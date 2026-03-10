export interface NewsFeedSource {
  name: string;
  url: string;
  maxItems: number;
}

export interface TwitterSource {
  handle: string;
  maxItems: number;
}

export interface FarcasterSource {
  label: string;
  url: string;
  maxItems: number;
}

export const NEWS_FEED_SOURCES: NewsFeedSource[] = [
  {
    name: "CoinDesk",
    url: "https://www.coindesk.com/arc/outboundfeeds/rss/",
    maxItems: 35,
  },
  {
    name: "Cointelegraph",
    url: "https://cointelegraph.com/rss",
    maxItems: 35,
  },
  {
    name: "Decrypt",
    url: "https://decrypt.co/feed",
    maxItems: 35,
  },
  {
    name: "The Block",
    url: "https://www.theblock.co/rss.xml",
    maxItems: 35,
  },
  {
    name: "CryptoSlate",
    url: "https://cryptoslate.com/feed/",
    maxItems: 35,
  },
  {
    name: "Bitcoin Magazine",
    url: "https://bitcoinmagazine.com/.rss/full/",
    maxItems: 30,
  },
  {
    name: "Blockworks",
    url: "https://blockworks.co/feed",
    maxItems: 30,
  },
  {
    name: "The Defiant",
    url: "https://thedefiant.io/feed",
    maxItems: 30,
  },
];

export const TWITTER_SOURCES: TwitterSource[] = [
  { handle: "VitalikButerin", maxItems: 8 },
  { handle: "WuBlockchain", maxItems: 8 },
  { handle: "coinbase", maxItems: 8 },
  { handle: "TheBlock__", maxItems: 8 },
  { handle: "BanklessHQ", maxItems: 8 },
];

export const FARCASTER_SOURCES: FarcasterSource[] = [
  {
    label: "crypto channel",
    url: "https://warpcast.com/~/channel/crypto",
    maxItems: 10,
  },
  {
    label: "defi channel",
    url: "https://warpcast.com/~/channel/defi",
    maxItems: 10,
  },
  {
    label: "ethereum channel",
    url: "https://warpcast.com/~/channel/ethereum",
    maxItems: 10,
  },
  {
    label: "vitalik.eth",
    url: "https://warpcast.com/vitalik.eth",
    maxItems: 8,
  },
  {
    label: "base channel",
    url: "https://warpcast.com/~/channel/base",
    maxItems: 10,
  },
];

export const CRYPTO_KEYWORDS = [
  "bitcoin",
  "btc",
  "ethereum",
  "eth",
  "crypto",
  "blockchain",
  "defi",
  "web3",
  "token",
  "stablecoin",
  "solana",
  "base",
  "l2",
  "etf",
  "onchain",
  "airdrop",
  "dao",
  "staking",
  "validator",
  "rollup",
  "altcoin",
  "wallet",
  "coinbase",
  "binance",
  "layer 2",
  "mev",
  "dex",
  "cex",
  "liquidity",
  "mempool",
  "eip",
  "farcaster",
];
