import { calculateRsi, calculateSma, getLatestValue } from "@/services/indicators";

export type AnalysisTimeframe = "1m" | "5m" | "15m" | "1h";
export type AnalysisTrend = "Bullish" | "Bearish" | "Neutral";
export type AnalysisSignal = "Strong Buy" | "Buy" | "Neutral" | "Sell" | "Strong Sell";

export interface AnalysisCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface TimeframeAnalysis {
  timeframe: AnalysisTimeframe;
  trend: AnalysisTrend;
  signal: AnalysisSignal;
  strength: number;
  confidence: number;
  momentum: number;
  volatility: number;
  probability: number;
  rsi: number | null;
  sma20: number | null;
  sma50: number | null;
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
  const rsi = getLatestValue(calculateRsi(indicatorCandles, 14));
  const lastClose = getLatestClose(candles);

  if (lastClose === null || sma20 === null || sma50 === null) {
    return null;
  }

  const momentum = calculateMomentum(candles);
  const volatility = calculateVolatility(candles);
  const trend = calculateTrend({ lastClose, sma20, sma50, momentum, rsi });
  const smaSpread = Math.abs(((sma20 - sma50) / sma50) * 100);
  const priceDistance = Math.abs(((lastClose - sma20) / sma20) * 100);
  const rsiConviction = rsi === null ? 0 : Math.min(Math.abs(rsi - 50) * 1.4, 22);
  const strength = clamp(
    Math.round(38 + Math.min(smaSpread * 7, 24) + Math.min(priceDistance * 5, 18) + Math.min(Math.abs(momentum) * 4, 18) + rsiConviction),
    0,
    100
  );
  const confidence = clamp(
    Math.round(42 + strength * 0.35 + Math.max(0, 18 - volatility * 3) + Math.min(candles.length / 8, 14)),
    0,
    100
  );
  const signal = calculateSignal({ trend, strength, momentum, rsi, volatility });
  const probability = calculateProbability({ strength, confidence, momentum, volatility, rsi });

  return {
    timeframe,
    trend,
    signal,
    strength,
    confidence,
    momentum,
    volatility,
    probability,
    rsi,
    sma20,
    sma50,
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
  };
  const score = results.reduce((sum, result) => sum + weights[result.signal], 0) / results.length;
  const strength = Math.round(results.reduce((sum, result) => sum + result.strength, 0) / results.length);
  const confidence = Math.round(results.reduce((sum, result) => sum + result.confidence, 0) / results.length);
  const probability = Math.round(results.reduce((sum, result) => sum + result.probability, 0) / results.length);
  const signal: AnalysisSignal =
    score >= 1.4 ? "Strong Buy" : score >= 0.45 ? "Buy" : score <= -1.4 ? "Strong Sell" : score <= -0.45 ? "Sell" : "Neutral";

  return { signal, probability, confidence, strength };
}
