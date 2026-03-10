import { getStoryCount, getSyncValue, setSyncValue } from "@/lib/db";
import { ingestAllSources } from "@/lib/ingest";
import type { RefreshResult } from "@/lib/types";

const DEFAULT_CACHE_TTL_MINUTES = 15;

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
    setSyncValue("last_attempt_sync", attemptTime);

    const result = await ingestAllSources();
    setSyncValue("last_success_sync", result.updatedAt);

    return result;
  })();

  try {
    return await activeRefreshPromise;
  } finally {
    activeRefreshPromise = null;
  }
}

export async function ensureFreshStories(): Promise<void> {
  const lastSyncedAt = getSyncValue("last_success_sync");
  const count = getStoryCount();

  if (count === 0 || cacheIsStale(lastSyncedAt)) {
    await refreshStories();
  }
}

export function getCacheMeta() {
  return {
    ttlMinutes: getCacheTtlMinutes(),
    lastAttemptAt: getSyncValue("last_attempt_sync"),
    lastSyncedAt: getSyncValue("last_success_sync"),
    isRefreshing: isRefreshing(),
  };
}
