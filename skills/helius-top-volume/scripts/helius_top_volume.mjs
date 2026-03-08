#!/usr/bin/env node
// Helius-only scanner: Orb Cults ranking + optional DAS enrichment.

import { execSync } from "node:child_process";

const DEFAULT_COUNT = 10;
const DEFAULT_MIN_VOLUME = 0;
const HELIUS_RPC = "https://mainnet.helius-rpc.com/?api-key=";
const HELIUS_KEYCHAIN_SERVICE = "HELIUS_API_KEY";
const HELIUS_KEYCHAIN_ACCOUNT = "openclaw-helius";
const ORB_URL_CANDIDATES = [
  "https://orbmarkets.io/?cluster=mainnet-beta&timeframe=24h&tab=cults",
  "https://orbmarkets.io/?cluster=mainnet-beta&timeframe=24h&category=cults",
  "https://orbmarkets.io/?cluster=mainnet-beta&timeframe=24h&view=cults",
  "https://orbmarkets.io/?cluster=mainnet-beta&timeframe=24h&sector=cults",
  "https://orbmarkets.io/?cluster=mainnet-beta&timeframe=24h",
  "https://orbmarkets.io/",
];
const VOLUME_KEYS = [
  "volume24h",
  "volume_24h",
  "volume24husd",
  "volume_usd_24h",
  "volumeusd24h",
  "usdvolume24h",
  "dailyvolume",
  "daily_volume",
  "tradingvolume24h",
];
const PRICE_KEYS = [
  "price",
  "priceusd",
  "price_usd",
  "usdprice",
  "tokenprice",
  "token_price",
  "currentprice",
  "current_price",
];
const MARKET_CAP_KEYS = [
  "marketcap",
  "market_cap",
  "marketcapusd",
  "market_cap_usd",
  "usdmarketcap",
  "fdv",
];
const LINK_HINTS = ["/token/", "/address/"];
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
  - Fetches the Helius-owned Orb Markets page.
  - Treats Orb's "Cults" category as the shitcoin universe.
  - Extracts the 24h ranking by trading volume from public Orb page state.
  - Optionally enriches the resulting mints with one Helius DAS getAssetBatch call.

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

Key source for optional enrichment:
  1. HELIUS_API_KEY
  2. HELIUS_KEY
  3. macOS Keychain (service: ${HELIUS_KEYCHAIN_SERVICE}, account: ${HELIUS_KEYCHAIN_ACCOUNT})
