# 🛰️ Clawberto Shitcoins - Helius Top Volume

A focused OpenClaw skill for pulling **top Solana tokens by 24h volume** and enriching results with Helius metadata.

## ✨ What this gives you

- Pulls the latest Solana market movers by `24h volume`.
- Limits output to the **top N** tokens (default: `10`).
- Enriches with Helius `getAssetBatch` metadata in one batched RPC call.
- Supports JSON mode for automation workflows.

## 🚀 Quick Start

```bash
cd Clawberto-shitcoins-helius
node skills/helius-top-volume/scripts/helius_top_volume.mjs "helius top-volume"
```

## 🔌 Commands

| Command | What it does |
|---|---|
| `helius top-volume` | Fetch top Solana tokens by 24h volume |
| `helius top-volume --count 20` | Show top 20 |
| `helius top-volume --min-volume 100000` | Require at least `$100k` 24h volume |
| `helius top-volume --format json` | Output machine-readable JSON |
| `helius top-volume --api-key YOUR_CG_KEY` | Use CoinGecko API key for this run |

### Flags

- `--count N` – how many results (default `10`)
- `--pages N` – how many CoinGecko market pages to scan (default `5`)
- `--per-page N` – page size, max `250` (default `250`)
- `--min-volume USD` – minimum 24h USD volume
- `--format json` – compact JSON output
- `--api-key <key>` – optional CoinGecko API key
- `--help` – show command help

## 🧩 Helius integration (conservative usage)

This skill is designed to keep Helius usage low:

- **1** Helius call for the token list (`getAssetBatch`)
- No per-token Helius loops

Helius key resolution:
1. `HELIUS_API_KEY`
2. `HELIUS_KEY`
3. macOS Keychain (service: `HELIUS_API_KEY`, account: `openclaw-helius`)

### CoinGecko API key source (optional)

- `--api-key <key>` (CLI argument)
- `COINGECKO_API_KEY` env
- `COINGECKO_KEY` env
- macOS Keychain (service: `COINGECKO_API_KEY`, account: `openclaw-coingecko`)

If no key is found, script uses public CoinGecko endpoints.

## 🧪 Example output

```text
Top 10 Solana tokens by 24h volume (CoinGecko, enriched via Helius)
| # | Symbol | Name | Mint | 24h Volume | 24h Change | CG Price | Helius Price |
|---|---|---|---|---|---|---|---|
| 1 | WIF | dogwifhat | H9x... | $12,345,678.00 | +12.41% | $0.45 | $0.44 |
...
```

## 🧭 Repo layout

```text
Clawberto-shitcoins-helius/
├─ README.md
├─ skills/
│  └─ helius-top-volume/
│     ├─ SKILL.md
│     └─ scripts/
│        └─ helius_top_volume.mjs
```

## 🛡️ Notes

- Market ranking uses CoinGecko `coins/markets` (24h volume).
- Helius is used for enrichment only and is optional for operation; CoinGecko key is optional and improves reliability.
- If no Helius key is available, results still return with `helius_price_usd: n/a` in JSON.
