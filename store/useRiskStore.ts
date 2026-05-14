import { create } from "zustand";

export interface RiskInputs {
  accountBalance: string;
  riskPercentage: string;
  entryPrice: string;
  stopLoss: string;
  takeProfit: string;
}

export interface RiskResult {
  positionSize: number;
  maxLossAmount: number;
  riskRewardRatio: number;
  potentialProfit: number;
  riskPerUnit: number;
  rewardPerUnit: number;
  errors: string[];
}

interface RiskState extends RiskInputs {
  updateInput: (field: keyof RiskInputs, value: string) => void;
  reset: () => void;
}

const DEFAULT_INPUTS: RiskInputs = {
  accountBalance: "10000",
  riskPercentage: "1",
  entryPrice: "",
  stopLoss: "",
  takeProfit: "",
};

function parsePositiveNumber(value: string) {
  const normalizedValue = value.replace(/,/g, "").trim();

  if (!normalizedValue) {
    return null;
  }

  const parsedValue = Number(normalizedValue);

  return Number.isFinite(parsedValue) ? parsedValue : null;
}

export function calculateRisk(inputs: RiskInputs): RiskResult {
  const accountBalance = parsePositiveNumber(inputs.accountBalance);
  const riskPercentage = parsePositiveNumber(inputs.riskPercentage);
  const entryPrice = parsePositiveNumber(inputs.entryPrice);
  const stopLoss = parsePositiveNumber(inputs.stopLoss);
  const takeProfit = parsePositiveNumber(inputs.takeProfit);
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
    return {
      positionSize: 0,
      maxLossAmount: 0,
      riskRewardRatio: 0,
      potentialProfit: 0,
      riskPerUnit: 0,
      rewardPerUnit: 0,
      errors,
    };
  }

  const maxLossAmount = accountBalance * (riskPercentage / 100);
  const riskPerUnit = Math.abs(entryPrice - stopLoss);
  const rewardPerUnit = Math.abs(takeProfit - entryPrice);
  const positionSize = riskPerUnit > 0 ? maxLossAmount / riskPerUnit : 0;
  const potentialProfit = positionSize * rewardPerUnit;
  const riskRewardRatio = riskPerUnit > 0 ? rewardPerUnit / riskPerUnit : 0;

  return {
    positionSize,
    maxLossAmount,
    riskRewardRatio,
    potentialProfit,
    riskPerUnit,
    rewardPerUnit,
    errors,
  };
}

export const useRiskStore = create<RiskState>((set) => ({
  ...DEFAULT_INPUTS,
  updateInput: (field, value) => {
    set({ [field]: value } as Pick<RiskState, keyof RiskInputs>);
  },
  reset: () => set(DEFAULT_INPUTS),
}));
