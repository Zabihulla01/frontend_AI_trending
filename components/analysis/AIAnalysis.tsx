"use client";

import { useEffect, useMemo, useRef } from "react";
import type { BinanceKlineResponse } from "@/services/binance";
import {
  ANALYSIS_TIMEFRAMES,
  type AnalysisCandle,
  type AnalysisSignal,
  type AnalysisTimeframe,
  type AnalysisTrend,
  type TimeframeAnalysis,
  analyzeTimeframe,
  calculateCompositeSignal,
} from "@/services/analysis";
import { createBinanceKlineSocket } from "@/services/websocket";
import { useAnalysisStore } from "@/store/useAnalysisStore";
import { useMarketStore } from "@/store/useMarketStore";

const HISTORY_LIMIT = 120;

function parseKline(kline: BinanceKlineResponse): AnalysisCandle | null {
  const candle = {
    time: Math.floor(kline[0] / 1000),
    open: Number(kline[1]),
    high: Number(kline[2]),
    low: Number(kline[3]),
    close: Number(kline[4]),
  };

  const isValid =
    Number.isFinite(candle.time) &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close);

  return isValid ? candle : null;
}

function upsertCandle(candles: AnalysisCandle[], candle: AnalysisCandle) {
  const existingIndex = candles.findIndex((item) => item.time === candle.time);

  if (existingIndex >= 0) {
    const nextCandles = [...candles];
    nextCandles[existingIndex] = candle;
    return nextCandles.slice(-HISTORY_LIMIT);
  }

  return [...candles, candle].sort((a, b) => a.time - b.time).slice(-HISTORY_LIMIT);
}

function formatNumber(value: number | null | undefined, maximumFractionDigits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "--";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(value);
}

function getSignalClasses(signal: AnalysisSignal) {
  if (signal === "Strong Buy" || signal === "Buy") {
    return "border-emerald-400/40 bg-emerald-400/10 text-emerald-200";
  }

  if (signal === "Strong Sell" || signal === "Sell") {
    return "border-red-400/40 bg-red-500/10 text-red-200";
  }

  return "border-amber-300/40 bg-amber-300/10 text-amber-100";
}

function getTrendTextClass(trend: AnalysisTrend) {
  if (trend === "Bullish") {
    return "text-emerald-300";
  }

  if (trend === "Bearish") {
    return "text-red-300";
  }

  return "text-amber-200";
}