`);
}

function parseInput(raw) {
  const input = raw.trim();
  if (!input) {
    return { command: "help", args: {} };
  }

  let text = input;
  const prefixMatch = text.match(/^\/?helius\b/i);
  if (prefixMatch) {
    text = text.slice(prefixMatch[0].length).trim();
  }

  if (!text) {
    return { command: "help", args: {} };
  }

  const tokens = [...text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((match) => match[1] || match[2] || match[3]);
  const commandIndex = tokens.findIndex((token) => !String(token).startsWith("--"));
  const first = String(commandIndex >= 0 ? tokens[commandIndex] : "").toLowerCase();
  const args = {};

  for (let i = 0; i < tokens.length; i += 1) {
    if (i === commandIndex) {
      continue;
    }

    const token = String(tokens[i]);
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const nextIndex = i + 1;
    const next = tokens[nextIndex];
    if (nextIndex !== commandIndex && next && !String(next).startsWith("--")) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }

  if (args.help || args.h || args["?"] || first === "help" || first === "-h") {
    return { command: "help", args };
  }

  if (first === "top-volume" || first === "top-volume-24h" || first === "top" || first === "top10") {
    const out = {
      command: "top-volume",
      args,
      count: null,
      minVolume: null,
      format: "text",
    };

    const afterCommand = commandIndex >= 0 ? tokens.slice(commandIndex + 1).filter((token) => !String(token).startsWith("--")) : [];
    if (first === "top" && /^\d+$/.test(String(afterCommand[0] || ""))) {
      out.count = Number(afterCommand[0]);
    }

    const aliasCount = args.count ?? args.n ?? args.top ?? out.count;
    const aliasMinVol = args["min-volume"] ?? args.minvolume ?? args.min;
    const fmt = args.format ?? args.f;

    if (fmt === "json") {
      out.format = "json";
    }

    out.count = normalizeInt(aliasCount, DEFAULT_COUNT, 1, 100);
    out.minVolume = normalizeFloat(aliasMinVol, DEFAULT_MIN_VOLUME, 0);

    return out;
  }

  if (first && /top/i.test(first) && /volume/i.test(text)) {
    const possibleCount = Number((text.match(/top\s+(\d{1,3})/i) || [])[1] || DEFAULT_COUNT);
    const minVolumeMatch = text.match(/min(?:imum)?(?:-|\s)volume\s+([0-9.]+)/i);
    return {
      command: "top-volume",
      args,
      count: normalizeInt(possibleCount, DEFAULT_COUNT, 1, 100),
      minVolume: normalizeFloat(minVolumeMatch ? minVolumeMatch[1] : DEFAULT_MIN_VOLUME, DEFAULT_MIN_VOLUME, 0),
      format: args.format === "json" ? "json" : "text",
    };
  }

  return { command: "help", args };
}

function normalizeInt(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function normalizeFloat(value, fallback, min = Number.NEGATIVE_INFINITY) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(min, n);
}

function toUsd(value, { minimumFractionDigits = 2, maximumFractionDigits = 2 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return "n/a";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(n);
}

function getHeliusApiKey() {
  if (process.env.HELIUS_API_KEY) {
    return process.env.HELIUS_API_KEY;
  }
  if (process.env.HELIUS_KEY) {
    return process.env.HELIUS_KEY;
  }

  try {
    if (process.platform === "darwin") {
      const key = execSync(
        `security find-generic-password -s ${JSON.stringify(HELIUS_KEYCHAIN_SERVICE)} -a ${JSON.stringify(HELIUS_KEYCHAIN_ACCOUNT)} -w`,
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).trim();
      if (key) {
        return key;
      }
    }
  } catch {
    // No-op: key lookup failed.
  }

  return "";
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
        const detail = text.trim().slice(0, 300);
        const error = new Error(`HTTP ${resp.status} ${resp.statusText}${detail ? `: ${detail}` : ""}`);
        error.status = resp.status;
        throw error;
      }

      return resp;
    } catch (error) {
      clearTimeout(timeout);
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

async function fetchTextWithTimeout(url, options = {}, timeoutMs = 15000, retries = 1) {
  const resp = await fetchWithTimeout(url, options, timeoutMs, retries);
  return resp.text();
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 15000, retries = 1) {
  const resp = await fetchWithTimeout(url, options, timeoutMs, retries);
  return resp.json();
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&quot;/g, "\"")
    .replace(/&#34;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripHtml(text) {
  return decodeHtmlEntities(String(text || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeKey(key) {
  return String(key || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function extractBalancedJsonSubstrings(text, { maxBlocks = 200 } = {}) {
  const blocks = [];
  const seen = new Set();
  const stack = [];
  let start = -1;
  let inString = false;
  let quote = "";
  let escape = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === quote) {
        inString = false;
        quote = "";
      }
      continue;
    }

    if (ch === "\"" || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }

    if (ch === "{" || ch === "[") {
      if (stack.length === 0) {
        start = i;
      }
      stack.push(ch === "{" ? "}" : "]");
      continue;
    }

    if ((ch === "}" || ch === "]") && stack.length) {
      if (stack[stack.length - 1] === ch) {
        stack.pop();
        if (stack.length === 0 && start >= 0) {
          const candidate = text.slice(start, i + 1);
          if (
            candidate.length >= 20 &&
            candidate.length <= 2_000_000 &&
            /volume|token|symbol|market|cult|meme/i.test(candidate)
          ) {
            const key = candidate.slice(0, 200);
            if (!seen.has(key)) {
              seen.add(key);
              blocks.push(candidate);
              if (blocks.length >= maxBlocks) {
                break;
              }
            }
          }
          start = -1;
        }
      } else {
        stack.length = 0;
        start = -1;
      }
    }
  }

  return blocks;
}

function extractScriptContents(html) {
  const out = [];
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const content = String(match[1] || "").trim();
    if (content) {
      out.push(content);
    }
  }
  return out;
}

function extractQuotedStrings(text) {
  const out = [];
  const re = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'/g;
  for (const match of text.matchAll(re)) {
    const literal = match[0];
    let decoded = null;

    if (literal.startsWith("\"")) {
      decoded = safeJsonParse(literal);
    } else {
      const inner = literal.slice(1, -1)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, "\\\"");
      decoded = safeJsonParse(`"${inner}"`);
    }

    if (typeof decoded === "string" && decoded.length >= 20) {
      out.push(decoded);
    }
  }
  return out;
}

function collectJsonPayloads(html) {
  const payloads = [];
  const seen = new Set();

  const addIfParsed = (value) => {
    if (!value) {
      return;
    }
    let key = "";
    try {
      key = JSON.stringify(value).slice(0, 1000);
    } catch {
      key = JSON.stringify([typeof value, Array.isArray(value), Object.keys(value || {}).slice(0, 10)]);
    }
    if (!seen.has(key)) {
      seen.add(key);
      payloads.push(value);
    }
  };

  const tryParseCandidate = (candidate) => {
    const trimmed = decodeHtmlEntities(String(candidate || "").trim());
    if (!trimmed) {
      return;
    }

    const direct = safeJsonParse(trimmed);
    if (direct !== null) {
      addIfParsed(direct);
    }

    for (const block of extractBalancedJsonSubstrings(trimmed)) {
      const parsed = safeJsonParse(block);
      if (parsed !== null) {
        addIfParsed(parsed);
      }
    }
  };

  tryParseCandidate(html);

  for (const script of extractScriptContents(html)) {
    tryParseCandidate(script);

    for (const quoted of extractQuotedStrings(script)) {
      if (/volume|token|symbol|market|cult|meme/i.test(quoted)) {
        tryParseCandidate(quoted);
      }
    }
  }

  return payloads;
}

function flattenEntries(value, { maxDepth = 5 } = {}) {
  const out = [];
  const queue = [{ value, path: [] }];
  const seen = new Set();

  while (queue.length) {
    const current = queue.shift();
    const node = current.value;
    if (!node || typeof node !== "object") {
      continue;
    }

    if (seen.has(node)) {
      continue;
    }
    seen.add(node);

    if (Array.isArray(node)) {
      if (current.path.length < maxDepth) {
        for (let i = 0; i < node.length; i += 1) {
          queue.push({ value: node[i], path: current.path.concat(String(i)) });
        }
      }
      continue;
    }

    for (const [key, child] of Object.entries(node)) {
      out.push({ key, normalizedKey: normalizeKey(key), value: child, path: current.path.concat(key) });
      if (child && typeof child === "object" && current.path.length < maxDepth) {
        queue.push({ value: child, path: current.path.concat(key) });
      }
    }
  }

  return out;
}

function firstString(value, keyHints) {
  const entries = flattenEntries(value);
  for (const hint of keyHints.map((key) => normalizeKey(key))) {
    for (const entry of entries) {
      if (entry.normalizedKey === hint) {
        if (typeof entry.value === "string") {
          const text = stripHtml(entry.value);
          if (text) {
            return text;
          }
        }
      }
    }
  }
  return null;
}

function firstNumber(value, keyHints) {
  const entries = flattenEntries(value);
  for (const hint of keyHints.map((key) => normalizeKey(key))) {
    for (const entry of entries) {
      if (entry.normalizedKey === hint) {
        const n = Number(entry.value);
        if (Number.isFinite(n)) {
          return n;
        }
      }
    }
  }
  return null;
}

function firstMint(value) {
  const entries = flattenEntries(value);
  const hintedKeys = new Set(["mint", "address", "tokenaddress", "mintaddress", "id", "tokenid", "assetid"]);

  for (const entry of entries) {
    if (!hintedKeys.has(entry.normalizedKey)) {
      continue;
    }
    if (typeof entry.value === "string") {
      const mint = extractMintFromString(entry.value);
      if (mint) {
        return mint;
      }
    }
  }

  for (const entry of entries) {
    if (typeof entry.value === "string") {
      const mint = extractMintFromString(entry.value);
      if (mint) {
        return mint;
      }
    }
  }

  return null;
}

function extractMintFromString(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return null;
  }

  if (BASE58_RE.test(raw)) {
    return raw;
  }

  for (const hint of LINK_HINTS) {
    const re = new RegExp(`${escapeRegExp(hint)}([1-9A-HJ-NP-Za-km-z]{32,44})`);
    const match = raw.match(re);
    if (match) {
      return match[1];
    }
  }

  return null;
}

function firstUrl(value) {
  const entries = flattenEntries(value);
  for (const entry of entries) {
    if (typeof entry.value !== "string") {
      continue;
    }
    const text = entry.value.trim();
    if (!text) {
      continue;
    }
    if (text.startsWith("https://orbmarkets.io/token/") || text.startsWith("https://orbmarkets.io/address/")) {
      return text;
    }
    if (text.startsWith("/token/") || text.startsWith("/address/")) {
      return `https://orbmarkets.io${text}`;
    }
  }
  return null;
}

