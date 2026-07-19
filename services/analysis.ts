import {
  calculateAdx,
  calculateAtr,
  calculateMacd,
  calculateRsi,
  calculateSma,
  detectSupportResistance,
  getLatestMacd,
  getLatestValue,
} from "@/services/indicators";
import { scoreMarket } from "@/services/scoring";
import type { RiskLevel, ScoringCandle, Signal as ScoringSignal } from "@/services/scoring";

export type AnalysisTimeframe = "1m" | "5m" | "15m" | "1h";
export type AnalysisTrend = "Bullish" | "Bearish" | "Neutral";
export type AnalysisSignal = "Strong Buy" | "Buy" | "Neutral" | "Sell" | "Strong Sell" | "Wait";
export type MarketTrendState = "Trending" | "Sideways" | "Volatile";
export type MarketCondition = "Bull" | "Bear" | "Sideways";
export type VolatilityState = "Low" | "Medium" | "High";
export type AnalysisRisk = RiskLevel;

export interface AnalysisCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TimeframeAnalysis {
  timeframe: AnalysisTimeframe;
  trend: AnalysisTrend;
  marketTrend: MarketTrendState;
  marketCondition: MarketCondition;
  volatilityState: VolatilityState;
  signal: AnalysisSignal;
  scoringSignal: ScoringSignal;
  strength: number;
  confidence: number;
  risk: AnalysisRisk;
  probability: number;
  trendStrength: number;
  reversalProbability: number;
  marketHealth: number;
  entryQuality: number;
  tradeOpportunityScore: number;
  tradeQuality: number;
  entry: number | null;
  stop: number | null;
  takeProfit: number | null;
  riskReward: number | null;
  action: "Long" | "Short" | "Wait";
  suggestedAction: string;
  setupChecks: {
    emaCrossover: boolean;
    macdConfirm: boolean;
    rsiConfirm: boolean;
    volumeConfirm: boolean;
    trendConfirm: boolean;
    marketStructureConfirm: boolean;
  };
  momentum: number;
  volatility: number;
  reasons: string[];
  rsi: number | null;
  sma20: number | null;
  sma50: number | null;
  ema20: number | null;
  ema50: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  atr: number | null;
  adx: number | null;
  vwap: number | null;
  support: number | null;
  resistance: number | null;
  averageVolume: number;
  currentVolume: number;
  volumeSpike: number;
  lastClose: number;
  updatedAt: number;
}

export const ANALYSIS_TIMEFRAMES: AnalysisTimeframe[] = ["1m", "5m", "15m", "1h"];

const MIN_CANDLES = 50;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getLatestClose(candles: AnalysisCandle[]) {
  return candles.length > 0 ? candles[candles.length - 1].close : null;
}

function calculateMomentum(candles: AnalysisCandle[], lookback = 10) {
  if (candles.length <= lookback) {
    return 0;
  }

  const lastClose = candles[candles.length - 1].close;
  const previousClose = candles[candles.length - 1 - lookback].close;

  if (!previousClose) {
    return 0;
  }

  return ((lastClose - previousClose) / previousClose) * 100;
}

function calculateVolatility(candles: AnalysisCandle[], lookback = 14) {
  const recentCandles = candles.slice(-lookback);

  if (recentCandles.length === 0) {
    return 0;
  }

  const totalRange = recentCandles.reduce((sum, candle) => {
    if (!candle.close) {
      return sum;
    }

    return sum + ((candle.high - candle.low) / candle.close) * 100;
  }, 0);

  return totalRange / recentCandles.length;
}

function calculateEma(candles: { time: number; close: number }[], period: number) {
  if (period <= 0 || candles.length < period) {
    return [];
  }

  const multiplier = 2 / (period + 1);
  let ema = candles.slice(0, period).reduce((sum, candle) => sum + candle.close, 0) / period;
  const points = [{ time: candles[period - 1].time, value: ema }];

  for (let index = period; index < candles.length; index += 1) {
    ema = (candles[index].close - ema) * multiplier + ema;
    points.push({ time: candles[index].time, value: ema });
  }

  return points;
}

function calculateAverageVolume(candles: AnalysisCandle[], lookback = 20) {
  const recentCandles = candles.slice(-lookback);

  if (recentCandles.length === 0) {
    return 0;
  }

  return recentCandles.reduce((sum, candle) => sum + candle.volume, 0) / recentCandles.length;
}

