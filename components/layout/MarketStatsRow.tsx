"use client";

import { useIndicatorStore } from "@/store/useIndicatorStore";

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "--";
  }

  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

export default function MarketStatsRow() {
  const snapshot = useIndicatorStore((state) => state.snapshot);
  const unavailable = "Awaiting feed";

  const metrics = [
    { label: "24H High", value: unavailable, muted: true },
    { label: "24H Low", value: unavailable, muted: true },
    { label: "24H Change", value: unavailable, muted: true },
    { label: "Volume", value: formatNumber(snapshot?.volume), muted: !snapshot?.volume },
    { label: "Market Cap", value: unavailable, muted: true },
  ];

  return (
    <section className="grid gap-2 rounded-md border border-slate-800 bg-slate-950/90 p-2 [grid-template-columns:repeat(5,minmax(0,1fr))] max-sm:[grid-template-columns:repeat(2,minmax(0,1fr))]">
      {metrics.map((metric) => (
        <div key={metric.label} className="min-w-0 border-r border-slate-800 px-2 py-1 last:border-r-0">
          <p className="truncate text-[10px] uppercase tracking-[0.12em] text-slate-500">{metric.label}</p>
          <p className={`mt-1 truncate text-xs font-semibold ${metric.muted ? "text-slate-500" : "text-white"}`}>{metric.value}</p>
        </div>
      ))}
    </section>
  );
}
