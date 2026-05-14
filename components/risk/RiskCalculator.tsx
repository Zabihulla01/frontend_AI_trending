"use client";

import { useMemo, useState } from "react";
import {
  calculateRisk,
  type RiskInputs,
  useRiskStore,
} from "@/store/useRiskStore";

const INPUTS: Array<{
  field: keyof RiskInputs;
  label: string;
  placeholder: string;
  suffix?: string;
}> = [
  {
    field: "accountBalance",
    label: "Account balance",
    placeholder: "10000",
  },
  {
    field: "riskPercentage",
    label: "Risk percentage",
    placeholder: "1",
    suffix: "%",
  },
  {
    field: "entryPrice",
    label: "Entry price",
    placeholder: "65000",
  },
  {
    field: "stopLoss",
    label: "Stop loss",
    placeholder: "64000",
  },
  {
    field: "takeProfit",
    label: "Take profit",
    placeholder: "68000",
  },
];

function formatNumber(value: number, maximumFractionDigits = 4) {
  if (!Number.isFinite(value) || value === 0) {
    return "--";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(value);
}

function formatCurrency(value: number) {
  if (!Number.isFinite(value) || value === 0) {
    return "--";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function getRiskTone(riskPercentage: string) {
  const risk = Number(riskPercentage.replace(/,/g, ""));

  if (!Number.isFinite(risk) || risk <= 0) {
    return "border-slate-800 bg-[#020617] text-slate-300";
  }

  if (risk > 5) {
    return "border-red-400/40 bg-red-500/10 text-red-200";
  }

  if (risk > 2) {
    return "border-amber-300/40 bg-amber-300/10 text-amber-100";
  }

  return "border-emerald-400/40 bg-emerald-400/10 text-emerald-200";
}

function getRatioTone(ratio: number) {
  if (ratio >= 2) {
    return "border-emerald-400/40 bg-emerald-400/10 text-emerald-200";
  }

  if (ratio >= 1) {
    return "border-amber-300/40 bg-amber-300/10 text-amber-100";
  }

  return "border-red-400/40 bg-red-500/10 text-red-200";
}

export default function RiskCalculator() {
  const accountBalance = useRiskStore((state) => state.accountBalance);
  const riskPercentage = useRiskStore((state) => state.riskPercentage);
  const entryPrice = useRiskStore((state) => state.entryPrice);
  const stopLoss = useRiskStore((state) => state.stopLoss);
  const takeProfit = useRiskStore((state) => state.takeProfit);
  const updateInput = useRiskStore((state) => state.updateInput);
  const reset = useRiskStore((state) => state.reset);
  const [touched, setTouched] = useState<Record<keyof RiskInputs, boolean>>({
    accountBalance: false,
    riskPercentage: false,
    entryPrice: false,
    stopLoss: false,
    takeProfit: false,
  });

  function parseNumber(value: string) {
    const normalized = value.replace(/,/g, "").trim();
    if (!normalized) {
      return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const inputs = useMemo(
    () => ({
      accountBalance,
      riskPercentage,
      entryPrice,
      stopLoss,
      takeProfit,
    }),
    [accountBalance, entryPrice, riskPercentage, stopLoss, takeProfit]
  );
  const result = useMemo(() => calculateRisk(inputs), [inputs]);
  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    const parsedAccountBalance = parseNumber(accountBalance);
    const parsedRiskPercentage = parseNumber(riskPercentage);
    const parsedEntryPrice = parseNumber(entryPrice);
    const parsedStopLoss = parseNumber(stopLoss);
    const parsedTakeProfit = parseNumber(takeProfit);

    if (touched.accountBalance && (parsedAccountBalance === null || parsedAccountBalance <= 0)) {
      errors.push("Account balance must be greater than 0.");
    }

    if (touched.riskPercentage && (parsedRiskPercentage === null || parsedRiskPercentage <= 0)) {
      errors.push("Risk percentage must be greater than 0.");
    }

    if (touched.riskPercentage && parsedRiskPercentage !== null && parsedRiskPercentage > 10) {
      errors.push("Risk above 10% is dangerous.");
    }

    if (touched.entryPrice && (parsedEntryPrice === null || parsedEntryPrice <= 0)) {
      errors.push("Entry price must be greater than 0.");
    }

    if (touched.stopLoss && (parsedStopLoss === null || parsedStopLoss <= 0)) {
      errors.push("Stop loss must be greater than 0.");
    }

    if (touched.takeProfit && (parsedTakeProfit === null || parsedTakeProfit <= 0)) {
      errors.push("Take profit must be greater than 0.");
    }

    if (
      touched.entryPrice &&
      touched.stopLoss &&
      parsedEntryPrice !== null &&
      parsedStopLoss !== null &&
      parsedEntryPrice === parsedStopLoss
    ) {
      errors.push("Entry and stop loss cannot be the same.");
    }

    if (
      touched.entryPrice &&
      touched.stopLoss &&
      touched.takeProfit &&
      parsedEntryPrice !== null &&
      parsedStopLoss !== null &&
      parsedTakeProfit !== null
    ) {
      const isLongSetup = parsedStopLoss < parsedEntryPrice && parsedTakeProfit > parsedEntryPrice;
      const isShortSetup = parsedStopLoss > parsedEntryPrice && parsedTakeProfit < parsedEntryPrice;

      if (!isLongSetup && !isShortSetup) {
        errors.push("Stop loss and take profit must be on opposite sides of entry.");
      }
    }

    return errors;
  }, [accountBalance, entryPrice, riskPercentage, stopLoss, takeProfit, touched]);
  const hasErrors = validationErrors.length > 0;

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-950/95 p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Risk</p>
          <h2 className="mt-1 text-xl font-semibold text-white">Position calculator</h2>
          <p className="mt-1 text-sm text-slate-400">Size trades from fixed account risk.</p>
        </div>
        <div className={`rounded-lg border px-3 py-2 text-right ${getRiskTone(riskPercentage)}`}>
          <p className="text-[11px] uppercase tracking-[0.18em] opacity-75">Risk</p>
          <p className="text-sm font-semibold">{riskPercentage || "--"}%</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        {INPUTS.map((input) => {
          const value = inputs[input.field];

          return (
            <label key={input.field} className="grid gap-2 text-sm">
              <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                {input.label}
              </span>
              <span className="relative">
                <input
                  value={value}
                  onChange={(event) => {
                    updateInput(input.field, event.target.value);
                    setTouched((previous) => ({
                      ...previous,
                      [input.field]: true,
                    }));
                  }}
                  inputMode="decimal"
                  placeholder={input.placeholder}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20"
                />
                {input.suffix ? (
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-slate-500">
                    {input.suffix}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>

      {hasErrors ? (
        <div className="mt-4 rounded-lg border border-red-400/30 bg-red-950/50 px-3 py-3">
          {validationErrors.map((error) => (
            <p key={error} className="text-xs text-red-200">
              {error}
            </p>
          ))}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-800 bg-[#020617] px-3 py-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Position size</p>
          <p className="mt-1 text-lg font-semibold text-white">
            {formatNumber(result.positionSize)}
          </p>
        </div>
        <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-3 text-red-100">
          <p className="text-[11px] uppercase tracking-[0.18em] opacity-75">Max loss</p>
          <p className="mt-1 text-lg font-semibold">{formatCurrency(result.maxLossAmount)}</p>
        </div>
        <div className={`rounded-lg border px-3 py-3 ${getRatioTone(result.riskRewardRatio)}`}>
          <p className="text-[11px] uppercase tracking-[0.18em] opacity-75">Risk reward</p>
          <p className="mt-1 text-lg font-semibold">
            {result.riskRewardRatio > 0 ? `1:${formatNumber(result.riskRewardRatio, 2)}` : "--"}
          </p>
        </div>
        <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-3 text-emerald-100">
          <p className="text-[11px] uppercase tracking-[0.18em] opacity-75">Potential profit</p>
          <p className="mt-1 text-lg font-semibold">{formatCurrency(result.potentialProfit)}</p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-400 sm:grid-cols-2">
        <div className="flex items-center justify-between gap-3">
          <span>Risk per unit</span>
          <span className="font-semibold text-slate-200">{formatNumber(result.riskPerUnit)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Reward per unit</span>
          <span className="font-semibold text-slate-200">{formatNumber(result.rewardPerUnit)}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={reset}
        className="mt-4 w-full rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-slate-500/30"
      >
        Reset calculator
      </button>
    </section>
  );
}