function calculateVolatilityState(volatility: number): VolatilityState {
  if (volatility > 4.2) {
    return "High";
  }

  if (volatility > 2) {
    return "Medium";
  }

  return "Low";
}

function calculateMarketTrend(input: {
  momentum: number;
  volatility: number;
  volumeSpike: number;
  ema20: number | null;
  ema50: number | null;
}): MarketTrendState {
  const { momentum, volatility, volumeSpike, ema20, ema50 } = input;

  if (volatility > 4.2 || volumeSpike > 1.7) {
    return "Volatile";
  }

  if (Math.abs(momentum) > 1.2 || (ema20 !== null && ema50 !== null && Math.abs((ema20 - ema50) / ema50) * 100 > 0.7)) {
    return "Trending";
  }

  return "Sideways";
}

function calculateMarketCondition(input: {
  lastClose: number;
  ema20: number | null;
  ema50: number | null;
  momentum: number;
  rsi: number | null;
}): MarketCondition {
  const { lastClose, ema20, ema50, momentum, rsi } = input;

  const bullishStructure = ema20 !== null && ema50 !== null && lastClose > ema20 && ema20 > ema50;
  const bearishStructure = ema20 !== null && ema50 !== null && lastClose < ema20 && ema20 < ema50;

  if (bullishStructure && momentum > 0 && (rsi === null || rsi < 80)) {
    return "Bull";
  }

  if (bearishStructure && momentum < 0 && (rsi === null || rsi > 20)) {
    return "Bear";
  }

  return "Sideways";
}

export function calculateTrend(input: {
  lastClose: number;
  sma20: number | null;
  sma50: number | null;
  momentum: number;
  rsi: number | null;
}): AnalysisTrend {
  const { lastClose, sma20, sma50, momentum, rsi } = input;
  let score = 0;

  if (sma20 !== null && lastClose > sma20) {
    score += 1;
  }

  if (sma20 !== null && lastClose < sma20) {
    score -= 1;
  }

  if (sma20 !== null && sma50 !== null && sma20 > sma50) {
    score += 2;
  }

  if (sma20 !== null && sma50 !== null && sma20 < sma50) {
    score -= 2;
  }

  if (momentum > 0.15) {
    score += 1;
  }

  if (momentum < -0.15) {
    score -= 1;
  }

  if (rsi !== null && rsi > 55 && rsi < 78) {
    score += 1;
  }

  if (rsi !== null && rsi < 45 && rsi > 22) {
    score -= 1;
  }

  if (score >= 2) {
    return "Bullish";
  }

  if (score <= -2) {
    return "Bearish";
  }

  return "Neutral";
}

export function calculateSignal(input: {
  trend: AnalysisTrend;
  strength: number;
  momentum: number;
  rsi: number | null;
  volatility: number;
}): AnalysisSignal {
  const { trend, strength, momentum, rsi, volatility } = input;
  const isOverheated = rsi !== null && rsi > 78;
  const isWashedOut = rsi !== null && rsi < 22;
  const highVolatilityPenalty = volatility > 5 ? 8 : 0;
  const adjustedStrength = strength - highVolatilityPenalty;

  if (trend === "Bullish" && adjustedStrength >= 76 && momentum > 0 && !isOverheated) {
    return "Strong Buy";
  }

  if (trend === "Bullish" && adjustedStrength >= 55 && !isOverheated) {
    return "Buy";
  }

  if (trend === "Bearish" && adjustedStrength >= 76 && momentum < 0 && !isWashedOut) {
    return "Strong Sell";
  }

  if (trend === "Bearish" && adjustedStrength >= 55 && !isWashedOut) {
    return "Sell";
  }

  return "Neutral";
}

export function calculateProbability(input: {
  strength: number;
  confidence: number;
  momentum: number;
  volatility: number;
  rsi: number | null;
}) {
  const { strength, confidence, momentum, volatility, rsi } = input;
  const momentumBoost = Math.min(Math.abs(momentum) * 3, 12);
  const volatilityPenalty = Math.min(volatility * 2.2, 18);
  const extremeRsiPenalty = rsi !== null && (rsi > 78 || rsi < 22) ? 8 : 0;

  return clamp(
    Math.round(42 + strength * 0.28 + confidence * 0.24 + momentumBoost - volatilityPenalty - extremeRsiPenalty),
    5,
    95
  );
}

