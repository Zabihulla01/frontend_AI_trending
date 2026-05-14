"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { BinanceKlineResponse } from "@/services/binance";
import {
  type AlertType,
  evaluateAlert,
  formatAlertValue,
  getAlertTypeLabel,
  getDefaultAlertTarget,
} from "@/services/alerts";
import { calculateRsi } from "@/services/indicators";
import { createBinanceKlineSocket, createBinanceTickerSocket } from "@/services/websocket";
import { useAlertStore } from "@/store/useAlertStore";
import { useMarketStore } from "@/store/useMarketStore";

type AlertToast = {
  id: string;
  message: string;
  symbol: string;
};

const ALERT_TYPES: Array<{ value: AlertType; label: string }> = [
  { value: "above-price", label: "Above price" },
  { value: "below-price", label: "Below price" },
  { value: "percentage-move", label: "Percentage move" },
  { value: "rsi-overbought", label: "RSI overbought" },
  { value: "rsi-oversold", label: "RSI oversold" },
];
const RSI_INTERVAL = "1m";
const RSI_HISTORY_LIMIT = 80;

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

function parseKlineClose(kline: BinanceKlineResponse) {
  const time = Math.floor(kline[0] / 1000);
  const close = Number(kline[4]);

  return Number.isFinite(time) && Number.isFinite(close) ? { time, close } : null;
}

function upsertClose(
  values: Array<{ time: number; close: number }>,
  nextValue: { time: number; close: number }
) {
  const existingIndex = values.findIndex((value) => value.time === nextValue.time);

  if (existingIndex >= 0) {
    const nextValues = [...values];
    nextValues[existingIndex] = nextValue;
    return nextValues.slice(-RSI_HISTORY_LIMIT);
  }

  return [...values, nextValue]
    .sort((a, b) => a.time - b.time)
    .slice(-RSI_HISTORY_LIMIT);
}

function playAlertSound() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    return;
  }

  const audioContext = new AudioContextClass();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  oscillator.type = "sine";
  oscillator.frequency.value = 880;
  gain.gain.setValueAtTime(0.001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.35);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.36);
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

