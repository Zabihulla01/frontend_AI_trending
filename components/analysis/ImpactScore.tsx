"use client";

interface ImpactScoreProps {
  level: "high" | "medium" | "low";
  showLabel?: boolean;
}

export const ImpactScore = ({ level, showLabel = true }: ImpactScoreProps) => {
  const config = {
    high: { icon: "⚡", label: "HIGH", bg: "bg-red-900/40", border: "border-red-500", text: "text-red-400" },
    medium: { icon: "◆", label: "MEDIUM", bg: "bg-yellow-900/40", border: "border-yellow-500", text: "text-yellow-400" },
    low: { icon: "·", label: "LOW", bg: "bg-slate-900/40", border: "border-slate-500", text: "text-slate-400" },
  };

  const c = config[level];

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold border ${c.bg} ${c.border} ${c.text}`}>
      {c.icon}
      {showLabel && c.label}
    </span>
  );
};
