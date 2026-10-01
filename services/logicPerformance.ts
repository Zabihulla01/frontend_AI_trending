/**
 * services/logicPerformance.ts
 *
 * Pure analysis engine for the Logic Accuracy Tracking feature.
 *
 * OBSERVATION ONLY — this module has no side-effects, no store imports,
 * and zero influence on live trading decisions. It only computes statistics
 * over already-completed trade records.
 *
 * Nothing in this file may be imported by or affect:
 *   indicators.ts, analysis.ts, scoring.ts, positionManager.ts,
 *   useRiskStore, useTradeStore, usePositionManagerStore, AIAnalysis,
 *   TradeSetupPanel, or any live-trading pathway.
 */

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

/** Minimum trades required before a bucket is trusted for analysis. */
export const SAMPLE_THRESHOLDS = {
  INSUFFICIENT: 10,
  LOW: 30,
} as const;

export type SampleTier = "INSUFFICIENT_DATA" | "LOW_SAMPLE" | "MEANINGFUL";
export type CloseReason = "COMPLETED" | "STOPPED_OUT" | "CLOSED";
export type TradeDirection = "LONG" | "SHORT";
export type SignalType = string; // e.g. "Strong Buy", "Buy", "Neutral", etc.

export type RsiRegime = "<30" | "30-45" | "45-55" | "55-70" | "70-80" | ">80";
export type EmaState = "BULLISH" | "BEARISH" | "FLAT";
export type MacdState = "POSITIVE" | "NEGATIVE" | "ZERO";
export type AdxStrength = "<20" | "20-25" | "25-35" | ">35";
export type VwapRelation = "ABOVE" | "BELOW" | "UNKNOWN";
export type VolumeLevel = "LOW" | "NORMAL" | "HIGH";
export type ConfidenceTier = "<62" | "62-70" | "70-80" | ">80";
export type MomentumDir = "POSITIVE" | "NEGATIVE" | "NEUTRAL";

/** Immutable snapshot of all indicator states at the moment a trade was locked. */
export interface LogicSnapshot {
  /** Unique per-lock ID, e.g. nanoid or `${positionKey}:${lockedAt}` */
  id: string;

  symbol: string;
  interval: string;
  direction: TradeDirection;

  entry: number;
  stopLoss: number;
  target: number;
  target2: number | null;

  confidence: number;
  riskScore: string; // "Low" | "Medium" | "High"

  indicators: {
    rsi: number | null;
    ema20: number | null;
    ema50: number | null;
    macd: number | null;
    macdHistogram: number | null;
    adx: number | null;
    vwap: number | null;
    atr: number | null;
    volume: number;
    volumeSpike: number;
    support: number | null;
    resistance: number | null;
    momentum: number;
  };

  /** Pre-classified states derived at capture time — never recomputed. */
  indicatorStates: {
    rsi: RsiRegime;
    ema: EmaState;
    macd: MacdState;
    adx: AdxStrength;
    vwap: VwapRelation;
    volume: VolumeLevel;
    momentum: MomentumDir;
    confidence: ConfidenceTier;
  };

  signal: SignalType;
  trendStrength: number;
  createdAt: number;
}

/** Outcome recorded after Position Protection closes a position. */
export interface TradeOutcome {
  /** Same ID as the LogicSnapshot it matches. */
  snapshotId: string;
  closeReason: CloseReason;
  entryPrice: number;
  exitPrice: number;
  rMultiple: number;
  duration: number; // milliseconds
  closedAt: number;
}

/** Combined record used by the analysis engine. */
export interface CompletedTradeRecord {
  snapshot: LogicSnapshot;
  outcome: TradeOutcome;
}

/** Per-bucket statistics. */
export interface BucketStats {
  label: string;
  trades: number;
  wins: number;
  losses: number;
  manualCloses: number;
  winRate: number;
  avgR: number;
  profitFactor: number;
  sampleTier: SampleTier;
}

/** Performance breakdown for a single indicator. */
export interface IndicatorPerformance {
  indicatorName: string;
  buckets: BucketStats[];
}

