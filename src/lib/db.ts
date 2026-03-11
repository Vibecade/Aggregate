import { get as getBlob, put as putBlob } from "@vercel/blob";
import fs from "node:fs/promises";
import path from "node:path";

import type { StoryInput, StoryListOptions, StoryRecord, StoryStats, StoryType } from "@/lib/types";

type StorageMode = "vercel-blob" | "local-file" | "tmp-file";

interface Snapshot {
  version: 1;
  stories: StoryRecord[];
  sync: Record<string, string>;
  updatedAt: string;
}

const SNAPSHOT_CACHE_MS = 5_000;
const SNAPSHOT_PATHNAME = "aggregate/stories-cache.json";
const LOCAL_DIRECTORY = path.join(process.cwd(), "data");
const LOCAL_SNAPSHOT_PATH = path.join(LOCAL_DIRECTORY, "stories-cache.json");
const TMP_SNAPSHOT_PATH = path.join("/tmp", "aggregate", "stories-cache.json");
const DEFAULT_MAX_SOCIAL_AGE_DAYS = 14;

let snapshotCache: Snapshot | null = null;
let snapshotCacheLoadedAt = 0;
let writeQueue: Promise<void> = Promise.resolve();

function isVercelRuntime(): boolean {
  return process.env.VERCEL === "1" || process.env.VERCEL === "true" || Boolean(process.env.VERCEL_ENV);
}

function getStorageMode(): StorageMode {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    return "vercel-blob";
  }

  if (isVercelRuntime()) {
    return "tmp-file";
  }

  return "local-file";
}

function getFileSnapshotPath(): string {
  return getStorageMode() === "tmp-file" ? TMP_SNAPSHOT_PATH : LOCAL_SNAPSHOT_PATH;
}

function createEmptySnapshot(): Snapshot {
  return {
    version: 1,
    stories: [],
    sync: {},
    updatedAt: new Date().toISOString(),
  };
}

function cloneSnapshot(snapshot: Snapshot): Snapshot {
  return JSON.parse(JSON.stringify(snapshot)) as Snapshot;
}

function normalizeStoryUrl(url: string): string {
  return url.replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
}

function normalizeStoryTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

function getMaxSocialAgeDays(): number {
  const parsed = Number(process.env.MAX_SOCIAL_AGE_DAYS ?? DEFAULT_MAX_SOCIAL_AGE_DAYS);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_SOCIAL_AGE_DAYS;
  }

  return Math.floor(parsed);
}

function isWithinSocialWindow(story: StoryRecord): boolean {
  if (story.sourceType === "news") {
    return true;
  }

  const publishedAt = new Date(story.publishedAt);
  if (Number.isNaN(publishedAt.getTime())) {
    return false;
  }

  const maxAgeMs = getMaxSocialAgeDays() * 24 * 60 * 60 * 1000;
  return Date.now() - publishedAt.getTime() <= maxAgeMs;
}

function getCanonicalSocialUrl(story: StoryRecord): string | null {
  const normalizedUrl = normalizeStoryUrl(story.url);

  if (
    story.sourceType === "twitter" &&
    /^https:\/\/x\.com\/[a-z0-9_]+\/status\/\d+$/i.test(normalizedUrl)
  ) {
    return normalizedUrl;
  }

  if (
    story.sourceType === "farcaster" &&
    /^https:\/\/(?:farcaster\.xyz|warpcast\.com)\/[a-z0-9_.-]+\/0x[0-9a-f]+$/i.test(
      normalizedUrl,
    )
  ) {
    return normalizedUrl.replace("https://warpcast.com/", "https://farcaster.xyz/");
  }

  return null;
}

function isDisplayableStory(story: StoryRecord): boolean {
  if (story.sourceType === "news") {
    return true;
  }

  return Boolean(getCanonicalSocialUrl(story)) && isWithinSocialWindow(story);
}

function getSocialTitleKey(story: StoryRecord): string {
  return `${story.sourceType}|${story.source.toLowerCase()}|${normalizeStoryTitle(story.title)}`;
}

function isProfileStyleSocialSource(story: StoryRecord): boolean {
  if (story.sourceType === "twitter") {
    return true;
  }

  return story.sourceType === "farcaster" && !story.source.toLowerCase().includes("channel");
}

function compareStoryPriority(left: StoryRecord, right: StoryRecord): number {
  const leftCanonical = getCanonicalSocialUrl(left);
  const rightCanonical = getCanonicalSocialUrl(right);

  if (Boolean(leftCanonical) !== Boolean(rightCanonical)) {
    return leftCanonical ? -1 : 1;
  }

  if (Boolean(left.author) !== Boolean(right.author)) {
    return left.author ? -1 : 1;
  }

  if (
    left.sourceType === "farcaster" &&
    right.sourceType === "farcaster" &&
    left.url !== right.url
  ) {
    const leftIsCanonicalHost = left.url.startsWith("https://farcaster.xyz/");
    const rightIsCanonicalHost = right.url.startsWith("https://farcaster.xyz/");

    if (leftIsCanonicalHost !== rightIsCanonicalHost) {
      return leftIsCanonicalHost ? -1 : 1;
    }
  }

  const leftPublished = new Date(left.publishedAt).getTime();
  const rightPublished = new Date(right.publishedAt).getTime();

  if (leftPublished !== rightPublished) {
    return rightPublished - leftPublished;
  }

  const leftUpdated = new Date(left.updatedAt).getTime();
  const rightUpdated = new Date(right.updatedAt).getTime();

  if (leftUpdated !== rightUpdated) {
    return rightUpdated - leftUpdated;
  }

  return right.title.length - left.title.length;
}

