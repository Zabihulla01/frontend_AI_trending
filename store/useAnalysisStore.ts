import { create } from "zustand";
import type {
  AnalysisTimeframe,
  TimeframeAnalysis,
  MarketCondition,
  MarketTrendState,
  VolatilityState,
} from "@/services/analysis";

type AnalysisStatus = "idle" | "loading" | "ready" | "error";

interface AnalysisState {
  symbol: string;
  interval: AnalysisTimeframe;
  status: AnalysisStatus;
  errorMessage: string | null;
  results: Partial<Record<AnalysisTimeframe, TimeframeAnalysis>>;
  marketState: {
    trend: MarketTrendState;
    market: MarketCondition;
    volatility: VolatilityState;
  } | null;
  setLoading: (symbol: string, interval: AnalysisTimeframe) => void;
  setResult: (timeframe: AnalysisTimeframe, result: TimeframeAnalysis) => void;
  setError: (message: string) => void;
  reset: (symbol: string, interval: AnalysisTimeframe) => void;
}

export const useAnalysisStore = create<AnalysisState>((set) => ({
  symbol: "BTCUSDT",
  interval: "1h",
  status: "idle",
  errorMessage: null,
  results: {},
  marketState: null,
  setLoading: (symbol, interval) =>
    set({
      symbol,
      interval,
      status: "loading",
      errorMessage: null,
      results: {},
      marketState: null,
    }),
  setResult: (timeframe, result) =>
    set((state) => ({
      status: "ready",
      errorMessage: null,
      results: {
        ...state.results,
        [timeframe]: result,
      },
      marketState: {
        trend: result.marketTrend,
        market: result.marketCondition,
        volatility: result.volatilityState,
      },
    })),
  setError: (message) =>
    set({
      status: "error",
      errorMessage: message,
    }),
  reset: (symbol, interval) =>
    set({
      symbol,
      interval,
      status: "idle",
      errorMessage: null,
      results: {},
      marketState: null,
    }),
}));
