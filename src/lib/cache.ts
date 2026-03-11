import { getStorageInfo, getStoryCount, getSyncValue, setSyncValue } from "@/lib/db";
import { ingestAllSources } from "@/lib/ingest";
import { createEmptyStoryCounts, isStoryType, type RefreshResult } from "@/lib/types";

const DEFAULT_CACHE_TTL_MINUTES = 15;
const LAST_REFRESH_REPORT_KEY = "last_refresh_report";

let activeRefreshPromise: Promise<RefreshResult> | null = null;

function getCacheTtlMinutes(): number {
  const parsed = Number(process.env.REFRESH_TTL_MINUTES ?? DEFAULT_CACHE_TTL_MINUTES);

  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return DEFAULT_CACHE_TTL_MINUTES;
}

function cacheIsStale(lastSyncedAt: string | null): boolean {
  if (!lastSyncedAt) {
    return true;
  }

  const timestamp = new Date(lastSyncedAt).getTime();
  if (Number.isNaN(timestamp)) {
    return true;
  }

  const ageMs = Date.now() - timestamp;
  const ttlMs = getCacheTtlMinutes() * 60_000;

  return ageMs >= ttlMs;
}

export function isRefreshing(): boolean {
  return activeRefreshPromise !== null;
}

export async function refreshStories(): Promise<RefreshResult> {
  if (activeRefreshPromise) {
    return activeRefreshPromise;
  }

  activeRefreshPromise = (async () => {
    const attemptTime = new Date().toISOString();
    await setSyncValue("last_attempt_sync", attemptTime);

    const result = await ingestAllSources();
    await setSyncValue("last_success_sync", result.updatedAt);
    await setSyncValue(LAST_REFRESH_REPORT_KEY, JSON.stringify(result));

    return result;
  })();

  try {
    return await activeRefreshPromise;
  } finally {
    activeRefreshPromise = null;
  }
}

export async function ensureFreshStories(): Promise<void> {
  const [lastSyncedAt, count] = await Promise.all([
    getSyncValue("last_success_sync"),
    getStoryCount(),
  ]);

  if (count === 0 || cacheIsStale(lastSyncedAt)) {
    await refreshStories();
  }
}

export async function getCacheMeta() {
  const [lastAttemptAt, lastSyncedAt] = await Promise.all([
    getSyncValue("last_attempt_sync"),
    getSyncValue("last_success_sync"),
  ]);

  return {
    ttlMinutes: getCacheTtlMinutes(),
    lastAttemptAt,
    lastSyncedAt,
    isRefreshing: isRefreshing(),
    storage: getStorageInfo(),
  };
}

export async function getLastRefreshReport(): Promise<RefreshResult | null> {
  const rawValue = await getSyncValue(LAST_REFRESH_REPORT_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<RefreshResult>;

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.updatedAt !== "string" ||
      typeof parsed.processed !== "number" ||
      typeof parsed.inserted !== "number" ||
      !parsed.byType ||
      typeof parsed.byType !== "object"
    ) {
      return null;
    }

    const byType = createEmptyStoryCounts();
    for (const type of Object.keys(byType)) {
      byType[type as keyof typeof byType] = Number(
        parsed.byType[type as keyof typeof parsed.byType] ?? 0,
      );
    }

    return {
      processed: parsed.processed,
      inserted: parsed.inserted,
      updatedAt: parsed.updatedAt,
      byType,
      errors: Array.isArray(parsed.errors) ? parsed.errors.filter((error): error is string => typeof error === "string") : [],
      sources: Array.isArray(parsed.sources)
        ? parsed.sources.filter(
            (source): source is RefreshResult["sources"][number] =>
              Boolean(
                source &&
                  typeof source === "object" &&
                  typeof source.label === "string" &&
                  typeof source.type === "string" &&
                  isStoryType(source.type) &&
                  typeof source.status === "string" &&
                  typeof source.storyCount === "number" &&
                  typeof source.durationMs === "number",
              ),
          )
        : [],
    };
  } catch {
    return null;
  }
}
