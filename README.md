# Clawberto Shitcoins - Helius Top Volume

This repo provides a single OpenClaw skill that scans the top Solana shitcoins by 24h volume using Helius-owned surfaces only.

## What it does

- Keeps the entrypoint stable at `skills/helius-top-volume/scripts/helius_top_volume.mjs`.
- Uses the Helius-owned Orb API as the ranking source.
- Defines `shitcoins` explicitly as tokens shown in Orb's `Cults` category.
- Reads the `24h` ranking from Orb and returns the top `N` rows.
- Optionally enriches the selected mints with one Helius DAS `getAssetBatch` call.
- Supports plain-text and JSON output.

## Exact methodology

This skill uses a Helius-only flow:

1. Authenticate against the Helius-owned Orb API via `POST /api/turnstile/verify`.
2. Query `GET /api/assets` with:
   - `timeframe=24h`
   - `category=Cults`
   - `sort_by=volume`
3. Treat the returned `Cults` rows as the shitcoin universe.
4. Sort by `24h volume`, apply `--min-volume` if provided, and keep the top `--count` rows.
5. If a Helius API key is available, enrich those mints with one batched DAS `getAssetBatch` call.

## Limitations

- `shitcoins` are not custom-classified here; they are exactly Orb `Cults` tokens.
- Orb ranking can work without a Helius API key. DAS enrichment needs a Helius key.
- If Orb changes its auth or assets API contract, this skill may need to be updated.

## Quick start

```bash
cd Clawberto-shitcoins-helius
node skills/helius-top-volume/scripts/helius_top_volume.mjs "helius top-volume"
```

That command scans the top 10 Solana shitcoins by 24h volume.

## Commands

| Command | What it does |
|---|---|
| `helius top-volume` | Scan the top 10 Orb Cults tokens by 24h volume |
| `helius top-volume --count 20` | Return the top 20 instead of 10 |
| `helius top-volume --min-volume 100000` | Require at least `$100k` 24h volume |
| `helius top-volume --format json` | Emit machine-readable JSON |

## Flags

- `--count N` - number of ranked tokens to return, default `10`
- `--min-volume USD` - minimum 24h USD volume filter
- `--format json` - output JSON only
- `--help` - show command help

## Helius key resolution

The script looks for a Helius key in this order:

1. `HELIUS_API_KEY`
2. `HELIUS_KEY`
3. macOS Keychain service `HELIUS_API_KEY`, account `openclaw-helius`

If no Helius key is found, the scan still returns Orb-ranked tokens, but the extra DAS enrichment fields remain empty.

## Output

Default text output includes:

- rank
- symbol
- name
- mint
- 24h volume
- Orb price when present in Orb
- Helius DAS price when present in `token_info.price_info`
- Orb token page URL

JSON output also includes:

- `source`
- `methodology`
- `limitations`
- `filters`
- `orb`
- `tokens[].orb_url`

## Repo layout

```text
Clawberto-shitcoins-helius/
├─ README.md
├─ skills/
│  └─ helius-top-volume/
│     ├─ SKILL.md
│     └─ scripts/
│        └─ helius_top_volume.mjs
```
