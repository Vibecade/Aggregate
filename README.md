# Aggregate

Responsive crypto news aggregator with server-side caching and persistence.

It pulls stories from reputable crypto media outlets plus crypto-related social signals from X/Twitter, Farcaster, Reddit, and Bluesky, dedupes them, and stores them in a server-side snapshot cache so repeated page loads do not spam upstream sources.

## Stack

- Next.js App Router + TypeScript
- Local JSON snapshot storage for development
- Vercel Blob support for durable deployed storage
- `rss-parser` for news feed ingestion
- Responsive client dashboard with source-type filtering and manual refresh

## What It Ingests

### News feeds (reputable crypto media)

- CoinDesk
- Cointelegraph
- Decrypt
- The Block
- CryptoSlate
- Bitcoin Magazine
- Blockworks
- The Defiant
- crypto.news
- Unchained
- Protos
- TechCrunch Crypto
- Financial Times Cryptofinance

### Social feeds

- X/Twitter profile snapshots for selected founders, media brands, and market-watch accounts
- Farcaster channel/profile snapshots for crypto-focused channels across Ethereum, Bitcoin, Solana, Base, DeFi, and stablecoins
- Optional Reddit subreddit ingestion for major crypto communities
- Bluesky author-feed ingestion for curated crypto handles

Notes:
- X/Farcaster ingestion is implemented with a resilient scraping fallback via a text-rendering proxy because most direct APIs now require keys or paid access.
- When `NEYNAR_API_KEY` is present, Farcaster channel sources use Neynar instead of scraping.
- Reddit ingestion only activates when Reddit API credentials are configured.
- The server caches and persists these social snapshots exactly like news articles.

## Caching and persistence behavior

- Local development stores stories in `data/stories-cache.json`.
- Vercel deployments use `BLOB_READ_WRITE_TOKEN` when available for durable shared storage.
- If deployed on Vercel without Blob configured, the app falls back to `/tmp` so the feed still works, but that cache is not durable across cold starts.
- `GET /api/stories` returns cached stories.
- Cache refresh happens only when stale or explicitly forced.
- Refresh lock prevents duplicate concurrent refresh jobs.
- Old rows are pruned automatically to a configurable max size.

## API

- `GET /api/stories?limit=220&type=news|twitter|farcaster|reddit|bluesky&refresh=true|false`
- `POST /api/refresh`

## Environment variables

Optional:

- `REFRESH_TTL_MINUTES` (default: `15`)
- `MAX_STORY_ROWS` (default: `4000`)
- `BLOB_READ_WRITE_TOKEN` for durable Vercel storage
- `NEYNAR_API_KEY` for Farcaster channel ingestion via Neynar free tier
- `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` for Reddit ingestion
- `MAX_SOCIAL_AGE_DAYS` (default: `14`)

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Build checks

```bash
npm run lint
npm run build
```
