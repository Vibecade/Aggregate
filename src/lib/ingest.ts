import { createHash } from "node:crypto";

import Parser from "rss-parser";

import { pruneStories, upsertStories } from "@/lib/db";
import {
  BLUESKY_SOURCES,
  CRYPTO_KEYWORDS,
  FARCASTER_SOURCES,
  NEWS_FEED_SOURCES,
  REDDIT_SOURCES,
  TWITTER_SOURCES,
  type BlueskySource,
  type FarcasterSource,
  type NewsFeedSource,
  type RedditSource,
  type TwitterSource,
} from "@/lib/sources";
import {
  createEmptyStoryCounts,
  type RefreshResult,
  type SourceRefreshStatus,
  type StoryInput,
  type StoryType,
} from "@/lib/types";

const REQUEST_TIMEOUT_MS = 18000;
const DEFAULT_MAX_ROWS = 4000;
const FARCASTER_CAST_FETCH_LIMIT = 20;
const DEFAULT_MAX_SOCIAL_AGE_DAYS = 14;
const parser = new Parser();

interface TwitterPostEntry {
  snippet: string;
  statusUrl?: string;
}

interface FarcasterUserResponse {
  result?: {
    user?: {
      fid?: number;
      username?: string;
    };
  };
}

interface FarcasterProfileCastsResponse {
  result?: {
    casts?: FarcasterCast[];
  };
}

interface FarcasterCast {
  hash: string;
  timestamp: number;
  text: string;
  author?: {
    username?: string;
  };
}

interface FarcasterProfile {
  fid: number;
  username: string;
  profileUrl: string;
}

interface FarcasterSnippetCandidate {
  text: string;
  authorUsername?: string;
  fallbackUrl: string;
}

interface NeynarChannelFeedResponse {
  casts?: NeynarCast[];
}

interface NeynarCast {
  hash?: string;
  text?: string;
  timestamp?: string;
  author?: {
    username?: string;
  };
}

interface RedditTokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface RedditListingResponse {
  data?: {
    children?: Array<{
      data?: RedditPost;
    }>;
  };
}

interface RedditPost {
  id?: string;
  title?: string;
  selftext?: string;
  permalink?: string;
  created_utc?: number;
  author?: string;
  subreddit?: string;
}

interface BlueskyAuthorFeedResponse {
  feed?: Array<{
    post?: BlueskyPost;
  }>;
}

interface BlueskyPost {
  uri?: string;
  indexedAt?: string;
  author?: {
    handle?: string;
  };
  record?: {
    text?: string;
    createdAt?: string;
  };
}

const farcasterProfileCache = new Map<string, Promise<FarcasterProfile | null>>();
const farcasterCastCache = new Map<string, Promise<FarcasterCast[]>>();
let redditAccessTokenCache:
  | {
      token: string;
      expiresAt: number;
    }
  | null = null;

function normalizeText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSocialText(value: string): string {
  return normalizeText(value)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function getMaxSocialAgeDays(): number {
  const parsed = Number(process.env.MAX_SOCIAL_AGE_DAYS ?? DEFAULT_MAX_SOCIAL_AGE_DAYS);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_SOCIAL_AGE_DAYS;
  }

  return Math.floor(parsed);
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

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "User-Agent": "AggregateBot/1.0 (+https://localhost)",
        Accept: "application/json, text/plain, */*",
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function hasNeynarApiKey(): boolean {
  return Boolean(process.env.NEYNAR_API_KEY?.trim());
}

function getRedditCredentials():
  | {
      clientId: string;
      clientSecret: string;
    }
  | null {
  const clientId = process.env.REDDIT_CLIENT_ID?.trim();
  const clientSecret = process.env.REDDIT_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    return null;
  }

  return { clientId, clientSecret };
}