function calculateRuleConfidence(input: {
  lastClose: number;
  ema20: number | null;
  ema50: number | null;
  macdHistogram: number | null;
  rsi: number | null;
  volumeSpike: number;
  atr: number | null;
  support: number | null;
  resistance: number | null;
}) {
  const { lastClose, ema20, ema50, macdHistogram, rsi, volumeSpike, atr, support, resistance } = input;
  let confidence = 0;

  if (ema20 !== null && ema50 !== null) {
    const emaSpread = Math.abs((ema20 - ema50) / ema50) * 100;
    confidence += ema20 > ema50 ? 18 : 14;
    confidence += Math.min(emaSpread * 12, 12);
  }

  if (macdHistogram !== null) {
    confidence += Math.min(Math.abs(macdHistogram / lastClose) * 10000, 16);
  }

  if (rsi !== null) {
    confidence += rsi >= 40 && rsi <= 62 ? 14 : rsi > 30 && rsi < 70 ? 9 : 3;
  }

  confidence += volumeSpike >= 1.15 ? Math.min(volumeSpike * 8, 14) : Math.max(0, volumeSpike * 6);

  if (atr !== null && atr > 0) {
    const atrPercent = (atr / lastClose) * 100;
    confidence += atrPercent >= 0.35 && atrPercent <= 3.5 ? 12 : 5;
  }

  if (support !== null || resistance !== null) {
    const supportDistance = support !== null ? Math.abs((lastClose - support) / lastClose) * 100 : 100;
    const resistanceDistance = resistance !== null ? Math.abs((resistance - lastClose) / lastClose) * 100 : 100;
    confidence += Math.min(supportDistance, resistanceDistance) <= 3 ? 14 : 8;
  }

  return clamp(Math.round(confidence), 0, 100);
}

function createWaitAnalysis(input: {
  scoring: ReturnType<typeof scoreMarket> extends infer Result ? NonNullable<Result> : never;
  confidence: number;
  reason?: string;
}) {
  const { scoring, confidence, reason = "Low conviction market" } = input;
  const waitConfidence = Math.min(confidence, 69);

  return {
    signal: "Wait" as AnalysisSignal,
    scoringSignal: "Neutral" as ScoringSignal,
    confidence: waitConfidence,
    entry: null,
    stop: null,
    takeProfit: null,
    riskReward: null,
    action: "Wait" as const,
    suggestedAction: `WAIT: ${reason}`,
    tradeQuality: 0,
    setupChecks: {
      ...scoring.setupChecks,
      emaCrossover: false,
      trendConfirm: false,
      marketStructureConfirm: false,
    },
  };
}

function describeEmaStructure(ema20: number | null, ema50: number | null) {
  if (ema20 === null || ema50 === null) {
    return "EMA structure incomplete.";
  }

  if (ema20 > ema50) {
    return "EMA structure is bullish, but trade filters are not aligned yet.";
  }

  if (ema20 < ema50) {
    return "EMA structure is bearish, but trade filters are not aligned yet.";
  }

  return "EMA structure is flat.";
}

function describeMacd(macdHistogram: number | null) {
  if (macdHistogram === null) {
    return "MACD confirmation unavailable.";
  }

  if (macdHistogram > 0) {
    return "MACD momentum is positive, but conviction is still too low.";
  }

  if (macdHistogram < 0) {
    return "MACD momentum is negative, but conviction is still too low.";
  }

  return "MACD momentum is neutral.";
}