function scoreCategoryHint(value, path) {
  const haystack = `${path.join(" ")} ${JSON.stringify(value).slice(0, 4000)}`.toLowerCase();
  let score = 0;
  if (/cults/.test(haystack)) {
    score += 8;
  }
  if (/meme|memecoin/.test(haystack)) {
    score += 4;
  }
  if (/shitcoin/.test(haystack)) {
    score += 4;
  }
  if (/market|markets/.test(haystack)) {
    score += 2;
  }
  return score;
}

function normalizeOrbRow(row, path = []) {
  if (!isPlainObject(row)) {
    return null;
  }

  const mint = firstMint(row);
  if (!mint) {
    return null;
  }

  const volume24hUsd = firstNumber(row, VOLUME_KEYS);
  if (!Number.isFinite(volume24hUsd)) {
    return null;
  }

  const symbol = firstString(row, ["symbol", "ticker", "tokenSymbol", "assetSymbol"]);
  const name = firstString(row, ["name", "tokenName", "displayName", "assetName", "title"]);
  const orbPriceUsd = firstNumber(row, PRICE_KEYS);
  const marketCapUsd = firstNumber(row, MARKET_CAP_KEYS);
  const orbUrl = firstUrl(row) || `https://orbmarkets.io/token/${mint}`;
  const categoryHint = firstString(row, ["category", "sector", "tab", "type", "bucket", "group"]);
  const joinedPath = path.join(".").toLowerCase();
  const combinedCategory = `${categoryHint || ""} ${joinedPath}`.trim().toLowerCase();

  return {
    symbol: (symbol || "N/A").toUpperCase(),
    name: name || symbol || mint,
    mint,
    volume24hUsd,
    orbPriceUsd: Number.isFinite(orbPriceUsd) ? orbPriceUsd : null,
    marketCapUsd: Number.isFinite(marketCapUsd) ? marketCapUsd : null,
    orbUrl,
    category: /cult|meme|shitcoin/.test(combinedCategory) ? "cults" : null,
  };
}

