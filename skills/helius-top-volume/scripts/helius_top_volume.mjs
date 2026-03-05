#!/usr/bin/env node
// Helius + CoinGecko scanner: top Solana tokens by 24h volume.

import { execSync } from "node:child_process";

const DEFAULT_COUNT = 10;
const DEFAULT_MARKETS_PAGES = 5;
const DEFAULT_MARKETS_PER_PAGE = 250;

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const HELIUS_RPC = "https://mainnet.helius-rpc.com/?api-key=";
const KEYCHAIN_SERVICE = "HELIUS_API_KEY";
const KEYCHAIN_ACCOUNT = "openclaw-helius";

function log(...args) {
  // eslint-disable-next-line no-console
  console.log(...args);
}

function err(...args) {
  // eslint-disable-next-line no-console
  console.error(...args);
}

function usage() {
  log(`Usage:
  node skills/helius-top-volume/scripts/helius_top_volume.mjs "helius top-volume [--count N] [--pages N] [--min-volume USD] [--format json] [--count 10]"

Examples:
  node skills/helius-top-volume/scripts/helius_top_volume.mjs "helius top-volume"
  node skills/helius-top-volume/scripts/helius_top_volume.mjs "helius top-volume --count 15 --pages 4"
  node skills/helius-top-volume/scripts/helius_top_volume.mjs "helius top-volume --min-volume 100000"
  node skills/helius-top-volume/scripts/helius_top_volume.mjs "helius top-volume --format json"

Flags:
  --count <n>             Number of top tokens to show (default: ${DEFAULT_COUNT})
  --pages <n>             CoinGecko market pages to scan (default: ${DEFAULT_MARKETS_PAGES})
  --per-page <n>          CoinGecko page size (default: ${DEFAULT_MARKETS_PER_PAGE}, max 250)
  --min-volume <usd>      Minimum 24h volume filter (optional)
  --format json            Output JSON only
  --help, -h               Show this help
`);
}

function parseInput(raw) {
  const input = raw.trim();
  if (!input) {
    return { command: "help", args: {} };
  }

  let text = input;
  const m = text.match(/^\/?helius\b/i);
  if (m) {
    text = text.slice(m[0].length).trim();
  }

  if (!text) {
    return { command: "help", args: {} };
  }

  const tokens = [...text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] || m[2] || m[3]);
  const args = {};
  let i = 0;
  for (; i < tokens.length; i++) {
    const token = String(tokens[i]);
    if (!token.startsWith("--")) {
      break;
    }

    const key = token.slice(2);
    const next = tokens[i + 1];
    if (next && !String(next).startsWith("--")) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }

  const rest = tokens.slice(i);
  const first = String(rest[0] || "").toLowerCase();

  if (args.help || args.h || args["?" ] || first === "help" || first === "-h") {
    return { command: "help", args };
  }

  if (first === "top-volume" || first === "top-volume-24h" || first === "top" || first === "top10") {
    const out = {
      command: "top-volume",
      args,
      count: null,
      pages: null,
      perPage: null,
      minVolume: null,
      format: "text",
    };

    // allow `helius top 10` style
    if (first === "top" && /^\d+$/.test(String(rest[1] || ""))) {
      out.count = Number(rest[1]);
    }

    const aliasCount = args.count ?? args.n ?? args.top ?? out.count;
    const aliasPages = args.pages ?? args.page;
    const aliasPerPage = args["per-page"] ?? args.perpage;
    const aliasMinVol = args["min-volume"] ?? args.minvolume ?? args.min;
    const fmt = args.format ?? args.f;

    if (fmt === "json") out.format = "json";
    out.count = normalizeInt(aliasCount, DEFAULT_COUNT, 1, 100);
    out.pages = normalizeInt(aliasPages, DEFAULT_MARKETS_PAGES, 1, 20);
    out.perPage = normalizeInt(aliasPerPage, DEFAULT_MARKETS_PER_PAGE, 1, 250);
    out.minVolume = normalizeFloat(aliasMinVol, 0, 0);

    return out;
  }

  // fallback heuristic: "top 10 by 24h volume"
  if (first && /top/i.test(first) && /volume/i.test(text)) {
    const possibleCount = Number((text.match(/top\s+(\d{1,3})/i) || [])[1] || DEFAULT_COUNT);
    const minVolumeMatch = text.match(/min(?:imum)?(?:-|\s)volume\s+([0-9.]+)/i);
    return {
      command: "top-volume",
      args,
      count: normalizeInt(possibleCount, DEFAULT_COUNT, 1, 100),
      pages: DEFAULT_MARKETS_PAGES,
      perPage: DEFAULT_MARKETS_PER_PAGE,
      minVolume: normalizeFloat(minVolumeMatch ? minVolumeMatch[1] : 0, 0, 0),
      format: args.format === "json" ? "json" : "text",
    };
  }

  return { command: "help", args };
}

