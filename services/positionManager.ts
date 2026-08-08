import { calculateIndicatorSnapshot, type OhlcvCandle } from "@/services/indicators";

export type PositionDirection = "LONG" | "SHORT";
export type PositionStatus = "ACTIVE" | "COMPLETED" | "STOPPED_OUT" | "CLOSED";
export type PositionRecommendation =
  | "HOLD"
  | "EXIT NOW"
  | "BOOK PARTIAL PROFIT"
  | "MOVE STOP LOSS TO BREAKEVEN"
  | "MOVE STOP LOSS TO TRAILING"
  | "TP1 HIT"
  | "TP2 HIT"
  | "STOP LOSS HIT";
export type PositionEventType =
  | "TRADE_LOCKED"
  | "TRADE_STARTED"
  | "TP1_HIT"
  | "TP2_HIT"
  | "STOP_LOSS_HIT"
  | "SL_MOVED"
  | "TRAILING_ACTIVATED"
  | "EXIT_RECOMMENDATION"
  | "TRADE_CLOSED";

export interface PositionCandle extends OhlcvCandle {
  time: number;
}

export interface PositionRecommendationSnapshot {
  recommendation: PositionRecommendation;
  confidence: number;
  exitScore: number;
  holdScore: number;
  currentProfit: number;
  currentLoss: number;
  currentRR: number;
  holdingTime: number;
  marketHealth: number;
  trendStrength: number;
  reasoning: string[];
  generatedAt: number;
  suggestedStopLoss: number | null;
}

export interface PositionTimelineEvent {
  id: string;
  type: PositionEventType;
  timestamp: number;
  message: string;
  recommendation?: PositionRecommendation;
}

export interface PositionNotification {
  id: string;
  positionKey: string;
  recommendation: PositionRecommendation;
  createdAt: number;
  dismissed: boolean;
  message: string;
}

export interface ManagedPosition {
  key: string;
  symbol: string;
  timeframe: string;
  direction: PositionDirection;
  entry: number;
  originalStopLoss: number;
  activeStopLoss: number;
  tp1: number | null;
  tp2: number | null;
  currentPrice: number;
  quantity: number;
  lockedAt: number;
  status: PositionStatus;
  tp1HitAt: number | null;
  trailingActive: boolean;
  timeline: PositionTimelineEvent[];
  notifications: PositionNotification[];
  lastRecommendation: PositionRecommendationSnapshot | null;
}

export interface PositionEvaluation {
  recommendation: PositionRecommendationSnapshot;
  tp1Hit: boolean;
  tp2Hit: boolean;
  stopLossHit: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const round = (value: number, precision = 2) => Number(value.toFixed(precision));

function isPositive(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0;
}

function isLevelHit(direction: PositionDirection, candle: PositionCandle, level: number, kind: "target" | "stop") {
  if (direction === "LONG") {
    return kind === "target" ? candle.high >= level : candle.low <= level;
  }

  return kind === "target" ? candle.low <= level : candle.high >= level;
}

function isValidCandle(candle: PositionCandle) {
  return (
    Number.isFinite(candle.time) &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close) &&
    Number.isFinite(candle.volume) &&
    candle.high >= candle.low &&
    candle.high >= candle.open &&
    candle.high >= candle.close &&
    candle.low <= candle.open &&
    candle.low <= candle.close &&
    candle.volume >= 0
  );
}

function getMonotonicStop(position: ManagedPosition, candidate: number | null, currentPrice: number) {
  if (!isPositive(candidate)) return null;

  const isFavorable = position.direction === "LONG" ? candidate > position.activeStopLoss : candidate < position.activeStopLoss;
  const isBeforeCurrentPrice = position.direction === "LONG" ? candidate < currentPrice : candidate > currentPrice;

  // A protection update may only reduce risk. It must not move the stop through
  // the current market price or undo a previously acknowledged stop move.
  return isFavorable && isBeforeCurrentPrice ? candidate : null;
}

function getHoldingMinutes(position: ManagedPosition, candle: PositionCandle, now: number) {
  const candleTime = Number.isFinite(candle.time) ? candle.time * 1000 : now;
  return Math.max(0, Math.round((candleTime - position.lockedAt) / 60_000));
}

