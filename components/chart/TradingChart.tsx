"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CandlestickData,
  IChartApi,
  ISeriesApi,
  LineData,
  UTCTimestamp,
} from "lightweight-charts";
import type { BinanceKlineResponse } from "@/services/binance";
import { calculateRsi, calculateSma, getLatestValue } from "@/services/indicators";
import { createBinanceKlineSocket } from "@/services/websocket";
import { useMarketStore } from "@/store/useMarketStore";

type CandlePoint = CandlestickData<UTCTimestamp>;
type LinePoint = LineData<UTCTimestamp>;

const PRICE_CHART_HEIGHT = 440;
const RSI_CHART_HEIGHT = 180;
const MIN_CHART_WIDTH = 320;
const HISTORY_LIMIT = 240;
const MIN_VISIBLE_BARS = 72;
const MAX_VISIBLE_BARS = 140;
const TARGET_BAR_WIDTH = 8;
const RIGHT_PADDING_BARS = 6;

function formatValue(value: number | null, maximumFractionDigits = 2) {
  if (value === null || !Number.isFinite(value)) {
    return "--";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(value);
}

function parseKline(kline: BinanceKlineResponse): CandlePoint | null {
  const candle = {
    time: Math.floor(kline[0] / 1000) as UTCTimestamp,
    open: Number(kline[1]),
    high: Number(kline[2]),
    low: Number(kline[3]),
    close: Number(kline[4]),
  };

  const isValid =
    Number.isFinite(candle.time) &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close);

  return isValid ? candle : null;
}

function parseKlines(rawData: BinanceKlineResponse[]) {
  return rawData
    .map(parseKline)
    .filter((candle): candle is CandlePoint => candle !== null)
    .sort((a, b) => Number(a.time) - Number(b.time));
}

function upsertCandle(candles: CandlePoint[], candle: CandlePoint) {
  const existingIndex = candles.findIndex((item) => item.time === candle.time);

  if (existingIndex >= 0) {
    const nextCandles = [...candles];
    nextCandles[existingIndex] = candle;
    return nextCandles.slice(-HISTORY_LIMIT);
  }

  return [...candles, candle].sort((a, b) => Number(a.time) - Number(b.time)).slice(-HISTORY_LIMIT);
}

function toLineData(points: Array<{ time: number; value: number }>): LinePoint[] {
  return points.map((point) => ({
    time: point.time as UTCTimestamp,
    value: point.value,
  }));
}

