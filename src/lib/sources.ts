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
    maxItems: 40,
  },
  {
    name: "Cointelegraph",
    url: "https://cointelegraph.com/rss",
    maxItems: 40,
  },
  {
    name: "Decrypt",
    url: "https://decrypt.co/feed",
    maxItems: 40,
  },
  {
    name: "The Block",
    url: "https://www.theblock.co/rss.xml",
    maxItems: 40,
  },
  {
    name: "CryptoSlate",
    url: "https://cryptoslate.com/feed/",
    maxItems: 40,
  },
  {
    name: "Bitcoin Magazine",
    url: "https://bitcoinmagazine.com/.rss/full/",
    maxItems: 35,
  },
  {
    name: "Blockworks",
    url: "https://blockworks.co/feed",
    maxItems: 35,
  },
  {
    name: "The Defiant",
    url: "https://thedefiant.io/feed",
    maxItems: 30,
  },
  {
    name: "crypto.news",
    url: "https://crypto.news/feed/",
    maxItems: 35,
  },
  {
    name: "Unchained",
    url: "https://unchainedcrypto.com/feed/",
    maxItems: 30,
  },
  {
    name: "Protos",
    url: "https://protos.com/feed/",
    maxItems: 25,
  },
  {
    name: "TechCrunch Crypto",
    url: "https://techcrunch.com/tag/cryptocurrency/feed/",
    maxItems: 25,
  },
  {
    name: "Financial Times Cryptofinance",
    url: "https://www.ft.com/cryptocurrencies?format=rss",
    maxItems: 20,
  },
  {
    name: "Ethereum Foundation Blog",
    url: "https://blog.ethereum.org/feed.xml",
    maxItems: 18,
  },
  {
    name: "Solana Blog",
    url: "https://solana.com/rss.xml",
    maxItems: 18,
  },
  {
    name: "Chainlink Blog",
    url: "https://blog.chain.link/rss/",
    maxItems: 18,
  },
];

export const TWITTER_SOURCES: TwitterSource[] = [
  { handle: "VitalikButerin", maxItems: 12 },
  { handle: "WuBlockchain", maxItems: 12 },
  { handle: "coinbase", maxItems: 12 },
  { handle: "BanklessHQ", maxItems: 12 },
  { handle: "CoinDesk", maxItems: 12 },
  { handle: "Cointelegraph", maxItems: 12 },
  { handle: "brian_armstrong", maxItems: 12 },
  { handle: "lookonchain", maxItems: 12 },
  { handle: "solana", maxItems: 12 },
  { handle: "DefiLlama", maxItems: 12 },
  { handle: "TheBlock__", maxItems: 10 },
  { handle: "blockworks_", maxItems: 10 },
  { handle: "BitcoinMagazine", maxItems: 10 },
  { handle: "MessariCrypto", maxItems: 10 },
  { handle: "glassnode", maxItems: 10 },
  { handle: "jseyff", maxItems: 10 },
  { handle: "EricBalchunas", maxItems: 10 },
];

export const FARCASTER_SOURCES: FarcasterSource[] = [
  {
    label: "crypto channel",
    url: "https://warpcast.com/~/channel/crypto",
    maxItems: 12,
  },
  {
    label: "defi channel",
    url: "https://warpcast.com/~/channel/defi",
    maxItems: 12,
  },
  {
    label: "ethereum channel",
    url: "https://warpcast.com/~/channel/ethereum",
    maxItems: 12,
  },
  {
    label: "vitalik.eth",
    url: "https://warpcast.com/vitalik.eth",
    maxItems: 10,
  },
  {
    label: "base channel",
    url: "https://warpcast.com/~/channel/base",
    maxItems: 12,
  },
  {
    label: "bitcoin channel",
    url: "https://warpcast.com/~/channel/bitcoin",
    maxItems: 12,
  },
  {
    label: "solana channel",
    url: "https://warpcast.com/~/channel/solana",
    maxItems: 12,
  },
  {
    label: "stablecoins channel",
    url: "https://warpcast.com/~/channel/stablecoins",
    maxItems: 12,
  },
  {
    label: "onchain channel",
    url: "https://warpcast.com/~/channel/onchain",
    maxItems: 12,
  },
  {
    label: "jesse.base.eth",
    url: "https://warpcast.com/jessepollak",
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
  "stablecoins",
  "stablecoin",
  "usdc",
  "usdt",
  "rwa",
  "restaking",
  "bridge",
  "bridging",
  "mainnet",
  "testnet",
  "layer1",
  "layer 1",
  "layer2",
  "layer-2",
  "rollups",
  "perp",
  "perps",
  "treasury",
  "tokenization",
  "custody",
  "ordinals",
  "memecoin",
  "polygon",
  "arbitrum",
  "optimism",
  "avax",
  "eigenlayer",
  "kraken",
  "bybit",
  "hyperliquid",
  "pump.fun",
];