function normalizeInt(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function normalizeFloat(value, fallback, min = Number.NEGATIVE_INFINITY) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, n);
}

function toUsd(value, { minimumFractionDigits = 2, maximumFractionDigits = 2 } = {}) {
  const n = Number(value || 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(Number.isFinite(n) ? n : 0);
}

function toPct(value, fallback = 0) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "n/a";
  return `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(2)}%`;
}

function fetchWithTimeout(url, options = {}, timeoutMs = 15000, retries = 1) {
  const attempt = async (n) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!resp.ok) {
        const text = await resp.text();
        const err = new Error(`HTTP ${resp.status} ${resp.statusText}: ${text.slice(0, 200)}`);
        err.status = resp.status;
        throw err;
      }
      return resp.json();
    } catch (error) {
      clearTimeout(timeout);
      if (n < retries && (error.name === "AbortError" || error.status === 429 || error.status >= 500)) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, n)));
        return attempt(n + 1);
      }
      throw error;
    }
  };
  return attempt(0);
}

async function fetchCoinListPlatforms() {
  const url = `${COINGECKO_BASE}/coins/list?include_platform=true`;
  const payload = await fetchWithTimeout(url);

  const out = new Map();
  for (const coin of payload) {
    const platforms = coin.platforms || {};
    const mint = typeof platforms.solana === "string" && platforms.solana.trim() ? platforms.solana.trim() : null;
    if (mint) {
      out.set(coin.id, mint);
    }
  }
  return out;
}

async function fetchTopMarketsByVolume({ count, pages, perPage }) {
  const out = [];
  for (let page = 1; page <= pages; page++) {
    const url = new URL(`${COINGECKO_BASE}/coins/markets`);
    url.searchParams.set("vs_currency", "usd");
    url.searchParams.set("order", "volume_desc");
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));
    url.searchParams.set("sparkline", "false");
    url.searchParams.set("price_change_percentage", "24h");

    const batch = await fetchWithTimeout(url.toString());
    if (!Array.isArray(batch)) break;
    out.push(...batch);
    if (batch.length < perPage) break;

    // stop early if we already have enough for a likely top-k selection and we're past first pass
    if (out.length >= count * 30) {
      break;
    }
  }
  return out;
}

function pickSolanaTokensFromMarkets(markets, solanaMap, { count, minVolume }) {
  const picked = new Map();

  for (const coin of markets) {
    const mint = solanaMap.get(coin.id);
    if (!mint) continue;

    const volume = Number(coin.total_volume || 0);
    if (!(Number.isFinite(volume) && volume >= minVolume)) continue;

    const existing = picked.get(mint);
    const candidate = {
      coingeckoId: coin.id,
      symbol: String(coin.symbol || "").toUpperCase() || "N/A",
      name: coin.name || "Unknown",
      mint,
      volume24hUsd: volume,
      priceUsd: Number(coin.current_price || 0),
      change24h: coin.price_change_percentage_24h,
      marketCapRank: coin.market_cap_rank ?? null,
      lastUpdated: coin.last_updated || null,
      coingeckoMarketCap: Number(coin.market_cap || 0),
    };

    if (!existing || volume > existing.volume24hUsd) {
      picked.set(mint, candidate);
    }

    if (picked.size >= count * 3) {
      // rough early stop: only keep a small superset to avoid scanning all pages.
      // final exact top is still sorted after filtering.
      continue;
    }
  }

  const list = Array.from(picked.values()).sort((a, b) => b.volume24hUsd - a.volume24hUsd);
  return list.slice(0, count);
}

function getHeliusApiKey() {
  if (process.env.HELIUS_API_KEY) return process.env.HELIUS_API_KEY;
  if (process.env.HELIUS_KEY) return process.env.HELIUS_KEY;

  try {
    if (process.platform === "darwin") {
      const key = execSync(`security find-generic-password -s ${JSON.stringify(KEYCHAIN_SERVICE)} -a ${JSON.stringify(KEYCHAIN_ACCOUNT)} -w`, {
        encoding: "utf8",
      }).trim();
      if (key) return key;
    }
  } catch {
    // no-op: key lookup failed.
  }
  return "";
}

