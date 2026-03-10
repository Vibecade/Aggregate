import { createHash } from "node:crypto";

import Parser from "rss-parser";

import { pruneStories, upsertStories } from "@/lib/db";
import {
  CRYPTO_KEYWORDS,
  FARCASTER_SOURCES,
  NEWS_FEED_SOURCES,
  TWITTER_SOURCES,
  type FarcasterSource,
  type NewsFeedSource,
  type TwitterSource,
} from "@/lib/sources";
import type { RefreshResult, StoryInput, StoryType } from "@/lib/types";

const REQUEST_TIMEOUT_MS = 18000;
const DEFAULT_MAX_ROWS = 2500;
const parser = new Parser();

function normalizeText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function ensureIsoDate(value: string | undefined, fallbackShiftMinutes = 0): string {
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date(Date.now() - fallbackShiftMinutes * 60_000).toISOString();
}

function toJinaUrl(targetUrl: string): string {
  return `https://r.jina.ai/http://${targetUrl.replace(/^https?:\/\//, "")}`;
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "User-Agent": "AggregateBot/1.0 (+https://localhost)",
        Accept: "text/plain, text/html, application/xml, text/xml, */*",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function cryptoRelevant(text: string): boolean {
  const lower = text.toLowerCase();
  return CRYPTO_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function shorten(text: string, max = 160): string {
  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

function parseSocialSnippets(markdown: string, maxItems: number): string[] {
  const lines = markdown.split("\n");
  const snippets: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of lines) {
    const line = normalizeText(rawLine);

    if (line.length < 28 || line.length > 360) {
      continue;
    }

    if (
      line.startsWith("Title:") ||
      line.startsWith("URL Source:") ||
      line.startsWith("Markdown Content:") ||
      line.startsWith("Replying to") ||
      line.startsWith("Quote") ||
      line.startsWith("http") ||
      line.startsWith("[") ||
      line.startsWith("!") ||
      line.startsWith(">")
    ) {
      continue;
    }

    if (!/[A-Za-z]/.test(line)) {
      continue;
    }

    if (/^[0-9.,kKmM]+$/.test(line)) {
      continue;
    }

    if (!cryptoRelevant(line)) {
      continue;
    }

    if (seen.has(line)) {
      continue;
    }

    seen.add(line);
    snippets.push(line);

    if (snippets.length >= maxItems) {
      break;
    }
  }

  return snippets;
}

function parseTwitterStatusUrls(markdown: string): string[] {
  const matches = [...markdown.matchAll(/https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d+/g)];
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const match of matches) {
    const url = match[0];
    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }

  return urls;
}

function parseFarcasterUrls(markdown: string): string[] {
  const matches = [
    ...markdown.matchAll(/https:\/\/(?:warpcast|farcaster)\.com\/[A-Za-z0-9_./~-]+/g),
  ];

  const seen = new Set<string>();
  const urls: string[] = [];

  for (const match of matches) {
    const url = match[0].replace(/[),.;]+$/, "");
    const isCastUrl = /\/0x[0-9a-fA-F]+/.test(url) || /\/casts\//.test(url);

    if (!isCastUrl) {
      continue;
    }

    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }

  return urls;
}

function decodeTweetDate(statusUrl: string): string | null {
  const match = statusUrl.match(/status\/(\d+)/);
  if (!match) {
    return null;
  }

  try {
    const snowflake = BigInt(match[1]);
    const shift = BigInt(22);
    const twitterEpochMs = BigInt("1288834974657");
    const createdAtMs = Number((snowflake >> shift) + twitterEpochMs);

    if (!Number.isFinite(createdAtMs)) {
      return null;
    }

    return new Date(createdAtMs).toISOString();
  } catch {
    return null;
  }
}

function dedupeStories(stories: StoryInput[]): StoryInput[] {
  const map = new Map<string, StoryInput>();

  for (const story of stories) {
    if (!map.has(story.uid)) {
      map.set(story.uid, story);
    }
  }

  return [...map.values()].sort((a, b) => {
    const aTime = new Date(a.publishedAt).getTime();
    const bTime = new Date(b.publishedAt).getTime();
    return bTime - aTime;
  });
}