async function getRedditAccessToken(): Promise<string> {
  const credentials = getRedditCredentials();
  if (!credentials) {
    throw new Error("Missing Reddit API credentials");
  }

  if (redditAccessTokenCache && Date.now() < redditAccessTokenCache.expiresAt) {
    return redditAccessTokenCache.token;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${credentials.clientId}:${credentials.clientSecret}`,
        ).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "AggregateBot/1.0 (+https://localhost)",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = (await response.json()) as RedditTokenResponse;
    if (!payload.access_token) {
      throw new Error("Missing Reddit access token");
    }

    const expiresInMs = Math.max(60, Number(payload.expires_in ?? 3600) - 120) * 1000;
    redditAccessTokenCache = {
      token: payload.access_token,
      expiresAt: Date.now() + expiresInMs,
    };

    return payload.access_token;
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

function shouldIgnoreSocialLine(line: string): boolean {
  const lower = line.toLowerCase();

  if (
    lower === "pinned" ||
    lower.includes("don\u2019t miss what\u2019s happening") ||
    lower.includes("don't miss what's happening") ||
    lower.includes("people on x are the first to know") ||
    lower.includes("see new posts") ||
    lower.includes("new to x?") ||
    lower.includes("this account doesn\u2019t exist") ||
    lower.includes("this account doesn't exist") ||
    lower.includes("try searching for another") ||
    lower.includes("[ad]") ||
    lower.includes("create account") ||
    /(?:'s|\u2019s) posts$/i.test(line)
  ) {
    return true;
  }

  return false;
}

function isUsableSocialSnippet(line: string): boolean {
  if (line.length < 28 || line.length > 360) {
    return false;
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
    return false;
  }

  if (shouldIgnoreSocialLine(line)) {
    return false;
  }

  if (!/[A-Za-z]/.test(line)) {
    return false;
  }

  if (/^[0-9.,kKmM]+$/.test(line)) {
    return false;
  }

  if (!cryptoRelevant(line)) {
    return false;
  }

  return true;
}

function normalizeTwitterStatusUrl(url: string): string {
  return url.replace(/\/photo\/\d+$/i, "").replace(/[),.;]+$/, "");
}

function extractTwitterPostEntries(markdown: string, maxItems: number): TwitterPostEntry[] {
  const lines = markdown.split("\n");
  const postsStartIndex = lines.findIndex((line) =>
    /(?:'s|\u2019s) posts$/i.test(normalizeText(line)),
  );
  const relevantLines = postsStartIndex >= 0 ? lines.slice(postsStartIndex + 1) : lines;

  const entries: TwitterPostEntry[] = [];
  const seen = new Set<string>();
  let currentEntry: TwitterPostEntry | null = null;

  const flushCurrentEntry = () => {
    if (!currentEntry) {
      return;
    }

    if (!seen.has(currentEntry.snippet)) {
      seen.add(currentEntry.snippet);
      entries.push(currentEntry);
    }

    currentEntry = null;
  };

  for (const rawLine of relevantLines) {
    const line = normalizeSocialText(rawLine);
    const statusMatch = rawLine.match(/https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d+(?:\/photo\/\d+)?/);

    if (statusMatch && currentEntry && !currentEntry.statusUrl) {
      currentEntry.statusUrl = normalizeTwitterStatusUrl(statusMatch[0]);
    }

    if (!isUsableSocialSnippet(line)) {
      continue;
    }

    if (currentEntry) {
      flushCurrentEntry();
    }

    currentEntry = {
      snippet: line,
      statusUrl: statusMatch ? normalizeTwitterStatusUrl(statusMatch[0]) : undefined,
    };

    if (entries.length >= maxItems) {
      break;
    }
  }

  flushCurrentEntry();

  return entries.slice(0, maxItems);
}

function extractFarcasterUsernameFromUrl(url: string): string | null {
  const match = url.match(/^https:\/\/(?:warpcast\.com|farcaster\.xyz)\/([A-Za-z0-9_.-]+)$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function extractFarcasterChannelIdFromUrl(url: string): string | null {
  const match = url.match(/^https:\/\/warpcast\.com\/~\/channel\/([A-Za-z0-9_-]+)$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function extractFarcasterChannelCandidates(
  markdown: string,
  sourceUrl: string,
  maxItems: number,
): FarcasterSnippetCandidate[] {
  const candidates: FarcasterSnippetCandidate[] = [];
  const seen = new Set<string>();
  let currentAuthorUsername: string | undefined;

  for (const rawLine of markdown.split("\n")) {
    const avatarMatch = rawLine.match(
      /^\[!\[Image .* avatar\]\([^)]*\)\]\(https:\/\/(?:farcaster\.xyz|warpcast\.com)\/([A-Za-z0-9_.-]+)\)/i,
    );

    if (avatarMatch) {
      currentAuthorUsername = avatarMatch[1].toLowerCase();
    }

    const line = normalizeSocialText(rawLine);
    if (!isUsableSocialSnippet(line)) {
      continue;
    }

    if (seen.has(line)) {
      continue;
    }

    seen.add(line);
    candidates.push({
      text: line,
      authorUsername: currentAuthorUsername,
      fallbackUrl: currentAuthorUsername
        ? `https://farcaster.xyz/${currentAuthorUsername}`
        : sourceUrl,
    });

    if (candidates.length >= maxItems) {
      break;
    }
  }

  return candidates;
}