async function fetchHeliusEnrichment(mints) {
  if (mints.length === 0) return new Map();

  const key = getHeliusApiKey();
  if (!key) {
    return new Map();
  }

  const body = {
    jsonrpc: "2.0",
    id: "1",
    method: "getAssetBatch",
    params: {
      ids: mints,
      options: {
        showFungible: true,
      },
    },
  };

  const url = `${HELIUS_RPC}${encodeURIComponent(key)}`;
  const payload = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!payload || payload.error) {
    const msg = payload?.error?.message || "Unknown Helius error";
    throw new Error(`Helius error: ${msg}`);
  }

  const result = Array.isArray(payload.result) ? payload.result : [payload.result].filter(Boolean);
  const byMint = new Map();
  for (const item of result) {
    if (!item || !item.id) continue;
    byMint.set(item.id, item);
  }
  return byMint;
}

function buildRows(topTokens, heliusAssets) {
  return topTokens.map((token, idx) => {
    const helius = heliusAssets.get(token.mint);
    const tokenInfo = helius?.token_info || {};
    const heliusPrice = tokenInfo.price_info?.price_per_token;

    return {
      rank: idx + 1,
      coingeckoId: token.coingeckoId,
      symbol: token.symbol,
      name: token.name,
      mint: token.mint,
      volume_24h_usd: token.volume24hUsd,
      price_24h_change_percent: token.change24h,
      price_usd_coingecko: token.priceUsd,
      market_cap_rank: token.marketCapRank,
      helius_price_usd: heliusPrice ?? null,
      helius_verified: Boolean(helius),
      currency: tokenInfo.price_info?.currency || null,
      helius_name: helius?.content?.metadata?.name || null,
      helius_symbol: helius?.token_info?.symbol || null,
      helius_supply: tokenInfo.supply ?? null,
    };
  });
}

function printText(rows, options, scannedMarkets) {
  const header = [];
  header.push(`Top ${rows.length} Solana tokens by 24h volume (CoinGecko, enriched via Helius)`);
  header.push(`CoinGecko markets scanned: ${scannedMarkets}.`);
  header.push("" );
  header.push(`| # | Symbol | Name | Mint | 24h Volume | 24h Change | CG Price | Helius Price |`);
  header.push("|---|---|---|---|---|---|---|---|");

  const lines = rows.map((r) => {
    const heliusPrice = typeof r.helius_price_usd === "number" ? toUsd(r.helius_price_usd) : "n/a";
    return `| ${r.rank} | ${r.symbol} | ${r.name} | ${r.mint} | ${toUsd(r.volume_24h_usd)} | ${toPct(r.price_24h_change_percent)} | ${toUsd(r.price_usd_coingecko)} | ${heliusPrice} |`;
  });

  log([...header, ...lines].join("\n"));
}

async function runTopVolume(opts) {
  const { count, pages, perPage, minVolume, format } = opts;

  const solanaMap = await fetchCoinListPlatforms();

  const markets = await fetchTopMarketsByVolume({ count, pages, perPage });
  const topTokens = pickSolanaTokensFromMarkets(markets, solanaMap, { count: count * 2, minVolume });

  if (!topTokens.length) {
    if (format === "json") {
      log(JSON.stringify({ error: "No Solana tokens found with current filters." }, null, 2));
    } else {
      err("No Solana tokens found with current filters.");
    }
    return;
  }

  const heliusAssets = await fetchHeliusEnrichment(topTokens.map((t) => t.mint));
  const rows = buildRows(topTokens, heliusAssets);

  if (format === "json") {
    log(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          source: "coingecko.coins/markets",
          filters: {
            count,
            pages,
            perPage,
            minVolume,
          },
          totals: {
            scannedMarketRows: markets.length,
            tokenRows: rows.length,
          },
          tokens: rows,
        },
        null,
        2,
      ),
    );
    return;
  }

  printText(rows, opts, markets.length);
  log("\nHelius enrichment note: includes price_info and mint metadata when available.");
  log("Conservative Helius usage: 1 RPC call via getAssetBatch for all displayed tokens.");
}

async function main() {
  const parsed = parseInput(process.argv.slice(2).join(" "));

  if (parsed.command === "help") {
    usage();
    return;
  }

  try {
    if (parsed.command === "top-volume") {
      await runTopVolume({
        count: parsed.count,
        pages: parsed.pages,
        perPage: parsed.perPage,
        minVolume: parsed.minVolume,
        format: parsed.format,
      });
      return;
    }

    usage();
  } catch (e) {
    err(`Error: ${e?.message || String(e)}`);
    process.exit(1);
  }
}

main();
