---
name: helius-top-volume
description: Fetch top Solana tokens by 24h volume and enrich each result with Helius asset metadata/price in a single conservative `getAssetBatch` call.
---

# Helius Top Volume

A compact OpenClaw skill for quickly discovering **high-volume Solana tokens** over the last 24h and attaching Helius on-chain metadata.

## What it does

- Pulls token market snapshots from CoinGecko (`coins/markets`), ordered by `24h volume`.
- Filters to tokens that have a Solana mint address.
- Pulls Helius details for the selected mints using **one** RPC batch call (`getAssetBatch`).
- Supports optional CoinGecko API key for higher request capacity (`--api-key`, env, or macOS Keychain).
- Returns top tokens ranked by 24h volume with:
  - symbol/name
  - mint address
  - 24h USD volume
  - 24h % change
  - CoinGecko price
  - Helius `price_info` (if available)

## Why this is conservative with Helius

- CoinGecko is used for ranking and discovery.
- Helius is used **only once per run** for enrichment (`getAssetBatch`), no per-token RPC spam.
- This is safe for repeated polling and keeps key usage low.

## Usage

Run via node:

```bash
node skills/helius-top-volume/scripts/helius_top_volume.mjs "helius top-volume"
node skills/helius-top-volume/scripts/helius_top_volume.mjs "helius top-volume --count 10"
node skills/helius-top-volume/scripts/helius_top_volume.mjs "helius top-volume --min-volume 50000 --pages 6"
node skills/helius-top-volume/scripts/helius_top_volume.mjs "helius top-volume --format json"
node skills/helius-top-volume/scripts/helius_top_volume.mjs "helius top-volume --api-key YOUR_CG_KEY --count 10"
```

## Supported arguments

- `--count N`           Number of tokens to show (default: `10`)
- `--pages N`           CoinGecko pages to scan (default: `5`)
- `--per-page N`        Page size for market scan, max `250` (default: `250`)
- `--min-volume USD`    Minimum 24h volume filter
- `--format json`       Emit JSON output
- `--api-key <key>`    CoinGecko API key (optional)
- `--help`              Show usage

### Key source

**Helius (optional, for enrichment)**
1. `HELIUS_API_KEY`
2. `HELIUS_KEY`
3. macOS Keychain (`service: HELIUS_API_KEY`, `account: openclaw-helius`)

**CoinGecko (optional, for ranking/rate limit handling)**
1. `--api-key`
2. `COINGECKO_API_KEY`
3. `COINGECKO_KEY`
4. macOS Keychain (`service: COINGECKO_API_KEY`, `account: openclaw-coingecko`)

If no CoinGecko key is available, the script uses public endpoints (subject to rate limits).

## Output modes

### Default (markdown table)

```
Top 10 Solana tokens by 24h volume (CoinGecko, enriched via Helius)
| # | Symbol | Name | Mint | 24h Volume | 24h Change | CG Price | Helius Price |
|---|---|---|---|---|---|---|---|
```

### JSON

```bash
node skills/helius-top-volume/scripts/helius_top_volume.mjs "helius top-volume --format json"
node skills/helius-top-volume/scripts/helius_top_volume.mjs "helius top-volume --api-key YOUR_CG_KEY --count 10"
```

Will include:

- `generatedAt`
- `source`
- `filters`
- `totals`
- `tokens` array with market + Helius fields

## Notes

- Token discovery is market-scored by CoinGecko volume data.
- If a Solana token lacks Helius `getAssetBatch` enrichment, `helius_price_usd` is `n/a`.
