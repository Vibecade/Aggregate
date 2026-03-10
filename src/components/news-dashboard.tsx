"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { StoryRecord, StoryStats, StoryType } from "@/lib/types";

type FilterType = "all" | StoryType;

type ApiResponse = {
  stories: StoryRecord[];
  stats: StoryStats;
  meta: {
    ttlMinutes: number;
    lastAttemptAt: string | null;
    lastSyncedAt: string | null;
    isRefreshing: boolean;
  };
};

const FILTERS: Array<{ label: string; value: FilterType }> = [
  { label: "All", value: "all" },
  { label: "News", value: "news" },
  { label: "X / Twitter", value: "twitter" },
  { label: "Farcaster", value: "farcaster" },
];

function formatRelativeTime(value: string): string {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "Unknown time";
  }

  const diffMs = Date.now() - parsed.getTime();
  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 1) {
    return "Just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 8) {
    return `${days}d ago`;
  }

  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function sourceTypeLabel(type: StoryType): string {
  if (type === "twitter") {
    return "X";
  }

  if (type === "farcaster") {
    return "Farcaster";
  }

  return "News";
}

export function NewsDashboard() {
  const [selectedFilter, setSelectedFilter] = useState<FilterType>("all");
  const [stories, setStories] = useState<StoryRecord[]>([]);
  const [stats, setStats] = useState<StoryStats>({
    total: 0,
    byType: { news: 0, twitter: 0, farcaster: 0 },
  });
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStories = useCallback(
    async (options?: { forceRefresh?: boolean; background?: boolean }) => {
      if (!options?.background) {
        setLoading(true);
      }

      if (options?.forceRefresh) {
        setIsRefreshing(true);
      }

      setError(null);

      try {
        const params = new URLSearchParams({ limit: "220" });

        if (selectedFilter !== "all") {
          params.set("type", selectedFilter);
        }

        if (options?.forceRefresh) {
          params.set("refresh", "true");
        }

        const response = await fetch(`/api/stories?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Failed to load feed (${response.status})`);
        }

        const payload = (await response.json()) as ApiResponse;

        setStories(payload.stories ?? []);
        setStats(payload.stats ?? { total: 0, byType: { news: 0, twitter: 0, farcaster: 0 } });
        setLastSyncedAt(payload.meta?.lastSyncedAt ?? null);
        setIsRefreshing(Boolean(payload.meta?.isRefreshing));
      } catch (requestError) {
        const message =
          requestError instanceof Error ? requestError.message : "Could not load stories.";
        setError(message);
      } finally {
        setLoading(false);
        if (options?.forceRefresh) {
          setIsRefreshing(false);
        }
      }
    },
    [selectedFilter],
  );

  useEffect(() => {
    void loadStories();

    const interval = setInterval(() => {
      void loadStories({ background: true });
    }, 90_000);

    return () => clearInterval(interval);
  }, [loadStories]);

  const cards = useMemo(() => {
    return stories.map((story, index) => {
      return (
        <article
          key={story.uid}
          className="card-fade group rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-[0_20px_60px_-44px_rgba(3,37,56,0.75)] ring-1 ring-white/40 transition hover:-translate-y-0.5 hover:border-sky-300"
          style={{ animationDelay: `${Math.min(index * 35, 280)}ms` }}
        >
          <div className="mb-3 flex items-center justify-between gap-3 text-xs uppercase tracking-[0.12em] text-slate-500">
            <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">
              {sourceTypeLabel(story.sourceType)}
            </span>
            <time dateTime={story.publishedAt}>{formatRelativeTime(story.publishedAt)}</time>
          </div>

          <a
            className="block text-lg font-semibold leading-tight text-slate-900 transition group-hover:text-sky-700"
            href={story.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {story.title}
          </a>

          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            {story.summary ?? "Open this story for full context."}
          </p>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
            <span className="truncate" title={story.source}>
              {story.source}
            </span>
            {story.author ? <span className="font-semibold">{story.author}</span> : null}
          </div>
        </article>
      );
    });
  }, [stories]);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,rgba(15,118,110,0.18),transparent_44%),radial-gradient(circle_at_top_left,rgba(251,146,60,0.16),transparent_36%),linear-gradient(180deg,#f6fbff_0%,#ecf4fb_100%)]">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <section className="relative overflow-hidden rounded-3xl border border-white/60 bg-slate-900 px-6 py-8 shadow-[0_26px_80px_-42px_rgba(2,15,23,0.75)] sm:px-10">
          <div className="pointer-events-none absolute -top-24 left-6 h-56 w-56 rounded-full bg-orange-400/30 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 right-12 h-56 w-56 rounded-full bg-teal-300/25 blur-3xl" />

          <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-200">
                Aggregate
              </p>
              <h1 className="mt-2 text-3xl font-semibold text-white sm:text-4xl">
                Crypto News + Social Pulse
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-200 sm:text-base">
                Stories are cached on the server and refreshed in scheduled windows, so you can
                monitor markets without hammering upstream APIs.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void loadStories({ forceRefresh: true })}
                disabled={isRefreshing}
                className="rounded-full bg-orange-400 px-5 py-2 text-sm font-semibold text-slate-900 transition hover:bg-orange-300 disabled:cursor-not-allowed disabled:opacity-65"
              >
                {isRefreshing ? "Refreshing..." : "Refresh Feed"}
              </button>
              <div className="rounded-full border border-white/30 bg-white/10 px-4 py-2 text-xs text-slate-100">
                {lastSyncedAt
                  ? `Synced ${formatRelativeTime(lastSyncedAt)}`
                  : "Waiting for first sync"}
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-sm">
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Total Stories</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{stats.total}</p>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-sm">
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">News</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{stats.byType.news}</p>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-sm">
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">X / Twitter</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{stats.byType.twitter}</p>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-sm">
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Farcaster</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{stats.byType.farcaster}</p>
          </div>
        </section>

        <section className="mt-6 flex flex-wrap items-center gap-3">
          {FILTERS.map((filter) => {
            const active = selectedFilter === filter.value;

            return (
              <button
                key={filter.value}
                type="button"
                onClick={() => setSelectedFilter(filter.value)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  active
                    ? "bg-slate-900 text-white"
                    : "border border-slate-300 bg-white/80 text-slate-700 hover:border-slate-400"
                }`}
              >
                {filter.label}
              </button>
            );
          })}
        </section>

        {error ? (
          <section className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </section>
        ) : null}

        {loading && stories.length === 0 ? (
          <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={`skeleton-${index}`}
                className="h-56 animate-pulse rounded-2xl border border-slate-200 bg-white/70"
              />
            ))}
          </section>
        ) : null}

        {!loading && stories.length === 0 ? (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white/80 px-5 py-10 text-center text-slate-600">
            No stories available yet. Try forcing a refresh.
          </section>
        ) : null}

        {stories.length > 0 ? (
          <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{cards}</section>
        ) : null}
      </div>
    </main>
  );
}
