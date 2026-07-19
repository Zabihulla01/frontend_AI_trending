"use client";

import { useAnalysisStore } from "@/store/useAnalysisStore";

function getTone(value: string) {
  if (value === "Bull" || value === "Bullish" || value.includes("Buy") || value === "Long") {
    return "text-emerald-400";
  }

  if (value === "Bear" || value === "Bearish" || value.includes("Sell") || value === "Short") {
    return "text-red-400";
  }

  return "text-amber-300";
}

export function MarketSummary() {
  const results = useAnalysisStore((state) => state.results);
  const analysis = Object.values(results).find((result) => result !== undefined);

  return (
    <section className="grid gap-3 rounded-lg border border-slate-800 bg-slate-950/90 p-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Market</p>
      <div className="grid gap-1.5 [grid-template-columns:repeat(2,minmax(0,1fr))]">
        <Metric label="Condition" value={analysis?.marketCondition ?? "--"} />
        <Metric label="Trend" value={analysis?.marketTrend ?? "--"} />
        <Metric label="Volatility" value={analysis?.volatilityState ?? "--"} />
        <Metric label="Health" value={analysis ? `${analysis.marketHealth}%` : "--"} />
      </div>
    </section>
  );
}

export function SignalSummary() {
  const results = useAnalysisStore((state) => state.results);
  const analysis = Object.values(results).find((result) => result !== undefined);

  return (
    <section className="grid gap-3 rounded-lg border border-slate-800 bg-slate-950/90 p-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Signals</p>
      <div className="rounded-md border border-slate-800 bg-[#071022] px-3 py-2">
        <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Current action</p>
        <p className={`mt-1 text-sm font-semibold ${getTone(analysis?.action ?? "Wait")}`}>
          {analysis?.action ?? "Waiting"}
        </p>
      </div>
      <div className="grid gap-1.5 [grid-template-columns:repeat(2,minmax(0,1fr))]">
        <Metric label="Signal" value={analysis?.signal ?? "--"} tone={analysis ? getTone(analysis.signal) : undefined} />
        <Metric label="Confidence" value={analysis ? `${analysis.confidence}%` : "--"} />
        <Metric label="Probability" value={analysis ? `${analysis.probability}%` : "--"} />
        <Metric label="Risk" value={analysis?.risk ?? "--"} />
      </div>
    </section>
  );
}

function Metric({ label, value, tone = "text-white" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-md border border-slate-800 bg-[#071022] px-2 py-2">
      <p className="truncate text-[10px] uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className={`mt-0.5 truncate text-xs font-semibold ${tone}`}>{value}</p>
    </div>
  );
}
