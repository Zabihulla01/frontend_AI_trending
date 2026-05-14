import { create } from "zustand";

const DEFAULT_WATCHLIST = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"];
const VALID_SYMBOL = /^[A-Z0-9]{3,20}$/;

interface MarketState {
  symbol: string;
  interval: string;
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

export const useMarketStore = create<MarketState>((set) => ({
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
  setInterval: (interval: string) => set({ interval }),
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
}));