function dedupeStories(stories: StoryRecord[]): StoryRecord[] {
  const sortedByPriority = [...stories].sort(compareStoryPriority);
  const canonicalByUrl = new Map<string, StoryRecord>();
  const canonicalTitleKeys = new Set<string>();
  const canonicalSources = new Set<string>();

  for (const story of sortedByPriority) {
    if (story.sourceType === "news") {
      continue;
    }

    const canonicalUrl = getCanonicalSocialUrl(story);
    if (!canonicalUrl || canonicalByUrl.has(canonicalUrl)) {
      continue;
    }

    canonicalByUrl.set(canonicalUrl, story);
    canonicalTitleKeys.add(getSocialTitleKey(story));
    canonicalSources.add(`${story.sourceType}|${story.source}`);
  }

  const deduped: StoryRecord[] = [];
  const seenNewsUrls = new Set<string>();
  const seenFallbackKeys = new Set<string>();
  const seenCanonicalUrls = new Set<string>();

  for (const story of sortedByPriority) {
    if (!isDisplayableStory(story)) {
      continue;
    }

    if (story.sourceType === "news") {
      const normalizedUrl = normalizeStoryUrl(story.url);
      if (seenNewsUrls.has(normalizedUrl)) {
        continue;
      }

      seenNewsUrls.add(normalizedUrl);
      deduped.push(story);
      continue;
    }

    const canonicalUrl = getCanonicalSocialUrl(story);

    if (canonicalUrl) {
      if (seenCanonicalUrls.has(canonicalUrl)) {
        continue;
      }

      const preferredStory = canonicalByUrl.get(canonicalUrl);
      if (!preferredStory || preferredStory.uid !== story.uid) {
        continue;
      }

      seenCanonicalUrls.add(canonicalUrl);
      deduped.push(preferredStory);
      continue;
    }

    const titleKey = getSocialTitleKey(story);
    const sourceKey = `${story.sourceType}|${story.source}`;
    if (
      canonicalTitleKeys.has(titleKey) ||
      seenFallbackKeys.has(titleKey) ||
      (canonicalSources.has(sourceKey) && isProfileStyleSocialSource(story))
    ) {
      continue;
    }

    seenFallbackKeys.add(titleKey);
    deduped.push(story);
  }

  return deduped;
}

function sortStories(stories: StoryRecord[]): StoryRecord[] {
  return [...dedupeStories(stories)].sort((left, right) => {
    const leftTime = new Date(left.publishedAt).getTime();
    const rightTime = new Date(right.publishedAt).getTime();

    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }

    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}

function normalizeSnapshot(input: unknown): Snapshot {
  if (!input || typeof input !== "object") {
    return createEmptySnapshot();
  }

  const candidate = input as Partial<Snapshot>;
  const stories = Array.isArray(candidate.stories)
    ? candidate.stories.filter((story): story is StoryRecord => {
        return Boolean(
          story &&
            typeof story === "object" &&
            typeof story.uid === "string" &&
            typeof story.title === "string" &&
            typeof story.url === "string" &&
            typeof story.source === "string" &&
            typeof story.sourceType === "string" &&
            typeof story.publishedAt === "string" &&
            typeof story.createdAt === "string" &&
            typeof story.updatedAt === "string",
        );
      })
    : [];

  return {
    version: 1,
    stories: sortStories(stories),
    sync:
      candidate.sync && typeof candidate.sync === "object"
        ? Object.fromEntries(
            Object.entries(candidate.sync).filter(
              (entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string",
            ),
          )
        : {},
    updatedAt:
      typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString(),
  };
}

async function readSnapshotFromBlob(): Promise<Snapshot> {
  const result = await getBlob(SNAPSHOT_PATHNAME, {
    access: "public",
    useCache: false,
  });

  if (!result?.stream) {
    return createEmptySnapshot();
  }

  const text = await new Response(result.stream).text();

  try {
    return normalizeSnapshot(JSON.parse(text));
  } catch {
    return createEmptySnapshot();
  }
}

async function writeSnapshotToBlob(snapshot: Snapshot): Promise<void> {
  await putBlob(SNAPSHOT_PATHNAME, JSON.stringify(snapshot), {
    access: "public",
    allowOverwrite: true,
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
    contentType: "application/json",
  });
}

async function readSnapshotFromFile(filePath: string): Promise<Snapshot> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return normalizeSnapshot(JSON.parse(text));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;

    if (code === "ENOENT") {
      return createEmptySnapshot();
    }

    throw error;
  }
}

