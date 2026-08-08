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
  const rangeWidth = support !== null && resistance !== null ? resistance - support : null;
  const rangePosition = currentPrice !== null && support !== null && resistance !== null && resistance > support
    ? Math.min(100, Math.max(0, ((currentPrice - support) / (resistance - support)) * 100))
    : null;

  return (
    <div className="space-y-3 text-xs">
      <div className="rounded-lg border border-slate-800 bg-[linear-gradient(135deg,rgba(9,22,43,.95),rgba(4,10,24,.95))] p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="uppercase tracking-[0.16em] text-slate-500">Market context</p>
            <p className="mt-1 text-sm font-semibold text-white">{condition}</p>
          </div>
          <span className="rounded-md border border-amber-400/25 bg-amber-400/5 px-2 py-1 font-semibold text-amber-300">Wait for confirmation</span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-sky-400 to-red-400" style={{ width: `${rangePosition ?? 50}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-slate-500">
          <span>Support zone</span>
          <span>{rangeWidth !== null ? `Range width ${formatPrice(rangeWidth)}` : "Range width --"}</span>
          <span>Resistance zone</span>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Metric label="Current price" value={formatPrice(currentPrice)} detail={rangePosition !== null ? `${rangePosition.toFixed(0)}% through range` : "Awaiting position"} />
        <Metric label="Support" value={formatPrice(support)} detail="Demand / invalidation" tone="text-emerald-300" />
        <Metric label="Resistance" value={formatPrice(resistance)} detail="Supply / breakout trigger" tone="text-red-300" />
      </div>

      <div className="grid gap-1.5 sm:grid-cols-3">
        <Scenario
          label="Bullish scenario"
          caption="Breakout acceptance"
          tone="border-emerald-500/30 text-emerald-200"
          rows={[
            ["Trigger", `Close above ${formatPrice(resistance)}`],
            ["Target", bullishPlan ? formatPrice(analysis?.takeProfit) : "--"],
            ["Invalidation", bullishPlan ? formatPrice(analysis?.stop) : "--"],
          ]}
        />
        <Scenario
          label="Bearish scenario"
          caption="Breakdown acceptance"
          tone="border-red-500/30 text-red-200"
          rows={[
            ["Trigger", `Close below ${formatPrice(support)}`],
            ["Target", bearishPlan ? formatPrice(analysis?.takeProfit) : "--"],
            ["Invalidation", bearishPlan ? formatPrice(analysis?.stop) : "--"],
          ]}
        />
        <Scenario
          label="No-trade zone"
          caption="Capital preservation"
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

function Metric({ label, value, detail, tone = "text-white" }: { label: string; value: string; detail: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-md border border-slate-800 bg-[#071022] px-2.5 py-2">
      <p className="truncate text-[10px] uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className={`mt-1 truncate text-sm font-semibold ${tone}`}>{value}</p>
      <p className="mt-1 truncate text-[10px] text-slate-600">{detail}</p>
    </div>
  );
}

function Scenario({ label, caption, rows, tone }: { label: string; caption: string; rows: Array<[string, string]>; tone: string }) {
  return (
    <div className={`rounded-md border bg-[#071022] px-2.5 py-2 ${tone}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-[10px] uppercase tracking-[0.1em] text-slate-500">{label}</p>
        <span className="shrink-0 text-[10px] text-slate-600">{caption}</span>
      </div>
      <div className="mt-2 space-y-1">
        {rows.map(([rowLabel, value]) => (
          <p key={rowLabel} className="flex min-h-4 items-center justify-between gap-2 text-[10px]">
            <span className="text-slate-500">{rowLabel}</span>
            <span className="truncate text-right font-medium">{value}</span>
          </p>
        ))}
      </div>
    </div>
  );
}
