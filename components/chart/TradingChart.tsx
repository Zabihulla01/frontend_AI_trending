"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CandlestickData,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  LineData,
  UTCTimestamp,
} from "lightweight-charts";
import { getClosedBinanceKlines, type BinanceKlineResponse } from "@/services/binance";
import {
  calculateAdx,
  calculateAtr,
  calculateEma,
  calculateIndicatorSnapshot,
  calculateMacd,
  calculateRsi,
  calculateSma,
  calculateVwap,
  getLatestMacd,
  getLatestValue,
} from "@/services/indicators";
import { createBinanceKlineSocket } from "@/services/websocket";
import { useIndicatorStore } from "@/store/useIndicatorStore";
import { useMarketStore } from "@/store/useMarketStore";
import { usePositionManagerStore } from "@/store/usePositionManagerStore";
import { formatRiskInput, parseRiskNumber, useRiskStore } from "@/store/useRiskStore";
import { useTradeStore } from "@/store/useTradeStore";

type CandlePoint = CandlestickData<UTCTimestamp> & { volume: number };
type LinePoint = LineData<UTCTimestamp>;
type PositionSide = "long" | "short";
type PositionLevelKey = "entry" | "stop" | "takeProfit";
type PositionLevels = Record<PositionLevelKey, number | null>;

const PRICE_CHART_HEIGHT = 540;
const RSI_CHART_HEIGHT = 88;
const MIN_CHART_WIDTH = 320;
const HISTORY_LIMIT = 240;
const MIN_VISIBLE_BARS = 72;
const MAX_VISIBLE_BARS = 140;
const TARGET_BAR_WIDTH = 9;
const RIGHT_PADDING_BARS = 6;
const CENTER_PADDING_BARS = 24;
const LIVE_UPDATE_MS = 2500;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function parseKline(kline: BinanceKlineResponse): CandlePoint | null {
  const candle = {
    time: Math.floor(kline[0] / 1000) as UTCTimestamp,
    open: Number(kline[1]),
    high: Number(kline[2]),
    low: Number(kline[3]),
    close: Number(kline[4]),
    volume: Number(kline[5]),
  };

  const isValid =
    Number.isFinite(candle.time) &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close) &&
    Number.isFinite(candle.volume);

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

function formatNumber(value: number | null | undefined, maximumFractionDigits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "--";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(value);
}

function calculateRiskReward(levels: PositionLevels) {
  const { entry, stop, takeProfit } = levels;

  if (entry === null || stop === null || takeProfit === null) {
    return null;
  }

  const risk = Math.abs(entry - stop);
  const reward = Math.abs(takeProfit - entry);

  return risk > 0 ? reward / risk : null;
}

function intervalToMs(interval: string) {
  const value = Number.parseInt(interval, 10);

  if (!Number.isFinite(value)) {
    return 60_000;
  }

  if (interval.endsWith("m")) return value * 60_000;
  if (interval.endsWith("h")) return value * 60 * 60_000;
  if (interval.endsWith("d")) return value * 24 * 60 * 60_000;

  return 60_000;
}