async function fetchNewsStories(source: NewsFeedSource): Promise<StoryInput[]> {
  const xml = await fetchText(source.url);
  const feed = await parser.parseString(xml);

  const items = Array.isArray(feed.items) ? feed.items : [];
  const stories: StoryInput[] = [];

  for (const item of items.slice(0, source.maxItems)) {
    const title = normalizeText(String(item.title ?? ""));
    const url = normalizeText(String(item.link ?? item.guid ?? source.url));
    const summary = normalizeText(
      String(item.contentSnippet ?? item.summary ?? item.content ?? ""),
    );
    const author = normalizeText(String(item.creator ?? item.author ?? ""));
    const publishedAt = ensureIsoDate(
      typeof item.isoDate === "string" ? item.isoDate : item.pubDate,
    );

    if (!title || !url) {
      continue;
    }

    const uid = hashValue(`news|${source.name}|${url}|${title}`);

    stories.push({
      uid,
      title: shorten(title, 150),
      url,
      source: source.name,
      sourceType: "news",
      publishedAt,
      summary: summary ? shorten(summary, 260) : undefined,
      author: author || undefined,
    });
  }

  return stories;
}

async function fetchTwitterStories(source: TwitterSource): Promise<StoryInput[]> {
  const profileUrl = `https://x.com/${source.handle}`;
  const markdown = await fetchText(toJinaUrl(profileUrl));

  const snippets = parseSocialSnippets(markdown, source.maxItems);
  const statusUrls = parseTwitterStatusUrls(markdown);

  return snippets.map((snippet, index) => {
    const url = statusUrls[index] ?? profileUrl;
    const publishedAt = decodeTweetDate(url) ?? ensureIsoDate(undefined, index * 5);
    const uid = hashValue(`twitter|${source.handle}|${url}|${snippet}`);

    return {
      uid,
      title: shorten(snippet, 140),
      url,
      source: `X @${source.handle}`,
      sourceType: "twitter" as const,
      publishedAt,
      summary: shorten(snippet, 260),
      author: source.handle,
    };
  });
}

async function fetchFarcasterStories(source: FarcasterSource): Promise<StoryInput[]> {
  const markdown = await fetchText(toJinaUrl(source.url));

  const snippets = parseSocialSnippets(markdown, source.maxItems);
  const castUrls = parseFarcasterUrls(markdown);

  return snippets.map((snippet, index) => {
    const url = castUrls[index] ?? source.url;
    const publishedAt = ensureIsoDate(undefined, index * 6);
    const uid = hashValue(`farcaster|${source.label}|${url}|${snippet}`);

    return {
      uid,
      title: shorten(snippet, 140),
      url,
      source: `Farcaster ${source.label}`,
      sourceType: "farcaster" as const,
      publishedAt,
      summary: shorten(snippet, 260),
    };
  });
}

export async function ingestAllSources(): Promise<RefreshResult> {
  const jobs: Array<{
    label: string;
    type: StoryType;
    run: () => Promise<StoryInput[]>;
  }> = [
    ...NEWS_FEED_SOURCES.map((source) => ({
      label: source.name,
      type: "news" as const,
      run: () => fetchNewsStories(source),
    })),
    ...TWITTER_SOURCES.map((source) => ({
      label: `X @${source.handle}`,
      type: "twitter" as const,
      run: () => fetchTwitterStories(source),
    })),
    ...FARCASTER_SOURCES.map((source) => ({
      label: `Farcaster ${source.label}`,
      type: "farcaster" as const,
      run: () => fetchFarcasterStories(source),
    })),
  ];

  const errors: string[] = [];
  const collected: StoryInput[] = [];

  await Promise.all(
    jobs.map(async (job) => {
      try {
        const stories = await job.run();
        collected.push(...stories);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${job.label}: ${message}`);
      }
    }),
  );

  const dedupedStories = dedupeStories(collected);
  const inserted = await upsertStories(dedupedStories);

  const maxRows = Number(process.env.MAX_STORY_ROWS ?? DEFAULT_MAX_ROWS);
  await pruneStories(Number.isFinite(maxRows) ? maxRows : DEFAULT_MAX_ROWS);

  const byType: Record<StoryType, number> = {
    news: 0,
    twitter: 0,
    farcaster: 0,
  };

  for (const story of dedupedStories) {
    byType[story.sourceType] += 1;
  }

  return {
    processed: dedupedStories.length,
    inserted,
    updatedAt: new Date().toISOString(),
    byType,
    errors,
  };
}
