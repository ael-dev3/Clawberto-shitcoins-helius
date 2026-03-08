---
name: helius-top-volume
description: Scan the top Solana shitcoins by 24h volume using Helius-owned Orb market data only, with optional batched Helius DAS enrichment.
---

# Helius Top Volume

Use this skill to scan the top Solana shitcoins by `24h` volume using Helius-owned data paths only.

## Definition

- `shitcoins` means tokens in Orb's `Cults` category.
- The ranking timeframe is `24h`.
- The default scan size is `10`.

## Real behavior

There is no documented single Helius API endpoint that directly returns `top Solana shitcoins by 24h volume`.

This skill therefore uses the best honest Helius-only workflow available:

1. Fetch the public Helius-owned Orb Markets page.
2. Extract structured market rows for the `Cults` category.
3. Rank those rows by `24h volume`.
4. Apply `--min-volume` if requested and keep the top `--count` rows.
5. If a Helius API key is available, enrich the selected mints with one DAS `getAssetBatch` call.

## Limitations

- Ranking depends on Orb continuing to expose structured Cults market state publicly.
- The classification is exactly Orb `Cults`; this skill does not invent a separate meme-token classifier.
- Orb ranking can run without a Helius API key. DAS enrichment requires a Helius key.

## Usage

```bash
node skills/helius-top-volume/scripts/helius_top_volume.mjs "helius top-volume"
node skills/helius-top-volume/scripts/helius_top_volume.mjs "helius top-volume --count 10"
node skills/helius-top-volume/scripts/helius_top_volume.mjs "helius top-volume --min-volume 50000"
node skills/helius-top-volume/scripts/helius_top_volume.mjs "helius top-volume --format json"
```

## Supported arguments

- `--count N`        Number of ranked tokens to return, default `10`
- `--min-volume USD` Minimum 24h USD volume filter
- `--format json`    Emit JSON output
- `--help`           Show usage

## Helius key source

1. `HELIUS_API_KEY`
2. `HELIUS_KEY`
3. macOS Keychain (`service: HELIUS_API_KEY`, `account: openclaw-helius`)

If no Helius key is available, Orb ranking still works and the JSON/text output simply omits DAS enrichment values.

## Output

The command returns a directly usable ranked list with at least:

- symbol
- name
- mint
- 24h volume
- Orb token URL

When DAS enrichment succeeds it also includes Helius metadata and price fields from `getAssetBatch`.
