// components/layout/Header.tsx
"use client";

import { useState } from "react";
import { useMarketStore } from "@/store/useMarketStore";
import styles from './Header.module.css';

function ChartIcon() {
  return (
    <svg viewBox="0 0 20 20" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M3 16h14M5 14V8h3v6M9 14V4h3v10M13 14V6h3v8" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4.5 14.5h11l-1.5-2V8a4 4 0 10-8 0v4.5l-1.5 2zM8 16a2.1 2.1 0 004 0" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M10 6.8a3.2 3.2 0 100 6.4 3.2 3.2 0 000-6.4z" />
      <path d="M10 2.8v2M10 15.2v2M17.2 10h-2M4.8 10h-2M15.1 4.9l-1.4 1.4M6.3 13.7l-1.4 1.4M15.1 15.1l-1.4-1.4M6.3 6.3L4.9 4.9" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M16 7.5A6.5 6.5 0 104.2 12M16 3.5v4h-4" />
    </svg>
  );
}

function normalizeMarketSymbol(value: string) {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");

  return normalized && !normalized.endsWith("USDT") ? `${normalized}USDT` : normalized;
}

interface MarketControlsProps {
  symbol: string;
  interval: string;
  setSymbol: (symbol: string) => void;
  setInterval: (interval: string) => void;
}

function MarketControls({ symbol, interval, setSymbol, setInterval }: MarketControlsProps) {
  const [tempSymbol, setTempSymbol] = useState(symbol);
  const [tempInterval, setTempInterval] = useState(interval);

  const applySettings = () => {
    const nextSymbol = normalizeMarketSymbol(tempSymbol);

    setTempSymbol(nextSymbol);
    setSymbol(nextSymbol);
    setInterval(tempInterval);
  };

  return (
    <div className={styles.marketControls}>
        <label className={styles.selectField}>
          <span className="sr-only">Symbol</span>
          <input
            type="text"
            value={tempSymbol}
            onChange={(e) => setTempSymbol(e.target.value)}
            className={styles.symbolInput}
            aria-label="Symbol"
          />
        </label>
        <label className={styles.selectField}>
          <span className="sr-only">Timeframe</span>
          <select
            value={tempInterval}
            onChange={(e) => setTempInterval(e.target.value)}
            className={styles.intervalSelect}
            aria-label="Timeframe"
          >
            <option value="1m">1m</option>
            <option value="5m">5m</option>
            <option value="15m">15m</option>
            <option value="1h">1h</option>
            <option value="4h">4h</option>
            <option value="1d">1D</option>
          </select>
        </label>
        <button
          onClick={applySettings}
          className={styles.applyButton}
        >
          Apply
        </button>
    </div>
  );
}

export default function Header() {
  const { symbol, interval, setSymbol, setInterval } = useMarketStore();

  return (
    <header className={styles.header}>
      <div className={styles.leftSection}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}><ChartIcon /></span>
          <span className={styles.logoText}>AI Trader</span>
        </div>
      </div>

      <div className={styles.centerSection}>
        <input
          type="text"
          placeholder="Search BTC ETH SOL..."
          className={styles.searchInput}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              const nextSymbol = normalizeMarketSymbol(event.currentTarget.value);

              if (nextSymbol) {
                setSymbol(nextSymbol);
                event.currentTarget.value = "";
              }
            }
          }}
        />
      </div>

      <MarketControls
        key={`${symbol}:${interval}`}
        symbol={symbol}
        interval={interval}
        setSymbol={setSymbol}
        setInterval={setInterval}
      />

      <div className={styles.rightSection}>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className={styles.iconButton}
          aria-label="Refresh market data"
          title="Refresh market data"
        >
          <RefreshIcon />
        </button>
        <button className={styles.iconButton} aria-label="Notifications" title="Notifications">
          <BellIcon />
        </button>
        <button className={styles.iconButton} aria-label="Settings" title="Settings">
          <SettingsIcon />
        </button>
      </div>
    </header>
  );
}
