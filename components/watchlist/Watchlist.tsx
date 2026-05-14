"use client";

import { useMemo, useState } from "react";
import SymbolSearch from "@/components/watchlist/SymbolSearch";
import { useMarketStore } from "@/store/useMarketStore";

const SYMBOL_DETAILS: Record<string, { name: string; market: string }> = {
  BTCUSDT: { name: "Bitcoin", market: "Crypto" },
  ETHUSDT: { name: "Ethereum", market: "Crypto" },
  BNBUSDT: { name: "BNB", market: "Crypto" },
  SOLUSDT: { name: "Solana", market: "Crypto" },
  XRPUSDT: { name: "XRP", market: "Crypto" },
};

function getSymbolDetails(symbol: string) {
  return SYMBOL_DETAILS[symbol] ?? { name: symbol.replace("USDT", ""), market: "Spot" };
}

export default function Watchlist() {
  const symbol = useMarketStore((state) => state.symbol);
  const watchlist = useMarketStore((state) => state.watchlist);
  const setSymbol = useMarketStore((state) => state.setSymbol);
  const removeSymbol = useMarketStore((state) => state.removeSymbol);
  const [message, setMessage] = useState<string | null>(null);

  const sortedWatchlist = useMemo(
    () => [...watchlist].sort((a, b) => a.localeCompare(b)),
    [watchlist]
  );

  function handleRemove(symbolToRemove: string) {
    if (watchlist.length <= 1) {
      setMessage("Keep at least one symbol in the watchlist.");
      return;
    }

    removeSymbol(symbolToRemove);
    setMessage(`${symbolToRemove} removed.`);
  }

  return (
    <aside className="rounded-lg border border-slate-800 bg-slate-950/95 p-4">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Watchlist</p>
          <h2 className="mt-1 text-xl font-semibold text-white">Markets</h2>
        </div>
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-right">
          <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-300">Active</p>
          <p className="text-sm font-semibold text-emerald-100">{symbol}</p>
        </div>
      </div>

      <div className="mb-4">
        <SymbolSearch />
      </div>

      <div className="space-y-2">
        {sortedWatchlist.map((watchSymbol) => {
          const isActive = watchSymbol === symbol;
          const details = getSymbolDetails(watchSymbol);

          return (
            <div
              key={watchSymbol}
              className={`grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border px-3 py-3 transition ${
                isActive
                  ? "border-emerald-400/50 bg-emerald-400/10"
                  : "border-slate-800 bg-slate-900/70 hover:border-slate-700"
              }`}
            >
              <button
                type="button"
                onClick={() => setSymbol(watchSymbol)}
                className="min-w-0 text-left focus:outline-none"
                aria-pressed={isActive}
              >
                <span className="block truncate text-sm font-semibold text-white">
                  {watchSymbol}
                </span>
                <span className="mt-1 block truncate text-xs text-slate-400">
                  {details.name} / {details.market}
                </span>
              </button>
              <button
                type="button"
                onClick={() => handleRemove(watchSymbol)}
                className="rounded-md border border-slate-700 px-2 py-1 text-xs font-medium text-slate-300 transition hover:border-red-400/60 hover:bg-red-500/10 hover:text-red-200 focus:outline-none focus:ring-2 focus:ring-red-300/40"
                aria-label={`Remove ${watchSymbol}`}
              >
                Remove
              </button>
            </div>
          );
        })}
      </div>

      {message ? (
        <p className="mt-4 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-300">
          {message}
        </p>
      ) : null}
    </aside>
  );
}
