"use client";

import { useMemo, useState } from "react";
import SymbolSearch from "@/components/watchlist/SymbolSearch";
import { useMarketStore } from "@/store/useMarketStore";

const SYMBOL_DETAILS: Record<string, string> = {
  BTCUSDT: "Bitcoin",
  ETHUSDT: "Ethereum",
  BNBUSDT: "BNB",
  SOLUSDT: "Solana",
  XRPUSDT: "XRP",
};

export default function Watchlist() {
  const symbol = useMarketStore((state) => state.symbol);
  const watchlist = useMarketStore((state) => state.watchlist);
  const setSymbol = useMarketStore((state) => state.setSymbol);
  const removeSymbol = useMarketStore((state) => state.removeSymbol);
  const [message, setMessage] = useState<string | null>(null);

  const sortedWatchlist = useMemo(() => [...watchlist].sort((a, b) => a.localeCompare(b)), [watchlist]);

  function handleRemove(symbolToRemove: string) {
    if (watchlist.length <= 1) {
      setMessage("Keep at least one favorite.");
      return;
    }

    removeSymbol(symbolToRemove);
    setMessage(`${symbolToRemove} removed from favorites.`);
  }

  return (
    <section className="min-w-0">
      <header className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Watchlist</h2>
        <span className="text-[10px] text-slate-500">{watchlist.length} symbols</span>
      </header>

      <SymbolSearch />

      <div className="mt-2 grid grid-cols-[minmax(82px,1fr)_52px_38px_28px] gap-2 px-2 text-[10px] uppercase tracking-[0.12em] text-slate-500">
        <span>Symbol</span>
        <span className="text-right">Price</span>
        <span className="text-right">%</span>
        <span className="sr-only">Favorite</span>
      </div>

      <div className="mt-1 max-h-[250px] space-y-1 overflow-y-auto overflow-x-hidden pr-1">
        {sortedWatchlist.map((watchSymbol) => {
          const isActive = watchSymbol === symbol;

          return (
            <div
              key={watchSymbol}
              title={watchSymbol}
              className={`grid min-w-0 grid-cols-[minmax(82px,1fr)_52px_38px_28px] items-center gap-2 rounded-md border px-2 py-2 text-xs transition ${
                isActive
                  ? "border-emerald-400/40 bg-emerald-400/10"
                  : "border-slate-800 bg-[#071022] hover:border-slate-700"
              }`}
            >
              <button
                type="button"
                onClick={() => setSymbol(watchSymbol)}
                className="min-w-0 text-left focus:outline-none"
                aria-pressed={isActive}
              >
                <span className="block break-all font-semibold leading-4 text-white">{watchSymbol}</span>
                <span className="block truncate text-[10px] text-slate-500">
                  {SYMBOL_DETAILS[watchSymbol] ?? watchSymbol.replace("USDT", "")}
                </span>
              </button>
              <span className="text-right font-mono text-slate-500">--</span>
              <span className="text-right font-mono text-slate-500">--</span>
              <button
                type="button"
                onClick={() => handleRemove(watchSymbol)}
                className="grid h-7 w-7 place-items-center rounded-md text-sm text-amber-300 transition hover:bg-slate-800 hover:text-slate-100 focus:outline-none"
                aria-label={`Remove ${watchSymbol} from favorites`}
                title="Remove from favorites"
              >
                &#9733;
              </button>
            </div>
          );
        })}
      </div>

      {message ? <p className="mt-2 text-[11px] text-slate-400">{message}</p> : null}
    </section>
  );
}