function getPnl(position: ManagedPosition, price: number) {
  const directionMultiplier = position.direction === "LONG" ? 1 : -1;
  const perUnit = (price - position.entry) * directionMultiplier;
  return perUnit * position.quantity;
}

function makeReasoning(input: {
  direction: PositionDirection;
  recommendation: PositionRecommendation;
  trendAligned: boolean;
  emaAligned: boolean;
  macdAligned: boolean;
  momentumAligned: boolean;
  volumeSupports: boolean;
  reversalCandle: boolean;
  structureBreak: boolean;
  rsi: number | null;
  tp1Hit: boolean;
  tp2Hit: boolean;
  stopLossHit: boolean;
}) {
  const directionName = input.direction === "LONG" ? "bullish" : "bearish";
  const oppositeName = input.direction === "LONG" ? "bearish" : "bullish";
  const reasons: string[] = [];

  if (input.stopLossHit) {
    return ["The completed candle crossed the locked stop-loss level. This is a historical level check, not an order execution."];
  }

  if (input.tp2Hit) {
    return ["The completed candle reached TP2. Consider manually closing any remaining position; monitoring has ended for this snapshot."];
  }

  if (input.tp1Hit) {
    return [
      "The completed candle reached TP1.",
      "Consider booking partial profit and reviewing whether to move the stop to entry manually.",
      "Monitoring continues because this tool only provides guidance.",
    ];
  }

  if (input.trendAligned) reasons.push(`The broader structure remains ${directionName}.`);
  if (input.emaAligned) reasons.push("EMA alignment still supports the position direction.");
  if (input.macdAligned) reasons.push("MACD momentum remains aligned with the position.");
  if (input.momentumAligned) reasons.push("Recent momentum supports continuation.");
  if (input.volumeSupports) reasons.push("Volume is supporting the current move without an abnormal spike.");
  if (input.reversalCandle) reasons.push(`A ${oppositeName} reversal-style candle needs caution.`);
  if (input.structureBreak) reasons.push(`Price has broken a nearby ${oppositeName} structure level.`);
  if (input.rsi !== null && (input.rsi >= 70 || input.rsi <= 30)) reasons.push(`RSI is extended near ${Math.round(input.rsi)}.`);

  if (input.recommendation === "EXIT NOW") {
    reasons.push("Several completed-candle signals are weakening the original thesis; consider manually exiting or reducing exposure.");
  } else if (input.recommendation === "MOVE STOP LOSS TO BREAKEVEN") {
    reasons.push("The trade has moved sufficiently in favor to consider protecting risk at entry manually.");
  } else if (input.recommendation === "MOVE STOP LOSS TO TRAILING") {
    reasons.push("Strength remains favorable after progress toward target; a manually managed trailing stop may protect gains.");
  } else if (reasons.length === 0) {
    reasons.push("The available completed-candle data is mixed, so the guidance remains cautious rather than certain.");
  }

  return reasons.slice(0, 5);
}

export function getPositionKey(symbol: string, timeframe: string) {
  return `${symbol.trim().toUpperCase()}:${timeframe.trim().toLowerCase()}`;
}

