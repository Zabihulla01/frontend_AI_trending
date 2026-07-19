import { create } from "zustand";

export type RiskAction = "Long" | "Short" | "Wait";

export interface RiskInputs {
  accountBalance: string;
  riskPercentage: string;
  entryPrice: string;
  stopLoss: string;
  takeProfit: string;
  atr: string;
  action: RiskAction;
}

export interface TradeSetupPlanInput extends Partial<RiskInputs> {
  takeProfit2?: string;
  trend?: string | null;
  marketCondition?: string | null;
  scoringSignal?: string | null;
  confidence?: number | null;
  ema20?: number | null;
  ema50?: number | null;
  rsi?: number | null;
  macdHistogram?: number | null;
  support?: number | null;
  resistance?: number | null;
  volatility?: number | null;
  volumeSpike?: number | null;
  signal?: string;
  trendStrength?: number | null;
  vwap?: number | null;
  lastClose?: number | null;
}

export interface TargetContext {
  action: RiskAction;
  ema20: number | null;
  ema50: number | null;
  rsiRegime: "oversold" | "bearish" | "neutral" | "bullish" | "overbought";
  macdDirection: -1 | 0 | 1;
  support: number | null;
  resistance: number | null;
  volatility: number | null;
  volumeSpike: number | null;
  signal: string;
  lastClose: number | null;
  atr: number | null;
}

export interface RiskResult {
  positionSize: number;
  maxLossAmount: number;
  riskAmount: number;
  rewardAmount: number;
  riskRewardRatio: number;
  suggestedRiskReward: number;
  potentialProfit: number;
  riskPerUnit: number;
  rewardPerUnit: number;
  tradeQuality: number;
  entryQuality: number;
  tradeScore: number;
  isRejected: boolean;
  warning: string | null;
  direction: RiskAction;
  errors: string[];
}

interface RiskState extends RiskInputs {
  takeProfit2: string;
  confidence: number | null;
  targetLocked: boolean;
  targetLockReason: string;
  recomputeReason: string | null;
  recalculateMode: "ON STRUCTURE BREAK ONLY";
  targetContext: TargetContext | null;
  updateInput: (field: keyof RiskInputs, value: string) => void;
  applyTradePlan: (plan: TradeSetupPlanInput) => void;
  reset: () => void;
}

const MIN_SETUP_CONFIDENCE = 55;
const MIN_PUBLISH_RISK_REWARD = 1.5;
const MIN_RISK_REWARD = 2;
const PREFERRED_RISK_REWARD = 3;
const REJECTED_RISK_REASON = "Rejected because reward does not justify risk";

const DEFAULT_INPUTS: RiskInputs = {
  accountBalance: "10000",
  riskPercentage: "1",
  entryPrice: "",
  stopLoss: "",
  takeProfit: "",
  atr: "",
  action: "Wait",
};

const DEFAULT_LOCK_STATE = {
  takeProfit2: "",
  confidence: null,
  targetLocked: false,
  targetLockReason: "",
  recomputeReason: null,
  recalculateMode: "ON STRUCTURE BREAK ONLY" as const,
  targetContext: null,
};

export function parseRiskNumber(value: string) {
  const normalizedValue = value.replace(/,/g, "").trim();

  if (!normalizedValue) {
    return null;
  }

  const parsedValue = Number(normalizedValue);

  return Number.isFinite(parsedValue) ? parsedValue : null;
}

export function formatRiskInput(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "";
  }

  return Number(value.toPrecision(12)).toString();
}

function getRsiRegime(rsi: number | null): TargetContext["rsiRegime"] {
  if (rsi === null) return "neutral";
  if (rsi <= 30) return "oversold";
  if (rsi < 45) return "bearish";
  if (rsi <= 55) return "neutral";
  if (rsi < 70) return "bullish";
  return "overbought";
}

function getDirection(value: number | null): TargetContext["macdDirection"] {
  if (value === null || value === 0) return 0;
  return value > 0 ? 1 : -1;
}