export default function AlertPanel() {
  const symbol = useMarketStore((state) => state.symbol);
  const alerts = useAlertStore((state) => state.alerts);
  const history = useAlertStore((state) => state.history);
  const addAlert = useAlertStore((state) => state.addAlert);
  const setAlertStatus = useAlertStore((state) => state.setAlertStatus);
  const removeAlert = useAlertStore((state) => state.removeAlert);
  const triggerAlert = useAlertStore((state) => state.triggerAlert);
  const clearHistory = useAlertStore((state) => state.clearHistory);
  const [selectedType, setSelectedType] = useState<AlertType>("above-price");
  const [target, setTarget] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [latestPrices, setLatestPrices] = useState<Record<string, number>>({});
  const [latestRsi, setLatestRsi] = useState<Record<string, number>>({});
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<AlertToast[]>([]);
  const rsiHistoryRef = useRef<Record<string, Array<{ time: number; close: number }>>>({});
  const currentPriceRef = useRef<number | null>(null);

  const activeSymbols = useMemo(() => {
    const symbols = alerts
      .filter((alert) => alert.status === "active")
      .map((alert) => alert.symbol);

    return Array.from(new Set([symbol, ...symbols]));
  }, [alerts, symbol]);

  const activeAlerts = useMemo(
    () => alerts.filter((alert) => alert.status === "active"),
    [alerts]
  );

  const currentPrice = latestPrices[symbol] ?? null;

  useEffect(() => {
    currentPriceRef.current = currentPrice;
  }, [currentPrice]);

  useEffect(() => {
    setTarget(String(formatAlertValue(getDefaultAlertTarget(selectedType, currentPriceRef.current))));
  }, [selectedType, symbol]);

  useEffect(() => {
    if (activeSymbols.length === 0) {
      return;
    }

    const cleanups = activeSymbols.map((activeSymbol) =>
      createBinanceTickerSocket({
        symbol: activeSymbol,
        onPrice: (price) => {
          setLatestPrices((current) => ({ ...current, [activeSymbol]: price }));
          setStreamError(null);
        },
        onError: () => {
          setStreamError("One or more alert price streams interrupted.");
        },
      })
    );

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [activeSymbols]);

  useEffect(() => {
    const rsiSymbols = Array.from(
      new Set(
        alerts
          .filter(
            (alert) =>
              alert.status === "active" &&
              (alert.type === "rsi-overbought" || alert.type === "rsi-oversold")
          )
          .map((alert) => alert.symbol)
      )
    );

    if (rsiSymbols.length === 0) {
      return;
    }

    const abortControllers: AbortController[] = [];
    const socketCleanups: Array<() => void> = [];

    rsiSymbols.forEach((rsiSymbol) => {
      const abortController = new AbortController();
      abortControllers.push(abortController);

      async function loadRsiHistory() {
        try {
          const response = await fetch(
            `/api/klines?symbol=${encodeURIComponent(rsiSymbol)}&interval=${RSI_INTERVAL}&limit=${RSI_HISTORY_LIMIT}`,
            { signal: abortController.signal }
          );

          if (!response.ok) {
            throw new Error(`RSI history failed with status ${response.status}`);
          }

          const rawData = (await response.json()) as BinanceKlineResponse[];
          const closes = rawData
            .map(parseKlineClose)
            .filter((value): value is { time: number; close: number } => value !== null);

          if (abortController.signal.aborted) {
            return;
          }

          rsiHistoryRef.current[rsiSymbol] = closes;
          const rsi = calculateRsi(closes, 14);
          const latestValue = rsi.length > 0 ? rsi[rsi.length - 1].value : null;

          if (latestValue !== null) {
            setLatestRsi((current) => ({ ...current, [rsiSymbol]: latestValue }));
          }
        } catch {
          if (!abortController.signal.aborted) {
            setStreamError("Unable to load RSI alert history.");
          }
        }
      }

      loadRsiHistory();

      const cleanup = createBinanceKlineSocket({
        symbol: rsiSymbol,
        interval: RSI_INTERVAL,
        onCandle: ({ candle }) => {
          const close = parseKlineClose(candle);

          if (!close) {
            return;
          }

          const nextHistory = upsertClose(rsiHistoryRef.current[rsiSymbol] ?? [], close);
          const rsi = calculateRsi(nextHistory, 14);
          const latestValue = rsi.length > 0 ? rsi[rsi.length - 1].value : null;

          rsiHistoryRef.current[rsiSymbol] = nextHistory;

          if (latestValue !== null) {
            setLatestRsi((current) => ({ ...current, [rsiSymbol]: latestValue }));
          }

          setStreamError(null);
        },
        onError: () => {
          setStreamError("One or more RSI alert streams interrupted.");
        },
      });

      socketCleanups.push(cleanup);
    });

    return () => {
      abortControllers.forEach((controller) => controller.abort());
      socketCleanups.forEach((cleanup) => cleanup());
    };
  }, [alerts]);

  useEffect(() => {
    activeAlerts.forEach((alert) => {
      const result = evaluateAlert(alert, {
        price: latestPrices[alert.symbol] ?? null,
        rsi: latestRsi[alert.symbol] ?? null,
      });

      if (!result) {
        return;
      }

      const triggeredAlert = triggerAlert({
        id: alert.id,
        value: result.value,
        message: result.message,
      });

      if (!triggeredAlert) {
        return;
      }

      setToasts((current) => [
        { id: triggeredAlert.id, message: result.message, symbol: triggeredAlert.symbol },
        ...current,
      ].slice(0, 3));

      if (triggeredAlert.soundEnabled) {
        playAlertSound();
      }
    });
  }, [activeAlerts, latestPrices, latestRsi, triggerAlert]);

  useEffect(() => {
    if (toasts.length === 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setToasts((current) => current.slice(0, -1));
    }, 5000);

    return () => window.clearTimeout(timeout);
  }, [toasts]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedTarget = Number(target.replace(/,/g, ""));
    const result = addAlert({
      symbol,
      type: selectedType,
      target: normalizedTarget,
      referencePrice: selectedType === "percentage-move" ? currentPrice ?? undefined : undefined,
      soundEnabled,
    });

    if (!result.ok) {
      setFormMessage(result.error);
      return;
    }

    setFormMessage(`${getAlertTypeLabel(result.alert.type)} alert created for ${result.alert.symbol}.`);
  }

  return (
    <section className="relative rounded-lg border border-slate-800 bg-slate-950/95 p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Alerts</p>
          <h2 className="mt-1 text-xl font-semibold text-white">Trading alerts</h2>
          <p className="mt-1 text-sm text-slate-400">
            {symbol} live {currentPrice ? formatAlertValue(currentPrice) : "--"}
          </p>
        </div>
        <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-right">
          <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-200">Active</p>
          <p className="text-sm font-semibold text-emerald-50">{activeAlerts.length}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-3">
        <label className="grid gap-2 text-sm">
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Type</span>
          <select
            value={selectedType}
            onChange={(event) => setSelectedType(event.target.value as AlertType)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20"
          >
            {ALERT_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-2 text-sm">
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
            {selectedType === "percentage-move"
              ? "Move %"
              : selectedType.startsWith("rsi")
              ? "RSI level"
              : "Price"}
          </span>
          <input
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            inputMode="decimal"
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-white outline-none placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20"
            placeholder="Alert value"
          />
        </label>

        <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-[#020617] px-3 py-2.5 text-sm text-slate-300">
          <span>Sound alert</span>
          <input
            type="checkbox"
            checked={soundEnabled}
            onChange={(event) => setSoundEnabled(event.target.checked)}
            className="h-4 w-4 accent-emerald-400"
          />
        </label>

        <button
          type="submit"
          className="rounded-lg bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-300/50"
        >
          Create alert
        </button>
      </form>

      {formMessage ? (
        <p className="mt-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-300">
          {formMessage}
        </p>
      ) : null}

      {streamError ? (
        <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
          {streamError}
        </p>
      ) : null}

      <div className="mt-5 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-white">Alert list</h3>
          <span className="text-xs text-slate-500">{alerts.length} total</span>
        </div>

        {alerts.length === 0 ? (
          <p className="rounded-lg border border-slate-800 bg-[#020617] px-3 py-4 text-sm text-slate-400">
            No alerts yet.
          </p>
        ) : null}

        {alerts.map((alert) => (
          <div key={alert.id} className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{alert.symbol}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {getAlertTypeLabel(alert.type)} at {formatAlertValue(alert.target)}
                </p>
              </div>
              <span
                className={`rounded-md border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                  alert.status === "active"
                    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                    : alert.status === "triggered"
                    ? "border-red-400/30 bg-red-400/10 text-red-200"
                    : "border-slate-700 bg-slate-950 text-slate-400"
                }`}
              >
                {alert.status}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  setAlertStatus(alert.id, alert.status === "disabled" ? "active" : "disabled")
                }
                disabled={alert.status === "triggered"}
                className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 transition hover:border-emerald-400/60 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {alert.status === "disabled" ? "Enable" : "Disable"}
              </button>
              <button
                type="button"
                onClick={() => removeAlert(alert.id)}
                className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 transition hover:border-red-400/60 hover:text-red-100"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-white">History</h3>
          <button
            type="button"
            onClick={clearHistory}
            className="text-xs font-medium text-slate-400 transition hover:text-white"
          >
            Clear
          </button>
        </div>
        <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
          {history.length === 0 ? (
            <p className="rounded-lg border border-slate-800 bg-[#020617] px-3 py-4 text-sm text-slate-400">
              No triggered alerts.
            </p>
          ) : null}
          {history.map((item) => (
            <div key={item.id} className="rounded-lg border border-slate-800 bg-[#020617] px-3 py-2">
              <p className="text-sm font-medium text-white">{item.message}</p>
              <p className="mt-1 text-xs text-slate-500">{formatTime(item.triggeredAt)}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="pointer-events-none fixed right-4 top-4 z-50 grid w-[min(360px,calc(100vw-2rem))] gap-3">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="rounded-lg border border-emerald-400/40 bg-slate-950/95 p-4 shadow-2xl shadow-black/40"
          >
            <p className="text-xs uppercase tracking-[0.18em] text-emerald-200">{toast.symbol}</p>
            <p className="mt-1 text-sm font-semibold text-white">{toast.message}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
