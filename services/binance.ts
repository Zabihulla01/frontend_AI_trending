export const BINANCE_BASE_URL = "https://api.binance.com/api/v3";
const BINANCE_BASE_URLS = [
  process.env.BINANCE_API_BASE_URL,
  BINANCE_BASE_URL,
  "https://api1.binance.com/api/v3",
  "https://api2.binance.com/api/v3",
  "https://data-api.binance.vision/api/v3",
].filter((baseUrl, index, urls): baseUrl is string => Boolean(baseUrl) && urls.indexOf(baseUrl) === index);
const REQUEST_TIMEOUT_MS = 7_000;
const CACHE_TTL_MS = 5_000;
const STALE_CACHE_TTL_MS = 10 * 60_000;
const VALID_SYMBOL = /^[A-Z0-9]{5,20}$/;
const VALID_INTERVAL = /^(1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w|1M)$/;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  staleUntil: number;
}

const responseCache = new Map<string, CacheEntry<unknown>>();
const inFlightRequests = new Map<string, Promise<unknown>>();

function getCached<T>(key: string, allowStale = false): T | null {
  const entry = responseCache.get(key) as CacheEntry<T> | undefined;

  if (!entry || (allowStale ? entry.staleUntil : entry.expiresAt) <= Date.now()) {
    return null;
  }

  return entry.value;
}

function setCached<T>(key: string, value: T, ttlMs = CACHE_TTL_MS) {
  const now = Date.now();
  responseCache.set(key, {
    value,
    expiresAt: now + ttlMs,
    staleUntil: now + Math.max(ttlMs, STALE_CACHE_TTL_MS),
  });
}

async function fetchBinanceJson(path: string): Promise<unknown> {
  const errors: string[] = [];

  for (const baseUrl of BINANCE_BASE_URLS) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`Binance request failed with status ${response.status}`);
      }

      return response.json();
    } catch (error) {
      errors.push(`${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Unable to reach Binance API. ${errors.join(" | ")}`);
}

export type BinanceKlineResponse = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string
];

export interface BinanceSymbolSearchResult {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
}

export function isBinanceKlineClosed(kline: BinanceKlineResponse, now = Date.now()) {
  const closeTime = Number(kline[6]);

  return Number.isFinite(closeTime) && closeTime < now;
}

export function getClosedBinanceKlines(klines: BinanceKlineResponse[], now = Date.now()) {
  return klines.slice(0, -1).filter((kline) => isBinanceKlineClosed(kline, now));
}

interface BinanceExchangeInfoResponse {
  symbols: Array<{
    symbol: string;
    status: string;
    baseAsset: string;
    quoteAsset: string;
    isSpotTradingAllowed?: boolean;
  }>;
}

export async function fetchBinanceKlines(
  symbol: string,
  interval: string,
  limit = 100
): Promise<BinanceKlineResponse[]> {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const normalizedInterval = interval.trim();
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 1000);

  if (!VALID_SYMBOL.test(normalizedSymbol)) {
    throw new Error("Invalid trading symbol");
  }

  if (!VALID_INTERVAL.test(normalizedInterval)) {
    throw new Error("Invalid kline interval");
  }

  const params = new URLSearchParams({
    symbol: normalizedSymbol,
    interval: normalizedInterval,
    limit: String(safeLimit),
  });
  const cacheKey = `klines:${params.toString()}`;
  const cached = getCached<BinanceKlineResponse[]>(cacheKey);

  if (cached) {
    return cached;
  }

  let data: unknown;
  let request = inFlightRequests.get(cacheKey);

  if (!request) {
    request = fetchBinanceJson(`/klines?${params.toString()}`);
    inFlightRequests.set(cacheKey, request);
  }

  try {
    data = await request;
  } catch (error) {
    const stale = getCached<BinanceKlineResponse[]>(cacheKey, true);
    if (stale) {
      return stale;
    }
    throw error;
  } finally {
    if (inFlightRequests.get(cacheKey) === request) {
      inFlightRequests.delete(cacheKey);
    }
  }

  if (!Array.isArray(data)) {
    throw new Error("Unexpected Binance response");
  }

  const klines = data as BinanceKlineResponse[];
  setCached(cacheKey, klines);
  return klines;
}

export async function searchBinanceSymbols(
  query: string,
  limit = 10
): Promise<BinanceSymbolSearchResult[]> {
  const normalizedQuery = query.trim().toUpperCase().replace(/\s+/g, "");
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 20);

  if (!normalizedQuery) {
    return [];
  }

  if (!/^[A-Z0-9]{1,20}$/.test(normalizedQuery)) {
    return [];
  }

  const cacheKey = "exchange-info";
  const cached = getCached<BinanceExchangeInfoResponse>(cacheKey);
  const data = cached ?? (await fetchBinanceJson("/exchangeInfo")) as BinanceExchangeInfoResponse;

  if (!Array.isArray(data.symbols)) {
    throw new Error("Unexpected Binance exchangeInfo response");
  }

  if (!cached) {
    setCached(cacheKey, data, 60 * 60_000);
  }

  return data.symbols
    .filter((item) => {
      const isTrading = item.status === "TRADING";
      const isSpot = item.isSpotTradingAllowed !== false;
      const isUsdtPair = item.quoteAsset === "USDT";
      const matchesBase = item.baseAsset.startsWith(normalizedQuery);
      const matchesSymbol = item.symbol.includes(normalizedQuery);

      return isTrading && isSpot && isUsdtPair && (matchesBase || matchesSymbol);
    })
    .sort((a, b) => {
      const aExact = a.baseAsset === normalizedQuery || a.symbol === normalizedQuery;
      const bExact = b.baseAsset === normalizedQuery || b.symbol === normalizedQuery;

      if (aExact !== bExact) {
        return aExact ? -1 : 1;
      }

      return a.symbol.localeCompare(b.symbol);
    })
    .slice(0, safeLimit)
    .map((item) => ({
      symbol: item.symbol,
      baseAsset: item.baseAsset,
      quoteAsset: item.quoteAsset,
      status: item.status,
    }));
}
