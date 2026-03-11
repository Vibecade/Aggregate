import type { StoryRecord, StoryType } from "@/lib/types";

export type StoryLane = "news" | "social";

export interface TopicTag {
  slug: string;
  label: string;
}

export interface CuratedStory extends StoryRecord {
  lane: StoryLane;
  topics: TopicTag[];
  primaryTopic: TopicTag | null;
  tokens: string[];
  searchText: string;
  sourceWeight: number;
  score: number;
}

export interface StoryCluster {
  key: string;
  lane: StoryLane;
  topic: TopicTag | null;
  title: string;
  summary: string | undefined;
  publishedAt: string;
  leadStory: CuratedStory;
  stories: CuratedStory[];
  sources: string[];
  sourceCount: number;
  score: number;
}

interface TopicDefinition extends TopicTag {
  keywords: string[];
}

const TOPIC_DEFINITIONS: TopicDefinition[] = [
  { slug: "bitcoin", label: "Bitcoin", keywords: ["bitcoin", "btc", "ordinals"] },
  { slug: "ethereum", label: "Ethereum", keywords: ["ethereum", "eth", "eip", "staking"] },
  { slug: "solana", label: "Solana", keywords: ["solana", "sol", "pump.fun"] },
  { slug: "defi", label: "DeFi", keywords: ["defi", "dex", "liquidity", "yield", "restaking"] },
  { slug: "stablecoins", label: "Stablecoins", keywords: ["stablecoin", "stablecoins", "usdc", "usdt"] },
  { slug: "regulation", label: "Regulation", keywords: ["sec", "cftc", "senate", "house", "irs", "bill", "law"] },
  { slug: "base", label: "Base", keywords: ["base", "coinbase", "l2", "layer 2", "layer2", "layer-2"] },
  { slug: "markets", label: "Markets", keywords: ["etf", "trading", "market", "price", "rally", "liquidation", "treasury"] },
  { slug: "infrastructure", label: "Infrastructure", keywords: ["validator", "rollup", "bridge", "mempool", "wallet", "onchain", "mainnet", "testnet"] },
];

const STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "amid",
  "been",
  "being",
  "between",
  "could",
  "from",
  "have",
  "just",
  "more",
  "much",
  "over",
  "some",
  "that",
  "their",
  "there",
  "these",
  "this",
  "those",
  "today",
  "under",
  "using",
  "with",
  "your",
  "into",
  "while",
  "because",
  "where",
  "what",
  "when",
  "will",
  "would",
  "could",
  "should",
  "still",
  "they",
  "them",
  "then",
  "than",
]);

const SHORT_KEEPERS = new Set(["btc", "eth", "sec", "etf", "defi", "dao", "sol"]);
const SOURCE_WEIGHTS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /^Financial Times Cryptofinance$/i, weight: 100 },
  { pattern: /^The Block$/i, weight: 98 },
  { pattern: /^CoinDesk$/i, weight: 96 },
  { pattern: /^Blockworks$/i, weight: 94 },
  { pattern: /^Decrypt$/i, weight: 92 },
  { pattern: /^Unchained$/i, weight: 91 },
  { pattern: /^Ethereum Foundation Blog$/i, weight: 95 },
  { pattern: /^Solana Blog$/i, weight: 92 },
  { pattern: /^Chainlink Blog$/i, weight: 90 },
  { pattern: /^The Defiant$/i, weight: 89 },
  { pattern: /^Cointelegraph$/i, weight: 87 },
  { pattern: /^Bitcoin Magazine$/i, weight: 86 },
  { pattern: /^CryptoSlate$/i, weight: 82 },
  { pattern: /^TechCrunch Crypto$/i, weight: 80 },
  { pattern: /^crypto\.news$/i, weight: 78 },
  { pattern: /^Protos$/i, weight: 76 },
  { pattern: /^X @VitalikButerin$/i, weight: 92 },
  { pattern: /^X @coinbase$/i, weight: 88 },
  { pattern: /^X @brian_armstrong$/i, weight: 86 },
  { pattern: /^X @solana$/i, weight: 85 },
  { pattern: /^X @WuBlockchain$/i, weight: 84 },
  { pattern: /^X @CoinDesk$/i, weight: 82 },
  { pattern: /^X @BanklessHQ$/i, weight: 78 },
  { pattern: /^X @Cointelegraph$/i, weight: 74 },
  { pattern: /^X @lookonchain$/i, weight: 72 },
  { pattern: /^Farcaster vitalik\.eth$/i, weight: 88 },
  { pattern: /^Farcaster jesse\.base\.eth$/i, weight: 83 },
  { pattern: /^Farcaster .*channel$/i, weight: 70 },
];

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function storyText(story: StoryRecord): string {
  return normalizeText([story.title, story.summary, story.source, story.author].filter(Boolean).join(" "));
}

function sourceWeightForStory(story: StoryRecord): number {
  for (const entry of SOURCE_WEIGHTS) {
    if (entry.pattern.test(story.source)) {
      return entry.weight;
    }
  }

  return story.sourceType === "news" ? 75 : 68;
}

function freshnessBoost(story: StoryRecord): number {
  const publishedAt = new Date(story.publishedAt);
  if (Number.isNaN(publishedAt.getTime())) {
    return 0;
  }

  const ageHours = Math.max(0, (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60));
  const horizonHours = story.sourceType === "news" ? 96 : 72;

  return Math.max(0, horizonHours - ageHours) / 4;
}