export default function TradingChart() {
  const symbol = useMarketStore((state) => state.symbol);
  const interval = useMarketStore((state) => state.interval);
  const priceChartContainerRef = useRef<HTMLDivElement | null>(null);
  const rsiChartContainerRef = useRef<HTMLDivElement | null>(null);
  const priceChartRef = useRef<IChartApi | null>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const sma20SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const sma50SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const [candles, setCandles] = useState<CandlePoint[]>([]);
  const [isChartReady, setIsChartReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [socketError, setSocketError] = useState<string | null>(null);
  const [showSma20, setShowSma20] = useState(true);
  const [showSma50, setShowSma50] = useState(true);
  const [showRsi, setShowRsi] = useState(true);

  const indicators = useMemo(() => {
    const indicatorCandles = candles.map((candle) => ({
      time: Number(candle.time),
      close: candle.close,
    }));
    const sma20 = calculateSma(indicatorCandles, 20);
    const sma50 = calculateSma(indicatorCandles, 50);
    const rsi = calculateRsi(indicatorCandles, 14);

    return {
      sma20,
      sma50,
      rsi,
      latestSma20: getLatestValue(sma20),
      latestSma50: getLatestValue(sma50),
      latestRsi: getLatestValue(rsi),
      latestClose: candles.length > 0 ? candles[candles.length - 1].close : null,
    };
  }, [candles]);

  const fitChartContent = useCallback(() => {
    priceChartRef.current?.timeScale().fitContent();
    rsiChartRef.current?.timeScale().fitContent();
  }, []);

  useEffect(() => {
    if (!priceChartContainerRef.current || !rsiChartContainerRef.current) {
      return;
    }

    const priceContainer = priceChartContainerRef.current;
    const rsiContainer = rsiChartContainerRef.current;
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;

    async function initializeCharts() {
      const { createChart } = await import("lightweight-charts");

      if (disposed || priceChartRef.current || rsiChartRef.current) {
        return;
      }

      const baseOptions = {
        autoSize: true,
        layout: {
          background: { color: "#020617" },
          textColor: "#cbd5e1",
        },
        grid: {
          vertLines: { color: "#1e293b" },
          horzLines: { color: "#1e293b" },
        },
        rightPriceScale: {
          borderColor: "#334155",
        },
        timeScale: {
          borderColor: "#334155",
          barSpacing: 8,
          minBarSpacing: 4,
          rightOffset: RIGHT_PADDING_BARS,
          timeVisible: true,
          secondsVisible: false,
          shiftVisibleRangeOnNewBar: true,
          fixRightEdge: false,
        },
        crosshair: { mode: 1 },
      };

      const priceChart = createChart(priceContainer, {
        ...baseOptions,
        width: Math.max(priceContainer.clientWidth, MIN_CHART_WIDTH),
        height: PRICE_CHART_HEIGHT,
        rightPriceScale: {
          ...baseOptions.rightPriceScale,
          scaleMargins: {
            top: 0.12,
            bottom: 0.12,
          },
        },
      });
      const rsiChart = createChart(rsiContainer, {
        ...baseOptions,
        width: Math.max(rsiContainer.clientWidth, MIN_CHART_WIDTH),
        height: RSI_CHART_HEIGHT,
        rightPriceScale: {
          ...baseOptions.rightPriceScale,
          scaleMargins: {
            top: 0.18,
            bottom: 0.18,
          },
        },
      });

      const candleSeries = priceChart.addCandlestickSeries({
        upColor: "#22c55e",
        downColor: "#ef4444",
        wickUpColor: "#22c55e",
        wickDownColor: "#ef4444",
        borderUpColor: "#22c55e",
        borderDownColor: "#ef4444",
        wickVisible: true,
        priceLineVisible: false,
      });
      const sma20Series = priceChart.addLineSeries({
        color: "#38bdf8",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      const sma50Series = priceChart.addLineSeries({
        color: "#f59e0b",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      const rsiSeries = rsiChart.addLineSeries({
        color: "#a78bfa",
        lineWidth: 2,
        priceLineVisible: false,
      });

      rsiSeries.createPriceLine({
        price: 70,
        color: "#ef4444",
        lineWidth: 1,
        axisLabelVisible: true,
        title: "70",
      });
      rsiSeries.createPriceLine({
        price: 30,
        color: "#22c55e",
        lineWidth: 1,
        axisLabelVisible: true,
        title: "30",
      });

      priceChartRef.current = priceChart;
      rsiChartRef.current = rsiChart;
      candleSeriesRef.current = candleSeries;
      sma20SeriesRef.current = sma20Series;
      sma50SeriesRef.current = sma50Series;
      rsiSeriesRef.current = rsiSeries;
      setIsChartReady(true);

      const resizeCharts = () => {
        priceChart.applyOptions({ height: PRICE_CHART_HEIGHT });
        rsiChart.applyOptions({ height: RSI_CHART_HEIGHT });
        requestAnimationFrame(() => {
          fitChartContent();
        });
      };

      resizeObserver =
        typeof ResizeObserver !== "undefined"
          ? new ResizeObserver((entries) => {
              if (entries.some((entry) => entry.target === priceContainer)) {
                resizeCharts();
              }
            })
          : null;

      resizeObserver?.observe(priceContainer);
      window.addEventListener("resize", resizeCharts);
      requestAnimationFrame(resizeCharts);

      return () => {
        window.removeEventListener("resize", resizeCharts);
      };
    }

    let removeResizeListener: (() => void) | undefined;

    initializeCharts().then((cleanup) => {
      removeResizeListener = cleanup;
    });

    return () => {
      disposed = true;
      removeResizeListener?.();
      resizeObserver?.disconnect();
      priceChartRef.current?.remove();
      rsiChartRef.current?.remove();
      priceChartRef.current = null;
      rsiChartRef.current = null;
      candleSeriesRef.current = null;
      sma20SeriesRef.current = null;
      sma50SeriesRef.current = null;
      rsiSeriesRef.current = null;
      setIsChartReady(false);
    };
  }, [fitChartContent]);

  useEffect(() => {
    if (!isChartReady) {
      return;
    }

    const abortController = new AbortController();

    setCandles([]);
    setIsLive(false);
    setIsLoading(true);
    setErrorMessage(null);
    setSocketError(null);

    async function loadCandles() {
      try {
        const response = await fetch(
          `/api/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${HISTORY_LIMIT}`,
          { signal: abortController.signal }
        );

        if (!response.ok) {
          throw new Error(`Server returned ${response.status}`);
        }

        const rawData = (await response.json()) as BinanceKlineResponse[];
        const nextCandles = parseKlines(rawData);

        if (nextCandles.length === 0) {
          throw new Error("No data returned from Binance");
        }

        if (!abortController.signal.aborted) {
          setCandles(nextCandles);
          setIsLoading(false);
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setIsLoading(false);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load chart data");
      }
    }

    loadCandles();

    return () => {
      abortController.abort();
    };
  }, [isChartReady, symbol, interval]);

  useEffect(() => {
    if (!isChartReady || isLoading || errorMessage) {
      return;
    }

    const closeSocket = createBinanceKlineSocket({
      symbol,
      interval,
      onCandle: ({ candle }) => {
        const nextCandle = parseKline(candle);

        if (!nextCandle) {
          return;
        }

        setCandles((currentCandles) => upsertCandle(currentCandles, nextCandle));
        setIsLive(true);
        setSocketError(null);
      },
      onError: () => {
        setIsLive(false);
        setSocketError("Live stream interrupted");
      },
    });

    return closeSocket;
  }, [errorMessage, interval, isChartReady, isLoading, symbol]);

  useEffect(() => {
    if (!isChartReady || candles.length === 0) {
      return;
    }

    const sma20Data = toLineData(indicators.sma20);
    const sma50Data = toLineData(indicators.sma50);
    const rsiData = toLineData(indicators.rsi);

    candleSeriesRef.current?.setData(candles);
    sma20SeriesRef.current?.setData(showSma20 ? sma20Data : []);
    sma50SeriesRef.current?.setData(showSma50 ? sma50Data : []);
    rsiSeriesRef.current?.setData(showRsi ? rsiData : []);
    requestAnimationFrame(() => {
      fitChartContent();
    });
  }, [candles, indicators.rsi, indicators.sma20, indicators.sma50, isChartReady, fitChartContent, showSma20, showSma50, showRsi]);

  const statusText = isLoading
    ? "Loading market data..."
    : errorMessage
    ? "Unable to load data"
    : isLive
    ? "Live stream active"
    : "Connecting live stream";

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/95 p-4">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Market</p>
          <h2 className="text-2xl font-semibold text-white">{symbol}</h2>
          <p className="mt-1 text-sm text-slate-400">{interval} candlesticks</p>
        </div>
        <div className="grid gap-2 text-sm sm:text-right">
          <div className="rounded-lg bg-slate-900 px-4 py-3 text-slate-300">{statusText}</div>
          {socketError ? (
            <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-amber-100">
              {socketError}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px]">
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-800 bg-[#020617] px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Last</p>
              <p className="mt-1 text-sm font-semibold text-white">
                {formatValue(indicators.latestClose, 4)}
              </p>
            </div>
            <div className="rounded-lg border border-sky-400/30 bg-sky-400/10 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.18em] text-sky-200">SMA 20</p>
              <p className="mt-1 text-sm font-semibold text-sky-50">
                {formatValue(indicators.latestSma20, 4)}
              </p>
            </div>
            <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.18em] text-amber-100">SMA 50</p>
              <p className="mt-1 text-sm font-semibold text-amber-50">
                {formatValue(indicators.latestSma50, 4)}
              </p>
            </div>
            <div className="rounded-lg border border-violet-400/30 bg-violet-400/10 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.18em] text-violet-100">RSI 14</p>
              <p className="mt-1 text-sm font-semibold text-violet-50">
                {formatValue(indicators.latestRsi)}
              </p>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-lg border border-slate-800 bg-[#020617]">
            <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-2 text-xs">
              {showSma20 ? (
                <span className="rounded-md border border-sky-400/30 bg-slate-950/80 px-2 py-1 text-sky-200">
                  SMA 20
                </span>
              ) : null}
              {showSma50 ? (
                <span className="rounded-md border border-amber-400/30 bg-slate-950/80 px-2 py-1 text-amber-100">
                  SMA 50
                </span>
              ) : null}
              {showRsi ? (
                <span className="rounded-md border border-violet-400/30 bg-slate-950/80 px-2 py-1 text-violet-100">
                  RSI 14
                </span>
              ) : null}
            </div>
            <div ref={priceChartContainerRef} className="h-[440px] min-h-[300px] w-full" />
            {isLoading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 text-sm text-slate-300">
                Loading market data...
              </div>
            ) : null}
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-800 bg-[#020617]">
            <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2 text-xs">
              <span className="font-semibold uppercase tracking-[0.18em] text-violet-100">RSI 14</span>
              <span className="text-slate-400">70 / 30 bands</span>
            </div>
            <div ref={rsiChartContainerRef} className="h-[180px] w-full" />
          </div>
        </div>

        <aside className="space-y-4 rounded-3xl border border-slate-800 bg-slate-950/95 p-4">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Indicator controls</p>
            <h3 className="mt-2 text-lg font-semibold text-white">Chart overlays</h3>
            <p className="mt-1 text-sm text-slate-400">Toggle indicators for a clean TradingView-style view.</p>
          </div>

          <div className="grid gap-3">
            <button
              type="button"
              onClick={() => setShowSma20((value) => !value)}
              className={`rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition ${
                showSma20
                  ? "border-sky-400 bg-sky-400/10 text-sky-100"
                  : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
              }`}
            >
              <span>SMA 20</span>
              <p className="mt-1 text-xs text-slate-400">Smooth short-term trend</p>
            </button>
            <button
              type="button"
              onClick={() => setShowSma50((value) => !value)}
              className={`rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition ${
                showSma50
                  ? "border-amber-400 bg-amber-400/10 text-amber-100"
                  : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
              }`}
            >
              <span>SMA 50</span>
              <p className="mt-1 text-xs text-slate-400">Medium-term trend</p>
            </button>
            <button
              type="button"
              onClick={() => setShowRsi((value) => !value)}
              className={`rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition ${
                showRsi
                  ? "border-violet-400 bg-violet-400/10 text-violet-100"
                  : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
              }`}
            >
              <span>RSI 14</span>
              <p className="mt-1 text-xs text-slate-400">Momentum oscillator</p>
            </button>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-[#020617] p-4 text-sm">
            <div className="grid gap-3">
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-3">
                <span className="text-slate-400">SMA 20 value</span>
                <span className="font-semibold text-sky-100">{formatValue(indicators.latestSma20, 4)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-3">
                <span className="text-slate-400">SMA 50 value</span>
                <span className="font-semibold text-amber-100">{formatValue(indicators.latestSma50, 4)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-3">
                <span className="text-slate-400">RSI 14 value</span>
                <span className="font-semibold text-violet-100">{formatValue(indicators.latestRsi)}</span>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {errorMessage ? (
        <p className="mt-4 rounded-lg bg-red-950/80 px-4 py-3 text-sm text-red-300">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