export function analyzeTimeframe(
  timeframe: AnalysisTimeframe,
  candles: AnalysisCandle[]
): TimeframeAnalysis | null {
  if (candles.length < MIN_CANDLES) {
    return null;
  }

  const indicatorCandles = candles.map((candle) => ({
    time: candle.time,
    close: candle.close,
  }));
  const sma20 = getLatestValue(calculateSma(indicatorCandles, 20));
  const sma50 = getLatestValue(calculateSma(indicatorCandles, 50));
  const ema20 = getLatestValue(calculateEma(indicatorCandles, 20));
  const ema50 = getLatestValue(calculateEma(indicatorCandles, 50));
  const rsi = getLatestValue(calculateRsi(indicatorCandles, 14));
  const macd = getLatestMacd(calculateMacd(indicatorCandles));
  const atr = getLatestValue(calculateAtr(candles, 14));
  const adx = getLatestValue(calculateAdx(candles, 14));
  const levels = detectSupportResistance(candles);
  const lastClose = getLatestClose(candles);

  if (lastClose === null || sma20 === null || sma50 === null) {
    return null;
  }

  const momentum = calculateMomentum(candles);
  const volatility = calculateVolatility(candles);
  const averageVolume = calculateAverageVolume(candles, 20);
  const currentVolume = candles[candles.length - 1].volume;
  const volumeSpike = averageVolume > 0 ? currentVolume / averageVolume : 1;
  const trend = calculateTrend({ lastClose, sma20, sma50, momentum, rsi });
  const marketTrend = calculateMarketTrend({ momentum, volatility, volumeSpike, ema20, ema50 });
  const marketCondition = calculateMarketCondition({ lastClose, ema20, ema50, momentum, rsi });
  const volatilityState = calculateVolatilityState(volatility);
  const smaSpread = Math.abs(((sma20 - sma50) / sma50) * 100);
  const priceDistance = Math.abs(((lastClose - sma20) / sma20) * 100);
  const rsiConviction = rsi === null ? 0 : Math.min(Math.abs(rsi - 50) * 1.4, 22);
  const strength = clamp(
    Math.round(38 + Math.min(smaSpread * 7, 24) + Math.min(priceDistance * 5, 18) + Math.min(Math.abs(momentum) * 4, 18) + rsiConviction),
    0,
    100
  );
  const scoring = scoreMarket(candles as ScoringCandle[]) ?? {
    signal: "Neutral" as ScoringSignal,
    confidence: 0,
    risk: "Low" as AnalysisRisk,
    strength: 0,
    reasons: [],
    rsi: null,
    ema12: null,
    ema20: null,
    ema26: null,
    ema50: null,
    macd: null,
    macdSignal: null,
    macdHistogram: null,
    momentum: 0,
    averageVolume: 0,
    currentVolume: 0,
    volumeSpike: 0,
    support: null,
    resistance: null,
    atr: null,
    adx: null,
    vwap: null,
    volume: 0,
    trendStrength: 0,
    reversalProbability: 0,
    marketHealth: 0,
    entryQuality: 0,
    tradeOpportunityScore: 0,
    tradeQuality: 0,
    entry: null,
    stop: null,
    takeProfit: null,
    riskReward: null,
    action: "Wait" as const,
    suggestedAction: "WAIT: no clear edge",
    setupChecks: {
      emaCrossover: false,
      macdConfirm: false,
      rsiConfirm: false,
      volumeConfirm: false,
      trendConfirm: false,
      marketStructureConfirm: false,
    },
  };
  const ruleConfidence = calculateRuleConfidence({
    lastClose,
    ema20,
    ema50,
    macdHistogram: macd?.histogram ?? null,
    rsi,
    volumeSpike,
    atr,
    support: levels.support,
    resistance: levels.resistance,
  });
  const blendedConfidence = clamp(Math.round(ruleConfidence * 0.7 + scoring.confidence * 0.3), 0, 100);
  const probability = calculateProbability({ strength, confidence: blendedConfidence, momentum, volatility, rsi });
  const emaAllowsLong = ema20 !== null && ema50 !== null && ema20 > ema50;
  const emaAllowsShort = ema20 !== null && ema50 !== null && ema20 < ema50;
  const hasCompleteTradePlan = scoring.entry !== null && scoring.stop !== null && scoring.takeProfit !== null && scoring.riskReward !== null;
  const requestedAction = scoring.action;
  const directionAllowed = requestedAction === "Long" ? emaAllowsLong : requestedAction === "Short" ? emaAllowsShort : false;
  const canTrade =
    blendedConfidence > 80 &&
    marketCondition !== "Sideways" &&
    requestedAction !== "Wait" &&
    directionAllowed &&
    hasCompleteTradePlan;
  const normalizedTrade = canTrade
    ? {
        signal: requestedAction === "Long" ? ("Buy" as AnalysisSignal) : ("Sell" as AnalysisSignal),
        scoringSignal: scoring.signal,
        confidence: blendedConfidence,
        entry: scoring.entry,
        stop: scoring.stop,
        takeProfit: scoring.takeProfit,
        riskReward: scoring.riskReward,
        action: requestedAction,
        suggestedAction: `${requestedAction.toUpperCase()}: ${scoring.reasons.slice(0, 3).join(" ")}`,
        tradeQuality: scoring.tradeQuality,
        setupChecks: {
          ...scoring.setupChecks,
          trendConfirm: true,
          marketStructureConfirm: true,
        },
      }
    : createWaitAnalysis({
        scoring,
        confidence: blendedConfidence,
        reason:
          blendedConfidence < 70 || marketCondition === "Sideways" || blendedConfidence <= 80
            ? "Low conviction market"
            : "Low conviction market",
      });

  const finalProbability = normalizedTrade.signal === "Wait" ? Math.min(probability, 60) : probability;
  const finalConfidence = normalizedTrade.signal === "Wait" ? Math.min(normalizedTrade.confidence, 69) : normalizedTrade.confidence;
  const waitReasons = [
    `Low conviction: confidence ${finalConfidence}%, trade requires more than 80%.`,
    marketCondition === "Sideways"
      ? "Market is sideways; wait for a clean structure break."
      : `Market condition is ${marketCondition}; confirmation is incomplete.`,
    describeEmaStructure(ema20, ema50),
    describeMacd(macd?.histogram ?? null),
  ];

  return {
    timeframe,
    trend,
    marketTrend,
    marketCondition,
    volatilityState,
    signal: normalizedTrade.signal,
    scoringSignal: normalizedTrade.scoringSignal,
    strength,
    confidence: finalConfidence,
    risk: scoring.risk,
    probability: finalProbability,
    trendStrength: scoring.trendStrength,
    reversalProbability: scoring.reversalProbability,
    marketHealth: scoring.marketHealth,
    entryQuality: scoring.entryQuality,
    tradeOpportunityScore: normalizedTrade.action === "Wait" ? 0 : scoring.tradeOpportunityScore,
    tradeQuality: normalizedTrade.tradeQuality,
    entry: normalizedTrade.entry,
    stop: normalizedTrade.stop,
    takeProfit: normalizedTrade.takeProfit,
    riskReward: normalizedTrade.riskReward,
    action: normalizedTrade.action,
    suggestedAction: normalizedTrade.suggestedAction,
    setupChecks: normalizedTrade.setupChecks,
    momentum,
    volatility,
    reasons: normalizedTrade.action === "Wait" ? waitReasons : scoring.reasons,
    rsi,
    sma20,
    sma50,
    ema20,
    ema50,
    macd: macd?.macd ?? null,
    macdSignal: macd?.signal ?? null,
    macdHistogram: macd?.histogram ?? null,
    atr,
    adx,
    vwap: scoring.vwap,
    support: levels.support,
    resistance: levels.resistance,
    averageVolume,
    currentVolume,
    volumeSpike,
    lastClose,
    updatedAt: Date.now(),
  };
}

