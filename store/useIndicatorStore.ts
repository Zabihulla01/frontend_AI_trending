import { create } from "zustand";
import type { IndicatorSnapshot } from "@/services/indicators";

export type IndicatorKey =
  | "rsi"
  | "ema"
  | "macd"
  | "volume"
  | "atr"
  | "adx"
  | "vwap"
  | "supportResistance"
  | "momentum";

const DEFAULT_ENABLED: Record<IndicatorKey, boolean> = {
  rsi: true,
  ema: true,
  macd: true,
  volume: true,
  atr: true,
  adx: true,
  vwap: true,
  supportResistance: true,
  momentum: true,
};

interface IndicatorState {
  symbol: string;
  interval: string;
  enabled: Record<IndicatorKey, boolean>;
  snapshot: IndicatorSnapshot | null;
  setSnapshot: (symbol: string, interval: string, snapshot: IndicatorSnapshot) => void;
  toggleIndicator: (indicator: IndicatorKey) => void;
  reset: () => void;
}

export const useIndicatorStore = create<IndicatorState>((set) => ({
  symbol: "BTCUSDT",
  interval: "1h",
  enabled: DEFAULT_ENABLED,
  snapshot: null,
  setSnapshot: (symbol, interval, snapshot) =>
    set({
      symbol,
      interval,
      snapshot,
    }),
  toggleIndicator: (indicator) =>
    set((state) => ({
      enabled: {
        ...state.enabled,
        [indicator]: !state.enabled[indicator],
      },
    })),
  reset: () =>
    set({
      enabled: DEFAULT_ENABLED,
      snapshot: null,
    }),
}));