function structureCrossed(previous: TargetContext, current: TargetContext) {
  if (previous.ema20 === null || previous.ema50 === null || current.ema20 === null || current.ema50 === null) {
    return false;
  }

  return (
    (previous.ema20 <= previous.ema50 && current.ema20 > current.ema50) ||
    (previous.ema20 >= previous.ema50 && current.ema20 < current.ema50)
  );
}

export function recomputeTrigger(previous: TargetContext | null, current: TargetContext) {
  if (previous === null) {
    return "Initial target generated";
  }

  if (previous.action !== current.action || previous.signal !== current.signal) {
    return "AI signal changes";
  }

  if (structureCrossed(previous, current)) {
    return "EMA crossover";
  }

  if (previous.macdDirection !== 0 && current.macdDirection !== 0 && previous.macdDirection !== current.macdDirection) {
    return "MACD reversal";
  }

  const supportBroken = previous.support !== null && current.lastClose !== null && current.lastClose < previous.support;
  const resistanceBroken = previous.resistance !== null && current.lastClose !== null && current.lastClose > previous.resistance;

  if (supportBroken) {
    return "Support break";
  }

  if (resistanceBroken) {
    return "Resistance break";
  }

  return null;
}

function createTargetContext(plan: TradeSetupPlanInput, fallback: RiskState): TargetContext {
  const lastClose = plan.lastClose ?? parseRiskNumber(plan.entryPrice ?? fallback.entryPrice);
  const signal = [plan.signal, plan.scoringSignal, plan.marketCondition].filter(Boolean).join(":");

  return {
    action: plan.action ?? fallback.action,
    ema20: plan.ema20 ?? null,
    ema50: plan.ema50 ?? null,
    rsiRegime: getRsiRegime(plan.rsi ?? null),
    macdDirection: getDirection(plan.macdHistogram ?? null),
    support: plan.support ?? null,
    resistance: plan.resistance ?? null,
    volatility: plan.volatility ?? null,
    volumeSpike: plan.volumeSpike ?? null,
    signal: signal || plan.action || fallback.action,
    lastClose,
    atr: parseRiskNumber(plan.atr ?? fallback.atr),
  };
}

function deriveSetupAction(plan: TradeSetupPlanInput, fallbackAction: RiskAction): RiskAction {
  if (plan.trend === "Bullish") {
    return "Long";
  }

  if (plan.trend === "Bearish") {
    return "Short";
  }

  if (plan.action === "Long" || plan.action === "Short") {
    return plan.action;
  }

  const signalText = `${plan.signal ?? ""} ${plan.scoringSignal ?? ""}`.toLowerCase();

  if (signalText.includes("buy") || plan.trend === "Bullish" || plan.marketCondition === "Bull") {
    return "Long";
  }

  if (signalText.includes("sell") || plan.trend === "Bearish" || plan.marketCondition === "Bear") {
    return "Short";
  }

  if (plan.ema20 !== null && plan.ema20 !== undefined && plan.ema50 !== null && plan.ema50 !== undefined) {
    if (plan.ema20 > plan.ema50 && (plan.macdHistogram === null || plan.macdHistogram === undefined || plan.macdHistogram >= 0)) {
      return "Long";
    }

    if (plan.ema20 < plan.ema50 && (plan.macdHistogram === null || plan.macdHistogram === undefined || plan.macdHistogram <= 0)) {
      return "Short";
    }
  }

  return fallbackAction === "Long" || fallbackAction === "Short" ? fallbackAction : "Wait";
}

function isValidPrice(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0;
}

function getNearestPrice(prices: number[], reference: number, direction: "below" | "above") {
  const candidates = prices.filter((price) => (direction === "below" ? price < reference : price > reference));

  if (candidates.length === 0) {
    return null;
  }

  return candidates.reduce((nearest, price) =>
    Math.abs(price - reference) < Math.abs(nearest - reference) ? price : nearest
  );
}

