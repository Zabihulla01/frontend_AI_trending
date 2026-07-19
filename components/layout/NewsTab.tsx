"use client";

import { SentimentBadge } from "@/components/analysis/SentimentBadge";
import { ImpactScore } from "@/components/analysis/ImpactScore";

export const NewsTab = () => {
  const newsItems = [
    { id: 1, title: "Bitcoin breaks resistance", sentiment: "bullish" as const, impact: "high" as const, category: "Crypto", time: "2 min ago" },
    { id: 2, title: "SEC approves ETF", sentiment: "bullish" as const, impact: "high" as const, category: "Regulation", time: "15 min ago" },
    { id: 3, title: "Market consolidation phase", sentiment: "neutral" as const, impact: "medium" as const, category: "Macro", time: "1 hour ago" },
    { id: 4, title: "Fed signals rate hold", sentiment: "bearish" as const, impact: "medium" as const, category: "Macro", time: "3 hours ago" },
  ];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between rounded-md border border-slate-800 bg-[#071022] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-slate-500">
        <span>Simulated feed</span>
        <span>Not live news</span>
      </div>
      {newsItems.map((item) => (
        <div key={item.id} className="rounded-md border border-slate-800 bg-[#071022] p-2 text-xs transition hover:border-slate-700">
          <div className="mb-1 flex items-start justify-between gap-2">
            <p className="flex-1 leading-snug text-slate-200">{item.title}</p>
            <ImpactScore level={item.impact} showLabel={false} />
          </div>
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <div className="flex items-center gap-1">
              <SentimentBadge sentiment={item.sentiment} compact={false} />
              <span className="text-slate-500">/</span>
              <span className="text-slate-500">{item.category}</span>
            </div>
            <span className="text-slate-500">{item.time}</span>
          </div>
        </div>
      ))}
    </div>
  );
};