function storyScore(story: StoryRecord): number {
  const topicBonus = inferTopics(story).length * 2.5;
  const summaryBonus = story.summary ? 1.5 : 0;
  return sourceWeightForStory(story) + freshnessBoost(story) + topicBonus + summaryBonus;
}

function compareCuratedStories(left: CuratedStory, right: CuratedStory): number {
  if (left.score !== right.score) {
    return right.score - left.score;
  }

  return new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
}

function tokenize(value: string): string[] {
  const normalized = value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9.$ -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const unique = new Set<string>();

  for (const token of normalized.split(" ")) {
    if (!token) {
      continue;
    }

    if (STOPWORDS.has(token)) {
      continue;
    }

    if (token.length < 4 && !SHORT_KEEPERS.has(token)) {
      continue;
    }

    unique.add(token);
  }

  return [...unique].slice(0, 18);
}

function inferTopics(story: StoryRecord): TopicTag[] {
  const text = storyText(story);

  const matches = TOPIC_DEFINITIONS.map((topic) => ({
    topic,
    score: topic.keywords.reduce((count, keyword) => {
      return text.includes(keyword) ? count + 1 : count;
    }, 0),
  }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  if (matches.length === 0) {
    return [];
  }

  return matches.slice(0, 3).map((entry) => ({
    slug: entry.topic.slug,
    label: entry.topic.label,
  }));
}

function laneForType(type: StoryType): StoryLane {
  return type === "news" ? "news" : "social";
}

function intersectionCount(left: string[], right: string[]): number {
  const rightSet = new Set(right);
  let shared = 0;

  for (const token of left) {
    if (rightSet.has(token)) {
      shared += 1;
    }
  }

  return shared;
}

function storiesAreRelated(left: CuratedStory, right: CuratedStory): boolean {
  if (left.lane !== right.lane) {
    return false;
  }

  const leftTime = new Date(left.publishedAt).getTime();
  const rightTime = new Date(right.publishedAt).getTime();
  const maxGapMs = left.lane === "news" ? 96 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;

  if (Math.abs(leftTime - rightTime) > maxGapMs) {
    return false;
  }

  const sharedTokens = intersectionCount(left.tokens, right.tokens);
  const samePrimaryTopic =
    left.primaryTopic && right.primaryTopic && left.primaryTopic.slug === right.primaryTopic.slug;

  if (sharedTokens >= 3) {
    return true;
  }

  return Boolean(samePrimaryTopic && sharedTokens >= 2);
}

export function curateStories(stories: StoryRecord[]): CuratedStory[] {
  return stories.map((story) => {
    const topics = inferTopics(story);
    const score = storyScore(story);

    return {
      ...story,
      lane: laneForType(story.sourceType),
      topics,
      primaryTopic: topics[0] ?? null,
      tokens: tokenize([story.title, story.summary ?? ""].join(" ")),
      searchText: normalizeText(
        [story.title, story.summary, story.source, story.author, ...topics.map((topic) => topic.label)].join(" "),
      ),
      sourceWeight: sourceWeightForStory(story),
      score,
    };
  });
}

export function buildStoryClusters(stories: CuratedStory[]): StoryCluster[] {
  const clusters: StoryCluster[] = [];
  const orderedStories = [...stories].sort(compareCuratedStories);

  for (const story of orderedStories) {
    const existingCluster = clusters.find((cluster) => storiesAreRelated(cluster.leadStory, story));

    if (!existingCluster) {
      clusters.push({
        key: `${story.lane}|${story.uid}`,
        lane: story.lane,
        topic: story.primaryTopic,
        title: story.title,
        summary: story.summary,
        publishedAt: story.publishedAt,
        leadStory: story,
        stories: [story],
        sources: [story.source],
        sourceCount: 1,
        score: story.score,
      });
      continue;
    }

    existingCluster.stories.push(story);
    existingCluster.sources = [...new Set([...existingCluster.sources, story.source])];
    existingCluster.sourceCount = existingCluster.sources.length;
  }

  return clusters
    .map((cluster) => {
      const rankedStories = [...cluster.stories].sort(compareCuratedStories);
      const leadStory = rankedStories[0];
      const clusterScore =
        leadStory.score + cluster.sourceCount * 3 + Math.min(6, rankedStories.length) * 2;

      return {
        ...cluster,
        topic: leadStory.primaryTopic,
        title: leadStory.title,
        summary: leadStory.summary,
        publishedAt: leadStory.publishedAt,
        leadStory,
        stories: rankedStories,
        score: clusterScore,
      };
    })
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }

      if (left.stories.length !== right.stories.length) {
        return right.stories.length - left.stories.length;
      }

      return new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
    });
}

export function buildTopicCounts(stories: CuratedStory[]): Array<{ topic: TopicTag; count: number }> {
  const counts = new Map<string, { topic: TopicTag; count: number }>();

  for (const story of stories) {
    for (const topic of story.topics) {
      const current = counts.get(topic.slug);
      if (current) {
        current.count += 1;
      } else {
        counts.set(topic.slug, { topic, count: 1 });
      }
    }
  }

  return [...counts.values()].sort((left, right) => right.count - left.count);
}
