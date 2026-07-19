/**
 * WebSocket service — Phase 1
 *
 * Replaces the bare WebSocket wrappers with a managed connection that provides:
 *   - Exponential backoff reconnect: 1s → 2s → 5s → 10s → 30s → 60s (cap)
 *   - Stale-data detection: no message for STALE_MS → status = "STALE"
 *   - Connection status emitted on every change: "LIVE" | "RECONNECTING" | "STALE"
 *   - Never silently fails — always calls onStatusChange
 *   - Clean teardown: close code 1000 suppresses reconnect
 *
 * Public API is backwards-compatible with the old createBinanceKlineSocket /
 * createBinanceTickerSocket signatures so existing callers continue to work.
 * New callers can pass onStatusChange to receive granular status updates.
 */

import type { BinanceKlineResponse } from "@/services/binance";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConnectionStatus = "LIVE" | "RECONNECTING" | "STALE";

export interface BinanceLiveCandle {
  candle: BinanceKlineResponse;
  isClosed: boolean;
  eventTime: number | null;
  receivedAt: number;
  socketLatencyMs: number | null;
}

// ---------------------------------------------------------------------------
// Internal backoff schedule (ms)
// ---------------------------------------------------------------------------

const BACKOFF_SCHEDULE_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000] as const;

function getBackoffMs(attempt: number): number {
  return BACKOFF_SCHEDULE_MS[Math.min(attempt, BACKOFF_SCHEDULE_MS.length - 1)];
}

// ---------------------------------------------------------------------------
// Core managed socket factory
// ---------------------------------------------------------------------------

interface ManagedSocketOptions<T> {
  url: string;
  parseMessage: (raw: string) => T | null;
  onMessage: (data: T) => void;
  onStatusChange: (status: ConnectionStatus) => void;
  /** How long (ms) without a message before the stream is marked STALE. Default 12 000. */
  staleThresholdMs?: number;
}

function createManagedSocket<T>(options: ManagedSocketOptions<T>): () => void {
  const { url, parseMessage, onMessage, onStatusChange, staleThresholdMs = 12_000 } = options;

  let socket: WebSocket | null = null;
  let disposed = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let staleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastStatus: ConnectionStatus | null = null;

  function emit(status: ConnectionStatus) {
    if (status !== lastStatus) {
      lastStatus = status;
      onStatusChange(status);
    }
  }

  function clearTimers() {
    if (reconnectTimer !== null) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (staleTimer !== null)     { clearTimeout(staleTimer);     staleTimer = null;     }
  }

  function armStaleTimer() {
    if (staleTimer !== null) clearTimeout(staleTimer);
    staleTimer = setTimeout(() => {
      if (!disposed) emit("STALE");
    }, staleThresholdMs);
  }

  function connect() {
    if (disposed) return;
    clearTimers();

    try {
      socket = new WebSocket(url);
    } catch {
      // Invalid URL — treat as permanent failure
      emit("STALE");
      return;
    }

    socket.onopen = () => {
      if (disposed) { socket?.close(1000); return; }
      attempt = 0;
      emit("LIVE");
      armStaleTimer();
    };

    socket.onmessage = (event: MessageEvent) => {
      if (disposed) return;
      armStaleTimer();
      emit("LIVE");
      try {
        const parsed = parseMessage(event.data as string);
        if (parsed !== null) onMessage(parsed);
      } catch {
        // Malformed frame — keep connection, ignore message
      }
    };

    socket.onerror = () => {
      // Always followed by onclose — handle reconnect there
    };

    socket.onclose = (ev: CloseEvent) => {
      if (disposed) return;
      clearTimers();
      // 1000 / 1001 = intentional close, don't reconnect
      if (ev.code === 1000 || ev.code === 1001) return;
      emit("RECONNECTING");
      reconnectTimer = setTimeout(() => {
        attempt += 1;
        connect();
      }, getBackoffMs(attempt));
    };
  }

  connect();

  return () => {
    disposed = true;
    clearTimers();
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, "unmounted");
      }
      socket = null;
    }
  };
}

// ---------------------------------------------------------------------------
// Binance kline stream message shape
// ---------------------------------------------------------------------------

interface BinanceKlineFrame {
  e: "kline";
  E?: number;
  k: {
    t: number; o: string; h: string; l: string; c: string; v: string;
    T: number; q: string; n: number; V: string; Q: string; x: boolean;
  };
}

interface BinanceTickerFrame {
  e: "24hrMiniTicker";
  c: string; o: string; h: string; l: string; v: string; q: string;
}

// ---------------------------------------------------------------------------
// Public: kline socket
// ---------------------------------------------------------------------------

export interface BinanceKlineSocketOptions {
  symbol: string;
  interval: string;
  onCandle: (payload: BinanceLiveCandle) => void;
  /** Called on every status transition. Replaces the old onError callback. */
  onStatusChange?: (status: ConnectionStatus) => void;
  /** @deprecated Use onStatusChange instead */
  onError?: () => void;
  staleThresholdMs?: number;
}

export function createBinanceKlineSocket(options: BinanceKlineSocketOptions): () => void {
  const { symbol, interval, onCandle, onStatusChange, onError, staleThresholdMs } = options;
  const streamName = `${symbol.trim().toLowerCase()}@kline_${interval.trim()}`;
  const url = `wss://stream.binance.com:9443/ws/${streamName}`;

  return createManagedSocket<BinanceKlineFrame>({
    url,
    staleThresholdMs,
    parseMessage: (raw) => {
      const msg = JSON.parse(raw) as BinanceKlineFrame;
      return msg.e === "kline" && msg.k ? msg : null;
    },
    onMessage: (msg) => {
      const receivedAt = Date.now();
      const k = msg.k;
      const candle: BinanceKlineResponse = [
        k.t, k.o, k.h, k.l, k.c, k.v, k.T, k.q, k.n, k.V, k.Q, "0",
      ];
      const eventTime = Number.isFinite(msg.E) ? msg.E ?? null : null;
      const socketLatencyMs = eventTime !== null ? Math.max(0, receivedAt - eventTime) : null;
      onCandle({ candle, isClosed: k.x, eventTime, receivedAt, socketLatencyMs });
    },
    onStatusChange: (status) => {
      onStatusChange?.(status);
      if ((status === "RECONNECTING" || status === "STALE") && onError) {
        onError();
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Public: ticker socket
// ---------------------------------------------------------------------------

export interface BinanceTickerSocketOptions {
  symbol: string;
  onPrice: (price: number) => void;
  onStatusChange?: (status: ConnectionStatus) => void;
  /** @deprecated Use onStatusChange instead */
  onError?: () => void;
  staleThresholdMs?: number;
}

export function createBinanceTickerSocket(options: BinanceTickerSocketOptions): () => void {
  const { symbol, onPrice, onStatusChange, onError, staleThresholdMs } = options;
  const streamName = `${symbol.trim().toLowerCase()}@miniTicker`;
  const url = `wss://stream.binance.com:9443/ws/${streamName}`;

  return createManagedSocket<BinanceTickerFrame>({
    url,
    staleThresholdMs,
    parseMessage: (raw) => {
      const msg = JSON.parse(raw) as BinanceTickerFrame;
      return msg.c ? msg : null;
    },
    onMessage: (msg) => {
      const price = Number(msg.c);
      if (Number.isFinite(price)) onPrice(price);
    },
    onStatusChange: (status) => {
      onStatusChange?.(status);
      if ((status === "RECONNECTING" || status === "STALE") && onError) {
        onError();
      }
    },
  });
}