function getFarcasterCastHashPrefix(hash: string): string {
  return hash.slice(0, 10).toLowerCase();
}

function buildFarcasterCastUrl(username: string, hash: string): string {
  return `https://farcaster.xyz/${username.toLowerCase()}/${getFarcasterCastHashPrefix(hash)}`;
}

function normalizeRedditPermalink(permalink: string): string {
  return `https://www.reddit.com${permalink.startsWith("/") ? permalink : `/${permalink}`}`;
}

function buildBlueskyPostUrl(handle: string, uri: string): string | null {
  const match = uri.match(/\/app\.bsky\.feed\.post\/([^/]+)$/);
  if (!match) {
    return null;
  }

  return `https://bsky.app/profile/${handle.toLowerCase()}/post/${match[1]}`;
}

function normalizeComparableText(value: string): string {
  return normalizeSocialText(value)
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/www\.\S+/gi, " ")
    .replace(/[`"'()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function farcasterTextsLikelyMatch(snippet: string, castText: string): boolean {
  const snippetComparable = normalizeComparableText(snippet)
    .replace(/\.\.\.$/, "")
    .replace(/…$/, "")
    .trim();
  const castComparable = normalizeComparableText(castText);

  if (!snippetComparable || !castComparable) {
    return false;
  }

  if (castComparable === snippetComparable || castComparable.startsWith(snippetComparable)) {
    return true;
  }

  if (snippetComparable.length >= 48 && castComparable.includes(snippetComparable)) {
    return true;
  }

  const prefix = snippetComparable.slice(0, Math.min(snippetComparable.length, 120)).trim();
  return prefix.length >= 24 && castComparable.startsWith(prefix);
}

async function getFarcasterProfile(username: string): Promise<FarcasterProfile | null> {
  const normalizedUsername = username.trim().toLowerCase();
  const cachedProfile = farcasterProfileCache.get(normalizedUsername);
  if (cachedProfile) {
    return cachedProfile;
  }

  const profilePromise = (async () => {
    const data = await fetchJson<FarcasterUserResponse>(
      `https://client.farcaster.xyz/v2/user-by-username?username=${encodeURIComponent(
        normalizedUsername,
      )}`,
    );
    const fid = data.result?.user?.fid;
    const resolvedUsername = data.result?.user?.username?.trim().toLowerCase();

    if (!fid || !resolvedUsername) {
      return null;
    }

    return {
      fid,
      username: resolvedUsername,
      profileUrl: `https://farcaster.xyz/${resolvedUsername}`,
    };
  })();

  farcasterProfileCache.set(normalizedUsername, profilePromise);
  return profilePromise;
}

async function getFarcasterProfileCasts(profile: FarcasterProfile): Promise<FarcasterCast[]> {
  const cacheKey = String(profile.fid);
  const cachedCasts = farcasterCastCache.get(cacheKey);
  if (cachedCasts) {
    return cachedCasts;
  }

  const castsPromise = (async () => {
    const data = await fetchJson<FarcasterProfileCastsResponse>(
      `https://client.farcaster.xyz/v2/profile-casts?fid=${profile.fid}&limit=${FARCASTER_CAST_FETCH_LIMIT}`,
    );

    return (data.result?.casts ?? []).filter(
      (cast): cast is FarcasterCast =>
        typeof cast.hash === "string" &&
        typeof cast.text === "string" &&
        typeof cast.timestamp === "number",
    );
  })();

  farcasterCastCache.set(cacheKey, castsPromise);
  return castsPromise;
}

function normalizeStoryUrl(url: string): string {
  return url.replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
}