function collectArrayCandidates(node, path = [], candidates = []) {
  if (!node || typeof node !== "object") {
    return candidates;
  }

  if (Array.isArray(node)) {
    const normalized = node.map((entry) => normalizeOrbRow(entry, path)).filter(Boolean);
    if (normalized.length >= 3) {
      const uniqueByMint = new Map();
      for (const row of normalized) {
        const existing = uniqueByMint.get(row.mint);
        if (!existing || row.volume24hUsd > existing.volume24hUsd) {
          uniqueByMint.set(row.mint, row);
        }
      }

      const rows = Array.from(uniqueByMint.values()).sort((a, b) => b.volume24hUsd - a.volume24hUsd);
      const score =
        rows.length +
        scoreCategoryHint(node, path) +
        rows.filter((row) => row.category === "cults").length * 2;

      candidates.push({
        path,
        rows,
        score,
      });
    }

    for (let i = 0; i < node.length; i += 1) {
      collectArrayCandidates(node[i], path.concat(String(i)), candidates);
    }
    return candidates;
  }

  for (const [key, value] of Object.entries(node)) {
    collectArrayCandidates(value, path.concat(key), candidates);
  }

  return candidates;
}

function pickBestOrbDataset(payloads) {
  const candidates = [];
  for (const payload of payloads) {
    collectArrayCandidates(payload, [], candidates);
  }

  if (!candidates.length) {
    return null;
  }

  candidates.sort((a, b) => b.score - a.score || b.rows.length - a.rows.length);
  return candidates[0];
}