function createLockedSetup(input: {
  action: RiskAction;
  lastClose: number;
  atr: number | null;
  ema20: number | null;
  support: number | null;
  resistance: number | null;
}) {
  const atr = input.atr !== null && input.atr > 0 ? input.atr : input.lastClose * 0.012;
  const riskDistance = atr * 1.5;
  const retestLevels = [input.ema20, input.support, input.resistance].filter(isValidPrice);

  if (input.action === "Long") {
    const entry = getNearestPrice(retestLevels, input.lastClose, "below") ?? input.lastClose - atr * 0.5;
    const structureStop = input.support !== null && input.support < entry ? input.support - atr * 0.15 : entry - riskDistance;
    const atrStop = entry - riskDistance;
    const stop = Math.min(structureStop, atrStop);
    const risk = Math.abs(entry - stop);
    const tp1 = entry + risk * MIN_RISK_REWARD;
    const tp2 = entry + risk * PREFERRED_RISK_REWARD;

    return { entry, stop, takeProfit: tp1, takeProfit2: tp2 };
  }

  if (input.action === "Short") {
    const entry = getNearestPrice(retestLevels, input.lastClose, "above") ?? input.lastClose + atr * 0.5;
    const structureStop = input.resistance !== null && input.resistance > entry ? input.resistance + atr * 0.15 : entry + riskDistance;
    const atrStop = entry + riskDistance;
    const stop = Math.max(structureStop, atrStop);
    const risk = Math.abs(entry - stop);
    const tp1 = entry - risk * MIN_RISK_REWARD;
    const tp2 = entry - risk * PREFERRED_RISK_REWARD;

    return {
      entry,
      stop,
      takeProfit: tp1,
      takeProfit2: tp2,
    };
  }

  return { entry: input.lastClose, stop: null, takeProfit: null, takeProfit2: null };
}

function emptyResult(errors: string[], direction: RiskAction): RiskResult {
  return {
    positionSize: 0,
    maxLossAmount: 0,
    riskAmount: 0,
    rewardAmount: 0,
    riskRewardRatio: 0,
    suggestedRiskReward: PREFERRED_RISK_REWARD,
    potentialProfit: 0,
    riskPerUnit: 0,
    rewardPerUnit: 0,
    tradeQuality: 0,
    entryQuality: 0,
    tradeScore: 0,
    isRejected: true,
    warning: errors[0] ?? null,
    direction,
    errors,
  };
}

function inferDirection(entryPrice: number | null, stopLoss: number | null, takeProfit: number | null, action: RiskAction) {
  if (action !== "Wait") {
    return action;
  }

  if (entryPrice !== null && stopLoss !== null && takeProfit !== null) {
    if (stopLoss < entryPrice && takeProfit > entryPrice) {
      return "Long";
    }

    if (stopLoss > entryPrice && takeProfit < entryPrice) {
      return "Short";
    }
  }

  return "Wait";
}

export function createAtrTradePlan(input: {
  action: RiskAction;
  entry: number;
  atr: number | null;
  riskReward?: number;
}) {
  const riskReward = Math.max(input.riskReward ?? PREFERRED_RISK_REWARD, MIN_RISK_REWARD);
  const atr = input.atr !== null && input.atr > 0 ? input.atr : input.entry * 0.012;
  const risk = atr * 1.5;

  if (input.action === "Long") {
    return {
      entry: input.entry,
      stop: input.entry - risk,
      takeProfit: input.entry + risk * riskReward,
      riskReward,
    };
  }

  if (input.action === "Short") {
    return {
      entry: input.entry,
      stop: input.entry + risk,
      takeProfit: input.entry - risk * riskReward,
      riskReward,
    };
  }

  return {
    entry: input.entry,
    stop: null,
    takeProfit: null,
    riskReward: null,
  };
}

