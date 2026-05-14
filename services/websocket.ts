import type { BinanceKlineResponse } from "@/services/binance";

export interface BinanceLiveCandle {
  candle: BinanceKlineResponse;
  isClosed: boolean;
}

interface BinanceKlineStreamMessage {
  e: "kline";
  k: {
    t: number;
    o: string;
    h: string;
    l: string;
    c: string;
    v: string;
    T: number;
    q: string;
    n: number;
    V: string;
    Q: string;
    x: boolean;
  };
}

interface BinanceKlineSocketOptions {
  symbol: string;
  interval: string;
  onCandle: (payload: BinanceLiveCandle) => void;
  onError?: () => void;
}

interface BinanceTickerStreamMessage {
  e: "24hrMiniTicker";
  c: string;
  o: string;
  h: string;
  l: string;
  v: string;
  q: string;
}

interface BinanceTickerSocketOptions {
  symbol: string;
  onPrice: (price: number) => void;
  onError?: () => void;
}

const BINANCE_WS_BASE_URL = "wss://stream.binance.com:9443/ws";

export function createBinanceKlineSocket({
  symbol,
  interval,
  onCandle,
  onError,
}: BinanceKlineSocketOptions) {
  const streamName = `${symbol.trim().toLowerCase()}@kline_${interval.trim()}`;
  const socket = new WebSocket(`${BINANCE_WS_BASE_URL}/${streamName}`);

  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data as string) as BinanceKlineStreamMessage;

      if (message.e !== "kline" || !message.k) {
        return;
      }

      const kline = message.k;
      const candle: BinanceKlineResponse = [
        kline.t,
        kline.o,
        kline.h,
        kline.l,
        kline.c,
        kline.v,
        kline.T,
        kline.q,
        kline.n,
        kline.V,
        kline.Q,
        "0",
      ];

      onCandle({ candle, isClosed: kline.x });
    } catch {
      onError?.();
    }
  };

  socket.onerror = () => {
    onError?.();
  };

  return () => {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;

    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  };
}

export function createBinanceTickerSocket({ symbol, onPrice, onError }: BinanceTickerSocketOptions) {
  const streamName = `${symbol.trim().toLowerCase()}@miniTicker`;
  const socket = new WebSocket(`${BINANCE_WS_BASE_URL}/${streamName}`);

  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data as string) as BinanceTickerStreamMessage;
      const price = Number(message.c);

      if (Number.isFinite(price)) {
        onPrice(price);
      }
    } catch {
      onError?.();
    }
  };

  socket.onerror = () => {
    onError?.();
  };

  return () => {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;

    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  };
}
