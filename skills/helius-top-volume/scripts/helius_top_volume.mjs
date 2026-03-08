#!/usr/bin/env node
// Helius-only scanner: Orb Cults 24h top-volume ranking + optional DAS enrichment.

import { execSync } from "node:child_process";

const DEFAULT_COUNT = 10;
const DEFAULT_MIN_VOLUME = 0;
const HELIUS_RPC = "https://mainnet.helius-rpc.com/?api-key=";
const HELIUS_KEYCHAIN_SERVICE = "HELIUS_API_KEY";
const HELIUS_KEYCHAIN_ACCOUNT = "openclaw-helius";
const ORB_VERIFY_URL = "https://orb-api.helius-rpc.com/api/turnstile/verify";
const ORB_ASSETS_URL = "https://orb-api.helius-rpc.com/api/assets";
const ORB_ORIGIN = "https://orbmarkets.io";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

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
  node skills/helius-top-volume/scripts/helius_top_volume.mjs "helius top-volume [--count N] [--min-volume USD] [--format json]"

What this command does:
  - Uses the Helius-owned Orb API only.
  - Treats Orb's "Cults" category as the shitcoin universe.
  - Ranks by 24h volume.
  - Optionally enriches the selected mints with one Helius DAS getAssetBatch call.

Examples:
  node skills/helius-top-volume/scripts/helius_top_volume.mjs "helius top-volume"
  node skills/helius-top-volume/scripts/helius_top_volume.mjs "helius top-volume --count 10"
  node skills/helius-top-volume/scripts/helius_top_volume.mjs "helius top-volume --min-volume 100000"
  node skills/helius-top-volume/scripts/helius_top_volume.mjs "helius top-volume --format json"

Flags:
  --count <n>             Number of ranked shitcoins to show (default: ${DEFAULT_COUNT})
  --min-volume <usd>      Minimum 24h USD volume filter (default: ${DEFAULT_MIN_VOLUME})
  --format json           Output JSON only
  --help, -h              Show this help

Helius DAS enrichment key sources:
  1. HELIUS_API_KEY
  2. HELIUS_KEY
  3. macOS Keychain (service: ${HELIUS_KEYCHAIN_SERVICE}, account: ${HELIUS_KEYCHAIN_ACCOUNT})
