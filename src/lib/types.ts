export const STORY_TYPES = ["news", "twitter", "farcaster", "reddit", "bluesky"] as const;
export type StoryType = (typeof STORY_TYPES)[number];
export type SourceHealthStatus = "healthy" | "quiet" | "error";

export function isStoryType(value: string): value is StoryType {
  return STORY_TYPES.includes(value as StoryType);
}

export function createEmptyStoryCounts(): Record<StoryType, number> {
  return {
    news: 0,
    twitter: 0,
    farcaster: 0,
    reddit: 0,
    bluesky: 0,
  };
}

export interface StoryInput {
  uid: string;
  title: string;
  url: string;
  source: string;
  sourceType: StoryType;
  publishedAt: string;
  summary?: string;
  author?: string;
}

export interface StoryRecord extends StoryInput {
  createdAt: string;
  updatedAt: string;
}

export interface StoryListOptions {
  limit?: number;
  type?: StoryType;
}

export interface RefreshResult {
  processed: number;
  inserted: number;
  updatedAt: string;
  byType: Record<StoryType, number>;
  errors: string[];
  sources: SourceRefreshStatus[];
}

export interface StoryStats {
  total: number;
  byType: Record<StoryType, number>;
}

export interface SourceRefreshStatus {
  label: string;
  type: StoryType;
  status: SourceHealthStatus;
  storyCount: number;
  durationMs: number;
  message?: string;
}
