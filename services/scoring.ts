import {
  calculateIndicatorSnapshot,
  type IndicatorSnapshot,
  type OhlcvCandle,
  type SupportResistanceLevels,
} from "@/services/indicators";
import { createAtrTradePlan } from "@/store/useRiskStore";

export type Signal = "Strong Buy" | "Buy" | "Neutral" | "Sell" | "Strong Sell";
export type RiskLevel = "Low" | "Medium" | "High";
export type Action = "Long" | "Short" | "Wait";

export type ScoringCandle = OhlcvCandle;

export interface CustomScores {
  trendStrength: number;
  reversalProbability: number;
  marketHealth: number;
  entryQuality: number;
  tradeOpportunityScore: number;
  confidence: number;
}

export interface TradePlan {
  action: Action;
  entry: number | null;
  stop: number | null;
  takeProfit: number | null;
  riskReward: number | null;
  tradeQuality: number;
  suggestedAction: string;
  setupChecks: {
    emaCrossover: boolean;
    macdConfirm: boolean;
    rsiConfirm: boolean;
    volumeConfirm: boolean;
    trendConfirm: boolean;
    marketStructureConfirm: boolean;
  };
}

export interface ScoreResult extends IndicatorSnapshot, SupportResistanceLevels, CustomScores, TradePlan {
  signal: Signal;
  confidence: number;
  risk: RiskLevel;
  strength: number;
  reasons: string[];
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function getLatestClose(candles: ScoringCandle[]) {
  return candles.length > 0 ? candles[candles.length - 1].close : null;
}

function calculateRiskScore(input: {
  signalScore: number;
  snapshot: IndicatorSnapshot;
  lastClose: number;
}) {
  const { signalScore, snapshot, lastClose } = input;
  const proximity = Math.min(
    snapshot.support !== null ? Math.abs((lastClose - snapshot.support) / lastClose) * 100 : 100,
    snapshot.resistance !== null ? Math.abs((snapshot.resistance - lastClose) / lastClose) * 100 : 100
  );

  return (
    Math.abs(signalScore) * 4 +
    (snapshot.rsi !== null ? Math.max(0, Math.abs(snapshot.rsi - 50) - 18) * 0.6 : 8) +
    snapshot.volumeSpike * 5 +
    (snapshot.atr !== null ? Math.min((snapshot.atr / lastClose) * 100 * 2, 14) : 8) +
    Math.max(0, 6 - proximity)
  );
}

function getRiskLevel(score: number, snapshot: IndicatorSnapshot, lastClose: number): RiskLevel {
  const atrPercent = snapshot.atr !== null ? (snapshot.atr / lastClose) * 100 : 0;

  if (score > 30 || snapshot.volumeSpike > 2.2 || atrPercent > 4.5) {
    return "High";
  }

  if (score > 18 || snapshot.volumeSpike > 1.5 || atrPercent > 2.2) {
    return "Medium";
  }

  return "Low";
}

function calculateScores(snapshot: IndicatorSnapshot, lastClose: number, signalScore: number): CustomScores {
  const emaSpread =
    snapshot.ema12 !== null && snapshot.ema26 !== null
      ? Math.abs((snapshot.ema12 - snapshot.ema26) / lastClose) * 100
      : 0;
  const trendStrength = clamp(
    Math.round(
      35 +
        Math.min(emaSpread * 14, 28) +
        Math.min(Math.abs(snapshot.momentum) * 4, 22) +
        (snapshot.adx !== null ? Math.min(snapshot.adx * 0.55, 22) : 0)
    ),
    0,
    100
  );
  const reversalProbability = clamp(
    Math.round(
      18 +
        (snapshot.rsi !== null ? Math.max(0, Math.abs(snapshot.rsi - 50) - 16) * 1.25 : 0) +
        (snapshot.macdHistogram !== null && Math.sign(snapshot.macdHistogram) !== Math.sign(snapshot.momentum)
          ? 18
          : 0) +
        (snapshot.support !== null && Math.abs((lastClose - snapshot.support) / lastClose) * 100 < 1.5 ? 12 : 0) +
        (snapshot.resistance !== null && Math.abs((snapshot.resistance - lastClose) / lastClose) * 100 < 1.5 ? 12 : 0)
    ),
    0,
    100
  );
  const marketHealth = clamp(
    Math.round(
      48 +
        (snapshot.volumeSpike > 0.8 && snapshot.volumeSpike < 1.8 ? 14 : -6) +
        (snapshot.vwap !== null && lastClose >= snapshot.vwap ? 10 : -4) +
        (snapshot.atr !== null ? Math.max(0, 18 - (snapshot.atr / lastClose) * 100 * 4) : 0) +
        (snapshot.adx !== null ? Math.min(snapshot.adx * 0.25, 10) : 0)
    ),
    0,
    100
  );
  const entryQuality = clamp(
    Math.round(
      42 +
        Math.abs(signalScore) * 8 +
        (snapshot.rsi !== null ? Math.max(0, 20 - Math.abs(snapshot.rsi - 50)) * 0.35 : 0) +
        (snapshot.volumeSpike > 1 ? 8 : 0) +
        (snapshot.support !== null || snapshot.resistance !== null ? 8 : 0)
    ),
    0,
    100
  );
  const confidence = clamp(
    Math.round(trendStrength * 0.28 + marketHealth * 0.28 + entryQuality * 0.3 + (100 - reversalProbability) * 0.14),
    0,
    100
  );
  const tradeOpportunityScore = clamp(
    Math.round(
      trendStrength * 0.24 +
        marketHealth * 0.18 +
        entryQuality * 0.28 +
        confidence * 0.18 +
        (100 - reversalProbability) * 0.12
    ),
    0,
    100
  );

  return {
    trendStrength,
    reversalProbability,
    marketHealth,
    entryQuality,
    tradeOpportunityScore,
    confidence,
  };
}

function createTradePlan(
  signal: Signal,
  snapshot: IndicatorSnapshot,
  previousSnapshot: IndicatorSnapshot | null,
  lastClose: number,
  scores: CustomScores,
  reasons: string[]
): TradePlan {
  const bullishCross =
    snapshot.ema12 !== null &&
    snapshot.ema26 !== null &&
    previousSnapshot !== null &&
    previousSnapshot.ema12 !== null &&
    previousSnapshot.ema26 !== null &&
    previousSnapshot.ema12 <= previousSnapshot.ema26 &&
    snapshot.ema12 > snapshot.ema26;
  const bearishCross =
    snapshot.ema12 !== null &&
    snapshot.ema26 !== null &&
    previousSnapshot !== null &&
    previousSnapshot.ema12 !== null &&
    previousSnapshot.ema26 !== null &&
    previousSnapshot.ema12 >= previousSnapshot.ema26 &&
    snapshot.ema12 < snapshot.ema26;
  const initialAction: Action = bullishCross ? "Long" : bearishCross ? "Short" : "Wait";
  const directionSign = initialAction === "Long" ? 1 : initialAction === "Short" ? -1 : 0;
  const macdConfirm =
    directionSign !== 0 &&
    snapshot.macdHistogram !== null &&
    Math.sign(snapshot.macdHistogram) === directionSign;
  const rsiConfirm =
    directionSign === 1
      ? snapshot.rsi !== null && snapshot.rsi >= 45 && snapshot.rsi <= 68
      : directionSign === -1
      ? snapshot.rsi !== null && snapshot.rsi >= 32 && snapshot.rsi <= 55
      : false;
  const volumeConfirm = snapshot.volumeSpike >= 1.15;
  const trendConfirm =
    directionSign !== 0 &&
    snapshot.adx !== null &&
    snapshot.adx >= 20 &&
    Math.sign(snapshot.momentum) === directionSign;
  const marketStructureConfirm =
    directionSign === 1
      ? snapshot.ema20 !== null && snapshot.ema50 !== null && lastClose > snapshot.ema20 && snapshot.ema20 >= snapshot.ema50
      : directionSign === -1
      ? snapshot.ema20 !== null && snapshot.ema50 !== null && lastClose < snapshot.ema20 && snapshot.ema20 <= snapshot.ema50
      : false;
  const setupChecks = {
    emaCrossover: bullishCross || bearishCross,
    macdConfirm,
    rsiConfirm,
    volumeConfirm,
    trendConfirm,
    marketStructureConfirm,
  };
  const allConfirmed = Object.values(setupChecks).every(Boolean);
  const action = allConfirmed && scores.confidence > 80 ? initialAction : "Wait";

  if (action === "Wait") {
    const reason = scores.confidence <= 80 ? "confidence below 80%" : "setup checks incomplete";

    return {
      action,
      entry: lastClose,
      stop: null,
      takeProfit: null,
      riskReward: null,
      tradeQuality: scores.tradeOpportunityScore,
      suggestedAction: `WAIT: ${reason}`,
      setupChecks,
    };
  }

  const preferredRiskReward = scores.confidence >= 88 ? 3 : 2;
  const plan = createAtrTradePlan({
    action,
    entry: lastClose,
    atr: snapshot.atr,
    riskReward: preferredRiskReward,
  });

  if (action === "Long") {
    return {
      action,
      entry: plan.entry,
      stop: plan.stop,
      takeProfit: plan.takeProfit,
      riskReward: plan.riskReward,
      tradeQuality: scores.tradeOpportunityScore,
      suggestedAction: `LONG: ${reasons.slice(0, 3).join(" ")}`,
      setupChecks,
    };
  }

  if (action === "Short") {
    return {
      action,
      entry: plan.entry,
      stop: plan.stop,
      takeProfit: plan.takeProfit,
      riskReward: plan.riskReward,
      tradeQuality: scores.tradeOpportunityScore,
      suggestedAction: `SHORT: ${reasons.slice(0, 3).join(" ")}`,
      setupChecks,
    };
  }

  return {
    action,
    entry: lastClose,
    stop: null,
    takeProfit: null,
    riskReward: null,
    tradeQuality: scores.tradeOpportunityScore,
    suggestedAction: "WAIT: no clear edge",
    setupChecks,
  };
}

export function scoreMarket(candles: ScoringCandle[]): ScoreResult | null {
  const latestClose = getLatestClose(candles);

  if (latestClose === null || candles.length < 30) {
    return null;
  }

  const snapshot = calculateIndicatorSnapshot(candles);
  const previousSnapshot = candles.length > 31 ? calculateIndicatorSnapshot(candles.slice(0, -1)) : null;
  const reasons: string[] = [];
  let signalScore = 0;

  if (snapshot.ema12 !== null && snapshot.ema26 !== null) {
    if (snapshot.ema12 > snapshot.ema26) {
      signalScore += 2;
      reasons.push("EMA bullish structure favors buyers.");
    } else {
      signalScore -= 2;
      reasons.push("EMA bearish structure favors sellers.");
    }
  }

  if (snapshot.macdHistogram !== null) {
    if (snapshot.macdHistogram > 0) {
      signalScore += 2;
      reasons.push("MACD positive confirms upside momentum.");
    } else if (snapshot.macdHistogram < 0) {
      signalScore -= 2;
      reasons.push("MACD negative confirms downside momentum.");
    }
  }

  if (snapshot.momentum > 0.35) {
    signalScore += 1;
    reasons.push("Momentum is rising.");
  } else if (snapshot.momentum < -0.35) {
    signalScore -= 1;
    reasons.push("Momentum is falling.");
  }

  if (snapshot.vwap !== null) {
    if (latestClose > snapshot.vwap) {
      signalScore += 1;
      reasons.push("Price is trading above VWAP.");
    } else {
      signalScore -= 1;
      reasons.push("Price is trading below VWAP.");
    }
  }

  if (snapshot.adx !== null && snapshot.adx > 24) {
    signalScore += Math.sign(signalScore);
    reasons.push("ADX confirms directional strength.");
  }

  if (snapshot.rsi !== null) {
    if (snapshot.rsi > 72) {
      signalScore -= 2;
      reasons.push("RSI is overbought.");
    } else if (snapshot.rsi < 28) {
      signalScore += 2;
      reasons.push("RSI is oversold.");
    } else {
      reasons.push(`RSI ${Math.round(snapshot.rsi)} healthy.`);
    }
  }

  if (snapshot.volumeSpike > 1.5) {
    signalScore += Math.sign(signalScore);
    reasons.push("Volume spike supports the move.");
  }

  if (snapshot.support !== null && snapshot.resistance !== null) {
    const supportDist = Math.abs((latestClose - snapshot.support) / latestClose) * 100;
    const resistanceDist = Math.abs((snapshot.resistance - latestClose) / latestClose) * 100;

    if (supportDist < 1.5) {
      signalScore += 1;
      reasons.push("Price is near support.");
    }

    if (resistanceDist < 1.5) {
      signalScore -= 1;
      reasons.push("Price is near resistance.");
    }
  }

  const scores = calculateScores(snapshot, latestClose, signalScore);
  const strength = scores.trendStrength;
  let signal: Signal = "Neutral";

  if (signalScore >= 4 && strength >= 62) {
    signal = "Strong Buy";
  } else if (signalScore >= 1) {
    signal = "Buy";
  } else if (signalScore <= -4 && strength >= 62) {
    signal = "Strong Sell";
  } else if (signalScore <= -1) {
    signal = "Sell";
  }

  const riskScore = calculateRiskScore({ signalScore, snapshot, lastClose: latestClose });
  const risk = getRiskLevel(riskScore, snapshot, latestClose);
  const tradePlan = createTradePlan(signal, snapshot, previousSnapshot, latestClose, scores, reasons);

  return {
    signal,
    risk,
    strength,
    reasons,
    ...snapshot,
    ...scores,
    ...tradePlan,
  };
}
