import { create } from "zustand";

/**
 * useMarketPriceStore
 *
 * Single source of truth for the truly live market price received from the
 * Binance WebSocket stream. Keyed by `${symbol}:${interval}`.
 *
 * Intentionally NOT persisted — a price from a previous session is stale by
 * definition and must not influence proximity or phase detection.
 *
 * Consumers:
 *   - TradingChart.tsx  → writes via setPrice / setLiveStatus
 *   - useSetupPhase.ts  → reads for pre-lock entry-zone proximity
 *
 * This store has NO knowledge of trade setup geometry, indicators, or
 * positions. It is purely a price relay.
 */

/** How long without a price update before the entry is considered stale. */
export const MARKET_PRICE_STALE_MS = 15_000;

export interface MarketPriceEntry {
  /** Last live close price received from the WebSocket. */
  price: number;
  /** Date.now() at the time of the last setPrice call. */
  updatedAt: number;
  /** true while the WebSocket stream is connected; false on error/cleanup. */
  isLive: boolean;
}

interface MarketPriceState {
  prices: Record<string, MarketPriceEntry>;
  setPrice: (symbol: string, interval: string, price: number) => void;
  setLiveStatus: (symbol: string, interval: string, isLive: boolean) => void;
  getPrice: (symbol: string, interval: string) => MarketPriceEntry | null;
}

export const useMarketPriceStore = create<MarketPriceState>((set, get) => ({
  prices: {},

  setPrice: (symbol, interval, price) => {
    if (!Number.isFinite(price) || price <= 0) return;

    const key = `${symbol}:${interval}`;

    set((state) => ({
      prices: {
        ...state.prices,
        [key]: { price, updatedAt: Date.now(), isLive: true },
      },
    }));
  },

  setLiveStatus: (symbol, interval, isLive) => {
    const key = `${symbol}:${interval}`;

    set((state) => {
      const existing = state.prices[key];

      // No entry yet — nothing to mark as offline.
      if (!existing) return state;
      // Already in the desired state — avoid a needless re-render.
      if (existing.isLive === isLive) return state;

      return {
        prices: {
          ...state.prices,
          [key]: { ...existing, isLive },
        },
      };
    });
  },

  getPrice: (symbol, interval) => {
    return get().prices[`${symbol}:${interval}`] ?? null;
  },
}));