function dedupeKeyForStory(story: StoryInput): string {
  const normalizedUrl = normalizeStoryUrl(story.url);

  if (story.sourceType === "news") {
    return `${story.sourceType}|${normalizedUrl}`;
  }

  if (
    /\/status\/\d+$/i.test(normalizedUrl) ||
    /\/casts\//i.test(normalizedUrl) ||
    /\/0x[0-9a-f]+$/i.test(normalizedUrl) ||
    /\/comments\/[a-z0-9]+/i.test(normalizedUrl) ||
    /\/profile\/[^/]+\/post\/[^/]+$/i.test(normalizedUrl)
  ) {
    return `${story.sourceType}|${normalizedUrl}`;
  }

  return `${story.sourceType}|${story.title.trim().toLowerCase()}`;
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

function isRecentEnoughForSocial(isoDate: string): boolean {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  const maxAgeMs = getMaxSocialAgeDays() * 24 * 60 * 60 * 1000;
  return Date.now() - parsed.getTime() <= maxAgeMs;
}

function dedupeStories(stories: StoryInput[]): StoryInput[] {
  const orderedStories = [...stories].sort((a, b) => {
    const aTime = new Date(a.publishedAt).getTime();
    const bTime = new Date(b.publishedAt).getTime();
    return bTime - aTime;
  });

  const map = new Map<string, StoryInput>();
  const seenUids = new Set<string>();

  for (const story of orderedStories) {
    if (seenUids.has(story.uid)) {
      continue;
    }

    seenUids.add(story.uid);

    const dedupeKey = dedupeKeyForStory(story);
    if (!map.has(dedupeKey)) {
      map.set(dedupeKey, story);
    }
  }

  return [...map.values()];
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

  const entries = extractTwitterPostEntries(markdown, source.maxItems);

  return entries.flatMap((entry) => {
    if (!entry.statusUrl) {
      return [];
    }

    const publishedAt = decodeTweetDate(entry.statusUrl);
    if (!publishedAt || !isRecentEnoughForSocial(publishedAt)) {
      return [];
    }

    const uid = hashValue(`twitter|${source.handle}|${entry.statusUrl}|${entry.snippet}`);

    return [
      {
        uid,
        title: shorten(entry.snippet, 140),
        url: entry.statusUrl,
        source: `X @${source.handle}`,
        sourceType: "twitter" as const,
        publishedAt,
        summary: shorten(entry.snippet, 260),
        author: source.handle,
      },
    ];
  });
}

async function fetchNeynarChannelStories(source: FarcasterSource): Promise<StoryInput[]> {
  const channelId = extractFarcasterChannelIdFromUrl(source.url);
  const apiKey = process.env.NEYNAR_API_KEY?.trim();

  if (!channelId || !apiKey) {
    return [];
  }

  const data = await fetchJson<NeynarChannelFeedResponse>(
    `https://api.neynar.com/v2/farcaster/feed/channels?channel_ids=${encodeURIComponent(
      channelId,
    )}&limit=${Math.max(source.maxItems * 2, 10)}&with_recasts=false&with_replies=false`,
    {
      headers: {
        "x-api-key": apiKey,
      },
    },
  );

  const stories: StoryInput[] = [];
  const seenUrls = new Set<string>();

  for (const cast of data.casts ?? []) {
    const text = normalizeSocialText(String(cast.text ?? ""));
    const username = cast.author?.username?.trim().toLowerCase();
    const hash = cast.hash?.trim();
    const timestamp = cast.timestamp?.trim();

    if (!timestamp) {
      continue;
    }

    const publishedAt = ensureIsoDate(timestamp);

    if (!text || !username || !hash || !cryptoRelevant(text) || !isRecentEnoughForSocial(publishedAt)) {
      continue;
    }

    const url = buildFarcasterCastUrl(username, hash);
    if (seenUrls.has(url)) {
      continue;
    }

    seenUrls.add(url);
    stories.push({
      uid: hashValue(`farcaster|${source.label}|${url}|${text}`),
      title: shorten(text, 140),
      url,
      source: `Farcaster ${source.label}`,
      sourceType: "farcaster",
      publishedAt,
      summary: shorten(text, 260),
      author: username,
    });

    if (stories.length >= source.maxItems) {
      break;
    }
  }

  return stories;
}

async function fetchRedditStories(source: RedditSource): Promise<StoryInput[]> {
  const token = await getRedditAccessToken();
  const data = await fetchJson<RedditListingResponse>(
    `https://oauth.reddit.com/r/${encodeURIComponent(source.subreddit)}/new.json?limit=${Math.max(
      source.maxItems * 2,
      10,
    )}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  const stories: StoryInput[] = [];

  for (const child of data.data?.children ?? []) {
    const post = child.data;
    const title = normalizeSocialText(String(post?.title ?? ""));
    const summaryText = normalizeSocialText(String(post?.selftext ?? ""));
    const permalink = String(post?.permalink ?? "");
    const subreddit = String(post?.subreddit ?? source.subreddit);
    const author = normalizeText(String(post?.author ?? ""));

    if (!title || !permalink) {
      continue;
    }

    const combinedText = `${title} ${summaryText}`.trim();
    if (!cryptoRelevant(combinedText)) {
      continue;
    }

    const createdAtSeconds = Number(post?.created_utc ?? 0);
    if (!Number.isFinite(createdAtSeconds) || createdAtSeconds <= 0) {
      continue;
    }

    const publishedAt = ensureIsoDate(new Date(createdAtSeconds * 1000).toISOString());

    if (!isRecentEnoughForSocial(publishedAt)) {
      continue;
    }

    const url = normalizeRedditPermalink(permalink);
    stories.push({
      uid: hashValue(`reddit|${subreddit}|${url}|${title}`),
      title: shorten(title, 140),
      url,
      source: `Reddit r/${subreddit}`,
      sourceType: "reddit",
      publishedAt,
      summary: summaryText ? shorten(summaryText, 260) : undefined,
      author: author || undefined,
    });

    if (stories.length >= source.maxItems) {
      break;
    }
  }

  return stories;
}

async function fetchBlueskyStories(source: BlueskySource): Promise<StoryInput[]> {
  const data = await fetchJson<BlueskyAuthorFeedResponse>(
    `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(
      source.actor,
    )}&limit=${Math.max(source.maxItems * 3, 12)}`,
  );

  const stories: StoryInput[] = [];
  const seenUrls = new Set<string>();
  const normalizedActor = source.actor.trim().toLowerCase();

  for (const entry of data.feed ?? []) {
    const post = entry.post;
    const handle = post?.author?.handle?.trim().toLowerCase();
    const text = normalizeSocialText(String(post?.record?.text ?? ""));
    const url = handle && post?.uri ? buildBlueskyPostUrl(handle, post.uri) : null;

    if (!handle || handle !== normalizedActor || !text || !url || !cryptoRelevant(text)) {
      continue;
    }

    const rawPublishedAt = post?.indexedAt ?? post?.record?.createdAt;
    if (!rawPublishedAt) {
      continue;
    }

    const publishedAt = ensureIsoDate(rawPublishedAt);
    if (!isRecentEnoughForSocial(publishedAt) || seenUrls.has(url)) {
      continue;
    }

    seenUrls.add(url);
    stories.push({
      uid: hashValue(`bluesky|${source.actor}|${url}|${text}`),
      title: shorten(text, 140),
      url,
      source: `Bluesky ${source.label}`,
      sourceType: "bluesky",
      publishedAt,
      summary: shorten(text, 260),
      author: handle,
    });

    if (stories.length >= source.maxItems) {
      break;
    }
  }

  return stories;
}

async function fetchFarcasterStories(source: FarcasterSource): Promise<StoryInput[]> {
  const channelId = extractFarcasterChannelIdFromUrl(source.url);
  if (channelId && hasNeynarApiKey()) {
    const channelStories = await fetchNeynarChannelStories(source);
    if (channelStories.length > 0) {
      return channelStories;
    }
  }

  const sourceUsername = extractFarcasterUsernameFromUrl(source.url);

  if (sourceUsername) {
    const profile = await getFarcasterProfile(sourceUsername);
    if (!profile) {
      throw new Error(`Unable to resolve Farcaster profile for ${sourceUsername}`);
    }

    const casts = await getFarcasterProfileCasts(profile);
    const relevantCasts = casts
      .filter((cast) => cryptoRelevant(normalizeSocialText(cast.text)))
      .filter((cast) =>
        isRecentEnoughForSocial(new Date(cast.timestamp).toISOString()),
      )
      .slice(0, source.maxItems);

    return relevantCasts.map((cast, index) => {
      const text = normalizeSocialText(cast.text);
      const url = buildFarcasterCastUrl(profile.username, cast.hash);
      const publishedAt = ensureIsoDate(new Date(cast.timestamp).toISOString(), index * 6);
      const uid = hashValue(`farcaster|${source.label}|${url}|${text}`);

      return {
        uid,
        title: shorten(text, 140),
        url,
        source: `Farcaster ${source.label}`,
        sourceType: "farcaster" as const,
        publishedAt,
        summary: shorten(text, 260),
        author: profile.username,
      };
    });
  }

  const markdown = await fetchText(toJinaUrl(source.url));
  const candidates = extractFarcasterChannelCandidates(markdown, source.url, source.maxItems * 3);
  const authorUsernames = [
    ...new Set(
      candidates
        .map((candidate) => candidate.authorUsername)
        .filter((username): username is string => Boolean(username)),
    ),
  ];

  await Promise.all(
    authorUsernames.map(async (username) => {
      const profile = await getFarcasterProfile(username);
      if (profile) {
        await getFarcasterProfileCasts(profile);
      }
    }),
  );

  const stories: StoryInput[] = [];
  const seenUrls = new Set<string>();

  for (const candidate of candidates) {
    if (stories.length >= source.maxItems) {
      break;
    }

    let resolvedUrl: string | null = null;
    let publishedAt: string | null = null;
    let author = candidate.authorUsername;

    if (candidate.authorUsername) {
      const profile = await getFarcasterProfile(candidate.authorUsername);
      if (profile) {
        author = profile.username;

        const casts = await getFarcasterProfileCasts(profile);
        const matchedCast = casts.find((cast) => farcasterTextsLikelyMatch(candidate.text, cast.text));

        if (matchedCast) {
          const matchedPublishedAt = ensureIsoDate(new Date(matchedCast.timestamp).toISOString());
          if (isRecentEnoughForSocial(matchedPublishedAt)) {
            resolvedUrl = buildFarcasterCastUrl(profile.username, matchedCast.hash);
            publishedAt = matchedPublishedAt;
          }
        }
      }
    }

    if (!resolvedUrl || !publishedAt) {
      continue;
    }

    if (seenUrls.has(resolvedUrl)) {
      continue;
    }

    seenUrls.add(resolvedUrl);

    const uid = hashValue(`farcaster|${source.label}|${resolvedUrl}|${candidate.text}`);
    stories.push({
      uid,
      title: shorten(candidate.text, 140),
      url: resolvedUrl,
      source: `Farcaster ${source.label}`,
      sourceType: "farcaster" as const,
      publishedAt,
      summary: shorten(candidate.text, 260),
      author,
    });
  }

  return stories;
}

export async function ingestAllSources(): Promise<RefreshResult> {
  const redditEnabled = Boolean(getRedditCredentials());
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
    ...BLUESKY_SOURCES.map((source) => ({
      label: `Bluesky ${source.label}`,
      type: "bluesky" as const,
      run: () => fetchBlueskyStories(source),
    })),
    ...(!redditEnabled
      ? []
      : REDDIT_SOURCES.map((source) => ({
          label: `Reddit r/${source.subreddit}`,
          type: "reddit" as const,
          run: () => fetchRedditStories(source),
        }))),
  ];

  const errors: string[] = [];
  const collected: StoryInput[] = [];
  const sourceStatuses: SourceRefreshStatus[] = [];

  await Promise.all(
    jobs.map(async (job) => {
      const startedAt = Date.now();

      try {
        const stories = await job.run();
        collected.push(...stories);
        sourceStatuses.push({
          label: job.label,
          type: job.type,
          status: stories.length > 0 ? "healthy" : "quiet",
          storyCount: stories.length,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${job.label}: ${message}`);
        sourceStatuses.push({
          label: job.label,
          type: job.type,
          status: "error",
          storyCount: 0,
          durationMs: Date.now() - startedAt,
          message,
        });
      }
    }),
  );

  const dedupedStories = dedupeStories(collected);
  const inserted = await upsertStories(dedupedStories);

  const maxRows = Number(process.env.MAX_STORY_ROWS ?? DEFAULT_MAX_ROWS);
  await pruneStories(Number.isFinite(maxRows) ? maxRows : DEFAULT_MAX_ROWS);

  const byType = createEmptyStoryCounts();

  for (const story of dedupedStories) {
    byType[story.sourceType] += 1;
  }

  return {
    processed: dedupedStories.length,
    inserted,
    updatedAt: new Date().toISOString(),
    byType,
    errors,
    sources: sourceStatuses.sort((left, right) => left.label.localeCompare(right.label)),
  };
}