/** Performance for a combination of indicator states. */
export interface CombinationPerformance {
  key: string;       // e.g. "ema=BULLISH+macd=POSITIVE"
  labels: string[];  // human-readable parts
  trades: number;
  wins: number;
  losses: number;
  manualCloses: number;
  winRate: number;
  avgR: number;
  profitFactor: number;
  sampleTier: SampleTier;
}

/** Top-level output of the analysis engine. */
export interface LogicPerformanceReport {
  totalRecords: number;
  totalWins: number;
  totalLosses: number;
  totalManualCloses: number;
  overallWinRate: number;
  overallAvgR: number;
  profitFactor: number;

  byIndicator: IndicatorPerformance[];
  byCombination: CombinationPerformance[];

  // Convenience top-N lists
  topCombinations: CombinationPerformance[];
  weakCombinations: CombinationPerformance[];
  insufficientCombinations: CombinationPerformance[];

  generatedAt: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getSampleTier(trades: number, thresholds = SAMPLE_THRESHOLDS): SampleTier {
  if (trades < thresholds.INSUFFICIENT) return "INSUFFICIENT_DATA";
  if (trades < thresholds.LOW) return "LOW_SAMPLE";
  return "MEANINGFUL";
}

/**
 * A "win" is ONLY a position closed by Position Protection reaching the target.
 * Manually closed positions are never wins or losses — they are excluded from
 * win-rate maths but their R is still averaged.
 */
function classifyOutcome(record: CompletedTradeRecord): "WIN" | "LOSS" | "MANUAL" {
  switch (record.outcome.closeReason) {
    case "COMPLETED":
      return "WIN";
    case "STOPPED_OUT":
      return "LOSS";
    case "CLOSED":
      return "MANUAL";
  }
}

function buildBucketStats(label: string, records: CompletedTradeRecord[]): BucketStats {
  let wins = 0;
  let losses = 0;
  let manualCloses = 0;
  let totalWinR = 0;
  let totalLossR = 0;

  for (const record of records) {
    const cls = classifyOutcome(record);
    if (cls === "WIN") {
      wins++;
      totalWinR += record.outcome.rMultiple;
    } else if (cls === "LOSS") {
      losses++;
      totalLossR += Math.abs(record.outcome.rMultiple);
    } else {
      manualCloses++;
    }
  }

  const countableRecords = wins + losses;
  const winRate = countableRecords > 0 ? (wins / countableRecords) * 100 : 0;
  const allR = records.map((r) => r.outcome.rMultiple);
  const avgR = allR.length > 0 ? allR.reduce((s, v) => s + v, 0) / allR.length : 0;
  const profitFactor = totalLossR > 0 ? totalWinR / totalLossR : totalWinR > 0 ? Infinity : 0;

  return {
    label,
    trades: records.length,
    wins,
    losses,
    manualCloses,
    winRate: Math.round(winRate * 10) / 10,
    avgR: Math.round(avgR * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    sampleTier: getSampleTier(records.length),
  };
}

// ---------------------------------------------------------------------------
// Indicator state classifiers (called at snapshot capture time in the store,
// but also exported so tests can verify them independently)
// ---------------------------------------------------------------------------

export function classifyRsi(rsi: number | null): RsiRegime {
  if (rsi === null) return "45-55"; // neutral bucket
  if (rsi < 30) return "<30";
  if (rsi < 45) return "30-45";
  if (rsi < 55) return "45-55";
  if (rsi < 70) return "55-70";
  if (rsi < 80) return "70-80";
  return ">80";
}

export function classifyEma(ema20: number | null, ema50: number | null): EmaState {
  if (ema20 === null || ema50 === null) return "FLAT";
  if (ema20 > ema50) return "BULLISH";
  if (ema20 < ema50) return "BEARISH";
  return "FLAT";
}

export function classifyMacd(histogram: number | null): MacdState {
  if (histogram === null || histogram === 0) return "ZERO";
  return histogram > 0 ? "POSITIVE" : "NEGATIVE";
}

export function classifyAdx(adx: number | null): AdxStrength {
  if (adx === null) return "<20";
  if (adx < 20) return "<20";
  if (adx < 25) return "20-25";
  if (adx < 35) return "25-35";
  return ">35";
}

export function classifyVwap(price: number, vwap: number | null): VwapRelation {
  if (vwap === null || vwap <= 0) return "UNKNOWN";
  return price >= vwap ? "ABOVE" : "BELOW";
}

export function classifyVolume(volumeSpike: number): VolumeLevel {
  if (volumeSpike < 0.9) return "LOW";
  if (volumeSpike < 1.5) return "NORMAL";
  return "HIGH";
}

export function classifyConfidence(confidence: number): ConfidenceTier {
  if (confidence < 62) return "<62";
  if (confidence < 70) return "62-70";
  if (confidence < 80) return "70-80";
  return ">80";
}

export function classifyMomentum(momentum: number): MomentumDir {
  if (momentum > 0.1) return "POSITIVE";
  if (momentum < -0.1) return "NEGATIVE";
  return "NEUTRAL";
}

// ---------------------------------------------------------------------------
// Per-indicator performance analysis
// ---------------------------------------------------------------------------

function analyzeByRsi(records: CompletedTradeRecord[]): IndicatorPerformance {
  const groups: Record<RsiRegime, CompletedTradeRecord[]> = {
    "<30": [], "30-45": [], "45-55": [], "55-70": [], "70-80": [], ">80": [],
  };
  for (const record of records) {
    groups[record.snapshot.indicatorStates.rsi].push(record);
  }
  return {
    indicatorName: "RSI",
    buckets: (Object.keys(groups) as RsiRegime[])
      .map((k) => buildBucketStats(`RSI ${k}`, groups[k]))
      .filter((b) => b.trades > 0),
  };
}

function analyzeByEma(records: CompletedTradeRecord[]): IndicatorPerformance {
  const groups: Record<EmaState, CompletedTradeRecord[]> = { BULLISH: [], BEARISH: [], FLAT: [] };
  for (const record of records) {
    groups[record.snapshot.indicatorStates.ema].push(record);
  }
  return {
    indicatorName: "EMA",
    buckets: (Object.keys(groups) as EmaState[])
      .map((k) => buildBucketStats(`EMA ${k}`, groups[k]))
      .filter((b) => b.trades > 0),
  };
}

function analyzeByMacd(records: CompletedTradeRecord[]): IndicatorPerformance {
  const groups: Record<MacdState, CompletedTradeRecord[]> = { POSITIVE: [], NEGATIVE: [], ZERO: [] };
  for (const record of records) {
    groups[record.snapshot.indicatorStates.macd].push(record);
  }
  return {
    indicatorName: "MACD",
    buckets: (Object.keys(groups) as MacdState[])
      .map((k) => buildBucketStats(`MACD ${k}`, groups[k]))
      .filter((b) => b.trades > 0),
  };
}

function analyzeByAdx(records: CompletedTradeRecord[]): IndicatorPerformance {
  const groups: Record<AdxStrength, CompletedTradeRecord[]> = { "<20": [], "20-25": [], "25-35": [], ">35": [] };
  for (const record of records) {
    groups[record.snapshot.indicatorStates.adx].push(record);
  }
  return {
    indicatorName: "ADX",
    buckets: (Object.keys(groups) as AdxStrength[])
      .map((k) => buildBucketStats(`ADX ${k}`, groups[k]))
      .filter((b) => b.trades > 0),
  };
}

function analyzeByVwap(records: CompletedTradeRecord[]): IndicatorPerformance {
  const groups: Record<VwapRelation, CompletedTradeRecord[]> = { ABOVE: [], BELOW: [], UNKNOWN: [] };
  for (const record of records) {
    groups[record.snapshot.indicatorStates.vwap].push(record);
  }
  return {
    indicatorName: "VWAP",
    buckets: (Object.keys(groups) as VwapRelation[])
      .map((k) => buildBucketStats(`VWAP ${k}`, groups[k]))
      .filter((b) => b.trades > 0),
  };
}

function analyzeByVolume(records: CompletedTradeRecord[]): IndicatorPerformance {
  const groups: Record<VolumeLevel, CompletedTradeRecord[]> = { LOW: [], NORMAL: [], HIGH: [] };
  for (const record of records) {
    groups[record.snapshot.indicatorStates.volume].push(record);
  }
  return {
    indicatorName: "Volume",
    buckets: (Object.keys(groups) as VolumeLevel[])
      .map((k) => buildBucketStats(`Volume ${k}`, groups[k]))
      .filter((b) => b.trades > 0),
  };
}

function analyzeByMomentum(records: CompletedTradeRecord[]): IndicatorPerformance {
  const groups: Record<MomentumDir, CompletedTradeRecord[]> = { POSITIVE: [], NEGATIVE: [], NEUTRAL: [] };
  for (const record of records) {
    groups[record.snapshot.indicatorStates.momentum].push(record);
  }
  return {
    indicatorName: "Momentum",
    buckets: (Object.keys(groups) as MomentumDir[])
      .map((k) => buildBucketStats(`Momentum ${k}`, groups[k]))
      .filter((b) => b.trades > 0),
  };
}

function analyzeByConfidence(records: CompletedTradeRecord[]): IndicatorPerformance {
  const groups: Record<ConfidenceTier, CompletedTradeRecord[]> = { "<62": [], "62-70": [], "70-80": [], ">80": [] };
  for (const record of records) {
    groups[record.snapshot.indicatorStates.confidence].push(record);
  }
  return {
    indicatorName: "Confidence",
    buckets: (Object.keys(groups) as ConfidenceTier[])
      .map((k) => buildBucketStats(`Confidence ${k}`, groups[k]))
      .filter((b) => b.trades > 0),
  };
}

function analyzeByDirection(records: CompletedTradeRecord[]): IndicatorPerformance {
  const groups: Record<TradeDirection, CompletedTradeRecord[]> = { LONG: [], SHORT: [] };
  for (const record of records) {
    groups[record.snapshot.direction].push(record);
  }
  return {
    indicatorName: "Direction",
    buckets: (Object.keys(groups) as TradeDirection[])
      .map((k) => buildBucketStats(k, groups[k]))
      .filter((b) => b.trades > 0),
  };
}

function analyzeByTimeframe(records: CompletedTradeRecord[]): IndicatorPerformance {
  const groups: Record<string, CompletedTradeRecord[]> = {};
  for (const record of records) {
    const tf = record.snapshot.interval;
    groups[tf] = groups[tf] ?? [];
    groups[tf].push(record);
  }
  return {
    indicatorName: "Timeframe",
    buckets: Object.keys(groups)
      .map((k) => buildBucketStats(k, groups[k]))
      .filter((b) => b.trades > 0),
  };
}

// ---------------------------------------------------------------------------
// Combination analysis
// ---------------------------------------------------------------------------

type ComboKey = keyof LogicSnapshot["indicatorStates"];

const COMBO_DEFINITIONS: Array<ComboKey[]> = [
  ["ema", "macd"],
  ["ema", "vwap"],
  ["ema", "adx"],
  ["macd", "vwap"],
  ["macd", "adx"],
  ["rsi", "macd"],
  ["ema", "macd", "vwap"],
  ["ema", "macd", "adx"],
  ["macd", "vwap", "adx"],
  ["ema", "macd", "vwap", "adx"],
  ["ema", "rsi"],
  ["macd", "volume"],
  ["ema", "macd", "volume"],
];

function buildComboKey(record: CompletedTradeRecord, keys: ComboKey[]): string {
  return keys.map((k) => `${k}=${record.snapshot.indicatorStates[k]}`).join("+");
}

function buildComboLabels(comboKey: string): string[] {
  return comboKey.split("+").map((part) => {
    const [indicator, value] = part.split("=");
    return `${indicator.toUpperCase()} ${value}`;
  });
}

function analyzeCombinations(records: CompletedTradeRecord[]): CombinationPerformance[] {
  const results: CombinationPerformance[] = [];

  for (const comboDef of COMBO_DEFINITIONS) {
    const groups: Record<string, CompletedTradeRecord[]> = {};

    for (const record of records) {
      const key = buildComboKey(record, comboDef);
      groups[key] = groups[key] ?? [];
      groups[key].push(record);
    }

    for (const [key, groupRecords] of Object.entries(groups)) {
      if (groupRecords.length === 0) continue;

      const stats = buildBucketStats(key, groupRecords);
      results.push({
        key,
        labels: buildComboLabels(key),
        trades: stats.trades,
        wins: stats.wins,
        losses: stats.losses,
        manualCloses: stats.manualCloses,
        winRate: stats.winRate,
        avgR: stats.avgR,
        profitFactor: stats.profitFactor,
        sampleTier: stats.sampleTier,
      });
    }
  }

  // Deduplicate by key (same combo from different defs would be identical)
  const seen = new Set<string>();
  return results.filter((r) => {
    if (seen.has(r.key)) return false;
    seen.add(r.key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Filtering helpers
// ---------------------------------------------------------------------------

export interface PerformanceFilter {
  symbol?: string;
  interval?: string;
  direction?: TradeDirection;
  signal?: string;
  fromDate?: number;
  toDate?: number;
}

export function applyFilter(
  records: CompletedTradeRecord[],
  filter: PerformanceFilter
): CompletedTradeRecord[] {
  return records.filter((record) => {
    if (filter.symbol && record.snapshot.symbol !== filter.symbol) return false;
    if (filter.interval && record.snapshot.interval !== filter.interval) return false;
    if (filter.direction && record.snapshot.direction !== filter.direction) return false;
    if (filter.signal && record.snapshot.signal !== filter.signal) return false;
    if (filter.fromDate && record.snapshot.createdAt < filter.fromDate) return false;
    if (filter.toDate && record.snapshot.createdAt > filter.toDate) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Compute a full LogicPerformanceReport from completed trade records.
 * Pure function — no side-effects, no I/O, fully deterministic.
 */
export function computeLogicPerformance(
  records: CompletedTradeRecord[],
  filter?: PerformanceFilter
): LogicPerformanceReport {
  const filtered = filter ? applyFilter(records, filter) : records;

  let totalWins = 0;
  let totalLosses = 0;
  let totalManualCloses = 0;
  let totalWinR = 0;
  let totalLossR = 0;

  for (const record of filtered) {
    const cls = classifyOutcome(record);
    if (cls === "WIN") {
      totalWins++;
      totalWinR += record.outcome.rMultiple;
    } else if (cls === "LOSS") {
      totalLosses++;
      totalLossR += Math.abs(record.outcome.rMultiple);
    } else {
      totalManualCloses++;
    }
  }

  const countable = totalWins + totalLosses;
  const overallWinRate = countable > 0 ? Math.round((totalWins / countable) * 1000) / 10 : 0;
  const allR = filtered.map((r) => r.outcome.rMultiple);
  const overallAvgR = allR.length > 0 ? Math.round((allR.reduce((s, v) => s + v, 0) / allR.length) * 100) / 100 : 0;
  const overallPF = totalLossR > 0 ? Math.round((totalWinR / totalLossR) * 100) / 100 : totalWinR > 0 ? Infinity : 0;

  const byIndicator: IndicatorPerformance[] = [
    analyzeByRsi(filtered),
    analyzeByEma(filtered),
    analyzeByMacd(filtered),
    analyzeByAdx(filtered),
    analyzeByVwap(filtered),
    analyzeByVolume(filtered),
    analyzeByMomentum(filtered),
    analyzeByConfidence(filtered),
    analyzeByDirection(filtered),
    analyzeByTimeframe(filtered),
  ].filter((p) => p.buckets.length > 0);

  const allCombos = analyzeCombinations(filtered);

  const meaningful = allCombos.filter((c) => c.sampleTier === "MEANINGFUL");
  const topCombinations = [...meaningful]
    .filter((c) => c.wins + c.losses > 0)
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, 10);
  const weakCombinations = [...meaningful]
    .filter((c) => c.wins + c.losses > 0)
    .sort((a, b) => a.winRate - b.winRate)
    .slice(0, 10);
  const insufficientCombinations = allCombos
    .filter((c) => c.sampleTier === "INSUFFICIENT_DATA")
    .slice(0, 20);

  return {
    totalRecords: filtered.length,
    totalWins,
    totalLosses,
    totalManualCloses,
    overallWinRate,
    overallAvgR,
    profitFactor: overallPF,
    byIndicator,
    byCombination: allCombos,
    topCombinations,
    weakCombinations,
    insufficientCombinations,
    generatedAt: Date.now(),
  };
}
