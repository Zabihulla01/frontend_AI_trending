"use client";

import { useAnalysisStore } from "@/store/useAnalysisStore";
import { useIndicatorStore } from "@/store/useIndicatorStore";

function formatPrice(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "--";
  }

  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

export default function MarketScenarios() {
  const snapshot = useIndicatorStore((state) => state.snapshot);
  const results = useAnalysisStore((state) => state.results);
  const analysis = results["1h"] ?? Object.values(results).find((result) => result !== undefined);

  const currentPrice = analysis?.lastClose ?? null;
  const support = analysis?.support ?? snapshot?.support ?? null;
  const resistance = analysis?.resistance ?? snapshot?.resistance ?? null;
  const condition = analysis?.marketCondition ?? "Awaiting analysis";
  const action = analysis?.action ?? "Waiting";
  const bullishPlan = analysis?.action === "Long";
  const bearishPlan = analysis?.action === "Short";

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center justify-between rounded-md border border-slate-800 bg-[#071022] px-2 py-1.5">
        <span className="uppercase tracking-[0.14em] text-slate-500">Market context</span>
        <span className="font-semibold text-amber-300">{condition}</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Metric label="Current" value={formatPrice(currentPrice)} />
        <Metric label="Support" value={formatPrice(support)} tone="text-emerald-300" />
        <Metric label="Resistance" value={formatPrice(resistance)} tone="text-red-300" />
      </div>

      <div className="grid gap-1.5 sm:grid-cols-3">
        <Scenario
          label="Bullish scenario"
          tone="border-emerald-500/30 text-emerald-200"
          rows={[
            ["Trigger", `Close above ${formatPrice(resistance)}`],
            ["Target", bullishPlan ? formatPrice(analysis?.takeProfit) : "--"],
            ["Invalidation", bullishPlan ? formatPrice(analysis?.stop) : "--"],
          ]}
        />
        <Scenario
          label="Bearish scenario"
          tone="border-red-500/30 text-red-200"
          rows={[
            ["Trigger", `Close below ${formatPrice(support)}`],
            ["Target", bearishPlan ? formatPrice(analysis?.takeProfit) : "--"],
            ["Invalidation", bearishPlan ? formatPrice(analysis?.stop) : "--"],
          ]}
        />
        <Scenario
          label="No-trade zone"
          tone="border-amber-500/30 text-amber-200"
          rows={[
            ["Range", `${formatPrice(support)} – ${formatPrice(resistance)}`],
            ["Action", action],
            ["Reason", "Wait for confirmation"],
          ]}
        />
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "text-white" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-md border border-slate-800 bg-[#071022] px-2 py-1.5">
      <p className="truncate text-[10px] uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className={`mt-0.5 truncate font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

function Scenario({ label, rows, tone }: { label: string; rows: Array<[string, string]>; tone: string }) {
  return (
    <div className={`rounded-md border bg-[#071022] px-2 py-1.5 ${tone}`}>
      <p className="truncate text-[10px] uppercase tracking-[0.1em] text-slate-500">{label}</p>
      <div className="mt-1 space-y-0.5">
        {rows.map(([rowLabel, value]) => (
          <p key={rowLabel} className="flex justify-between gap-2 text-[10px]">
            <span className="text-slate-500">{rowLabel}</span>
            <span className="truncate text-right font-medium">{value}</span>
          </p>
        ))}
      </div>
    </div>
  );
}