export default function AIAnalysis() {
  const symbol = useMarketStore((state) => state.symbol);
  const status = useAnalysisStore((state) => state.status);
  const errorMessage = useAnalysisStore((state) => state.errorMessage);
  const results = useAnalysisStore((state) => state.results);
  const setLoading = useAnalysisStore((state) => state.setLoading);
  const setResult = useAnalysisStore((state) => state.setResult);
  const setError = useAnalysisStore((state) => state.setError);
  const candleHistoryRef = useRef<Partial<Record<AnalysisTimeframe, AnalysisCandle[]>>>({});

  const orderedResults = useMemo(
    () =>
      ANALYSIS_TIMEFRAMES.map((timeframe) => results[timeframe]).filter(
        (result): result is TimeframeAnalysis => result !== undefined
      ),
    [results]
  );
  const composite = useMemo(() => calculateCompositeSignal(orderedResults), [orderedResults]);
  const isLoading = status === "loading";

  useEffect(() => {
    const abortControllers: AbortController[] = [];
    const socketCleanups: Array<() => void> = [];
    let disposed = false;

    candleHistoryRef.current = {};
    setLoading(symbol);

    ANALYSIS_TIMEFRAMES.forEach((timeframe) => {
      const abortController = new AbortController();
      abortControllers.push(abortController);

      async function loadTimeframe() {
        try {
          const response = await fetch(
            `/api/klines?symbol=${encodeURIComponent(symbol)}&interval=${timeframe}&limit=${HISTORY_LIMIT}`,
            { signal: abortController.signal }
          );

          if (!response.ok) {
            throw new Error(`${timeframe} analysis failed with status ${response.status}`);
          }

          const rawData = (await response.json()) as BinanceKlineResponse[];
          const candles = rawData
            .map(parseKline)
            .filter((candle): candle is AnalysisCandle => candle !== null);

          if (disposed || abortController.signal.aborted) {
            return;
          }

          candleHistoryRef.current[timeframe] = candles;
          const analysis = analyzeTimeframe(timeframe, candles);

          if (analysis) {
            setResult(timeframe, analysis);
          }
        } catch (error) {
          if (!disposed && !abortController.signal.aborted) {
            setError(error instanceof Error ? error.message : "Unable to load multi-timeframe analysis");
          }
        }
      }

      loadTimeframe();

      const cleanup = createBinanceKlineSocket({
        symbol,
        interval: timeframe,
        onCandle: ({ candle }) => {
          const parsedCandle = parseKline(candle);

          if (!parsedCandle || disposed) {
            return;
          }

          const nextCandles = upsertCandle(candleHistoryRef.current[timeframe] ?? [], parsedCandle);
          candleHistoryRef.current[timeframe] = nextCandles;

          const analysis = analyzeTimeframe(timeframe, nextCandles);

          if (analysis) {
            setResult(timeframe, analysis);
          }
        },
        onError: () => {
          if (!disposed) {
            setError("Live analysis stream interrupted.");
          }
        },
      });

      socketCleanups.push(cleanup);
    });

    return () => {
      disposed = true;
      abortControllers.forEach((controller) => controller.abort());
      socketCleanups.forEach((cleanup) => cleanup());
    };
  }, [setError, setLoading, setResult, symbol]);

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-950/95 p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">AI analysis</p>
          <h2 className="mt-1 text-xl font-semibold text-white">{symbol}</h2>
          <p className="mt-1 text-sm text-slate-400">Live multi-timeframe model</p>
        </div>
        <div className={`rounded-lg border px-3 py-2 text-right ${getSignalClasses(composite.signal)}`}>
          <p className="text-[11px] uppercase tracking-[0.18em] opacity-75">Signal</p>
          <p className="text-sm font-semibold">{isLoading ? "Scanning" : composite.signal}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="mb-4 grid gap-3">
          {ANALYSIS_TIMEFRAMES.map((timeframe) => (
            <div key={timeframe} className="h-24 animate-pulse rounded-lg bg-slate-900" />
          ))}
        </div>
      ) : null}

      {errorMessage ? (
        <p className="mb-4 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-3 text-sm text-amber-100">
          {errorMessage}
        </p>
      ) : null}

      <div className="mb-4 grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-slate-800 bg-[#020617] px-3 py-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Strength</p>
          <p className="mt-1 text-lg font-semibold text-white">{composite.strength}%</p>
        </div>
        <div className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-3 text-cyan-100">
          <p className="text-[11px] uppercase tracking-[0.16em] opacity-75">Confidence</p>
          <p className="mt-1 text-lg font-semibold">{composite.confidence}%</p>
        </div>
        <div className="rounded-lg border border-violet-400/30 bg-violet-400/10 px-3 py-3 text-violet-100">
          <p className="text-[11px] uppercase tracking-[0.16em] opacity-75">Probability</p>
          <p className="mt-1 text-lg font-semibold">{composite.probability}%</p>
        </div>
      </div>

      <div className="grid gap-3">
        {ANALYSIS_TIMEFRAMES.map((timeframe) => {
          const analysis = results[timeframe];

          return (
            <div
              key={timeframe}
              className={`rounded-lg border p-3 ${
                analysis ? getSignalClasses(analysis.signal) : "border-slate-800 bg-slate-900/70 text-slate-300"
              }`}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold text-white">{timeframe}</p>
                  <p className={`mt-0.5 text-sm ${analysis ? getTrendTextClass(analysis.trend) : "text-slate-400"}`}>
                    {analysis?.trend ?? "Loading"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{analysis?.signal ?? "Scanning"}</p>
                  <p className="mt-0.5 text-xs opacity-75">{analysis ? `${analysis.probability}% score` : "--"}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-2">
                <div className="rounded-md bg-slate-950/45 px-2 py-2">
                  <p className="text-slate-400">Strength</p>
                  <p className="mt-1 font-semibold text-white">{analysis ? `${analysis.strength}%` : "--"}</p>
                </div>
                <div className="rounded-md bg-slate-950/45 px-2 py-2">
                  <p className="text-slate-400">Confidence</p>
                  <p className="mt-1 font-semibold text-white">{analysis ? `${analysis.confidence}%` : "--"}</p>
                </div>
                <div className="rounded-md bg-slate-950/45 px-2 py-2">
                  <p className="text-slate-400">Momentum</p>
                  <p className={`mt-1 font-semibold ${analysis && analysis.momentum >= 0 ? "text-emerald-200" : "text-red-200"}`}>
                    {analysis ? `${analysis.momentum >= 0 ? "+" : ""}${formatNumber(analysis.momentum)}%` : "--"}
                  </p>
                </div>
                <div className="rounded-md bg-slate-950/45 px-2 py-2">
                  <p className="text-slate-400">Volatility</p>
                  <p className="mt-1 font-semibold text-white">{analysis ? `${formatNumber(analysis.volatility)}%` : "--"}</p>
                </div>
                <div className="rounded-md bg-slate-950/45 px-2 py-2">
                  <p className="text-slate-400">RSI 14</p>
                  <p className="mt-1 font-semibold text-white">{formatNumber(analysis?.rsi)}</p>
                </div>
                <div className="rounded-md bg-slate-950/45 px-2 py-2">
                  <p className="text-slate-400">Last</p>
                  <p className="mt-1 font-semibold text-white">{formatNumber(analysis?.lastClose, 4)}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
