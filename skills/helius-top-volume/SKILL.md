---
name: helius-top-volume
description: Scan the top Solana shitcoins by 24h volume using Helius-owned Orb API data only, with optional batched Helius DAS enrichment.
---

# Helius Top Volume

Use this skill to scan the top Solana shitcoins by `24h` volume using Helius-owned data paths only.

## Definition

- `shitcoins` means tokens in Orb's `Cults` category.
- The ranking timeframe is `24h`.
- The default scan size is `10`.

## Real behavior

This skill uses the Helius-owned Orb API directly:

1. Authenticate against Orb via `POST /api/turnstile/verify`.
2. Query Orb assets with:
   - `timeframe=24h`
   - `category=Cults`
   - `sort_by=volume`
3. Rank the returned rows by `24h volume`.
4. Apply `--min-volume` if requested and keep the top `--count` rows.
5. If a Helius API key is available, enrich the selected mints with one DAS `getAssetBatch` call.

## Limitations

- The classification is exactly Orb `Cults`; this skill does not invent a separate meme-token classifier.
- Orb ranking can run without a Helius API key. DAS enrichment requires a Helius key.
- If Orb changes its auth or assets API contract, the scan may need to be updated.

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
