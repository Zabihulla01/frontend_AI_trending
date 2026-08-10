"use client";

import { useEffect, useMemo, useRef } from "react";
import { getClosedBinanceKlines, type BinanceKlineResponse } from "@/services/binance";
import {
  ANALYSIS_TIMEFRAMES,
  type AnalysisCandle,
  type AnalysisSignal,
  type AnalysisTimeframe,
  type AnalysisTrend,
  type MarketCondition,
  type VolatilityState,
  type TimeframeAnalysis,
  analyzeTimeframe,
  calculateCompositeSignal,
} from "@/services/analysis";
import { createBinanceKlineSocket } from "@/services/websocket";
import { useAnalysisStore } from "@/store/useAnalysisStore";
import { useMarketStore } from "@/store/useMarketStore";
import { formatRiskInput, useRiskStore } from "@/store/useRiskStore";
import { useTradeStore, type TradeDirection } from "@/store/useTradeStore";

const HISTORY_LIMIT = 120;
const ANALYSIS_DEBOUNCE_MS = 1500;

function parseKline(kline: BinanceKlineResponse): AnalysisCandle | null {
  const candle = {
    time: Math.floor(kline[0] / 1000),
    open: Number(kline[1]),
    high: Number(kline[2]),
    low: Number(kline[3]),
    close: Number(kline[4]),
    volume: Number(kline[5]),
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

function getMarketBadgeClasses(market: MarketCondition) {
  if (market === "Bull") {
    return "border-emerald-400/40 bg-emerald-400/10 text-emerald-200";
  }

  if (market === "Bear") {
    return "border-red-400/40 bg-red-500/10 text-red-200";
  }

  return "border-slate-500/30 bg-slate-500/10 text-slate-200";
}

function getVolatilityBadgeClasses(volatility: VolatilityState) {
  if (volatility === "High") {
    return "border-violet-400/30 bg-violet-400/10 text-violet-200";
  }

  if (volatility === "Medium") {
    return "border-amber-300/30 bg-amber-300/10 text-amber-100";
  }

  return "border-slate-500/30 bg-slate-500/10 text-slate-200";
}

function getRiskBadgeClasses(risk: "Low" | "Medium" | "High") {
  if (risk === "High") {
    return "border-red-400/30 bg-red-500/10 text-red-200";
  }

  if (risk === "Medium") {
    return "border-amber-300/30 bg-amber-300/10 text-amber-100";
  }

  return "border-slate-500/30 bg-slate-500/10 text-slate-200";
}

function simplifySignal(signal: AnalysisSignal) {
  if (signal === "Wait") {
    return "WAIT";
  }

  if (signal === "Strong Buy" || signal === "Buy") {
    return "BUY";
  }

  if (signal === "Strong Sell" || signal === "Sell") {
    return "SELL";
  }

  return "WAIT";
}

function getSuggestedAction(signal: string, trend: string) {
  if (signal === "BUY") {
    return "LONG";
  }

  if (signal === "SELL") {
    return "SHORT";
  }

  if (trend === "Trending" || trend === "Volatile") {
    return "Watch breakout";
  }

  return "Wait";
}

function getSuggestedActionClasses(signal: string) {
  if (signal === "BUY") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  }

  if (signal === "SELL") {
    return "border-red-500/30 bg-red-500/10 text-red-200";
  }

  return "border-amber-300/30 bg-amber-300/10 text-amber-100";
}

export default function AIAnalysis({ headless = false }: { headless?: boolean } = {}) {
  const symbol = useMarketStore((state) => state.symbol);
  const interval = useMarketStore((state) => state.interval) as AnalysisTimeframe;
  const status = useAnalysisStore((state) => state.status);
  const analysisSymbol = useAnalysisStore((state) => state.symbol);
  const analysisInterval = useAnalysisStore((state) => state.interval);
  const errorMessage = useAnalysisStore((state) => state.errorMessage);
  const results = useAnalysisStore((state) => state.results);
  const setLoading = useAnalysisStore((state) => state.setLoading);
  const setResult = useAnalysisStore((state) => state.setResult);
  const setError = useAnalysisStore((state) => state.setError);
  const applyTradePlan = useRiskStore((state) => state.applyTradePlan);
  const resetRisk = useRiskStore((state) => state.reset);
  const activeTrade = useTradeStore((state) => state.activeTrade);
  const isAuto = useTradeStore((state) => state.isAuto);
  const isPaused = useTradeStore((state) => state.isPaused);
  const isLocked = useTradeStore((state) => state.isLocked);
  const cooldownUntil = useTradeStore((state) => state.cooldownUntil);
  const forceNonce = useTradeStore((state) => state.forceNonce);
  const openTrade = useTradeStore((state) => state.openTrade);
  const closeTrade = useTradeStore((state) => state.closeTrade);
  const resetTrade = useTradeStore((state) => state.resetTrade);
  const candleHistoryRef = useRef<Partial<Record<AnalysisTimeframe, AnalysisCandle[]>>>({});
  const debounceTimersRef = useRef<Partial<Record<AnalysisTimeframe, number>>>({});
  const handledForceNonceRef = useRef(forceNonce);
  const marketKey = `${symbol}:${interval}`;
  const readyForCurrentMarket =
    analysisSymbol === symbol && analysisInterval === interval && status === "ready";

  const orderedResults = useMemo(
    () =>
      readyForCurrentMarket
        ? Object.values(results).filter((result): result is TimeframeAnalysis => result !== undefined)
        : [],
    [readyForCurrentMarket, results]
  );
  const composite = useMemo(() => calculateCompositeSignal(orderedResults), [orderedResults]);
  const primaryAnalysis = readyForCurrentMarket ? results[interval] ?? null : null;
  const displaySignal = primaryAnalysis ? simplifySignal(primaryAnalysis.signal) : simplifySignal(composite.signal);
  const displayRisk = primaryAnalysis?.risk ?? "Low";
  const displayTrend = primaryAnalysis?.trend ?? "Neutral";
  const displayAction = primaryAnalysis?.action.toUpperCase() ?? getSuggestedAction(displaySignal, displayTrend);
  const displayEntry = primaryAnalysis?.entry ?? null;
  const displayStop = primaryAnalysis?.stop ?? null;
  const displayTakeProfit = primaryAnalysis?.takeProfit ?? null;
  const displayRiskReward = primaryAnalysis?.riskReward ?? null;
  const displayReasons =
    primaryAnalysis?.action === "Wait" ? [primaryAnalysis.suggestedAction] : primaryAnalysis?.reasons ?? [];
  const displaySetupChecks = primaryAnalysis?.setupChecks ?? null;
  const displayOpportunityScore = primaryAnalysis?.tradeOpportunityScore ?? composite.strength;
  const displayMarketCondition = primaryAnalysis?.marketCondition ?? "Sideways";
  const displayProbability = primaryAnalysis?.probability ?? composite.probability;
  const displayEntryQuality = primaryAnalysis?.entryQuality ?? 0;
  const displayTradeQuality = primaryAnalysis?.tradeQuality ?? displayOpportunityScore;
  const displaySuggestedAction = primaryAnalysis?.suggestedAction ?? `${displayAction}: waiting for analysis`;
  const isLoading = status === "loading";

  useEffect(() => {
    // A setup/trade is not portable across symbols or timeframes. Position
    // history remains stored by its own symbol/timeframe key.
    resetRisk();
    resetTrade();
  }, [marketKey, resetRisk, resetTrade]);
  const summaryMetrics = [
    { label: "Confidence", value: `${primaryAnalysis?.confidence ?? composite.confidence}%` },
    { label: "Trend", value: displayTrend, className: getTrendTextClass(displayTrend) },
    { label: "Risk", value: displayRisk, badgeClassName: getRiskBadgeClasses(displayRisk) },
    { label: "Strength", value: `${primaryAnalysis?.trendStrength ?? composite.strength}%` },
    { label: "Market", value: displayMarketCondition, badgeClassName: getMarketBadgeClasses(displayMarketCondition) },
    {
      label: "Volatility",
      value: primaryAnalysis?.volatilityState ?? null,
      badgeClassName: getVolatilityBadgeClasses(primaryAnalysis?.volatilityState ?? "Low"),
    },
    { label: "Probability", value: `${displayProbability}%` },
    { label: "Opportunity", value: `${displayOpportunityScore}%` },
  ].filter((metric) => metric.value !== null && metric.value !== undefined && metric.value !== "");
  const tradeMetrics = [
    displayEntry !== null ? { label: "Entry", value: formatNumber(displayEntry) } : null,
    displayTakeProfit !== null ? { label: "TP", value: formatNumber(displayTakeProfit) } : null,
    displayStop !== null ? { label: "Stop", value: formatNumber(displayStop) } : null,
    displayRiskReward !== null ? { label: "RR", value: `1:${formatNumber(displayRiskReward, 2)}` } : null,
    displayTradeQuality > 0 ? { label: "Trade quality", value: `${displayTradeQuality}%` } : null,
    displayEntryQuality > 0 ? { label: "Entry quality", value: `${displayEntryQuality}%` } : null,
  ].filter((metric): metric is { label: string; value: string } => metric !== null);
  const indicatorMetrics = [
    primaryAnalysis?.macdHistogram !== null && primaryAnalysis?.macdHistogram !== undefined
      ? { label: "MACD hist", value: formatNumber(primaryAnalysis.macdHistogram) }
      : null,
    primaryAnalysis?.atr !== null && primaryAnalysis?.atr !== undefined
      ? { label: "ATR", value: formatNumber(primaryAnalysis.atr) }
      : null,
    primaryAnalysis?.adx !== null && primaryAnalysis?.adx !== undefined
      ? { label: "ADX", value: formatNumber(primaryAnalysis.adx) }
      : null,
    primaryAnalysis?.reversalProbability !== null && primaryAnalysis?.reversalProbability !== undefined
      ? { label: "Reversal", value: `${primaryAnalysis.reversalProbability}%` }
      : null,
  ].filter((metric): metric is { label: string; value: string } => metric !== null);
  const passedSetupChecks = displaySetupChecks
    ? [
        ["EMA crossover", displaySetupChecks.emaCrossover],
        ["MACD confirm", displaySetupChecks.macdConfirm],
        ["RSI confirm", displaySetupChecks.rsiConfirm],
        ["Volume confirm", displaySetupChecks.volumeConfirm],
        ["Trend confirm", displaySetupChecks.trendConfirm],
        ["Structure", displaySetupChecks.marketStructureConfirm],
      ].filter(([, passed]) => passed)
    : [];

  useEffect(() => {
    if (!primaryAnalysis) {
      return;
    }

    if (isPaused) {
      return;
    }

    if (activeTrade) {
      applyTradePlan({
        action: activeTrade.direction === "LONG" ? "Long" : "Short",
        entryPrice: formatRiskInput(activeTrade.entry),
        stopLoss: formatRiskInput(activeTrade.stopLoss),
        takeProfit: formatRiskInput(activeTrade.takeProfit),
      });
      return;
    }

    applyTradePlan({
      action: primaryAnalysis.action,
      entryPrice: formatRiskInput(primaryAnalysis.entry),
      stopLoss: formatRiskInput(primaryAnalysis.stop),
      takeProfit: formatRiskInput(primaryAnalysis.takeProfit),
      atr: formatRiskInput(primaryAnalysis.atr),
      trend: primaryAnalysis.trend,
      marketCondition: primaryAnalysis.marketCondition,
      scoringSignal: primaryAnalysis.scoringSignal,
      confidence: primaryAnalysis.confidence,
      ema20: primaryAnalysis.ema20,
      ema50: primaryAnalysis.ema50,
      rsi: primaryAnalysis.rsi,
      macdHistogram: primaryAnalysis.macdHistogram,
      support: primaryAnalysis.support,
      resistance: primaryAnalysis.resistance,
      volatility: primaryAnalysis.volatility,
      volumeSpike: primaryAnalysis.volumeSpike,
      signal: primaryAnalysis.signal,
      trendStrength: primaryAnalysis.trendStrength,
      vwap: primaryAnalysis.vwap,
      lastClose: primaryAnalysis.lastClose,
    });
  }, [
    applyTradePlan,
    primaryAnalysis?.action,
    primaryAnalysis?.atr,
    primaryAnalysis?.entry,
    primaryAnalysis?.stop,
    primaryAnalysis?.takeProfit,
    primaryAnalysis,
    activeTrade,
    isPaused,
  ]);

  useEffect(() => {
    if (!isAuto || isPaused || !primaryAnalysis) {
      return;
    }

    const isForced = forceNonce !== handledForceNonceRef.current;

    if (Date.now() < cooldownUntil && !isForced) {
      return;
    }

    const direction: TradeDirection | null =
      primaryAnalysis.action === "Long" ? "LONG" : primaryAnalysis.action === "Short" ? "SHORT" : null;

    if (
      direction === null ||
      primaryAnalysis.action === "Wait" ||
      primaryAnalysis.confidence <= 80 ||
      primaryAnalysis.marketCondition === "Sideways" ||
      primaryAnalysis.entry === null ||
      primaryAnalysis.stop === null ||
      primaryAnalysis.takeProfit === null ||
      primaryAnalysis.riskReward === null ||
      !Object.values(primaryAnalysis.setupChecks).every(Boolean)
    ) {
      return;
    }

    if (activeTrade) {
      if (isLocked || activeTrade.direction === direction) {
        return;
      }

      closeTrade("CLOSED");
    }

    openTrade({
      entry: primaryAnalysis.entry,
      stopLoss: primaryAnalysis.stop,
      takeProfit: primaryAnalysis.takeProfit,
      direction,
      confidence: primaryAnalysis.confidence,
      rr: primaryAnalysis.riskReward,
      createdAt: Date.now(),
    });
    handledForceNonceRef.current = forceNonce;
  }, [activeTrade, closeTrade, cooldownUntil, forceNonce, isAuto, isLocked, isPaused, openTrade, primaryAnalysis]);

  useEffect(() => {
    const abortControllers: AbortController[] = [];
    const socketCleanups: Array<() => void> = [];
    let disposed = false;

    candleHistoryRef.current = {};
    setLoading(symbol, interval);

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
          const candles = getClosedBinanceKlines(rawData)
            .map(parseKline)
            .filter((candle): candle is AnalysisCandle => candle !== null);

          if (disposed || abortController.signal.aborted) {
            return;
          }

          candleHistoryRef.current[timeframe] = candles;
          const analysis = analyzeTimeframe(timeframe, candles);

          if (analysis && !isPaused) {
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
        onCandle: ({ candle, isClosed }) => {
          if (!isClosed) {
            const chartOnly = true;
            const doNotAnalyze = true;

            if (chartOnly && doNotAnalyze) {
              return;
            }
          }

          const parsedCandle = parseKline(candle);

          if (!parsedCandle || disposed) {
            return;
          }

          const nextCandles = upsertCandle(candleHistoryRef.current[timeframe] ?? [], parsedCandle);
          candleHistoryRef.current[timeframe] = nextCandles;

          if (isPaused) {
            return;
          }

          if (debounceTimersRef.current[timeframe]) {
            window.clearTimeout(debounceTimersRef.current[timeframe]);
          }

          debounceTimersRef.current[timeframe] = window.setTimeout(() => {
            const analysis = analyzeTimeframe(timeframe, candleHistoryRef.current[timeframe] ?? []);

            if (analysis && !disposed) {
              setResult(timeframe, analysis);
            }
          }, ANALYSIS_DEBOUNCE_MS);
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
      Object.values(debounceTimersRef.current).forEach((timer) => {
        if (timer) window.clearTimeout(timer);
      });
      debounceTimersRef.current = {};
    };
  }, [interval, isPaused, setError, setLoading, setResult, symbol]);

  if (headless) {
    return null;
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-950/95 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Technical Analysis</p>
          <h2 className="mt-1 text-sm font-semibold text-white">{symbol}</h2>
        </div>
        <div className={`rounded-lg border px-2 py-1 text-center ${getSignalClasses(composite.signal)}`}>
          <p className="text-[10px] uppercase tracking-[0.18em] opacity-75">Signal</p>
          <p className="text-xs font-semibold">{isLoading ? "..." : simplifySignal(composite.signal)}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-center text-xs text-slate-400">
          Scanning...
        </div>
      ) : errorMessage ? (
        <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-2 py-2 text-xs text-amber-100">
          {errorMessage}
        </p>
      ) : !isLoading && orderedResults.length === 0 ? (
        <p className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs text-slate-400">
          No analysis
        </p>
      ) : (
        <div className="space-y-3">
          <div className={`min-h-[60px] rounded-lg border p-3 text-center text-sm ${getSuggestedActionClasses(displaySignal)}`}>
            <p className="text-[10px] uppercase tracking-[0.18em] opacity-75">Action</p>
            <p className="mt-1 font-semibold">{displaySuggestedAction}</p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#020617] px-3 py-2 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="uppercase tracking-[0.16em] text-slate-500">New trade decision</span>
              <span className="font-semibold text-slate-200">{displaySuggestedAction}</span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-3">
              <span className="uppercase tracking-[0.16em] text-slate-500">Existing position</span>
              <span className={activeTrade ? "font-semibold text-amber-300" : "font-semibold text-slate-400"}>
                {activeTrade ? "Protection manager" : "None"}
              </span>
            </div>
          </div>

          <div className="grid gap-3 text-sm [grid-template-columns:repeat(auto-fit,minmax(min(180px,100%),1fr))]">
            {summaryMetrics.map((metric) => (
              <div key={metric.label} className="min-h-[60px] rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                <p className="text-xs text-slate-400">{metric.label}</p>
                {metric.badgeClassName ? (
                  <p className={`mt-1 inline-block rounded border px-1.5 py-0.5 font-semibold ${metric.badgeClassName}`}>
                    {metric.value}
                  </p>
                ) : (
                  <p className={`mt-1 font-semibold ${metric.className ?? "text-white"}`}>{metric.value}</p>
                )}
              </div>
            ))}
          </div>

          {tradeMetrics.length > 0 ? (
            <div className="grid gap-3 text-sm [grid-template-columns:repeat(auto-fit,minmax(min(180px,100%),1fr))]">
              {tradeMetrics.map((metric) => (
                <div key={metric.label} className="min-h-[60px] rounded-lg border border-slate-800 bg-[#020617] p-3">
                  <p className="text-xs text-slate-400">{metric.label}</p>
                  <p className="mt-1 font-semibold text-white">{metric.value}</p>
                </div>
              ))}
            </div>
          ) : null}

          {indicatorMetrics.length > 0 ? (
            <div className="grid gap-3 text-sm [grid-template-columns:repeat(auto-fit,minmax(min(180px,100%),1fr))]">
              {indicatorMetrics.map((metric) => (
                <div key={metric.label} className="min-h-[60px] rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                  <p className="text-xs text-slate-400">{metric.label}</p>
                  <p className="mt-1 font-semibold text-white">{metric.value}</p>
                </div>
              ))}
            </div>
          ) : null}

          {displayReasons.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-2 py-2">
              <p className="text-xs text-slate-400">
                {primaryAnalysis?.action === "Wait" ? "Why" : "Why trade generated"}
              </p>
              <ul className="mt-1 space-y-1 text-xs text-slate-300">
                {displayReasons.slice(0, 5).map((reason, index) => (
                  <li key={index} className="flex items-start gap-1">
                    <span className="text-emerald-300">-</span>
                    <span className="line-clamp-1">{reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {passedSetupChecks.length > 0 ? (
            <div className="rounded-lg border border-slate-800 bg-[#020617] px-2 py-2 text-xs">
              <p className="text-slate-400">Trade gate</p>
              <div className="mt-2 grid grid-cols-2 gap-1">
                {passedSetupChecks.map(([label]) => (
                  <span key={label as string} className="text-emerald-300">
                    OK {label}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-2 py-2 text-xs">
            <p className="text-slate-400">Final</p>
            <p className="mt-1 font-semibold text-white">ACTION: {displayAction}</p>
            <p className="font-semibold text-white">CONFIDENCE: {primaryAnalysis?.confidence ?? composite.confidence}%</p>
          </div>
        </div>
      )}
    </section>
  );
}