export function evaluatePosition(position: ManagedPosition, candles: PositionCandle[], now = Date.now()): PositionEvaluation | null {
  const history = candles.filter(
    isValidCandle
  );
  const candle = history.at(-1);

  if (!candle || position.status !== "ACTIVE") {
    return null;
  }

  const price = candle.close;
  const riskPerUnit = Math.abs(position.entry - position.originalStopLoss);
  const directionMultiplier = position.direction === "LONG" ? 1 : -1;
  const directionalMove = (price - position.entry) * directionMultiplier;
  const currentRR = riskPerUnit > 0 ? directionalMove / riskPerUnit : 0;
  const pnl = getPnl(position, price);
  const holdingTime = getHoldingMinutes(position, candle, now);
  const stopLossHit = isLevelHit(position.direction, candle, position.activeStopLoss, "stop");
  const tp2Hit = isPositive(position.tp2) && isLevelHit(position.direction, candle, position.tp2, "target");
  const tp1Hit = !position.tp1HitAt && isPositive(position.tp1) && isLevelHit(position.direction, candle, position.tp1, "target");

  // A candle can span both a target and stop. Without intrabar sequencing, prefer the conservative stop outcome.
  if (stopLossHit) {
    const recommendation: PositionRecommendationSnapshot = {
      recommendation: "STOP LOSS HIT",
      confidence: 92,
      exitScore: 100,
      holdScore: 0,
      currentProfit: round(Math.max(0, pnl)),
      currentLoss: round(Math.max(0, -pnl)),
      currentRR: round(currentRR, 6),
      holdingTime,
      marketHealth: 0,
      trendStrength: 0,
      reasoning: makeReasoning({
        direction: position.direction,
        recommendation: "STOP LOSS HIT",
        trendAligned: false,
        emaAligned: false,
        macdAligned: false,
        momentumAligned: false,
        volumeSupports: false,
        reversalCandle: false,
        structureBreak: false,
        rsi: null,
        tp1Hit: false,
        tp2Hit: false,
        stopLossHit: true,
      }),
      generatedAt: now,
      suggestedStopLoss: null,
    };

    return { recommendation, tp1Hit: false, tp2Hit: false, stopLossHit: true };
  }

  if (tp2Hit) {
    const recommendation: PositionRecommendationSnapshot = {
      recommendation: "TP2 HIT",
      confidence: 93,
      exitScore: 95,
      holdScore: 5,
      currentProfit: round(Math.max(0, pnl)),
      currentLoss: round(Math.max(0, -pnl)),
      currentRR: round(currentRR, 6),
      holdingTime,
      marketHealth: 75,
      trendStrength: 75,
      reasoning: makeReasoning({
        direction: position.direction,
        recommendation: "TP2 HIT",
        trendAligned: true,
        emaAligned: true,
        macdAligned: true,
        momentumAligned: true,
        volumeSupports: true,
        reversalCandle: false,
        structureBreak: false,
        rsi: null,
        tp1Hit: false,
        tp2Hit: true,
        stopLossHit: false,
      }),
      generatedAt: now,
      suggestedStopLoss: null,
    };

    return { recommendation, tp1Hit: false, tp2Hit: true, stopLossHit: false };
  }

  const snapshot = calculateIndicatorSnapshot(history);
  const previousSnapshot = history.length > 1 ? calculateIndicatorSnapshot(history.slice(0, -1)) : null;
  const emaAligned =
    snapshot.ema20 !== null && snapshot.ema50 !== null
      ? position.direction === "LONG"
        ? snapshot.ema20 >= snapshot.ema50 && price >= snapshot.ema20
        : snapshot.ema20 <= snapshot.ema50 && price <= snapshot.ema20
      : false;
  const macdAligned = snapshot.macdHistogram !== null && Math.sign(snapshot.macdHistogram) === directionMultiplier;
  const momentumAligned = Math.sign(snapshot.momentum) === directionMultiplier && Math.abs(snapshot.momentum) > 0.05;
  const trendAligned = emaAligned || (macdAligned && momentumAligned);
  const volumeSupports = snapshot.volumeSpike >= 0.85 && snapshot.volumeSpike <= 2.25;
  const atrPercent = snapshot.atr !== null && price > 0 ? (snapshot.atr / price) * 100 : 0;
  const prior = history.at(-2) ?? null;
  const reversalCandle =
    prior !== null &&
    (position.direction === "LONG"
      ? candle.close < candle.open && candle.open >= prior.close && candle.close <= prior.open
      : candle.close > candle.open && candle.open <= prior.close && candle.close >= prior.open);
  const priorStructure = history.slice(-6, -1);
  const swingHigh = priorStructure.length > 0 ? Math.max(...priorStructure.map((item) => item.high)) : null;
  const swingLow = priorStructure.length > 0 ? Math.min(...priorStructure.map((item) => item.low)) : null;
  const swingBreak =
    position.direction === "LONG"
      ? swingLow !== null && candle.close < swingLow
      : swingHigh !== null && candle.close > swingHigh;
  const swingBreakout =
    position.direction === "LONG"
      ? swingHigh !== null && candle.close > swingHigh
      : swingLow !== null && candle.close < swingLow;
  const structureBreak =
    swingBreak ||
    (previousSnapshot !== null &&
      (position.direction === "LONG"
        ? previousSnapshot.support !== null && candle.close < previousSnapshot.support
        : previousSnapshot.resistance !== null && candle.close > previousSnapshot.resistance));
  const breakout =
    swingBreakout ||
    (previousSnapshot !== null &&
      (position.direction === "LONG"
        ? previousSnapshot.resistance !== null && candle.close > previousSnapshot.resistance
        : previousSnapshot.support !== null && candle.close < previousSnapshot.support));

  let holdScore = 42;
  let exitScore = 22;
  if (trendAligned) holdScore += 16;
  else exitScore += 18;
  if (emaAligned) holdScore += 12;
  else exitScore += 12;
  if (macdAligned) holdScore += 10;
  else exitScore += 10;
  if (momentumAligned) holdScore += 9;
  else exitScore += 9;
  if (volumeSupports) holdScore += 6;
  else if (snapshot.volumeSpike > 2.25) exitScore += 7;
  if (reversalCandle) exitScore += 16;
  if (structureBreak) exitScore += 20;
  if (breakout) holdScore += 8;
  if (snapshot.rsi !== null && (position.direction === "LONG" ? snapshot.rsi > 74 : snapshot.rsi < 26)) exitScore += 8;
  if (atrPercent > 4.5) exitScore += 7;
  holdScore = Math.round(clamp(holdScore, 0, 100));
  exitScore = Math.round(clamp(exitScore, 0, 100));
  const trendStrength = Math.round(
    clamp((snapshot.adx ?? 15) * 1.45 + (emaAligned ? 20 : 0) + (momentumAligned ? 12 : 0), 0, 100)
  );
  const marketHealth = Math.round(
    clamp(42 + (volumeSupports ? 16 : -5) + (trendAligned ? 18 : -12) + (atrPercent > 4.5 ? -16 : 8) + (snapshot.vwap !== null && Math.sign(price - snapshot.vwap) === directionMultiplier ? 8 : 0), 0, 100)
  );

  let recommendation: PositionRecommendation = "HOLD";
  let suggestedStopLoss: number | null = null;
  // Once a position is locked, protect it from completed-candle events. A weak
  // indicator alone should not close the trade; require price-action evidence.
  const protectionTrigger = structureBreak || reversalCandle;

  if (tp1Hit) {
    recommendation = "BOOK PARTIAL PROFIT";
    suggestedStopLoss = position.entry;
  } else if (protectionTrigger && exitScore >= 68 && exitScore > holdScore + 12) {
    recommendation = "EXIT NOW";
  } else if (currentRR >= 1.6 && trendStrength >= 60 && !position.trailingActive) {
    recommendation = "MOVE STOP LOSS TO TRAILING";
    const trailDistance = snapshot.atr !== null && snapshot.atr > 0 ? snapshot.atr * 1.2 : Math.abs(price - position.entry) * 0.35;
    suggestedStopLoss = getMonotonicStop(position, price - directionMultiplier * trailDistance, price);
  } else if (currentRR >= 0.9 && Math.abs(position.activeStopLoss - position.entry) > riskPerUnit * 0.08) {
    recommendation = "MOVE STOP LOSS TO BREAKEVEN";
    suggestedStopLoss = getMonotonicStop(position, position.entry, price);
  }

  const confidence = Math.round(
    clamp(48 + Math.abs(holdScore - exitScore) * 0.52 + (recommendation === "HOLD" ? 0 : 8), 45, 94)
  );
  const recommendationSnapshot: PositionRecommendationSnapshot = {
    recommendation,
    confidence,
    exitScore,
    holdScore,
    currentProfit: round(Math.max(0, pnl)),
    currentLoss: round(Math.max(0, -pnl)),
    currentRR: round(currentRR, 6),
    holdingTime,
    marketHealth,
    trendStrength,
    reasoning: makeReasoning({
      direction: position.direction,
      recommendation,
      trendAligned,
      emaAligned,
      macdAligned,
      momentumAligned,
      volumeSupports,
      reversalCandle,
      structureBreak,
      rsi: snapshot.rsi,
      tp1Hit,
      tp2Hit: false,
      stopLossHit: false,
    }),
    generatedAt: now,
    suggestedStopLoss,
  };

  return { recommendation: recommendationSnapshot, tp1Hit, tp2Hit: false, stopLossHit: false };
}
