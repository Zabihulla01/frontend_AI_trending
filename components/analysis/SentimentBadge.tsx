"use client";

interface SentimentBadgeProps {
  sentiment: "bullish" | "bearish" | "neutral";
  compact?: boolean;
}

export const SentimentBadge = ({ sentiment, compact = false }: SentimentBadgeProps) => {
  const config = {
    bullish: { icon: "🟢", label: "Bullish", bg: "bg-green-900/30", border: "border-green-500/50", text: "text-green-400" },
    bearish: { icon: "🔴", label: "Bearish", bg: "bg-red-900/30", border: "border-red-500/50", text: "text-red-400" },
    neutral: { icon: "⚪", label: "Neutral", bg: "bg-slate-900/30", border: "border-slate-500/50", text: "text-slate-400" },
  };

  const c = config[sentiment];

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border ${c.bg} ${c.border} ${c.text}`}>
      <span>{c.icon}</span>
      {!compact && c.label}
    </span>
  );
};