async function fetchOrbTopCults({ count, minVolume }) {
  const errors = [];

  for (const sourceUrl of ORB_URL_CANDIDATES) {
    try {
      const html = await fetchTextWithTimeout(sourceUrl, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "Clawberto-Helius-Top-Volume/1.0",
        },
      });

      const payloads = collectJsonPayloads(html);
      const dataset = pickBestOrbDataset(payloads);
      if (!dataset) {
        errors.push(`${sourceUrl}: no structured market rows found in Orb page state`);
        continue;
      }

      const cultRows = dataset.rows.filter((row) => row.category === "cults");
      const rows = (cultRows.length ? cultRows : dataset.rows)
        .filter((row) => row.volume24hUsd >= minVolume)
        .sort((a, b) => b.volume24hUsd - a.volume24hUsd)
        .slice(0, count);

      if (!rows.length) {
        return {
          sourceUrl,
          extractionPath: dataset.path.join(".") || "(root)",
          rows: [],
        };
      }

      return {
        sourceUrl,
        extractionPath: dataset.path.join(".") || "(root)",
        rows,
      };
    } catch (error) {
      errors.push(`${sourceUrl}: ${error.message || String(error)}`);
    }
  }

  throw new Error(
    [
      "Unable to extract Orb Cults market data.",
      "Helius does not publish a dedicated top-volume API for this workflow, so this skill depends on the public Orb Markets page exposing structured state.",
      ...errors.map((line) => `- ${line}`),
    ].join("\n"),
  );
}

async function fetchHeliusEnrichment(mints) {
  if (!mints.length) {
    return new Map();
  }

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
  const payload = await fetchJsonWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    15000,
    1,
  );

  if (!payload || payload.error) {
    const msg = payload?.error?.message || "Unknown Helius error";
    throw new Error(`Helius getAssetBatch failed: ${msg}`);
  }

  const result = Array.isArray(payload.result) ? payload.result : [payload.result].filter(Boolean);
  const byMint = new Map();
  for (const item of result) {
    if (!item || !item.id) {
      continue;
    }
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
      classification: "cults",
      symbol: token.symbol,
      name: token.name,
      mint: token.mint,
      volume_24h_usd: token.volume24hUsd,
      price_usd_orb: token.orbPriceUsd,
      market_cap_usd_orb: token.marketCapUsd,
      helius_price_usd: typeof heliusPrice === "number" ? heliusPrice : null,
      helius_currency: tokenInfo.price_info?.currency || null,
      helius_name: helius?.content?.metadata?.name || null,
      helius_symbol: helius?.token_info?.symbol || null,
      helius_supply: tokenInfo.supply ?? null,
      orb_url: token.orbUrl,
      helius_enriched: Boolean(helius),
    };
  });
}