async function writeSnapshotToFile(filePath: string, snapshot: Snapshot): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(snapshot), "utf8");
}

async function readSnapshotFromStorage(): Promise<Snapshot> {
  const mode = getStorageMode();

  if (mode === "vercel-blob") {
    return readSnapshotFromBlob();
  }

  return readSnapshotFromFile(getFileSnapshotPath());
}

async function writeSnapshotToStorage(snapshot: Snapshot): Promise<void> {
  const mode = getStorageMode();

  if (mode === "vercel-blob") {
    await writeSnapshotToBlob(snapshot);
    return;
  }

  await writeSnapshotToFile(getFileSnapshotPath(), snapshot);
}

async function getSnapshot(forceRefresh = false): Promise<Snapshot> {
  if (
    !forceRefresh &&
    snapshotCache &&
    Date.now() - snapshotCacheLoadedAt < SNAPSHOT_CACHE_MS
  ) {
    return cloneSnapshot(snapshotCache);
  }

  const snapshot = await readSnapshotFromStorage();
  snapshotCache = cloneSnapshot(snapshot);
  snapshotCacheLoadedAt = Date.now();

  return snapshot;
}

async function persistSnapshot(snapshot: Snapshot): Promise<void> {
  snapshot.updatedAt = new Date().toISOString();
  await writeSnapshotToStorage(snapshot);
  snapshotCache = cloneSnapshot(snapshot);
  snapshotCacheLoadedAt = Date.now();
}

async function mutateSnapshot<T>(mutator: (snapshot: Snapshot) => T | Promise<T>): Promise<T> {
  const nextOperation = writeQueue.then(async () => {
    const snapshot = await getSnapshot(true);
    const result = await mutator(snapshot);
    snapshot.stories = sortStories(snapshot.stories);
    await persistSnapshot(snapshot);
    return result;
  });

  writeQueue = nextOperation.then(
    () => undefined,
    () => undefined,
  );

  return nextOperation;
}

function normalizeLimit(limit?: number): number {
  if (!limit || Number.isNaN(limit)) {
    return 200;
  }

  return Math.min(Math.max(Math.floor(limit), 1), 500);
}

export function getStorageInfo() {
  const mode = getStorageMode();

  return {
    mode,
    durable: mode !== "tmp-file",
    location:
      mode === "vercel-blob" ? SNAPSHOT_PATHNAME : getFileSnapshotPath(),
  };
}

export async function upsertStories(stories: StoryInput[]): Promise<number> {
  if (stories.length === 0) {
    return 0;
  }

  return mutateSnapshot((snapshot) => {
    const byUid = new Map(snapshot.stories.map((story) => [story.uid, story]));
    let inserted = 0;

    for (const incoming of stories) {
      const existing = byUid.get(incoming.uid);
      const now = new Date().toISOString();

      if (!existing) {
        inserted += 1;
      }

      byUid.set(incoming.uid, {
        uid: incoming.uid,
        title: incoming.title,
        url: incoming.url,
        source: incoming.source,
        sourceType: incoming.sourceType,
        publishedAt: incoming.publishedAt,
        summary: incoming.summary,
        author: incoming.author,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
    }

    snapshot.stories = [...byUid.values()];
    return inserted;
  });
}

export async function listStories(options: StoryListOptions = {}): Promise<StoryRecord[]> {
  const snapshot = await getSnapshot();
  const limit = normalizeLimit(options.limit);
  const stories = options.type
    ? snapshot.stories.filter(
        (story) => story.sourceType === options.type && isDisplayableStory(story),
      )
    : snapshot.stories.filter(isDisplayableStory);

  return stories.slice(0, limit);
}

export async function getStoryCount(type?: StoryType): Promise<number> {
  const snapshot = await getSnapshot();

  if (!type) {
    return snapshot.stories.filter(isDisplayableStory).length;
  }

  return snapshot.stories.filter(
    (story) => story.sourceType === type && isDisplayableStory(story),
  ).length;
}

export async function getStoryStats(): Promise<StoryStats> {
  const snapshot = await getSnapshot();
  const byType: Record<StoryType, number> = {
    news: 0,
    twitter: 0,
    farcaster: 0,
  };

  for (const story of snapshot.stories) {
    if (!isDisplayableStory(story)) {
      continue;
    }

    byType[story.sourceType] += 1;
  }

  return {
    total: Object.values(byType).reduce((sum, count) => sum + count, 0),
    byType,
  };
}

export async function setSyncValue(key: string, value: string): Promise<void> {
  await mutateSnapshot((snapshot) => {
    snapshot.sync[key] = value;
  });
}

export async function getSyncValue(key: string): Promise<string | null> {
  const snapshot = await getSnapshot();
  return snapshot.sync[key] ?? null;
}

export async function pruneStories(maxRows: number): Promise<void> {
  const sanitizedMaxRows = Math.max(1, Math.floor(maxRows));

  await mutateSnapshot((snapshot) => {
    snapshot.stories = snapshot.stories.slice(0, sanitizedMaxRows);
  });
}