export function calculateCompositeSignal(results: TimeframeAnalysis[]) {
  if (results.length === 0) {
    return {
      signal: "Neutral" as AnalysisSignal,
      probability: 0,
      confidence: 0,
      strength: 0,
    };
  }

  const weights: Record<AnalysisSignal, number> = {
    "Strong Buy": 2,
    Buy: 1,
    Neutral: 0,
    Sell: -1,
    "Strong Sell": -2,
    Wait: 0,
  };
  const score = results.reduce((sum, result) => sum + weights[result.signal], 0) / results.length;
  const strength = Math.round(results.reduce((sum, result) => sum + result.strength, 0) / results.length);
  const confidence = Math.round(results.reduce((sum, result) => sum + result.confidence, 0) / results.length);
  const probability = Math.round(results.reduce((sum, result) => sum + result.probability, 0) / results.length);
  const hasTradeSignal = results.some((result) => result.signal !== "Wait" && result.action !== "Wait");
  const signal: AnalysisSignal =
    !hasTradeSignal
      ? "Wait"
      : score >= 1.4
      ? "Strong Buy"
      : score >= 0.45
      ? "Buy"
      : score <= -1.4
      ? "Strong Sell"
      : score <= -0.45
      ? "Sell"
      : "Neutral";

  const finalConfidence = signal === "Wait" ? Math.min(confidence, 69) : confidence;
  const finalProbability = signal === "Wait" ? Math.min(probability, 60) : probability;

  return { signal, probability: finalProbability, confidence: finalConfidence, strength };
}
