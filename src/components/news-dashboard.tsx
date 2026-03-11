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
  StoryType,
} from "@/lib/types";

type SelectedTopic = "all" | string;
type DashboardTheme = "light" | "dark";
type SourceFilter = "all" | StoryType;

const SAVED_TOPICS_STORAGE_KEY = "aggregate.saved-topics.v1";
const THEME_STORAGE_KEY = "aggregate.dashboard-theme.v1";
const SOURCE_FILTER_STORAGE_KEY = "aggregate.source-filter.v1";

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

const TOPIC_STYLES_LIGHT: Record<string, string> = {
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

const TOPIC_STYLES_DARK: Record<string, string> = {
  bitcoin: "bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/20",
  ethereum: "bg-indigo-500/15 text-indigo-200 ring-1 ring-indigo-400/20",
  solana: "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/20",
  defi: "bg-cyan-500/15 text-cyan-200 ring-1 ring-cyan-400/20",
  stablecoins: "bg-teal-500/15 text-teal-200 ring-1 ring-teal-400/20",
  regulation: "bg-rose-500/15 text-rose-200 ring-1 ring-rose-400/20",
  base: "bg-blue-500/15 text-blue-200 ring-1 ring-blue-400/20",
  markets: "bg-orange-500/15 text-orange-200 ring-1 ring-orange-400/20",
  infrastructure: "bg-slate-700/60 text-slate-100 ring-1 ring-slate-500/30",
};

function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

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

function sourceTypeLabel(type: StoryType): string {
  if (type === "twitter") {
    return "X";
  }

  if (type === "farcaster") {
    return "Farcaster";
  }

  return "News";
}

function storyLaneLabel(story: CuratedStory): string {
  return sourceTypeLabel(story.sourceType);
}

function healthTone(status: SourceHealthStatus, isDark: boolean): string {
  if (status === "healthy") {
    return isDark
      ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/20"
      : "bg-emerald-100 text-emerald-800";
  }

  if (status === "quiet") {
    return isDark
      ? "bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/20"
      : "bg-amber-100 text-amber-900";
  }

  return isDark
    ? "bg-rose-500/15 text-rose-200 ring-1 ring-rose-400/20"
    : "bg-rose-100 text-rose-900";
}

function topicTone(slug: string, isDark: boolean): string {
  if (isDark) {
    return TOPIC_STYLES_DARK[slug] ?? "bg-slate-700/60 text-slate-100 ring-1 ring-slate-500/30";
  }

  return TOPIC_STYLES_LIGHT[slug] ?? "bg-slate-100 text-slate-800";
}

function StoryCard({
  story,
  isDark,
}: {
  story: CuratedStory;
  isDark: boolean;
}) {
  return (
    <article
      className={classes(
        "rounded-2xl border p-5 shadow-[0_20px_50px_-40px_rgba(15,23,42,0.45)] ring-1 transition hover:-translate-y-0.5",
        isDark
          ? "border-slate-700/80 bg-slate-900/90 text-slate-100 ring-white/10 hover:border-sky-400/70"
          : "border-slate-200/80 bg-white/90 ring-white/40 hover:border-sky-300",
      )}
    >
      <div
        className={classes(
          "flex items-start justify-between gap-3 text-xs uppercase tracking-[0.12em]",
          isDark ? "text-slate-300" : "text-slate-500",
        )}
      >
        <span
          className={classes(
            "rounded-full px-2 py-1 font-semibold",
            isDark ? "bg-slate-800/95 text-slate-50" : "bg-slate-100 text-slate-700",
          )}
        >
          {storyLaneLabel(story)}
        </span>
        <time dateTime={story.publishedAt}>{formatRelativeTime(story.publishedAt)}</time>
      </div>

      <a
        className={classes(
          "mt-3 block text-lg font-semibold leading-tight transition",
          isDark ? "!text-white hover:!text-sky-300" : "text-slate-900 hover:text-sky-700",
        )}
        style={isDark ? { color: "#ffffff" } : undefined}
        href={story.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {story.title}
      </a>

      <p
        className={classes(
          "mt-3 text-sm leading-relaxed",
          isDark ? "text-slate-100/85" : "text-slate-600",
        )}
      >
        {story.summary ?? "Open the source for full context."}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {story.topics.map((topic) => (
          <span
            key={`${story.uid}-${topic.slug}`}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${topicTone(topic.slug, isDark)}`}
          >
            {topic.label}
          </span>
        ))}
      </div>

      <div
        className={classes(
          "mt-4 flex items-center justify-between gap-3 border-t pt-3 text-xs",
          isDark ? "border-slate-800/90 text-slate-300" : "border-slate-100 text-slate-500",
        )}
      >
        <span className="truncate" title={story.source}>
          {story.source}
        </span>
        {story.author ? (
          <span className={classes("font-semibold", isDark ? "text-slate-200" : "text-slate-500")}>
            {story.author}
          </span>
        ) : null}
      </div>
    </article>
  );
}

function ClusterCard({
  cluster,
  isDark,
}: {
  cluster: StoryCluster;
  isDark: boolean;
}) {
  const leadStory = cluster.leadStory;

  return (
    <article
      className={classes(
        "rounded-3xl border p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.5)]",
        isDark ? "border-slate-700/80 bg-slate-900/90 text-slate-100" : "border-slate-200/80 bg-white/92",
      )}
    >
      <div
        className={classes(
          "flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.14em]",
          isDark ? "text-slate-300" : "text-slate-500",
        )}
      >
        <span
          className={classes(
            "rounded-full px-2.5 py-1 font-semibold",
            isDark ? "bg-slate-100 text-slate-900" : "bg-slate-900 text-white",
          )}
        >
          {cluster.lane === "news" ? "News Cluster" : "Social Cluster"}
        </span>
        {cluster.topic ? (
          <span
            className={`rounded-full px-2.5 py-1 font-semibold ${topicTone(cluster.topic.slug, isDark)}`}
          >
            {cluster.topic.label}
          </span>
        ) : null}
        <span>{cluster.stories.length} related items</span>
      </div>

      <a
        href={leadStory.url}
        target="_blank"
        rel="noopener noreferrer"
        className={classes(
          "mt-4 block text-2xl font-semibold leading-tight transition",
          isDark ? "!text-white hover:!text-sky-300" : "text-slate-900 hover:text-sky-700",
        )}
        style={isDark ? { color: "#ffffff" } : undefined}
      >
        {cluster.title}
      </a>

      <p
        className={classes(
          "mt-3 max-w-3xl text-sm leading-relaxed",
          isDark ? "text-slate-100/85" : "text-slate-600",
        )}
      >
        {cluster.summary ?? "Open the lead story for the full thread of coverage."}
      </p>

      <div
        className={classes(
          "mt-5 flex flex-wrap items-center gap-3 text-sm",
          isDark ? "text-slate-300" : "text-slate-500",
        )}
      >
        <span>{cluster.sourceCount} sources</span>
        <span>{formatRelativeTime(cluster.publishedAt)}</span>
        <span className="truncate">Lead: {leadStory.source}</span>
      </div>
    </article>
  );
}

function HealthRow({
  source,
  isDark,
  bordered,
}: {
  source: SourceRefreshStatus;
  isDark: boolean;
  bordered: boolean;
}) {
  return (
    <li
      className={classes(
        "grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1.5fr)_120px_90px_90px_minmax(0,1.6fr)] md:items-center",
        bordered && (isDark ? "border-t border-slate-800/80" : "border-t border-slate-200/80"),
      )}
    >
      <div className="min-w-0">
        <p className={classes("truncate text-sm font-semibold", isDark ? "text-slate-100" : "text-slate-900")}>
          {source.label}
        </p>
        <p
          className={classes(
            "mt-1 text-xs uppercase tracking-[0.12em]",
            isDark ? "text-slate-500" : "text-slate-500",
          )}
        >
          {sourceTypeLabel(source.type)}
        </p>
      </div>

      <div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${healthTone(source.status, isDark)}`}>
          {source.status}
        </span>
      </div>

      <p className={classes("text-sm", isDark ? "text-slate-300" : "text-slate-600")}>
        {source.storyCount} stories
      </p>
      <p className={classes("text-sm", isDark ? "text-slate-300" : "text-slate-600")}>
        {formatDuration(source.durationMs)}
      </p>
      <p className={classes("text-sm leading-relaxed", isDark ? "text-slate-400" : "text-slate-500")}>
        {source.message ?? "Feed healthy during the last refresh window."}
      </p>
    </li>
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
  const [savedTopics, setSavedTopics] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [theme, setTheme] = useState<DashboardTheme>("light");
  const [selectedSourceType, setSelectedSourceType] = useState<SourceFilter>("all");
  const [showHealth, setShowHealth] = useState(false);

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

  useEffect(() => {
    try {
      const storedValue = window.localStorage.getItem(SAVED_TOPICS_STORAGE_KEY);
      if (!storedValue) {
        return;
      }

      const parsed = JSON.parse(storedValue);
      if (Array.isArray(parsed)) {
        setSavedTopics(parsed.filter((entry): entry is string => typeof entry === "string"));
      }
    } catch {
      setSavedTopics([]);
    }
  }, []);

  useEffect(() => {
    try {
      const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);

      if (storedTheme === "light" || storedTheme === "dark") {
        setTheme(storedTheme);
      } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        setTheme("dark");
      }

      const storedSourceFilter = window.localStorage.getItem(SOURCE_FILTER_STORAGE_KEY);
      if (
        storedSourceFilter === "all" ||
        storedSourceFilter === "news" ||
        storedSourceFilter === "twitter" ||
        storedSourceFilter === "farcaster"
      ) {
        setSelectedSourceType(storedSourceFilter);
      }
    } catch {
      setTheme("light");
      setSelectedSourceType("all");
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SAVED_TOPICS_STORAGE_KEY, JSON.stringify(savedTopics));
  }, [savedTopics]);

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(SOURCE_FILTER_STORAGE_KEY, selectedSourceType);
  }, [selectedSourceType]);

  const curatedStories = useMemo(() => curateStories(stories), [stories]);
  const healthSources = useMemo(() => health?.sources ?? [], [health]);
  const isDark = theme === "dark";

  const topicCounts = useMemo(() => buildTopicCounts(curatedStories), [curatedStories]);

  useEffect(() => {
    if (
      selectedTopic !== "all" &&
      !topicCounts.some((entry) => entry.topic.slug === selectedTopic)
    ) {
      setSelectedTopic("all");
    }
  }, [selectedTopic, topicCounts]);

  const topicAndSearchStories = useMemo(() => {
    const byTopic =
      selectedTopic === "all"
        ? curatedStories
        : curatedStories.filter((story) =>
            story.topics.some((topic) => topic.slug === selectedTopic),
          );
    const normalizedSearch = searchQuery.trim().toLowerCase();

    if (!normalizedSearch) {
      return byTopic;
    }

    return byTopic.filter((story) => story.searchText.includes(normalizedSearch));
  }, [curatedStories, searchQuery, selectedTopic]);

  const sourceCounts = useMemo(
    () => ({
      all: topicAndSearchStories.length,
      news: topicAndSearchStories.filter((story) => story.sourceType === "news").length,
      twitter: topicAndSearchStories.filter((story) => story.sourceType === "twitter").length,
      farcaster: topicAndSearchStories.filter((story) => story.sourceType === "farcaster").length,
    }),
    [topicAndSearchStories],
  );

  const filteredStories = useMemo(() => {
    if (selectedSourceType === "all") {
      return topicAndSearchStories;
    }

    return topicAndSearchStories.filter((story) => story.sourceType === selectedSourceType);
  }, [selectedSourceType, topicAndSearchStories]);

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

  const visibleNewsCount = filteredStories.filter((story) => story.sourceType === "news").length;
  const visibleTwitterCount = filteredStories.filter((story) => story.sourceType === "twitter").length;
  const visibleFarcasterCount =
    filteredStories.filter((story) => story.sourceType === "farcaster").length;
  const visibleSocialCount = visibleTwitterCount + visibleFarcasterCount;

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

      if (left.type !== right.type) {
        return left.type.localeCompare(right.type);
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
  const sourceFilterOptions = useMemo(
    () => [
      { slug: "all" as const, label: "All Sources", count: sourceCounts.all },
      { slug: "news" as const, label: "News", count: sourceCounts.news },
      { slug: "twitter" as const, label: "X", count: sourceCounts.twitter },
      { slug: "farcaster" as const, label: "Farcaster", count: sourceCounts.farcaster },
    ],
    [sourceCounts],
  );
  const savedTopicOptions = useMemo(
    () =>
      topicOptions.filter(
        (topic) => topic.slug !== "all" && savedTopics.includes(topic.slug),
      ),
    [savedTopics, topicOptions],
  );
  const selectedTopicLabel =
    topicOptions.find((topic) => topic.slug === selectedTopic)?.label ?? selectedTopic;
  const selectedSourceLabel =
    sourceFilterOptions.find((option) => option.slug === selectedSourceType)?.label ??
    selectedSourceType;
  const selectedTopicSaved =
    selectedTopic !== "all" && savedTopics.includes(selectedTopic);

  const toggleSavedTopic = useCallback((slug: string) => {
    setSavedTopics((current) => {
      if (current.includes(slug)) {
        return current.filter((entry) => entry !== slug);
      }

      return [...current, slug];
    });
  }, []);

  const showNewsSection = newsStories.length > 0;
  const showSocialSection = socialStories.length > 0;
  const totalCachedStories = stats.total || curatedStories.length;

  return (
    <main
      className={classes(
        "min-h-screen",
        isDark
          ? "bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.12),transparent_34%),radial-gradient(circle_at_top_left,rgba(249,115,22,0.12),transparent_32%),linear-gradient(180deg,#020617_0%,#0f172a_100%)] text-slate-100"
          : "bg-[radial-gradient(circle_at_top_right,rgba(15,118,110,0.18),transparent_44%),radial-gradient(circle_at_top_left,rgba(251,146,60,0.16),transparent_36%),linear-gradient(180deg,#f6fbff_0%,#ecf4fb_100%)]",
      )}
    >
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <section
          className={classes(
            "relative overflow-hidden rounded-[2rem] border px-6 py-8 shadow-[0_26px_80px_-42px_rgba(2,15,23,0.75)] sm:px-10",
            isDark ? "border-slate-800/80 bg-slate-950" : "border-white/60 bg-slate-900",
          )}
        >
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
                onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
                aria-pressed={isDark}
                className={classes(
                  "rounded-full border px-5 py-2 text-sm font-semibold transition",
                  isDark
                    ? "border-white/15 bg-white/10 text-white hover:bg-white/15"
                    : "border-white/25 bg-white/10 text-white hover:bg-white/15",
                )}
              >
                {isDark ? "Light mode" : "Dark mode"}
              </button>
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
          <div
            className={classes(
              "rounded-2xl border p-4 shadow-sm",
              isDark ? "border-slate-800/80 bg-slate-950/75" : "border-slate-200/80 bg-white/85",
            )}
          >
            <p className={classes("text-xs uppercase tracking-[0.14em]", isDark ? "text-slate-400" : "text-slate-500")}>
              Visible Stories
            </p>
            <p className={classes("mt-2 text-2xl font-semibold", isDark ? "text-slate-50" : "text-slate-900")}>
              {filteredStories.length}
            </p>
            <p className={classes("mt-1 text-sm", isDark ? "text-slate-500" : "text-slate-500")}>
              {totalCachedStories} cached total
            </p>
          </div>
          <div
            className={classes(
              "rounded-2xl border p-4 shadow-sm",
              isDark ? "border-slate-800/80 bg-slate-950/75" : "border-slate-200/80 bg-white/85",
            )}
          >
            <p className={classes("text-xs uppercase tracking-[0.14em]", isDark ? "text-slate-400" : "text-slate-500")}>
              News Desk
            </p>
            <p className={classes("mt-2 text-2xl font-semibold", isDark ? "text-slate-50" : "text-slate-900")}>
              {visibleNewsCount}
            </p>
            <p className={classes("mt-1 text-sm", isDark ? "text-slate-500" : "text-slate-500")}>
              {stats.byType.news} cached total
            </p>
          </div>
          <div
            className={classes(
              "rounded-2xl border p-4 shadow-sm",
              isDark ? "border-slate-800/80 bg-slate-950/75" : "border-slate-200/80 bg-white/85",
            )}
          >
            <p className={classes("text-xs uppercase tracking-[0.14em]", isDark ? "text-slate-400" : "text-slate-500")}>
              Social Pulse
            </p>
            <p className={classes("mt-2 text-2xl font-semibold", isDark ? "text-slate-50" : "text-slate-900")}>
              {visibleSocialCount}
            </p>
            <p className={classes("mt-1 text-sm", isDark ? "text-slate-500" : "text-slate-500")}>
              {stats.byType.twitter + stats.byType.farcaster} cached total
            </p>
          </div>
          <div
            className={classes(
              "rounded-2xl border p-4 shadow-sm",
              isDark ? "border-slate-800/80 bg-slate-950/75" : "border-slate-200/80 bg-white/85",
            )}
          >
            <p className={classes("text-xs uppercase tracking-[0.14em]", isDark ? "text-slate-400" : "text-slate-500")}>
              Healthy Sources
            </p>
            <p className={classes("mt-2 text-2xl font-semibold", isDark ? "text-slate-50" : "text-slate-900")}>
              {healthySourceCount}
              <span className={classes("ml-1 text-sm font-medium", isDark ? "text-slate-500" : "text-slate-500")}>
                / {healthSources.length}
              </span>
            </p>
            <p className={classes("mt-1 text-sm", isDark ? "text-slate-500" : "text-slate-500")}>
              Expand below for detail
            </p>
          </div>
        </section>

        <section
          className={classes(
            "mt-6 rounded-3xl border p-5 shadow-sm",
            isDark ? "border-slate-800/80 bg-slate-950/75" : "border-slate-200/80 bg-white/85",
          )}
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className={classes("text-xs font-semibold uppercase tracking-[0.16em]", isDark ? "text-slate-400" : "text-slate-500")}>
                Topic Radar
              </p>
              <h2 className={classes("mt-1 text-xl font-semibold", isDark ? "text-slate-50" : "text-slate-900")}>
                Filter the newsroom by theme, then narrow by source type
              </h2>
            </div>
            <div
              className={classes(
                "flex w-full max-w-md items-center gap-2 rounded-2xl border px-3 py-2",
                isDark ? "border-slate-700 bg-slate-950/90" : "border-slate-200 bg-slate-50",
              )}
            >
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search stories, sources, topics"
                className={classes(
                  "w-full bg-transparent text-sm outline-none",
                  isDark ? "text-slate-100 placeholder:text-slate-500" : "text-slate-900 placeholder:text-slate-400",
                )}
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className={classes(
                    "rounded-full px-2 py-1 text-xs font-semibold transition",
                    isDark
                      ? "bg-slate-800 text-slate-200 hover:bg-slate-700"
                      : "bg-slate-200 text-slate-700 hover:bg-slate-300",
                  )}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>

          {savedTopicOptions.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {savedTopicOptions.map((topic) => (
                <button
                  key={`saved-${topic.slug}`}
                  type="button"
                  onClick={() => setSelectedTopic(topic.slug)}
                  className={classes(
                    "rounded-full border px-4 py-2 text-sm font-semibold transition",
                    isDark
                      ? "border-sky-500/30 bg-sky-500/10 text-sky-100 hover:border-sky-400/50"
                      : "border-sky-200 bg-sky-50 text-sky-900 hover:border-sky-300",
                  )}
                >
                  Saved: {topic.label}
                  <span className="ml-2 text-xs opacity-70">{topic.count}</span>
                </button>
              ))}

              {selectedTopic !== "all" ? (
                <button
                  type="button"
                  onClick={() => toggleSavedTopic(selectedTopic)}
                  className={classes(
                    "rounded-full border px-4 py-2 text-sm font-semibold transition",
                    isDark
                      ? "border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-500"
                      : "border-slate-300 bg-white text-slate-700 hover:border-slate-400",
                  )}
                >
                  {selectedTopicSaved ? "Unsave topic" : "Save topic"}
                </button>
              ) : null}
            </div>
          ) : selectedTopic !== "all" ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => toggleSavedTopic(selectedTopic)}
                className={classes(
                  "rounded-full border px-4 py-2 text-sm font-semibold transition",
                  isDark
                    ? "border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-500"
                    : "border-slate-300 bg-white text-slate-700 hover:border-slate-400",
                )}
              >
                {selectedTopicSaved ? "Unsave topic" : "Save topic"}
              </button>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {topicOptions.map((topic) => {
              const active = selectedTopic === topic.slug;
              const isSaved = topic.slug !== "all" && savedTopics.includes(topic.slug);

              return (
                <button
                  key={topic.slug}
                  type="button"
                  onClick={() => setSelectedTopic(topic.slug)}
                  className={classes(
                    "rounded-full px-4 py-2 text-sm font-semibold transition",
                    active
                      ? isDark
                        ? "bg-slate-100 text-slate-950"
                        : "bg-slate-900 text-white"
                      : isDark
                        ? "border border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-500"
                        : "border border-slate-300 bg-white text-slate-700 hover:border-slate-400",
                  )}
                >
                  {topic.label}
                  {isSaved ? <span className="ml-2 text-[11px] opacity-70">saved</span> : null}
                  <span className="ml-2 text-xs opacity-70">{topic.count}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {sourceFilterOptions.map((option) => {
              const active = selectedSourceType === option.slug;

              return (
                <button
                  key={option.slug}
                  type="button"
                  onClick={() => setSelectedSourceType(option.slug)}
                  className={classes(
                    "rounded-full px-4 py-2 text-sm font-semibold transition",
                    active
                      ? isDark
                        ? "bg-orange-400 text-slate-950"
                        : "bg-orange-400 text-slate-950"
                      : isDark
                        ? "border border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-500"
                        : "border border-slate-300 bg-white text-slate-700 hover:border-slate-400",
                  )}
                >
                  {option.label}
                  <span className="ml-2 text-xs opacity-70">{option.count}</span>
                </button>
              );
            })}
          </div>

          <div className={classes("mt-3 text-sm", isDark ? "text-slate-400" : "text-slate-500")}>
            Showing {filteredStories.length} stories
            {selectedTopic !== "all" ? ` in ${selectedTopicLabel}` : ""}
            {selectedSourceType !== "all" ? ` from ${selectedSourceLabel}` : ""}
            {searchQuery ? ` matching “${searchQuery}”` : ""}
          </div>
        </section>

        {error ? (
          <section
            className={classes(
              "mt-5 rounded-2xl border px-4 py-3 text-sm",
              isDark ? "border-rose-500/30 bg-rose-500/10 text-rose-200" : "border-red-200 bg-red-50 text-red-700",
            )}
          >
            {error}
          </section>
        ) : null}

        {loading && stories.length === 0 ? (
          <section className="mt-6 grid gap-4 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={`skeleton-${index}`}
                className={classes(
                  "h-60 animate-pulse rounded-3xl border",
                  isDark ? "border-slate-800 bg-slate-950/60" : "border-slate-200 bg-white/70",
                )}
              />
            ))}
          </section>
        ) : null}

        {!loading && filteredStories.length === 0 ? (
          <section
            className={classes(
              "mt-6 rounded-2xl border px-5 py-10 text-center",
              isDark ? "border-slate-800 bg-slate-950/70 text-slate-300" : "border-slate-200 bg-white/80 text-slate-600",
            )}
          >
            No stories match this filter set right now.
          </section>
        ) : null}

        {featuredClusters.length > 0 ? (
          <section className="mt-6">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <p className={classes("text-xs font-semibold uppercase tracking-[0.16em]", isDark ? "text-slate-400" : "text-slate-500")}>
                  Story Clusters
                </p>
                <h2 className={classes("mt-1 text-2xl font-semibold", isDark ? "text-slate-50" : "text-slate-900")}>
                  Market-moving threads across multiple sources
                </h2>
              </div>
              <p className={classes("text-sm", isDark ? "text-slate-400" : "text-slate-500")}>
                {featuredClusters.length} active clusters
              </p>
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              {featuredClusters.map((cluster) => (
                <ClusterCard key={cluster.key} cluster={cluster} isDark={isDark} />
              ))}
            </div>
          </section>
        ) : null}

        {(showNewsSection || showSocialSection) && filteredStories.length > 0 ? (
          <section
            className={classes(
              "mt-6 grid gap-6",
              showNewsSection && showSocialSection ? "xl:grid-cols-[1.3fr_1fr]" : "xl:grid-cols-1",
            )}
          >
            {showNewsSection ? (
              <div
                className={classes(
                  "rounded-3xl border p-5 shadow-sm",
                  isDark ? "border-slate-800/80 bg-slate-950/75" : "border-slate-200/80 bg-white/88",
                )}
              >
                <div className="mb-5 flex items-center justify-between gap-4">
                  <div>
                    <p className={classes("text-xs font-semibold uppercase tracking-[0.16em]", isDark ? "text-slate-400" : "text-slate-500")}>
                      News Desk
                    </p>
                    <h2 className={classes("mt-1 text-2xl font-semibold", isDark ? "text-slate-50" : "text-slate-900")}>
                      Reputable coverage, ranked for recency
                    </h2>
                  </div>
                  <p className={classes("text-sm", isDark ? "text-slate-400" : "text-slate-500")}>
                    {newsStories.length} stories
                  </p>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  {newsStories.map((story) => (
                    <StoryCard key={story.uid} story={story} isDark={isDark} />
                  ))}
                </div>
              </div>
            ) : null}

            {showSocialSection ? (
              <div
                className={classes(
                  "rounded-3xl border p-5 shadow-sm",
                  isDark ? "border-slate-800/80 bg-slate-950/75" : "border-slate-200/80 bg-white/88",
                )}
              >
                <div className="mb-5 flex items-center justify-between gap-4">
                  <div>
                    <p className={classes("text-xs font-semibold uppercase tracking-[0.16em]", isDark ? "text-slate-400" : "text-slate-500")}>
                      Social Pulse
                    </p>
                    <h2 className={classes("mt-1 text-2xl font-semibold", isDark ? "text-slate-50" : "text-slate-900")}>
                      Higher-signal X and Farcaster references
                    </h2>
                  </div>
                  <p className={classes("text-sm", isDark ? "text-slate-400" : "text-slate-500")}>
                    {socialStories.length} posts
                  </p>
                </div>

                <div className="grid gap-4">
                  {socialStories.map((story) => (
                    <StoryCard key={story.uid} story={story} isDark={isDark} />
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        <section
          className={classes(
            "mt-6 rounded-3xl border p-5 shadow-sm",
            isDark ? "border-slate-800/80 bg-slate-950/75" : "border-slate-200/80 bg-white/88",
          )}
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className={classes("text-xs font-semibold uppercase tracking-[0.16em]", isDark ? "text-slate-400" : "text-slate-500")}>
                Source Health
              </p>
              <h2 className={classes("mt-1 text-2xl font-semibold", isDark ? "text-slate-50" : "text-slate-900")}>
                Last refresh visibility across every upstream source
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em]">
              <span className={`rounded-full px-3 py-1 ${healthTone("healthy", isDark)}`}>
                Healthy {healthySourceCount}
              </span>
              <span className={`rounded-full px-3 py-1 ${healthTone("quiet", isDark)}`}>
                Quiet {quietSourceCount}
              </span>
              <span className={`rounded-full px-3 py-1 ${healthTone("error", isDark)}`}>
                Errors {degradedSourceCount}
              </span>
              <button
                type="button"
                onClick={() => setShowHealth((current) => !current)}
                className={classes(
                  "rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] transition",
                  isDark
                    ? "border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-500"
                    : "border-slate-300 bg-white text-slate-700 hover:border-slate-400",
                )}
              >
                {showHealth ? "Hide Status List" : "Show Status List"}
              </button>
            </div>
          </div>

          {!showHealth ? (
            <div
              className={classes(
                "mt-5 rounded-2xl border px-4 py-4 text-sm",
                isDark ? "border-slate-800 bg-slate-950/90 text-slate-400" : "border-slate-200 bg-slate-50 text-slate-600",
              )}
            >
              Source health is hidden by default. Expand the status list when you need to inspect
              refresh quality or upstream failures.
            </div>
          ) : sortedSources.length === 0 ? (
            <div
              className={classes(
                "mt-5 rounded-2xl border px-4 py-6 text-sm",
                isDark ? "border-slate-800 bg-slate-950/90 text-slate-400" : "border-slate-200 bg-slate-50 text-slate-600",
              )}
            >
              Source health becomes available after the first completed refresh.
            </div>
          ) : (
            <div
              className={classes(
                "mt-5 overflow-hidden rounded-2xl border",
                isDark ? "border-slate-800/80 bg-slate-950/90" : "border-slate-200/80 bg-white/90",
              )}
            >
              <div
                className={classes(
                  "hidden px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] md:grid md:grid-cols-[minmax(0,1.5fr)_120px_90px_90px_minmax(0,1.6fr)]",
                  isDark
                    ? "border-b border-slate-800/80 bg-slate-900/70 text-slate-500"
                    : "border-b border-slate-200/80 bg-slate-50 text-slate-500",
                )}
              >
                <span>Source</span>
                <span>Status</span>
                <span>Stories</span>
                <span>Speed</span>
                <span>Notes</span>
              </div>

              <ul>
                {sortedSources.map((source, index) => (
                  <HealthRow
                    key={`${source.type}-${source.label}`}
                    source={source}
                    isDark={isDark}
                    bordered={index > 0}
                  />
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
