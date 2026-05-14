import { create } from "zustand";
import type { AnalysisTimeframe, TimeframeAnalysis } from "@/services/analysis";

type AnalysisStatus = "idle" | "loading" | "ready" | "error";

interface AnalysisState {
  symbol: string;
  status: AnalysisStatus;
  errorMessage: string | null;
  results: Partial<Record<AnalysisTimeframe, TimeframeAnalysis>>;
  setLoading: (symbol: string) => void;
  setResult: (timeframe: AnalysisTimeframe, result: TimeframeAnalysis) => void;
  setError: (message: string) => void;
  reset: (symbol: string) => void;
}

export const useAnalysisStore = create<AnalysisState>((set) => ({
  symbol: "BTCUSDT",
  status: "idle",
  errorMessage: null,
  results: {},
  setLoading: (symbol) =>
    set({
      symbol,
      status: "loading",
      errorMessage: null,
      results: {},
    }),
  setResult: (timeframe, result) =>
    set((state) => ({
      status: "ready",
      errorMessage: null,
      results: {
        ...state.results,
        [timeframe]: result,
      },
    })),
  setError: (message) =>
    set({
      status: "error",
      errorMessage: message,
    }),
  reset: (symbol) =>
    set({
      symbol,
      status: "idle",
      errorMessage: null,
      results: {},
    }),
}));