function printText(rows, { sourceUrl, extractionPath, minVolume }) {
  const header = [];
  header.push(`Top ${rows.length} Solana shitcoins by 24h volume (Helius Orb Cults)`);
  header.push(`Definition: "shitcoins" means tokens listed in Orb's Cults category.`);
  header.push(`Method: public Orb Markets page -> 24h timeframe -> Cults rows -> optional DAS getAssetBatch enrichment.`);
  header.push(`Orb source: ${sourceUrl}`);
  header.push(`Extraction path: ${extractionPath}`);
  if (minVolume > 0) {
    header.push(`Min 24h volume filter: ${toUsd(minVolume)}`);
  }
  header.push("");
  header.push(`| # | Symbol | Name | Mint | 24h Volume | Orb Price | Helius Price |`);
  header.push("|---|---|---|---|---|---|---|");

  const lines = rows.map((row) => {
    const orbPrice = Number.isFinite(row.price_usd_orb) ? toUsd(row.price_usd_orb) : "n/a";
    const heliusPrice = Number.isFinite(row.helius_price_usd) ? toUsd(row.helius_price_usd) : "n/a";
    return `| ${row.rank} | ${row.symbol} | ${row.name} | ${row.mint} | ${toUsd(row.volume_24h_usd)} | ${orbPrice} | ${heliusPrice} |`;
  });

  const urls = ["", "Orb token pages:"];
  for (const row of rows) {
    urls.push(`${row.rank}. ${row.symbol} ${row.orb_url}`);
  }

  log([...header, ...lines, ...urls].join("\n"));
  log("\nLimitation: Helius does not document a single top-volume API for this use case; this command depends on Orb continuing to expose structured Cults market state.");
}

async function runTopVolume(opts) {
  const { count, minVolume, format } = opts;

  const orb = await fetchOrbTopCults({ count, minVolume });
  if (!orb.rows.length) {
    if (format === "json") {
      log(
        JSON.stringify(
          {
            error: "No Orb Cults tokens matched the current filters.",
            source: "helius.orb.markets.cults.24h",
            filters: { count, minVolume },
          },
          null,
          2,
        ),
      );
    } else {
      err("No Orb Cults tokens matched the current filters.");
    }
    return;
  }

  const heliusAssets = await fetchHeliusEnrichment(orb.rows.map((row) => row.mint));
  const rows = buildRows(orb.rows, heliusAssets);

  if (format === "json") {
    log(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          source: "helius.orb.markets.cults.24h",
          methodology: "Fetch the Helius-owned Orb Markets page, treat the Cults category as the shitcoin universe, sort by 24h volume, then enrich the selected mints with one Helius DAS getAssetBatch call when a Helius API key is available.",
          limitations: [
            "Helius does not publish a dedicated top-volume endpoint for this workflow.",
            "Ranking depends on the public Orb Markets page continuing to expose structured Cults market state.",
            "The shitcoin classification is exactly Orb's Cults category, not a custom classifier.",
          ],
          filters: {
            count,
            minVolume,
            timeframe: "24h",
            classification: "cults",
          },
          totals: {
            tokenRows: rows.length,
            heliusEnrichedRows: rows.filter((row) => row.helius_enriched).length,
          },
          orb: {
            sourceUrl: orb.sourceUrl,
            extractionPath: orb.extractionPath,
          },
          tokens: rows,
        },
        null,
        2,
      ),
    );
    return;
  }

  printText(rows, {
    sourceUrl: orb.sourceUrl,
    extractionPath: orb.extractionPath,
    minVolume,
  });
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
