// components/layout/Header.tsx
"use client";

import { useState } from "react";
import { useMarketStore } from "@/store/useMarketStore";

export default function Header() {
  const { symbol, interval, setSymbol, setInterval } = useMarketStore();
  const [tempSymbol, setTempSymbol] = useState(symbol);
  const [tempInterval, setTempInterval] = useState(interval);

  const applySettings = () => {
    setSymbol(tempSymbol.toUpperCase());
    setInterval(tempInterval);
  };

  return (
    <header className="flex items-center justify-between mb-4">
      <h1 className="text-2xl font-bold text-green-400">AI Trader Dashboard</h1>
      <div className="flex space-x-4">
        <div>
          <label className="block text-sm">Symbol</label>
          <input
            type="text"
            value={tempSymbol}
            onChange={(e) => setTempSymbol(e.target.value)}
            className="mt-1 px-2 py-1 rounded bg-slate-800 text-white"
          />
        </div>
        <div>
          <label className="block text-sm">Interval</label>
          <select
            value={tempInterval}
            onChange={(e) => setTempInterval(e.target.value)}
            className="mt-1 px-2 py-1 rounded bg-slate-800 text-white"
          >
            <option value="1m">1m</option>
            <option value="15m">15m</option>
            <option value="1h">1h</option>
            <option value="4h">4h</option>
            <option value="1d">1d</option>
          </select>
        </div>
        <button
          onClick={applySettings}
          className="mt-6 ml-2 px-4 py-2 bg-green-600 rounded text-white"
        >
          Apply
        </button>
      </div>
    </header>
  );
}