`);
}

function parseInput(raw) {
  const input = String(raw || "").trim();
  if (!input) return { command: "help", args: {} };

  let text = input;
  const prefix = text.match(/^\/?helius\b/i);
  if (prefix) {
    text = text.slice(prefix[0].length).trim();
  }
  if (!text) return { command: "help", args: {} };

  const tokens = [...text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] || m[2] || m[3]);
  const args = {};
  const positional = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = String(tokens[i]);
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = tokens[i + 1];
      if (next && !String(next).startsWith("--")) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }
    } else {
      positional.push(token);
    }
  }

  const first = String(positional[0] || "").toLowerCase();
  if (args.help || args.h || args["?"] || first === "help" || first === "-h") {
    return { command: "help", args };
  }

  if (first === "top-volume" || first === "top-volume-24h" || first === "top" || first === "top10") {
    let inferredCount = null;
    if (first === "top" && /^\d+$/.test(String(positional[1] || ""))) {
      inferredCount = Number(positional[1]);
    }

    return {
      command: "top-volume",
      args,
      count: normalizeInt(args.count ?? args.n ?? args.top ?? inferredCount, DEFAULT_COUNT, 1, 100),
      minVolume: normalizeFloat(args["min-volume"] ?? args.minvolume ?? args.min, DEFAULT_MIN_VOLUME, 0),
      format: args.format === "json" ? "json" : "text",
    };
  }

  if (/top\s+\d+/i.test(text) && /volume/i.test(text)) {
    const count = Number((text.match(/top\s+(\d{1,3})/i) || [])[1] || DEFAULT_COUNT);
    const minVolumeMatch = text.match(/min(?:imum)?(?:-|\s)volume\s+([0-9.]+)/i);
    return {
      command: "top-volume",
      args,
      count: normalizeInt(count, DEFAULT_COUNT, 1, 100),
      minVolume: normalizeFloat(minVolumeMatch ? minVolumeMatch[1] : DEFAULT_MIN_VOLUME, DEFAULT_MIN_VOLUME, 0),
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
  const n = Number(value);
  if (!Number.isFinite(n)) return "n/a";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(n);
}

function getHeliusApiKey() {
  if (process.env.HELIUS_API_KEY) return process.env.HELIUS_API_KEY;
  if (process.env.HELIUS_KEY) return process.env.HELIUS_KEY;

  try {
    if (process.platform === "darwin") {
      const key = execSync(
        `security find-generic-password -s ${JSON.stringify(HELIUS_KEYCHAIN_SERVICE)} -a ${JSON.stringify(HELIUS_KEYCHAIN_ACCOUNT)} -w`,
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      if (key) return key;
    }
  } catch {
    // no-op
  }

  return "";
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 15000, retries = 1) {
  const attempt = async (n) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) {
        const body = (await response.text()).trim().slice(0, 300);
        const error = new Error(`HTTP ${response.status} ${response.statusText}${body ? `: ${body}` : ""}`);
        error.status = response.status;
        throw error;
      }
      return response.json();
    } catch (error) {
      clearTimeout(timer);
      if (n < retries && (error.name === "AbortError" || error.status === 429 || error.status >= 500)) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, n)));
        return attempt(n + 1);
      }
      if (error.name === "AbortError") {
        throw new Error(`Timed out while fetching ${url}`);
      }
      throw new Error(`Request failed for ${url}: ${error.message || String(error)}`);
    }
  };

  return attempt(0);
}

function orbHeaders(extra = {}) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": BROWSER_UA,
    Origin: ORB_ORIGIN,
    Referer: `${ORB_ORIGIN}/`,
    ...extra,
  };
}

async function getOrbBearerToken() {
  const payload = await fetchJsonWithTimeout(
    ORB_VERIFY_URL,
    {
      method: "POST",
      headers: orbHeaders(),
      body: "{}",
    },
    15000,
    1,
  );

  if (!payload?.token || payload.valid !== true) {
    throw new Error("Orb auth token request did not return a valid token");
  }
  return payload.token;
}

function mapOrbAsset(asset) {
  const mint = String(asset?.tokenAddress || "").trim();
  if (!BASE58_RE.test(mint)) return null;

  const volume24hUsd = Number(asset?.volume24h ?? asset?.volume ?? 0);
  if (!Number.isFinite(volume24hUsd)) return null;

  return {
    symbol: String(asset?.ticker || asset?.symbol || "N/A").toUpperCase(),
    name: String(asset?.name || asset?.ticker || mint),
    mint,
    volume24hUsd,
    orbPriceUsd: Number.isFinite(Number(asset?.price)) ? Number(asset.price) : null,
    marketCapUsd: Number.isFinite(Number(asset?.marketCap)) ? Number(asset.marketCap) : null,
    liquidityUsd: Number.isFinite(Number(asset?.liquidity)) ? Number(asset.liquidity) : null,
    priceChange24h: Number.isFinite(Number(asset?.priceChange24h)) ? Number(asset.priceChange24h) : null,
    orbUrl: `${ORB_ORIGIN}/token/${mint}`,
    category: String(asset?.category || "").trim() || "Cults",
    trustScore: asset?.trustScore?.label || null,
  };
}

async function fetchOrbTopCults({ count, minVolume }) {
  const token = await getOrbBearerToken();
  const url = new URL(ORB_ASSETS_URL);
  url.searchParams.set("timeframe", "24h");
  url.searchParams.set("page", "1");
  url.searchParams.set("pageSize", String(Math.min(Math.max(count * 3, 25), 100)));
  url.searchParams.set("include_charts", "false");
  url.searchParams.set("category", "Cults");
  url.searchParams.set("sort_by", "volume");

  const payload = await fetchJsonWithTimeout(
    url.toString(),
    {
      method: "GET",
      headers: orbHeaders({ Authorization: `Bearer ${token}` }),
    },
    20000,
    1,
  );

  const assets = Array.isArray(payload?.data?.assets) ? payload.data.assets : [];
  const rows = assets
    .map(mapOrbAsset)
    .filter(Boolean)
    .filter((row) => row.volume24hUsd >= minVolume)
    .sort((a, b) => b.volume24hUsd - a.volume24hUsd)
    .slice(0, count);

  return {
    rows,
    source: "helius.orb.assets.cults.24h",
    query: {
      timeframe: "24h",
      category: "Cults",
      sortBy: "volume",
    },
  };
}

async function fetchHeliusEnrichment(mints) {
  if (!mints.length) return new Map();

  const key = getHeliusApiKey();
  if (!key) return new Map();

  const payload = await fetchJsonWithTimeout(
    `${HELIUS_RPC}${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "1",
        method: "getAssetBatch",
        params: {
          ids: mints,
          options: { showFungible: true },
        },
      }),
    },
    15000,
    1,
  );

  if (payload?.error) {
    throw new Error(`Helius getAssetBatch failed: ${payload.error.message || "Unknown error"}`);
  }

  const items = Array.isArray(payload?.result) ? payload.result : [payload?.result].filter(Boolean);
  const byMint = new Map();
  for (const item of items) {
    if (item?.id) byMint.set(item.id, item);
  }
  return byMint;
}

