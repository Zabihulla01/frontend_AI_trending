export type ScenarioAction = "Long" | "Short" | "Wait";

export interface AdaptiveScenarioInput {
  action: ScenarioAction;
  marketCondition: "Bull" | "Bear" | "Sideways";
  confidence: number;
  currentPrice: number | null;
  support: number | null;
  resistance: number | null;
  atr: number | null;
  setupChecks?: Record<string, boolean>;
}

function isValidPrice(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function getMissingChecks(setupChecks: Record<string, boolean> | undefined) {
  if (!setupChecks) return [];

  const labels: Record<string, string> = {
    emaCrossover: "EMA",
    macdConfirm: "MACD",
    rsiConfirm: "RSI",
    volumeConfirm: "volume",
    trendConfirm: "trend",
    marketStructureConfirm: "structure",
  };

  return Object.entries(setupChecks)
    .filter(([, passed]) => !passed)
    .map(([key]) => labels[key] ?? key)
    .slice(0, 2);
}

export function createAdaptiveScenario(input: AdaptiveScenarioInput) {
  const currentPrice = isValidPrice(input.currentPrice) ? input.currentPrice : null;
  const support = isValidPrice(input.support) ? input.support : null;
  const resistance = isValidPrice(input.resistance) ? input.resistance : null;
  const hasLevels = currentPrice !== null && support !== null && resistance !== null && resistance > support;
  const range = hasLevels && resistance !== null && support !== null ? resistance - support : null;
  const buffer = range !== null && currentPrice !== null ? Math.max(input.atr ?? 0, range * 0.05, currentPrice * 0.001) : null;
  const bullishEntry = hasLevels ? resistance : null;
  const bullishStop = support !== null && bullishEntry !== null && buffer !== null ? Math.min(support - buffer, bullishEntry - buffer * 1.5) : null;
  const bullishTarget = bullishEntry !== null && bullishStop !== null ? bullishEntry + (bullishEntry - bullishStop) * 2 : null;
  const bearishEntry = hasLevels ? support : null;
  const bearishStop = resistance !== null && bearishEntry !== null && buffer !== null ? Math.max(resistance + buffer, bearishEntry + buffer * 1.5) : null;
  const bearishTarget = bearishEntry !== null && bearishStop !== null ? bearishEntry - (bearishStop - bearishEntry) * 2 : null;
  const missingChecks = getMissingChecks(input.setupChecks);

  if (!hasLevels) {
    return {
      stateLabel: "Awaiting current-timeframe levels",
      stateTone: "amber",
      reason: "Waiting for enough completed candles to establish support and resistance.",
      bullish: { entry: null, stop: null, target: null },
      bearish: { entry: null, stop: null, target: null },
    };
  }

  if (input.action === "Long") {
    return {
      stateLabel: "Bullish setup confirmed",
      stateTone: "emerald",
      reason: "All entry filters are aligned; continue using the locked trade plan for execution decisions.",
      bullish: { entry: bullishEntry, stop: bullishStop, target: bullishTarget },
      bearish: { entry: bearishEntry, stop: bearishStop, target: bearishTarget },
    };
  }

  if (input.action === "Short") {
    return {
      stateLabel: "Bearish setup confirmed",
      stateTone: "red",
      reason: "All entry filters are aligned; continue using the locked trade plan for execution decisions.",
      bullish: { entry: bullishEntry, stop: bullishStop, target: bullishTarget },
      bearish: { entry: bearishEntry, stop: bearishStop, target: bearishTarget },
    };
  }

  const stateLabel =
    input.marketCondition === "Sideways"
      ? "Range market — wait for a close outside the range"
      : input.marketCondition === "Bull"
      ? "Bullish pressure — wait for breakout acceptance"
      : "Bearish pressure — wait for breakdown acceptance";
  const reason =
    missingChecks.length > 0
      ? `${missingChecks.join(" and ")} confirmation is incomplete (${Math.round(input.confidence)}% confidence).`
      : `No trade until the next completed candle confirms direction (${Math.round(input.confidence)}% confidence).`;

  return {
    stateLabel,
    stateTone: input.marketCondition === "Bull" ? "emerald" : input.marketCondition === "Bear" ? "red" : "amber",
    reason,
    bullish: { entry: bullishEntry, stop: bullishStop, target: bullishTarget },
    bearish: { entry: bearishEntry, stop: bearishStop, target: bearishTarget },
  };
}
