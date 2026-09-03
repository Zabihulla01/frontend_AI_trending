"use client";

import { createAdaptiveScenario } from "@/services/marketScenario";
import { useAnalysisStore } from "@/store/useAnalysisStore";
import { useMarketStore } from "@/store/useMarketStore";

function formatPrice(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";

  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

export default function MarketScenarios() {
  const results = useAnalysisStore((state) => state.results);
  const status = useAnalysisStore((state) => state.status);
  const analysisSymbol = useAnalysisStore((state) => state.symbol);
  const analysisInterval = useAnalysisStore((state) => state.interval);
  const symbol = useMarketStore((state) => state.symbol);
  const interval = useMarketStore((state) => state.interval);
  const analysis = status === "ready" && analysisSymbol === symbol && analysisInterval === interval ? results[interval] : undefined;
  const currentPrice = analysis?.lastClose ?? null;
  const support = analysis?.support ?? null;
  const resistance = analysis?.resistance ?? null;
  const rangeWidth = support !== null && resistance !== null ? resistance - support : null;
  const rangePosition = currentPrice !== null && support !== null && resistance !== null && resistance > support
    ? Math.min(100, Math.max(0, ((currentPrice - support) / (resistance - support)) * 100))
    : null;
  const scenario = createAdaptiveScenario({
    action: analysis?.action ?? "Wait",
    marketCondition: analysis?.marketCondition ?? "Sideways",
    confidence: analysis?.confidence ?? 0,
    currentPrice,
    support,
    resistance,
    atr: analysis?.atr ?? null,
    setupChecks: analysis?.setupChecks,
  });
  const stateClasses =
    scenario.stateTone === "emerald"
      ? "border-emerald-400/25 bg-emerald-400/5 text-emerald-300"
      : scenario.stateTone === "red"
      ? "border-red-400/25 bg-red-400/5 text-red-300"
      : "border-amber-400/25 bg-amber-400/5 text-amber-300";

  return (
    <div className="space-y-3 text-xs">
      <div className="rounded-lg border border-slate-800 bg-[linear-gradient(135deg,rgba(9,22,43,.95),rgba(4,10,24,.95))] p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="uppercase tracking-[0.16em] text-slate-500">Adaptive market state</p>
            <p className="mt-1 text-sm font-semibold text-white">{analysis?.marketCondition ?? "Awaiting analysis"}</p>
          </div>
          <span className={`rounded-md border px-2 py-1 font-semibold ${stateClasses}`}>{scenario.stateLabel}</span>
        </div>
        <div className="relative mt-3 h-1.5 rounded-full bg-gradient-to-r from-emerald-400 via-sky-400 to-red-400">
          {rangePosition !== null ? <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-slate-950 shadow" style={{ left: `${rangePosition}%` }} aria-label={`Price is ${rangePosition.toFixed(0)}% through the range`} /> : null}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-slate-500">
          <span>Support zone</span>
          <span>{rangeWidth !== null ? `Range width ${formatPrice(rangeWidth)}` : "Range width --"}</span>
          <span>Resistance zone</span>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Metric label="Current price" value={formatPrice(currentPrice)} detail={rangePosition !== null ? `${rangePosition.toFixed(0)}% through range` : "Awaiting current timeframe"} />
        <Metric label="Support" value={formatPrice(support)} detail="Nearest swing demand" tone="text-emerald-300" />
        <Metric label="Resistance" value={formatPrice(resistance)} detail="Nearest swing supply" tone="text-red-300" />
      </div>

      <div className="grid gap-1.5 sm:grid-cols-3">
        <Scenario label="Bullish scenario" caption="Illustrative breakout plan" tone="border-emerald-500/30 text-emerald-200" rows={[["Trigger", `Close above ${formatPrice(scenario.bullish.entry)}`], ["Target", formatPrice(scenario.bullish.target)], ["Invalidation", formatPrice(scenario.bullish.stop)]]} />
        <Scenario label="Bearish scenario" caption="Illustrative breakdown plan" tone="border-red-500/30 text-red-200" rows={[["Trigger", `Close below ${formatPrice(scenario.bearish.entry)}`], ["Target", formatPrice(scenario.bearish.target)], ["Invalidation", formatPrice(scenario.bearish.stop)]]} />
        <Scenario label="Current state" caption="Completed-candle confirmation" tone="border-amber-500/30 text-amber-200" rows={[["Action", analysis?.action ?? "Waiting"], ["Confidence", analysis ? `${analysis.confidence}%` : "--"], ["Reason", scenario.reason]]} />
      </div>
    </div>
  );
}

function Metric({ label, value, detail, tone = "text-white" }: { label: string; value: string; detail: string; tone?: string }) {
  return <div className="min-w-0 rounded-md border border-slate-800 bg-[#071022] px-2.5 py-2"><p className="truncate text-[10px] uppercase tracking-[0.12em] text-slate-500">{label}</p><p className={`mt-1 truncate text-sm font-semibold ${tone}`}>{value}</p><p className="mt-1 truncate text-[10px] text-slate-600">{detail}</p></div>;
}

function Scenario({ label, caption, rows, tone }: { label: string; caption: string; rows: Array<[string, string]>; tone: string }) {
  return <div className={`rounded-md border bg-[#071022] px-2.5 py-2 ${tone}`}><div className="flex items-start justify-between gap-2"><p className="truncate text-[10px] uppercase tracking-[0.1em] text-slate-500">{label}</p><span className="shrink-0 text-[10px] text-slate-600">{caption}</span></div><div className="mt-2 space-y-1">{rows.map(([rowLabel, value]) => <p key={rowLabel} className="flex min-h-4 items-center justify-between gap-2 text-[10px]"><span className="text-slate-500">{rowLabel}</span><span className="max-w-[65%] truncate text-right font-medium" title={value}>{value}</span></p>)}</div></div>;
}