export function calculateRisk(inputs: RiskInputs): RiskResult {
  const accountBalance = parseRiskNumber(inputs.accountBalance);
  const riskPercentage = parseRiskNumber(inputs.riskPercentage);
  const entryPrice = parseRiskNumber(inputs.entryPrice);
  const stopLoss = parseRiskNumber(inputs.stopLoss);
  const takeProfit = parseRiskNumber(inputs.takeProfit);
  const atr = parseRiskNumber(inputs.atr);
  const direction = inferDirection(entryPrice, stopLoss, takeProfit, inputs.action);
  const errors: string[] = [];

  if (accountBalance === null || accountBalance <= 0) {
    errors.push("Account balance must be greater than 0.");
  }

  if (riskPercentage === null || riskPercentage <= 0) {
    errors.push("Risk percentage must be greater than 0.");
  }

  if (riskPercentage !== null && riskPercentage > 10) {
    errors.push("Risk above 10% is dangerous.");
  }

  if (entryPrice === null || entryPrice <= 0) {
    errors.push("Entry price must be greater than 0.");
  }

  if (stopLoss === null || stopLoss <= 0) {
    errors.push("Stop loss must be greater than 0.");
  }

  if (takeProfit === null || takeProfit <= 0) {
    errors.push("Take profit must be greater than 0.");
  }

  if (entryPrice !== null && stopLoss !== null && entryPrice === stopLoss) {
    errors.push("Entry and stop loss cannot be the same.");
  }

  if (entryPrice !== null && stopLoss !== null && takeProfit !== null) {
    const isLongSetup = stopLoss < entryPrice && takeProfit > entryPrice;
    const isShortSetup = stopLoss > entryPrice && takeProfit < entryPrice;

    if (!isLongSetup && !isShortSetup) {
      errors.push("Stop loss and take profit must be on opposite sides of entry.");
    }
  }

  if (
    errors.length > 0 ||
    accountBalance === null ||
    riskPercentage === null ||
    entryPrice === null ||
    stopLoss === null ||
    takeProfit === null
  ) {
    return emptyResult(errors, direction);
  }

  const maxLossAmount = accountBalance * (riskPercentage / 100);
  const riskPerUnit = Math.abs(entryPrice - stopLoss);
  const rewardPerUnit = Math.abs(takeProfit - entryPrice);
  const positionSize = riskPerUnit > 0 ? maxLossAmount / riskPerUnit : 0;
  const potentialProfit = positionSize * rewardPerUnit;
  const riskRewardRatio = riskPerUnit > 0 ? rewardPerUnit / riskPerUnit : 0;
  const riskAmount = maxLossAmount;
  const rewardAmount = potentialProfit;
  const atrRisk = atr !== null && atr > 0 ? Math.abs(entryPrice - stopLoss) / atr : 1.5;
  const stopQuality = Math.max(0, 100 - Math.abs(atrRisk - 1.5) * 28);
  const ratioQuality = Math.min(riskRewardRatio / PREFERRED_RISK_REWARD, 1) * 100;
  const riskQuality = riskPercentage <= 1 ? 100 : riskPercentage <= 2 ? 82 : riskPercentage <= 5 ? 55 : 20;
  const entryQuality = Math.round(Math.max(0, Math.min(100, stopQuality * 0.55 + ratioQuality * 0.45)));
  const tradeQuality = Math.round(Math.max(0, Math.min(100, ratioQuality * 0.45 + entryQuality * 0.35 + riskQuality * 0.2)));
  const isRejected = riskRewardRatio < MIN_RISK_REWARD;
  const warning =
    riskRewardRatio < MIN_RISK_REWARD
      ? REJECTED_RISK_REASON
      : riskRewardRatio >= PREFERRED_RISK_REWARD
      ? null
      : "RR is acceptable, but 1:3+ is preferred.";

  return {
    positionSize,
    maxLossAmount,
    riskAmount,
    rewardAmount,
    riskRewardRatio,
    suggestedRiskReward: riskRewardRatio >= PREFERRED_RISK_REWARD ? riskRewardRatio : PREFERRED_RISK_REWARD,
    potentialProfit,
    riskPerUnit,
    rewardPerUnit,
    tradeQuality,
    entryQuality,
    tradeScore: Math.round((tradeQuality + entryQuality + Math.min(riskRewardRatio / PREFERRED_RISK_REWARD, 1) * 100) / 3),
    isRejected,
    warning,
    direction,
    errors,
  };
}