function buildRows(rows, heliusAssets) {
  return rows.map((row, index) => {
    const asset = heliusAssets.get(row.mint);
    const tokenInfo = asset?.token_info || {};
    const heliusPrice = tokenInfo?.price_info?.price_per_token;

    return {
      rank: index + 1,
      classification: "cults",
      symbol: row.symbol,
      name: row.name,
      mint: row.mint,
      volume_24h_usd: row.volume24hUsd,
      price_usd_orb: row.orbPriceUsd,
      market_cap_usd_orb: row.marketCapUsd,
      liquidity_usd_orb: row.liquidityUsd,
      price_change_24h_percent_orb: row.priceChange24h,
      trust_score_label_orb: row.trustScore,
      helius_price_usd: Number.isFinite(Number(heliusPrice)) ? Number(heliusPrice) : null,
      helius_currency: tokenInfo?.price_info?.currency || null,
      helius_name: asset?.content?.metadata?.name || null,
      helius_symbol: tokenInfo?.symbol || null,
      helius_supply: tokenInfo?.supply ?? null,
      helius_enriched: Boolean(asset),
      orb_url: row.orbUrl,
    };
  });
}

function printText(rows, { minVolume }) {
  log(`Top ${rows.length} Solana shitcoins by 24h volume (Helius Orb Cults)`);
  log(`Definition: shitcoins = Orb category \"Cults\".`);
  log(`Method: Orb API 24h Cults ranking -> optional Helius DAS getAssetBatch enrichment.`);
  if (minVolume > 0) {
    log(`Min 24h volume filter: ${toUsd(minVolume)}`);
  }
  log("");

  for (const row of rows) {
    log(`${row.rank}. ${row.symbol} — ${row.name}`);
    log(`   mint: ${row.mint}`);
    log(`   24h volume: ${toUsd(row.volume_24h_usd)}`);
    log(`   orb price: ${toUsd(row.price_usd_orb)}`);
    log(`   helius price: ${toUsd(row.helius_price_usd)}`);
    log(`   orb url: ${row.orb_url}`);
  }

  log("");
  log("Limitation: classification is exactly Orb Cults, not a custom meme-token classifier.");
}

async function runTopVolume(opts) {
  const { count, minVolume, format } = opts;
  const orb = await fetchOrbTopCults({ count, minVolume });

  if (!orb.rows.length) {
    if (format === "json") {
      log(JSON.stringify({ error: "No Orb Cults tokens matched the current filters." }, null, 2));
    } else {
      err("No Orb Cults tokens matched the current filters.");
    }
    return;
  }

  const heliusAssets = await fetchHeliusEnrichment(orb.rows.map((row) => row.mint));
  const rows = buildRows(orb.rows, heliusAssets);

  if (format === "json") {
    log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      source: orb.source,
      methodology: "Authenticate to the Helius-owned Orb API, query the 24h Cults ranking sorted by volume, then optionally enrich the selected mints with one Helius DAS getAssetBatch call.",
      limitations: [
        "Shitcoins are defined exactly as Orb Cults tokens.",
        "Ranking depends on the Helius-owned Orb API remaining available.",
        "DAS enrichment requires a Helius API key; the Orb ranking itself does not.",
      ],
      filters: {
        count,
        minVolume,
        timeframe: "24h",
        classification: "Cults",
      },
      orb: orb.query,
      totals: {
        tokenRows: rows.length,
        heliusEnrichedRows: rows.filter((row) => row.helius_enriched).length,
      },
      tokens: rows,
    }, null, 2));
    return;
  }

  printText(rows, { minVolume });
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
        minVolume: parsed.minVolume,
        format: parsed.format,
      });
      return;
    }
    usage();
  } catch (error) {
    err(`Error: ${error?.message || String(error)}`);
    process.exit(1);
  }
}

main();
