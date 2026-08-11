import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

const DEFAULT_WATCHLIST = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"];
const VALID_SYMBOL = /^[A-Z0-9]{3,20}$/;
export const MARKET_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export type MarketInterval = (typeof MARKET_INTERVALS)[number];

interface MarketState {
  symbol: string;
  interval: MarketInterval;
  watchlist: string[];
  validSymbols: string[];
  setSymbol: (symbol: string) => void;
  setInterval: (interval: string) => void;
  addSymbol: (symbol: string) => boolean;
  removeSymbol: (symbol: string) => void;
  registerValidSymbols: (symbols: string[]) => void;
}

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase().replace(/\s+/g, "");
}

export function isMarketInterval(interval: string): interval is MarketInterval {
  return (MARKET_INTERVALS as readonly string[]).includes(interval);
}

export const useMarketStore = create<MarketState>()(
  persist(
    (set) => ({
  symbol: "BTCUSDT",
  interval: "1h",
  watchlist: DEFAULT_WATCHLIST,
  validSymbols: DEFAULT_WATCHLIST,
  setSymbol: (symbol: string) => {
    const normalizedSymbol = normalizeSymbol(symbol);

    set((state) => {
      const isKnownSymbol =
        state.watchlist.includes(normalizedSymbol) || state.validSymbols.includes(normalizedSymbol);

      if (!VALID_SYMBOL.test(normalizedSymbol) || !isKnownSymbol) {
        return {};
      }

      return { symbol: normalizedSymbol };
    });
  },
  setInterval: (interval: string) => {
    if (isMarketInterval(interval)) {
      set({ interval });
    }
  },
  addSymbol: (symbol: string) => {
    const normalizedSymbol = normalizeSymbol(symbol);

    let added = false;

    set((state) => {
      const isKnownSymbol =
        state.watchlist.includes(normalizedSymbol) || state.validSymbols.includes(normalizedSymbol);

      if (!VALID_SYMBOL.test(normalizedSymbol) || !isKnownSymbol) {
        return {};
      }

      if (state.watchlist.includes(normalizedSymbol)) {
        return { symbol: normalizedSymbol };
      }

      added = true;

      return {
        symbol: normalizedSymbol,
        watchlist: [...state.watchlist, normalizedSymbol],
      };
    });

    return added;
  },
  removeSymbol: (symbol: string) => {
    const normalizedSymbol = normalizeSymbol(symbol);

    set((state) => {
      const nextWatchlist = state.watchlist.filter((item) => item !== normalizedSymbol);
      const nextSymbol =
        state.symbol === normalizedSymbol ? nextWatchlist[0] ?? "BTCUSDT" : state.symbol;

      return {
        symbol: nextSymbol,
        watchlist: nextWatchlist,
      };
    });
  },
  registerValidSymbols: (symbols: string[]) => {
    const normalizedSymbols = symbols.map(normalizeSymbol).filter((item) => VALID_SYMBOL.test(item));

    set((state) => ({
      validSymbols: Array.from(new Set([...state.validSymbols, ...normalizedSymbols])),
    }));
  },
    }),
    {
      name: "ai-trader-market",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        symbol: state.symbol,
        interval: state.interval,
        watchlist: state.watchlist,
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<Pick<MarketState, "symbol" | "interval" | "watchlist">>;
        const watchlist = Array.isArray(persisted.watchlist)
          ? Array.from(
              new Set(
                persisted.watchlist
                  .filter((item): item is string => typeof item === "string")
                  .map(normalizeSymbol)
                  .filter((item) => VALID_SYMBOL.test(item))
              )
            )
          : currentState.watchlist;

        return {
          ...currentState,
          ...persisted,
          symbol:
            typeof persisted.symbol === "string" && VALID_SYMBOL.test(normalizeSymbol(persisted.symbol))
              ? normalizeSymbol(persisted.symbol)
              : currentState.symbol,
          interval:
            typeof persisted.interval === "string" && isMarketInterval(persisted.interval)
              ? persisted.interval
              : currentState.interval,
          watchlist: watchlist.length > 0 ? watchlist : currentState.watchlist,
        };
      },
    }
  )
);
