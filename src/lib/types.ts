export type StoryType = "news" | "twitter" | "farcaster";

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
}

export interface StoryStats {
  total: number;
  byType: Record<StoryType, number>;
}
