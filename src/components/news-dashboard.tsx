"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  buildStoryClusters,
  buildTopicCounts,
  curateStories,
  type CuratedStory,
  type StoryCluster,
} from "@/lib/curation";
import type {
  RefreshResult,
  SourceHealthStatus,
  SourceRefreshStatus,
  StoryRecord,
  StoryStats,
} from "@/lib/types";

type SelectedTopic = "all" | string;

type ApiResponse = {
  stories: StoryRecord[];
  stats: StoryStats;
  health: RefreshResult | null;
  meta: {
    ttlMinutes: number;
    lastAttemptAt: string | null;
    lastSyncedAt: string | null;
    isRefreshing: boolean;
  };
};

const TOPIC_STYLES: Record<string, string> = {
  bitcoin: "bg-amber-100 text-amber-900",
  ethereum: "bg-indigo-100 text-indigo-900",
  solana: "bg-emerald-100 text-emerald-900",
  defi: "bg-cyan-100 text-cyan-900",
  stablecoins: "bg-teal-100 text-teal-900",
  regulation: "bg-rose-100 text-rose-900",
  base: "bg-blue-100 text-blue-900",
  markets: "bg-orange-100 text-orange-900",
  infrastructure: "bg-slate-200 text-slate-900",
};

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

  const sameYear = parsed.getFullYear() === new Date().getFullYear();

  return parsed.toLocaleString(undefined, {
    year: sameYear ? undefined : "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) {
    return `${milliseconds}ms`;
  }

  return `${(milliseconds / 1_000).toFixed(1)}s`;
}

function storyLaneLabel(story: CuratedStory): string {
  if (story.sourceType === "twitter") {
    return "X";
  }

  if (story.sourceType === "farcaster") {
    return "Farcaster";
  }

  return "News";
}

function healthTone(status: SourceHealthStatus): string {
  if (status === "healthy") {
    return "bg-emerald-100 text-emerald-800";
  }

  if (status === "quiet") {
    return "bg-amber-100 text-amber-900";
  }

  return "bg-rose-100 text-rose-900";
}

function topicTone(slug: string): string {
  return TOPIC_STYLES[slug] ?? "bg-slate-100 text-slate-800";
}