export const useRiskStore = create<RiskState>((set) => ({
  ...DEFAULT_INPUTS,
  ...DEFAULT_LOCK_STATE,
  updateInput: (field, value) => {
    set((state) =>
      state[field] === value
        ? state
        : ({
            [field]: value,
            targetLocked: false,
            targetLockReason: "",
            recomputeReason: null,
            confidence: null,
            targetContext: null,
          } as Pick<RiskState, keyof RiskInputs | "targetLocked" | "targetLockReason" | "recomputeReason" | "confidence" | "targetContext">)
    );
  },
  applyTradePlan: (plan) => {
    set((state) => {
      const action = deriveSetupAction(plan, plan.action ?? state.action);
      const confidence = plan.confidence ?? null;
      const lastClose = plan.lastClose ?? parseRiskNumber(plan.entryPrice ?? state.entryPrice) ?? null;
      const hasClearTrend = plan.trend === "Bullish" || plan.trend === "Bearish";
      const directEntry = parseRiskNumber(plan.entryPrice ?? "");
      const directStop = parseRiskNumber(plan.stopLoss ?? "");
      const hasStructureContext =
        plan.ema20 !== undefined ||
        plan.ema50 !== undefined ||
        plan.rsi !== undefined ||
        plan.macdHistogram !== undefined ||
        plan.support !== undefined ||
        plan.resistance !== undefined ||
        plan.volatility !== undefined ||
        plan.signal !== undefined;
      const hasDirectLockedPlan =
        !hasStructureContext &&
        (action === "Long" || action === "Short") &&
        directEntry !== null &&
        directStop !== null;

      const invalidReason =
        hasDirectLockedPlan
          ? null
          : confidence !== null && confidence < MIN_SETUP_CONFIDENCE
          ? "NO TRADE"
          : !hasClearTrend || action === "Wait"
          ? "NO TRADE"
          : lastClose === null || lastClose <= 0
          ? "NO TRADE"
          : !hasStructureContext
          ? "NO TRADE"
          : null;

      if (invalidReason !== null) {

        const nextState = {
          ...state,
          ...plan,
          action,
          confidence,
          entryPrice: "",
          stopLoss: "",
          takeProfit: "",
          takeProfit2: "",
          targetLocked: false,
          targetLockReason:
            confidence !== null && confidence < MIN_SETUP_CONFIDENCE
              ? "NO TRADE: confidence below 55"
              : "NO TRADE: trend unclear",
          recomputeReason: null,
          targetContext: null,
        };

        const unchanged =
          state.action === nextState.action &&
          state.entryPrice === nextState.entryPrice &&
          state.stopLoss === nextState.stopLoss &&
          state.takeProfit === nextState.takeProfit &&
          state.takeProfit2 === nextState.takeProfit2 &&
          state.targetLocked === nextState.targetLocked;

        return unchanged ? state : nextState;
      }

      if (hasDirectLockedPlan) {
        const risk = Math.abs(directEntry - directStop);

        if (risk <= 0) {

          const nextState = {
            ...state,
            ...plan,
          action,
          confidence,
          entryPrice: "",
            stopLoss: "",
            takeProfit: "",
            takeProfit2: "",
            targetLocked: false,
            targetLockReason: REJECTED_RISK_REASON,
            recomputeReason: null,
            targetContext: null,
          };

          const unchanged =
            state.action === nextState.action &&
            state.entryPrice === nextState.entryPrice &&
            state.stopLoss === nextState.stopLoss &&
            state.takeProfit === nextState.takeProfit &&
            state.takeProfit2 === nextState.takeProfit2 &&
            state.targetLocked === nextState.targetLocked &&
            state.targetLockReason === nextState.targetLockReason;

          return unchanged ? state : nextState;
        }

        const directTakeProfit = action === "Long" ? directEntry + risk * MIN_RISK_REWARD : directEntry - risk * MIN_RISK_REWARD;
        const directTakeProfit2 = action === "Long" ? directEntry + risk * PREFERRED_RISK_REWARD : directEntry - risk * PREFERRED_RISK_REWARD;
        const nextState = {
          ...state,
          ...plan,
          action,
          confidence,
          entryPrice: formatRiskInput(directEntry),
          stopLoss: formatRiskInput(directStop),
          takeProfit: formatRiskInput(directTakeProfit),
          takeProfit2: formatRiskInput(directTakeProfit2),
          targetLocked: true,
          targetLockReason: `${action === "Long" ? "Bullish" : "Bearish"} structure intact`,
          recomputeReason: "Initial target generated",
          targetContext: null,
        };

        const unchanged =
          state.action === nextState.action &&
          state.entryPrice === nextState.entryPrice &&
          state.stopLoss === nextState.stopLoss &&
          state.takeProfit === nextState.takeProfit &&
          state.takeProfit2 === nextState.takeProfit2 &&
          state.targetLocked === nextState.targetLocked &&
          state.targetLockReason === nextState.targetLockReason;

        return unchanged ? state : nextState;
      }

      if (action === "Long" || action === "Short") {
        const context = createTargetContext({ ...plan, action }, state);
        const trigger = recomputeTrigger(state.targetLocked ? state.targetContext : null, context);

        if (state.targetLocked && trigger === null) {
          return state;
        }

        if (lastClose === null) {
          return state;
        }

        const targets = createLockedSetup({
          action,
          lastClose,
          atr: context.atr,
          ema20: context.ema20,
          support: context.support,
          resistance: context.resistance,
        });
        const risk = targets.stop === null ? 0 : Math.abs(targets.entry - targets.stop);
        const reward = targets.takeProfit === null ? 0 : Math.abs(targets.takeProfit - targets.entry);
        const riskReward = risk > 0 && reward > 0 ? reward / risk : null;

        if (riskReward === null || riskReward < MIN_PUBLISH_RISK_REWARD) {

          const nextState = {
            ...state,
            action,
            confidence,
            entryPrice: "",
            stopLoss: "",
            takeProfit: "",
            takeProfit2: "",
            atr: plan.atr ?? state.atr,
            targetLocked: false,
            targetLockReason: REJECTED_RISK_REASON,
            recomputeReason: trigger,
            targetContext: context,
          };

          const unchanged =
            state.action === nextState.action &&
            state.entryPrice === nextState.entryPrice &&
            state.stopLoss === nextState.stopLoss &&
            state.takeProfit === nextState.takeProfit &&
            state.takeProfit2 === nextState.takeProfit2 &&
            state.atr === nextState.atr &&
            state.targetLocked === nextState.targetLocked &&
            state.targetLockReason === nextState.targetLockReason &&
            state.recomputeReason === nextState.recomputeReason;

          return unchanged ? state : nextState;
        }

        const nextState = {
          ...state,
          action,
          confidence,
          entryPrice: formatRiskInput(targets.entry),
          stopLoss: formatRiskInput(targets.stop),
          takeProfit: formatRiskInput(targets.takeProfit),
          takeProfit2: formatRiskInput(targets.takeProfit2),
          atr: plan.atr ?? state.atr,
          targetLocked: true,
          targetLockReason: `${action === "Long" ? "Bullish" : "Bearish"} structure intact`,
          recomputeReason: trigger,
          targetContext: context,
        };

        const unchanged =
          state.action === nextState.action &&
          state.entryPrice === nextState.entryPrice &&
          state.stopLoss === nextState.stopLoss &&
          state.takeProfit === nextState.takeProfit &&
          state.takeProfit2 === nextState.takeProfit2 &&
          state.atr === nextState.atr &&
          state.targetLocked === nextState.targetLocked &&
          state.targetLockReason === nextState.targetLockReason &&
          state.recomputeReason === nextState.recomputeReason;

        return unchanged ? state : nextState;
      }

      const nextState = {
        ...state,
        ...plan,
      };

      const unchanged = Object.keys(plan).every((key) => {
        const field = key as keyof RiskInputs;
        return state[field] === nextState[field];
      });

      return unchanged ? state : nextState;
    });
  },
  reset: () => set({ ...DEFAULT_INPUTS, ...DEFAULT_LOCK_STATE }),
}));
