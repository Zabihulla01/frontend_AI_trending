import { create } from "zustand";

export type TradeDirection = "LONG" | "SHORT";
export type TradeStatus = "OPEN" | "TP_HIT" | "SL_HIT" | "CLOSED";

export interface ActiveTrade {
  entry: number;
  stopLoss: number;
  takeProfit: number;
  direction: TradeDirection;
  status: TradeStatus;
  createdAt: number;
  confidence: number;
  rr: number;
  tradeAge: number;
}

interface OpenTradeInput {
  entry: number;
  stopLoss: number;
  takeProfit: number;
  direction: TradeDirection;
  confidence: number;
  rr: number;
  createdAt?: number;
}

interface TradeState {
  activeTrade: ActiveTrade | null;
  lastStatus: TradeStatus | null;
  isAuto: boolean;
  isPaused: boolean;
  isLocked: boolean;
  cooldownUntil: number;
  forceNonce: number;
  openTrade: (trade: OpenTradeInput) => void;
  closeTrade: (status?: TradeStatus, cooldownUntil?: number) => void;
  updateTrade: (trade: Partial<ActiveTrade>) => void;
  updateStatus: (status: TradeStatus, cooldownUntil?: number) => void;
  pauseTrade: () => void;
  resumeTrade: () => void;
  lockTrade: () => void;
  unlockTrade: () => void;
  setAuto: (enabled: boolean) => void;
  resetTrade: () => void;
  requestNewTrade: () => void;
  tickTradeAge: (currentCandleTime?: number) => void;
}

function isValidTrade(trade: OpenTradeInput) {
  return (
    Number.isFinite(trade.entry) &&
    Number.isFinite(trade.stopLoss) &&
    Number.isFinite(trade.takeProfit) &&
    trade.entry > 0 &&
    trade.stopLoss > 0 &&
    trade.takeProfit > 0
  );
}

export const useTradeStore = create<TradeState>((set) => ({
  activeTrade: null,
  lastStatus: null,
  // Automatic trade simulation is opt-in. The dashboard has no exchange
  // execution and must not create hidden positions without user action.
  isAuto: false,
  isPaused: false,
  isLocked: false,
  cooldownUntil: 0,
  forceNonce: 0,
  openTrade: (trade) => {
    if (!isValidTrade(trade)) {
      return;
    }

    set((state) => {
      if (state.isLocked && state.activeTrade) {
        return state;
      }

      const createdAt = trade.createdAt ?? Date.now();

      return {
        activeTrade: {
          entry: trade.entry,
          stopLoss: trade.stopLoss,
          takeProfit: trade.takeProfit,
          direction: trade.direction,
          status: "OPEN",
          createdAt,
          confidence: Math.round(trade.confidence),
          rr: trade.rr,
          tradeAge: 0,
        },
        lastStatus: "OPEN",
      };
    });
  },
  closeTrade: (status = "CLOSED", cooldownUntil) =>
    set((state) => ({
      activeTrade: null,
      lastStatus: status,
      cooldownUntil: cooldownUntil ?? state.cooldownUntil,
    })),
  updateTrade: (trade) =>
    set((state) => {
      if (!state.activeTrade || state.isLocked) {
        return state;
      }

      return {
        activeTrade: {
          ...state.activeTrade,
          ...trade,
        },
      };
    }),
  updateStatus: (status, cooldownUntil) =>
    set((state) => ({
      activeTrade: state.activeTrade ? { ...state.activeTrade, status } : null,
      lastStatus: status,
      cooldownUntil: cooldownUntil ?? state.cooldownUntil,
    })),
  pauseTrade: () => set({ isPaused: true }),
  resumeTrade: () => set({ isPaused: false }),
  lockTrade: () => set({ isLocked: true }),
  unlockTrade: () => set({ isLocked: false }),
  setAuto: (enabled) => set({ isAuto: enabled }),
  resetTrade: () =>
    set({
      activeTrade: null,
      lastStatus: null,
      cooldownUntil: 0,
      isLocked: false,
    }),
  requestNewTrade: () => set((state) => ({ forceNonce: state.forceNonce + 1, cooldownUntil: 0 })),
  tickTradeAge: (currentCandleTime) =>
    set((state) => {
      if (!state.activeTrade) {
        return state;
      }

      const age = currentCandleTime
        ? Math.max(0, Math.round((currentCandleTime * 1000 - state.activeTrade.createdAt) / 60000))
        : state.activeTrade.tradeAge + 1;

      return {
        activeTrade: {
          ...state.activeTrade,
          tradeAge: age,
        },
      };
    }),
}));