function StoryCard({ story }: { story: CuratedStory }) {
  return (
    <article className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-[0_20px_50px_-40px_rgba(15,23,42,0.45)] ring-1 ring-white/40 transition hover:-translate-y-0.5 hover:border-sky-300">
      <div className="flex items-start justify-between gap-3 text-xs uppercase tracking-[0.12em] text-slate-500">
        <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">
          {storyLaneLabel(story)}
        </span>
        <time dateTime={story.publishedAt}>{formatRelativeTime(story.publishedAt)}</time>
      </div>

      <a
        className="mt-3 block text-lg font-semibold leading-tight text-slate-900 transition hover:text-sky-700"
        href={story.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {story.title}
      </a>

      <p className="mt-3 text-sm leading-relaxed text-slate-600">
        {story.summary ?? "Open the source for full context."}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {story.topics.map((topic) => (
          <span
            key={`${story.uid}-${topic.slug}`}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${topicTone(topic.slug)}`}
          >
            {topic.label}
          </span>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
        <span className="truncate" title={story.source}>
          {story.source}
        </span>
        {story.author ? <span className="font-semibold">{story.author}</span> : null}
      </div>
    </article>
  );
}

function ClusterCard({ cluster }: { cluster: StoryCluster }) {
  const leadStory = cluster.stories[0];

  return (
    <article className="rounded-3xl border border-slate-200/80 bg-white/92 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.5)]">
      <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.14em] text-slate-500">
        <span className="rounded-full bg-slate-900 px-2.5 py-1 font-semibold text-white">
          {cluster.lane === "news" ? "News Cluster" : "Social Cluster"}
        </span>
        {cluster.topic ? (
          <span className={`rounded-full px-2.5 py-1 font-semibold ${topicTone(cluster.topic.slug)}`}>
            {cluster.topic.label}
          </span>
        ) : null}
        <span>{cluster.stories.length} related items</span>
      </div>

      <a
        href={leadStory.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 block text-2xl font-semibold leading-tight text-slate-900 transition hover:text-sky-700"
      >
        {cluster.title}
      </a>

      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600">
        {cluster.summary ?? "Open the lead story for the full thread of coverage."}
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-slate-500">
        <span>{cluster.sourceCount} sources</span>
        <span>{formatRelativeTime(cluster.publishedAt)}</span>
        <span className="truncate">Lead: {leadStory.source}</span>
      </div>
    </article>
  );
}

function HealthCard({ source }: { source: SourceRefreshStatus }) {
  return (
    <article className="rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{source.label}</p>
          <p className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">{source.type}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${healthTone(source.status)}`}>
          {source.status}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
        <span>{source.storyCount} stories</span>
        <span>{formatDuration(source.durationMs)}</span>
      </div>

      <p className="mt-3 min-h-10 text-xs leading-relaxed text-slate-500">
        {source.message ?? "Feed healthy during the last refresh window."}
      </p>
    </article>
  );
}

export function NewsDashboard() {
  const [stories, setStories] = useState<StoryRecord[]>([]);
  const [stats, setStats] = useState<StoryStats>({
    total: 0,
    byType: { news: 0, twitter: 0, farcaster: 0 },
  });
  const [health, setHealth] = useState<RefreshResult | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<SelectedTopic>("all");

  const loadStories = useCallback(async (options?: { forceRefresh?: boolean; background?: boolean }) => {
    if (!options?.background) {
      setLoading(true);
    }

    if (options?.forceRefresh) {
      setIsRefreshing(true);
    }

    setError(null);

    try {
      const params = new URLSearchParams({ limit: "320" });

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
      setHealth(payload.health ?? null);
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
  }, []);

  useEffect(() => {
    void loadStories();

    const interval = setInterval(() => {
      void loadStories({ background: true });
    }, 90_000);

    return () => clearInterval(interval);
  }, [loadStories]);

  const curatedStories = useMemo(() => curateStories(stories), [stories]);
  const healthSources = useMemo(() => health?.sources ?? [], [health]);

  const topicCounts = useMemo(() => buildTopicCounts(curatedStories), [curatedStories]);

  useEffect(() => {
    if (
      selectedTopic !== "all" &&
      !topicCounts.some((entry) => entry.topic.slug === selectedTopic)
    ) {
      setSelectedTopic("all");
    }
  }, [selectedTopic, topicCounts]);

  const filteredStories = useMemo(() => {
    if (selectedTopic === "all") {
      return curatedStories;
    }

    return curatedStories.filter((story) =>
      story.topics.some((topic) => topic.slug === selectedTopic),
    );
  }, [curatedStories, selectedTopic]);

  const clusters = useMemo(() => buildStoryClusters(filteredStories), [filteredStories]);
  const featuredClusters = useMemo(
    () => clusters.filter((cluster) => cluster.stories.length > 1).slice(0, 3),
    [clusters],
  );

  const newsStories = useMemo(
    () => filteredStories.filter((story) => story.lane === "news").slice(0, 9),
    [filteredStories],
  );
  const socialStories = useMemo(
    () => filteredStories.filter((story) => story.lane === "social").slice(0, 9),
    [filteredStories],
  );

  const socialCount = stats.byType.twitter + stats.byType.farcaster;
  const healthySourceCount = healthSources.filter((source) => source.status === "healthy").length;
  const degradedSourceCount = healthSources.filter((source) => source.status === "error").length;
  const quietSourceCount = healthSources.filter((source) => source.status === "quiet").length;

  const sortedSources = useMemo(() => {
    if (!health) {
      return [];
    }

    const rank = { error: 0, quiet: 1, healthy: 2 };
    return [...healthSources].sort((left, right) => {
      if (rank[left.status] !== rank[right.status]) {
        return rank[left.status] - rank[right.status];
      }

      return left.label.localeCompare(right.label);
    });
  }, [health, healthSources]);

  const topicOptions = useMemo(
    () => [
      { slug: "all", label: "All Topics", count: curatedStories.length },
      ...topicCounts.map((entry) => ({
        slug: entry.topic.slug,
        label: entry.topic.label,
        count: entry.count,
      })),
    ],
    [curatedStories.length, topicCounts],
  );

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,rgba(15,118,110,0.18),transparent_44%),radial-gradient(circle_at_top_left,rgba(251,146,60,0.16),transparent_36%),linear-gradient(180deg,#f6fbff_0%,#ecf4fb_100%)]">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <section className="relative overflow-hidden rounded-[2rem] border border-white/60 bg-slate-900 px-6 py-8 shadow-[0_26px_80px_-42px_rgba(2,15,23,0.75)] sm:px-10">
          <div className="pointer-events-none absolute -top-24 left-6 h-56 w-56 rounded-full bg-orange-400/30 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 right-12 h-56 w-56 rounded-full bg-teal-300/25 blur-3xl" />

          <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-200">
                Aggregate
              </p>
              <h1 className="mt-2 text-3xl font-semibold text-white sm:text-4xl">
                Crypto Newsroom + Social Radar
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-200 sm:text-base">
                Reputable crypto coverage and filtered social signal, separated into news and
                social lanes, clustered by topic, and backed by source-health visibility.
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
                  ? `Last good sync ${formatRelativeTime(lastSyncedAt)}`
                  : "Waiting for first sync"}
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-sm">
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Visible Stories</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{stats.total}</p>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-sm">
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">News Desk</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{stats.byType.news}</p>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-sm">
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Social Pulse</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{socialCount}</p>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-sm">
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Healthy Sources</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {healthySourceCount}
              <span className="ml-1 text-sm font-medium text-slate-500">
                / {healthSources.length}
              </span>
            </p>
          </div>
        </section>

        <section className="mt-6 rounded-3xl border border-slate-200/80 bg-white/85 p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Topic Radar
              </p>
              <h2 className="mt-1 text-xl font-semibold text-slate-900">
                Filter the newsroom by the themes actually moving this cycle
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {topicOptions.map((topic) => {
                const active = selectedTopic === topic.slug;

                return (
                  <button
                    key={topic.slug}
                    type="button"
                    onClick={() => setSelectedTopic(topic.slug)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                      active
                        ? "bg-slate-900 text-white"
                        : "border border-slate-300 bg-white text-slate-700 hover:border-slate-400"
                    }`}
                  >
                    {topic.label}
                    <span className="ml-2 text-xs opacity-70">{topic.count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {error ? (
          <section className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </section>
        ) : null}

        {loading && stories.length === 0 ? (
          <section className="mt-6 grid gap-4 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={`skeleton-${index}`}
                className="h-60 animate-pulse rounded-3xl border border-slate-200 bg-white/70"
              />
            ))}
          </section>
        ) : null}

        {!loading && filteredStories.length === 0 ? (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white/80 px-5 py-10 text-center text-slate-600">
            No stories match this topic right now.
          </section>
        ) : null}

        {featuredClusters.length > 0 ? (
          <section className="mt-6">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Story Clusters
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-slate-900">
                  Market-moving threads across multiple sources
                </h2>
              </div>
              <p className="text-sm text-slate-500">{featuredClusters.length} active clusters</p>
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              {featuredClusters.map((cluster) => (
                <ClusterCard key={cluster.key} cluster={cluster} />
              ))}
            </div>
          </section>
        ) : null}

        {filteredStories.length > 0 ? (
          <section className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_1fr]">
            <div className="rounded-3xl border border-slate-200/80 bg-white/88 p-5 shadow-sm">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    News Desk
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold text-slate-900">
                    Reputable coverage, ranked for recency
                  </h2>
                </div>
                <p className="text-sm text-slate-500">{newsStories.length} stories</p>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                {newsStories.map((story) => (
                  <StoryCard key={story.uid} story={story} />
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200/80 bg-white/88 p-5 shadow-sm">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Social Pulse
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold text-slate-900">
                    Higher-signal X and Farcaster references
                  </h2>
                </div>
                <p className="text-sm text-slate-500">{socialStories.length} posts</p>
              </div>

              <div className="grid gap-4">
                {socialStories.map((story) => (
                  <StoryCard key={story.uid} story={story} />
                ))}
              </div>
            </div>
          </section>
        ) : null}

        <section className="mt-6 rounded-3xl border border-slate-200/80 bg-white/88 p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Source Health
              </p>
              <h2 className="mt-1 text-2xl font-semibold text-slate-900">
                Last refresh visibility across every upstream source
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em]">
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">
                Healthy {healthySourceCount}
              </span>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">
                Quiet {quietSourceCount}
              </span>
              <span className="rounded-full bg-rose-100 px-3 py-1 text-rose-900">
                Errors {degradedSourceCount}
              </span>
            </div>
          </div>

          {sortedSources.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
              Source health becomes available after the first completed refresh.
            </div>
          ) : (
            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {sortedSources.map((source) => (
                <HealthCard key={`${source.type}-${source.label}`} source={source} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
