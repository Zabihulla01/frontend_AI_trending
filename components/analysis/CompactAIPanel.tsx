"use client";

import { useAnalysisStore } from "@/store/useAnalysisStore";
import { useMarketStore } from "@/store/useMarketStore";
import { useRiskStore } from "@/store/useRiskStore";

function signalTone(signal: string) {
  if (signal.includes("Buy") || signal === "Bullish" || signal === "Bull") return "text-emerald-400";
  if (signal.includes("Sell") || signal === "Bearish" || signal === "Bear") return "text-red-400";
  return "text-amber-300";
}

function actionTone(action: string) {
  if (action === "Long") return "border-emerald-500/35 bg-emerald-500/10 text-emerald-300";
  if (action === "Short") return "border-red-500/35 bg-red-500/10 text-red-300";
  return "border-amber-400/30 bg-amber-400/10 text-amber-300";
}

function displayActionText(action: string, suggestedAction: string) {
  if (action === "Wait") {
    return suggestedAction.toUpperCase().startsWith("WAIT:") ? suggestedAction : `WAIT: ${suggestedAction}`;
  }

  return suggestedAction;
}

export const CompactAIPanel = () => {
  const results = useAnalysisStore((state) => state.results);
  const interval = useMarketStore((state) => state.interval);
  const status = useAnalysisStore((state) => state.status);
  const targetLocked = useRiskStore((state) => state.targetLocked);
  const targetLockReason = useRiskStore((state) => state.targetLockReason);
  const recalculateMode = useRiskStore((state) => state.recalculateMode);
  const entryPrice = useRiskStore((state) => state.entryPrice);
  const stopLoss = useRiskStore((state) => state.stopLoss);
  const takeProfit = useRiskStore((state) => state.takeProfit);
  const analysis = results[interval];

  if (!analysis) {
    return (
      <section className="rounded-md border border-slate-800 bg-[#050b1b] p-3 text-xs text-slate-400">
        <p className="uppercase tracking-[0.18em] text-slate-500">Technical Analysis</p>
        <p className="mt-3">{status === "loading" ? "Analyzing market..." : "Waiting for market data..."}</p>
      </section>
    );
  }

  const reasoning = analysis.reasons.length > 0 ? analysis.reasons : [analysis.suggestedAction];
  const actionText = displayActionText(analysis.action, analysis.suggestedAction);
  const entry = Number(entryPrice);
  const stop = Number(stopLoss);
  const target = Number(takeProfit);
  const hasTargetLevels = [entry, stop, target].every((value) => Number.isFinite(value) && value > 0);
  const stopPercent = hasTargetLevels ? (Math.abs(entry - stop) / entry) * 100 : null;
  const targetPercent = hasTargetLevels ? (Math.abs(target - entry) / entry) * 100 : null;
  const targetState = targetLocked && hasTargetLevels ? "CONFIRMED" : "WAITING";

  return (
    <section className="text-xs">
      <header className="mb-2 flex items-center justify-between">
        <p className="uppercase tracking-[0.18em] text-slate-400">Technical Analysis</p>
        <span className={`rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold uppercase ${signalTone(analysis.trend)}`}>
          {analysis.trend}
        </span>
      </header>

      <div className={`mb-2 flex items-center justify-between rounded-md border px-3 py-2 ${actionTone(analysis.action)}`}>
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] opacity-70">Action</p>
          <p className="mt-0.5 text-sm font-semibold leading-5">{actionText}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-[0.14em] opacity-70">Signal</p>
          <p className={`mt-0.5 font-bold ${signalTone(analysis.signal)}`}>{analysis.signal}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <Metric label="Confidence" value={`${analysis.confidence}%`} tone="text-blue-400" />
        <Metric label="Trend" value={analysis.trend} tone={signalTone(analysis.trend)} />
        <Metric label="Risk" value={analysis.risk} tone={analysis.risk === "High" ? "text-red-400" : "text-amber-300"} />
        <Metric label="Strength" value={`${analysis.trendStrength}%`} />
        <Metric label="Probability" value={`${analysis.probability}%`} tone="text-blue-400" />
        <Metric label="Market" value={analysis.marketCondition} tone={signalTone(analysis.marketCondition)} />
      </div>

      <div className="mt-2 space-y-2 rounded-md border border-slate-800 bg-[#071022] p-2">
        <ScoreBar label="Entry Quality" value={analysis.entryQuality} tone="bg-emerald-500" />
        <ScoreBar label="Trade Quality" value={analysis.tradeQuality} tone="bg-blue-500" />
      </div>

      <div className={`mt-2 rounded-md border p-2 ${targetState === "CONFIRMED" ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-400/30 bg-amber-400/5"}`}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] uppercase tracking-[0.15em] text-slate-400">AI target confirmation</p>
          <span className={targetState === "CONFIRMED" ? "font-bold text-emerald-300" : "font-bold text-amber-300"}>{targetState}</span>
        </div>
        <p className="mt-1 text-[11px] leading-4 text-slate-300">{targetLockReason || "Target requires structure confirmation."}</p>
        <div className="mt-2 grid grid-cols-3 gap-1 text-[10px]">
          <Metric label="Stop" value={stopPercent === null ? "--" : `${stopPercent.toFixed(2)}%`} tone="text-red-300" />
          <Metric label="Target" value={targetPercent === null ? "--" : `${targetPercent.toFixed(2)}%`} tone="text-emerald-300" />
          <Metric label="Refresh" value={recalculateMode.replace(" ONLY", "")} tone="text-blue-300" />
        </div>
      </div>

      <div className="mt-2 rounded-md border border-slate-800 bg-[#071022] p-2">
        <p className="mb-1 text-[10px] uppercase tracking-[0.15em] text-slate-500">Reasoning</p>
        <ul className="space-y-1 text-[11px] leading-4 text-slate-300">
          {reasoning.slice(0, 3).map((reason) => (
            <li key={reason} className="flex gap-1.5">
              <span className={analysis.action === "Wait" ? "text-amber-300" : "text-emerald-400"}>-</span>
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

function Metric({ label, value, tone = "text-white" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-md border border-slate-800 bg-[#071022] p-2">
      <p className="truncate text-[10px] text-slate-500">{label}</p>
      <p className={`mt-0.5 truncate font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

function ScoreBar({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[10px]">
        <span className="text-slate-400">{label}</span>
        <span className="font-semibold text-white">{value}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}