function TradingChart() {
  const symbol = useMarketStore((state) => state.symbol);
  const interval = useMarketStore((state) => state.interval);
  const priceChartContainerRef = useRef<HTMLDivElement | null>(null);
  const rsiChartContainerRef = useRef<HTMLDivElement | null>(null);
  const priceChartRef = useRef<IChartApi | null>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const positionPriceLinesRef = useRef<IPriceLine[]>([]);
  const sma20SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const sma50SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const candlesRef = useRef<CandlePoint[]>([]);
  const closedCandlesRef = useRef<CandlePoint[]>([]);
  const pendingLiveCandleRef = useRef<CandlePoint | null>(null);
  const pendingClosedCandleRef = useRef<CandlePoint | null>(null);
  const liveUpdateTimerRef = useRef<number | null>(null);
  const hasLoadedInitialRangeRef = useRef(false);
  const pendingRiskSyncRef = useRef(false);
  const planResetKeyRef = useRef<string | null>(null);
  const [candles, setCandles] = useState<CandlePoint[]>([]);
  const [closedCandles, setClosedCandles] = useState<CandlePoint[]>([]);
  const [isChartReady, setIsChartReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [socketError, setSocketError] = useState<string | null>(null);
  const [lastApiStatus, setLastApiStatus] = useState<number | null>(null);
  const [lastApiLatency, setLastApiLatency] = useState<number | null>(null);
  const [chartRequestCount, setChartRequestCount] = useState(0);
  const [showSma20, setShowSma20] = useState(true);
  const [showSma50, setShowSma50] = useState(true);
  const [showRsi, setShowRsi] = useState(true);
  const [positionSide, setPositionSide] = useState<PositionSide>("long");
  const [positionLevels, setPositionLevels] = useState<PositionLevels>({
    entry: null,
    stop: null,
    takeProfit: null,
  });
  const setIndicatorSnapshot = useIndicatorStore((state) => state.setSnapshot);
  const updateRiskInput = useRiskStore((state) => state.updateInput);
  const riskEntryPrice = useRiskStore((state) => state.entryPrice);
  const riskStopLoss = useRiskStore((state) => state.stopLoss);
  const riskTakeProfit = useRiskStore((state) => state.takeProfit);
  const riskAction = useRiskStore((state) => state.action);
  const activeTrade = useTradeStore((state) => state.activeTrade);
  const closeTrade = useTradeStore((state) => state.closeTrade);
  const tickTradeAge = useTradeStore((state) => state.tickTradeAge);

  const indicators = useMemo(() => {
    const indicatorCandles = closedCandles.map((candle) => ({
      time: Number(candle.time),
      close: candle.close,
    }));
    const ohlcvCandles = closedCandles.map((candle) => ({
      time: Number(candle.time),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    }));
    const sma20 = calculateSma(indicatorCandles, 20);
    const sma50 = calculateSma(indicatorCandles, 50);
    const ema20 = calculateEma(indicatorCandles, 20);
    const ema50 = calculateEma(indicatorCandles, 50);
    const rsi = calculateRsi(indicatorCandles, 14);
    const macd = calculateMacd(indicatorCandles);
    const atr = calculateAtr(ohlcvCandles, 14);
    const adx = calculateAdx(ohlcvCandles, 14);
    const vwap = calculateVwap(ohlcvCandles);
    const snapshot = closedCandles.length > 0 ? calculateIndicatorSnapshot(ohlcvCandles) : null;

    const result = {
      sma20,
      sma50,
      ema20,
      ema50,
      rsi,
      macd,
      atr,
      adx,
      vwap,
      snapshot,
      latestSma20: getLatestValue(sma20),
      latestSma50: getLatestValue(sma50),
      latestEma20: getLatestValue(ema20),
      latestEma50: getLatestValue(ema50),
      latestRsi: getLatestValue(rsi),
      latestMacd: getLatestMacd(macd),
      latestAtr: getLatestValue(atr),
      latestAdx: getLatestValue(adx),
      latestVwap: getLatestValue(vwap),
      latestClose: closedCandles.length > 0 ? closedCandles[closedCandles.length - 1].close : null,
    };

    return result;
  }, [closedCandles]);

  const positionRiskReward = useMemo(() => calculateRiskReward(positionLevels), [positionLevels]);
  const latestPrice = indicators.latestClose;
  const latestAdx = indicators.latestAdx;
  const volumeSpike = indicators.snapshot?.volumeSpike;
  const tradeMetrics = useMemo(() => {
    if (!activeTrade || latestPrice === null) {
      return null;
    }

    const directionMultiplier = activeTrade.direction === "LONG" ? 1 : -1;
    const pnl = (latestPrice - activeTrade.entry) * directionMultiplier;
    const distanceTp = Math.abs(activeTrade.takeProfit - latestPrice);
    const distanceSl = Math.abs(latestPrice - activeTrade.stopLoss);
    const expectedReward = Math.abs(activeTrade.takeProfit - activeTrade.entry);
    const riskAmount = Math.abs(activeTrade.entry - activeTrade.stopLoss);
    const marketHealth =
      volumeSpike !== undefined && latestAdx !== null
        ? Math.round(Math.min(100, volumeSpike * 18 + latestAdx * 1.8))
        : activeTrade.confidence;
    const tradeQuality = Math.round(Math.min(100, activeTrade.confidence * 0.7 + Math.min(activeTrade.rr / 3, 1) * 30));

    return { pnl, distanceTp, distanceSl, expectedReward, riskAmount, marketHealth, tradeQuality };
  }, [activeTrade, latestAdx, latestPrice, volumeSpike]);
  const applyLatestVisibleRange = useCallback(
    (options: { fitContent?: boolean; scrollToRealTime?: boolean } = {}) => {
      const priceChart = priceChartRef.current;
      const rsiChart = rsiChartRef.current;
      const candleCount = candlesRef.current.length;

      if (!priceChart || candleCount === 0) {
        return;
      }

      const chartWidth = Math.max(priceChartContainerRef.current?.clientWidth ?? MIN_CHART_WIDTH, MIN_CHART_WIDTH);
      const visibleBars = clamp(Math.round(chartWidth / TARGET_BAR_WIDTH), MIN_VISIBLE_BARS, MAX_VISIBLE_BARS);
      const lastIndex = candleCount - 1;
      const to = lastIndex + CENTER_PADDING_BARS;
      const from = Math.max(0, to - visibleBars);
      const barSpacing = Math.max(5, Math.min(12, chartWidth / visibleBars));

      priceChart.timeScale().applyOptions({
        rightOffset: CENTER_PADDING_BARS,
        barSpacing,
      });
      priceChart.timeScale().setVisibleLogicalRange({ from, to });
      rsiChart?.timeScale().applyOptions({
        rightOffset: CENTER_PADDING_BARS,
        barSpacing,
      });
      rsiChart?.timeScale().setVisibleLogicalRange({ from, to });

      if (options.fitContent) {
        priceChart.timeScale().fitContent();
        rsiChart?.timeScale().fitContent();
      }

      if (options.scrollToRealTime) {
        priceChart.timeScale().scrollToRealTime();
        rsiChart?.timeScale().scrollToRealTime();
      }
    },
    []
  );

  /* eslint-disable react-hooks/set-state-in-effect */
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
        // Dimensions are maintained by the ResizeObserver below. Explicitly
        // disabling auto-size prevents lightweight-charts from warning when
        // width and height are also supplied.
        autoSize: false,
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
          rightOffset: RIGHT_PADDING_BARS + CENTER_PADDING_BARS,
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
        const width = Math.max(priceContainer.clientWidth, MIN_CHART_WIDTH);

        priceChart.applyOptions({ width, height: PRICE_CHART_HEIGHT });
        rsiChart.applyOptions({ width, height: RSI_CHART_HEIGHT });
        requestAnimationFrame(() => {
          applyLatestVisibleRange();
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
      if (priceChartRef.current) {
        if (candleSeriesRef.current) priceChartRef.current.removeSeries(candleSeriesRef.current);
        if (sma20SeriesRef.current) priceChartRef.current.removeSeries(sma20SeriesRef.current);
        if (sma50SeriesRef.current) priceChartRef.current.removeSeries(sma50SeriesRef.current);
        priceChartRef.current.remove();
      }
      if (rsiChartRef.current) {
        if (rsiSeriesRef.current) rsiChartRef.current.removeSeries(rsiSeriesRef.current);
        rsiChartRef.current.remove();
      }
      priceChartRef.current = null;
      rsiChartRef.current = null;
      candleSeriesRef.current = null;
      positionPriceLinesRef.current = [];
      sma20SeriesRef.current = null;
      sma50SeriesRef.current = null;
      rsiSeriesRef.current = null;
      if (liveUpdateTimerRef.current) {
        window.clearTimeout(liveUpdateTimerRef.current);
        liveUpdateTimerRef.current = null;
      }
      pendingLiveCandleRef.current = null;
      setIsChartReady(false);
    };
  }, [applyLatestVisibleRange]);

  useEffect(() => {
    if (!isChartReady) {
      return;
    }

    const abortController = new AbortController();

    candlesRef.current = [];
    closedCandlesRef.current = [];
    pendingLiveCandleRef.current = null;
    pendingClosedCandleRef.current = null;
    if (liveUpdateTimerRef.current) {
      window.clearTimeout(liveUpdateTimerRef.current);
      liveUpdateTimerRef.current = null;
    }
    setCandles([]);
    setClosedCandles([]);
    setPositionLevels({ entry: null, stop: null, takeProfit: null });
    hasLoadedInitialRangeRef.current = false;
    planResetKeyRef.current = null;
    setIsLive(false);
    setIsLoading(true);
    setErrorMessage(null);
    setSocketError(null);

    async function loadCandles() {
      const requestStartedAt = performance.now();
      setChartRequestCount((count) => count + 1);

      try {
        const response = await fetch(
          `/api/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${HISTORY_LIMIT}`,
          { signal: abortController.signal }
        );

        setLastApiStatus(response.status);
        setLastApiLatency(Math.round(performance.now() - requestStartedAt));

        if (!response.ok) {
          throw new Error(`Server returned ${response.status}`);
        }

        const rawData = (await response.json()) as BinanceKlineResponse[];
        const nextCandles = parseKlines(rawData);
        const nextClosedCandles = parseKlines(getClosedBinanceKlines(rawData));

        if (nextCandles.length === 0) {
          throw new Error("No data returned from Binance");
        }

        if (!abortController.signal.aborted) {
          candlesRef.current = nextCandles;
          closedCandlesRef.current = nextClosedCandles;
          setCandles(nextCandles);
          setClosedCandles(nextClosedCandles);
          setIsLoading(false);
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setLastApiStatus((currentStatus) => currentStatus ?? 502);
        setLastApiLatency(Math.round(performance.now() - requestStartedAt));
        setIsLoading(false);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load chart data");
      }
    }

    loadCandles();

    return () => {
      abortController.abort();
    };
  }, [isChartReady, symbol, interval]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!activeTrade) {
      setPositionLevels({ entry: null, stop: null, takeProfit: null });
      return;
    }

    setPositionSide(activeTrade.direction === "LONG" ? "long" : "short");
    setPositionLevels({
      entry: activeTrade.entry,
      stop: activeTrade.stopLoss,
      takeProfit: activeTrade.takeProfit,
    });
  }, [activeTrade]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;

    if (!candleSeries) {
      return;
    }

    positionPriceLinesRef.current.forEach((line) => {
      candleSeries.removePriceLine(line);
    });
    positionPriceLinesRef.current = [];

    const lineConfigs = [
      positionLevels.takeProfit !== null
        ? {
            price: positionLevels.takeProfit,
            color: "#14c994",
            title: positionSide === "long" ? "TP" : "TP",
          }
        : null,
      positionLevels.entry !== null
        ? {
            price: positionLevels.entry,
            color: "#60a5fa",
            title: "ENTRY",
          }
        : null,
      positionLevels.stop !== null
        ? {
            price: positionLevels.stop,
            color: "#ff5a74",
            title: "SL",
          }
        : null,
    ].filter((config): config is { price: number; color: string; title: string } => config !== null);

    positionPriceLinesRef.current = lineConfigs.map((config) =>
      candleSeries.createPriceLine({
        price: config.price,
        color: config.color,
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: config.title,
      })
    );

    return () => {
      positionPriceLinesRef.current.forEach((line) => {
        candleSeries.removePriceLine(line);
      });
      positionPriceLinesRef.current = [];
    };
  }, [positionLevels.entry, positionLevels.stop, positionLevels.takeProfit, positionSide]);

  const flushLiveCandle = useCallback(() => {
    const candle = pendingLiveCandleRef.current;
    const closedCandle = pendingClosedCandleRef.current;

    liveUpdateTimerRef.current = null;
    pendingLiveCandleRef.current = null;
    pendingClosedCandleRef.current = null;

    if (!candle) {
      return;
    }

    const nextCandles = upsertCandle(candlesRef.current, candle);
    candlesRef.current = nextCandles;
    candleSeriesRef.current?.update(candle);
    setCandles(nextCandles);

    // Additive fan-out: the Position Manager reuses this chart stream and never alters chart, signal, or order logic.
    const positionManager = usePositionManagerStore.getState();
    positionManager.updateMarketPrice({ symbol, timeframe: interval, price: candle.close });

    if (closedCandle) {
      const nextClosedCandles = upsertCandle(closedCandlesRef.current, closedCandle);
      closedCandlesRef.current = nextClosedCandles;
      setClosedCandles(nextClosedCandles);
      tickTradeAge(Number(closedCandle.time));
      positionManager.processCompletedCandle({
        symbol,
        timeframe: interval,
        candles: nextClosedCandles.map((item) => ({
          time: Number(item.time),
          open: item.open,
          high: item.high,
          low: item.low,
          close: item.close,
          volume: item.volume,
        })),
      });
    }

    setIsLive(true);
    setSocketError(null);
  }, [interval, symbol, tickTradeAge]);

  const scheduleLiveCandle = useCallback(
    (candle: CandlePoint, isClosed: boolean) => {
      pendingLiveCandleRef.current = candle;
      if (isClosed) {
        pendingClosedCandleRef.current = candle;
      }

      if (liveUpdateTimerRef.current) {
        return;
      }

      liveUpdateTimerRef.current = window.setTimeout(flushLiveCandle, LIVE_UPDATE_MS);
    },
    [flushLiveCandle]
  );

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isChartReady || isLoading || errorMessage) {
      return;
    }

    const closeSocket = createBinanceKlineSocket({
      symbol,
      interval,
      onCandle: ({ candle, isClosed }) => {
        const nextCandle = parseKline(candle);

        if (!nextCandle) {
          return;
        }

        if (!isClosed) {
          scheduleLiveCandle(nextCandle, false);
          return;
        }

        scheduleLiveCandle(nextCandle, true);
      },
      onError: () => {
        setIsLive(false);
        setSocketError("Live stream interrupted");
      },
    });

    return () => {
      closeSocket();
      pendingLiveCandleRef.current = null;
      pendingClosedCandleRef.current = null;
      if (liveUpdateTimerRef.current) {
        window.clearTimeout(liveUpdateTimerRef.current);
        liveUpdateTimerRef.current = null;
      }
    };
  }, [errorMessage, interval, isChartReady, isLoading, scheduleLiveCandle, symbol]);

  useEffect(() => {
    if (!isChartReady || candles.length === 0) {
      return;
    }

    const sma20Data = toLineData(indicators.sma20);
    const sma50Data = toLineData(indicators.sma50);
    const rsiData = toLineData(indicators.rsi);

    if (!hasLoadedInitialRangeRef.current) {
      candleSeriesRef.current?.setData(candles);
    }
    sma20SeriesRef.current?.setData(showSma20 ? sma20Data : []);
    sma50SeriesRef.current?.setData(showSma50 ? sma50Data : []);
    rsiSeriesRef.current?.setData(showRsi ? rsiData : []);
    requestAnimationFrame(() => {
      if (!hasLoadedInitialRangeRef.current) {
        applyLatestVisibleRange({ fitContent: true, scrollToRealTime: true });
        hasLoadedInitialRangeRef.current = true;
      }
    });
  }, [candles, indicators.rsi, indicators.sma20, indicators.sma50, isChartReady, applyLatestVisibleRange, showSma20, showSma50, showRsi]);

  useEffect(() => {
    if (!indicators.snapshot) {
      return;
    }

    setIndicatorSnapshot(symbol, interval, indicators.snapshot);
  }, [indicators.snapshot, interval, setIndicatorSnapshot, symbol]);

  useEffect(() => {
    planResetKeyRef.current = `${symbol}:${interval}:${positionSide}`;
  }, [interval, positionSide, symbol]);

  useEffect(() => {
    if (!pendingRiskSyncRef.current) {
      return;
    }

    pendingRiskSyncRef.current = false;
    updateRiskInput("entryPrice", formatRiskInput(positionLevels.entry));
    updateRiskInput("stopLoss", formatRiskInput(positionLevels.stop));
    updateRiskInput("takeProfit", formatRiskInput(positionLevels.takeProfit));
    updateRiskInput("action", positionSide === "long" ? "Long" : "Short");
    updateRiskInput("atr", formatRiskInput(indicators.latestAtr));
  }, [
    indicators.latestAtr,
    positionLevels.entry,
    positionLevels.stop,
    positionLevels.takeProfit,
    positionSide,
    updateRiskInput,
  ]);

  useEffect(() => {
    if (activeTrade || pendingRiskSyncRef.current) {
      return;
    }

    const nextLevels = {
      entry: parseRiskNumber(riskEntryPrice),
      stop: parseRiskNumber(riskStopLoss),
      takeProfit: parseRiskNumber(riskTakeProfit),
    };

    if (nextLevels.entry === null && nextLevels.stop === null && nextLevels.takeProfit === null) {
      return;
    }

    const hasChanged =
      nextLevels.entry !== positionLevels.entry ||
      nextLevels.stop !== positionLevels.stop ||
      nextLevels.takeProfit !== positionLevels.takeProfit;

    if (hasChanged) {
      setPositionLevels(nextLevels);
    }

    if (riskAction === "Long" && positionSide !== "long") {
      setPositionSide("long");
    }

    if (riskAction === "Short" && positionSide !== "short") {
      setPositionSide("short");
    }
  }, [
    positionLevels.entry,
    positionLevels.stop,
    positionLevels.takeProfit,
    positionSide,
    riskAction,
    riskEntryPrice,
    riskStopLoss,
    riskTakeProfit,
    activeTrade,
  ]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!activeTrade || latestPrice === null || activeTrade.status !== "OPEN") {
      return;
    }

    const cooldownEnd = Date.now() + intervalToMs(interval) * 3;

    if (activeTrade.direction === "LONG") {
      if (latestPrice >= activeTrade.takeProfit) {
        closeTrade("TP_HIT", cooldownEnd);
      } else if (latestPrice <= activeTrade.stopLoss) {
        closeTrade("SL_HIT", cooldownEnd);
      }
      return;
    }

    if (latestPrice <= activeTrade.takeProfit) {
      closeTrade("TP_HIT", cooldownEnd);
    } else if (latestPrice >= activeTrade.stopLoss) {
      closeTrade("SL_HIT", cooldownEnd);
    }
  }, [activeTrade, closeTrade, interval, latestPrice]);

  const statusText = isLoading
    ? "Loading market data..."
    : errorMessage
    ? "Unable to load data"
    : isLive
    ? "Live stream active"
    : "Connecting live stream";
  const positionMetrics = [
    positionLevels.entry !== null ? ["Entry", formatNumber(positionLevels.entry)] : null,
    positionLevels.stop !== null ? ["Stop", formatNumber(positionLevels.stop)] : null,
    positionLevels.takeProfit !== null ? ["TP", formatNumber(positionLevels.takeProfit)] : null,
    positionRiskReward !== null ? ["RR", formatNumber(positionRiskReward, 2)] : null,
  ].filter((metric): metric is [string, string] => metric !== null);
  const emaStructure =
    indicators.latestEma20 === null || indicators.latestEma50 === null
      ? "Awaiting data"
      : indicators.latestEma20 >= indicators.latestEma50
      ? "Bullish"
      : "Bearish";
  const marketRegime = indicators.latestAdx !== null && indicators.latestAdx >= 25 ? "Directional" : "Range / transition";
  const momentumState =
    indicators.latestMacd?.histogram === null || indicators.latestMacd?.histogram === undefined
      ? "Awaiting data"
      : indicators.latestMacd.histogram >= 0
      ? "Positive"
      : "Negative";
  const volatilityState =
    indicators.latestAtr === null || latestPrice === null
      ? "Awaiting data"
      : `${formatNumber((indicators.latestAtr / latestPrice) * 100, 2)}% ATR`;
  const signalRead =
    emaStructure === "Bullish" && momentumState === "Positive"
      ? "Trend aur momentum dono buyers ko support kar rahe hain."
      : emaStructure === "Bullish" && momentumState === "Negative"
      ? "Structure bullish hai, lekin momentum weak hai — confirmation ka wait karein."
      : emaStructure === "Bearish" && momentumState === "Negative"
      ? "Sellers active hain; breakdown se pehle volume confirmation zaroori hai."
      : "Market mixed hai — range ke beech fresh entry avoid karein.";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Market</p>
          <h2 className="text-xl font-semibold text-white">{symbol}</h2>
          <p className="text-xs text-slate-400">{interval} candlesticks</p>
        </div>
        <div className="grid gap-2 text-xs sm:text-right">
          <div className="rounded-lg bg-slate-900 px-3 py-2 text-slate-300">{statusText}</div>
          {socketError ? (
            <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-amber-100">
              {socketError}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-2 rounded-lg border border-slate-800 bg-slate-950/70 p-2 text-[11px] text-slate-400 sm:grid-cols-4">
        <div>
          <span className="block uppercase tracking-[0.14em] text-slate-500">REST API</span>
          <span className={errorMessage ? "font-semibold text-amber-300" : "font-semibold text-emerald-300"}>
            {errorMessage ? "Unavailable" : isLoading ? "Checking" : "Healthy"}
          </span>
        </div>
        <div>
          <span className="block uppercase tracking-[0.14em] text-slate-500">Last response</span>
          <span className="font-semibold text-slate-200">{lastApiStatus ?? "--"}</span>
          {lastApiLatency !== null ? <span className="ml-1 text-slate-500">({lastApiLatency}ms)</span> : null}
        </div>
        <div>
          <span className="block uppercase tracking-[0.14em] text-slate-500">Chart requests</span>
          <span className="font-semibold text-slate-200">{chartRequestCount}</span>
          <span className="ml-1 text-slate-500">local</span>
        </div>
        <div>
          <span className="block uppercase tracking-[0.14em] text-slate-500">WebSocket</span>
          <span className={isLive ? "font-semibold text-emerald-300" : "font-semibold text-amber-300"}>
            {isLive ? "Connected" : "Connecting"}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-y border-slate-800 py-2">
        <label className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/50 px-2 py-1.5 text-xs text-slate-300 transition hover:border-slate-700">
          <input type="checkbox" checked={showSma20} onChange={() => setShowSma20((v) => !v)} className="h-4 w-4 accent-sky-400" />
          SMA 20
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/50 px-2 py-1.5 text-xs text-slate-300 transition hover:border-slate-700">
          <input type="checkbox" checked={showSma50} onChange={() => setShowSma50((v) => !v)} className="h-4 w-4 accent-amber-400" />
          SMA 50
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/50 px-2 py-1.5 text-xs text-slate-300 transition hover:border-slate-700">
          <input type="checkbox" checked={showRsi} onChange={() => setShowRsi((v) => !v)} className="h-4 w-4 accent-violet-400" />
          RSI 14
        </label>
      </div>

      <div className="relative overflow-hidden border border-slate-800 bg-[#020617]">
        <div ref={priceChartContainerRef} className="h-[540px] w-full" />
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 text-sm text-slate-300">
            Loading market data...
          </div>
        ) : null}
      </div>

      {tradeMetrics ? (
        <div className="grid gap-2 border border-slate-800 bg-slate-950 p-3 text-xs [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
          <span className="text-slate-400">Trade age <b className="text-white">{activeTrade?.tradeAge ?? 0}m</b></span>
          <span className="text-slate-400">PnL <b className={tradeMetrics.pnl >= 0 ? "text-emerald-300" : "text-red-300"}>{formatNumber(tradeMetrics.pnl, 4)}</b></span>
          <span className="text-slate-400">Distance TP <b className="text-white">{formatNumber(tradeMetrics.distanceTp)}</b></span>
          <span className="text-slate-400">Distance SL <b className="text-white">{formatNumber(tradeMetrics.distanceSl)}</b></span>
          <span className="text-slate-400">RR <b className="text-white">1:{formatNumber(activeTrade?.rr, 2)}</b></span>
          <span className="text-slate-400">Confidence <b className="text-white">{activeTrade?.confidence}%</b></span>
          <span className="text-slate-400">Expected reward <b className="text-white">{formatNumber(tradeMetrics.expectedReward)}</b></span>
          <span className="text-slate-400">Risk amount <b className="text-white">{formatNumber(tradeMetrics.riskAmount)}</b></span>
          <span className="text-slate-400">Market health <b className="text-white">{tradeMetrics.marketHealth}%</b></span>
          <span className="text-slate-400">Trade quality <b className="text-white">{tradeMetrics.tradeQuality}%</b></span>
        </div>
      ) : null}

      <div className="overflow-hidden border border-slate-800 bg-[#020617]">
        <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2 text-xs">
          <span className="font-semibold uppercase tracking-[0.18em] text-violet-100">RSI 14</span>
          <span className="text-slate-400">{formatNumber(indicators.latestRsi)} / 70 / 30 bands</span>
        </div>
        <div ref={rsiChartContainerRef} className="h-[88px] w-full" />
      </div>

      <section className="overflow-hidden rounded-lg border border-slate-800 bg-[linear-gradient(135deg,rgba(9,22,43,.98),rgba(4,10,24,.98))] text-xs shadow-[0_14px_32px_rgba(0,0,0,.12)]" aria-label="Adaptive market state">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 px-3 py-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400 shadow-[0_0_9px_rgba(56,189,248,.8)]" />
              <p className="uppercase tracking-[0.2em] text-slate-400">Adaptive market state</p>
            </div>
            <p className="mt-1.5 text-base font-semibold tracking-tight text-white">{marketRegime}</p>
            <p className="mt-1 text-[11px] text-slate-500">Regime first, execution second. Let price prove the next move.</p>
          </div>
          <div className="rounded-md border border-sky-400/20 bg-sky-400/5 px-2.5 py-1.5 text-right">
            <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Trend strength</p>
            <p className="mt-0.5 font-semibold text-sky-200">ADX {formatNumber(indicators.latestAdx)}</p>
          </div>
        </div>
        <div className="grid gap-2 p-3 sm:grid-cols-4">
          <StateMetric label="Structure" value={emaStructure} hint="EMA alignment" tone={emaStructure === "Bullish" ? "positive" : emaStructure === "Bearish" ? "negative" : "neutral"} />
          <StateMetric label="Momentum" value={momentumState} hint="MACD impulse" tone={momentumState === "Positive" ? "positive" : momentumState === "Negative" ? "negative" : "neutral"} />
          <StateMetric label="Volatility" value={volatilityState} hint="ATR expansion" />
          <StateMetric label="Volume context" value={`x${formatNumber(indicators.snapshot?.volumeSpike, 2)}`} hint="Relative activity" />
        </div>
        <div className="grid gap-2 border-t border-slate-800 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(240px,auto)] sm:items-stretch">
          <div className="min-w-0 rounded-md border border-slate-800 bg-[#071022] px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Signal read · Hinglish</p>
            <p className="mt-1 text-xs font-semibold leading-5 text-slate-200">{signalRead}</p>
          </div>
          <div className="rounded-md border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-[10px] text-amber-100">
            <span className="uppercase tracking-[0.16em] text-amber-300">Next step</span>
            <p className="mt-1 font-semibold leading-5">Scenario zone se bahar close confirm hone dein.</p>
          </div>
        </div>
      </section>

      <div className="grid gap-3 border border-slate-800 bg-slate-950 p-3 md:grid-cols-[auto_1fr] md:items-center">
        {positionMetrics.length > 0 ? (
          <div className="grid gap-2 text-xs [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))] md:col-span-2">
            {positionMetrics.map(([label, value]) => (
              <span key={label} className="text-slate-400">
                {label} <b className="text-white">{value}</b>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {errorMessage ? (
        <p className="rounded-lg bg-red-950/80 px-4 py-3 text-sm text-red-300">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

function StateMetric({ label, value, hint, tone = "neutral" }: { label: string; value: string; hint: string; tone?: "positive" | "negative" | "neutral" }) {
  const valueClass = tone === "positive" ? "text-emerald-300" : tone === "negative" ? "text-red-300" : "text-slate-200";

  return (
    <div className="min-w-0 rounded-md border border-slate-800 bg-[#071022] px-2.5 py-2">
      <p className="truncate text-[10px] uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className={`mt-1 truncate font-semibold ${valueClass}`}>{value}</p>
      <p className="mt-1 truncate text-[10px] text-slate-600">{hint}</p>
    </div>
  );
}

export default memo(TradingChart);
