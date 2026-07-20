import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  evaluatePosition,
  getPositionKey as createPositionKey,
  type ManagedPosition,
  type PositionCandle,
  type PositionDirection,
  type PositionEventType,
  type PositionNotification,
  type PositionRecommendation,
  type PositionRecommendationSnapshot,
  type PositionStatus,
  type PositionTimelineEvent,
} from "@/services/positionManager";

export { getPositionKey } from "@/services/positionManager";
export type {
  ManagedPosition,
  PositionCandle,
  PositionDirection,
  PositionNotification,
  PositionRecommendation,
  PositionRecommendationSnapshot,
  PositionStatus,
  PositionTimelineEvent,
} from "@/services/positionManager";

export interface PositionLockInput {
  symbol: string;
  timeframe: string;
  direction: PositionDirection;
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2?: number | null;
  currentPrice?: number;
  quantity?: number;
  lockedAt?: number;
}

interface PositionManagerState {
  positions: Record<string, ManagedPosition>;
  getPositionKey: (symbol: string, timeframe: string) => string;
  lockPosition: (input: PositionLockInput) => ManagedPosition | null;
  updateMarketPrice: (input: { symbol: string; timeframe: string; price: number }) => void;
  processCompletedCandle: (input: { symbol: string; timeframe: string; candles: PositionCandle[] }) => void;
  closePosition: (input: { key: string }) => void;
  acknowledgeSuggestedStopMove: (input: { key: string }) => void;
  dismissNotification: (input: { id: string }) => void;
}

const MAX_TIMELINE_EVENTS = 60;
const MAX_NOTIFICATIONS = 12;

function createId(prefix: string, timestamp = Date.now()) {
  return `${prefix}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
}

function isValidPrice(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0;
}

function createEvent(
  type: PositionEventType,
  message: string,
  timestamp: number,
  recommendation?: PositionRecommendation
): PositionTimelineEvent {
  return { id: createId(type.toLowerCase(), timestamp), type, timestamp, message, recommendation };
}

function createInitialRecommendation(position: Pick<ManagedPosition, "entry" | "currentPrice" | "originalStopLoss" | "direction" | "quantity">, now: number) {
  const risk = Math.abs(position.entry - position.originalStopLoss);
  const directionMultiplier = position.direction === "LONG" ? 1 : -1;
  const move = (position.currentPrice - position.entry) * directionMultiplier;
  const pnl = move * position.quantity;

  return {
    recommendation: "HOLD" as const,
    confidence: 50,
    exitScore: 50,
    holdScore: 50,
    currentProfit: Math.max(0, pnl),
    currentLoss: Math.max(0, -pnl),
    currentRR: risk > 0 ? move / risk : 0,
    holdingTime: 0,
    marketHealth: 50,
    trendStrength: 50,
    reasoning: [
      "Trade snapshot locked.",
      "Guidance will update after the next completed candle using the available market data.",
    ],
    generatedAt: now,
    suggestedStopLoss: null,
  };
}

function makeRecommendationNotification(position: ManagedPosition, recommendation: PositionRecommendationSnapshot, timestamp: number): PositionNotification {
  return {
    id: createId("recommendation", timestamp),
    positionKey: position.key,
    recommendation: recommendation.recommendation,
    createdAt: timestamp,
    dismissed: false,
    message: `AI Position Manager changed guidance to ${recommendation.recommendation}.`,
  };
}

export const usePositionManagerStore = create<PositionManagerState>()(
  persist(
    (set) => ({
      positions: {},
      getPositionKey: createPositionKey,
      lockPosition: (input) => {
        if (
          !input.symbol.trim() ||
          !input.timeframe.trim() ||
          !isValidPrice(input.entry) ||
          !isValidPrice(input.stopLoss) ||
          !isValidPrice(input.tp1) ||
          input.entry === input.stopLoss
        ) {
          return null;
        }

        const key = createPositionKey(input.symbol, input.timeframe);
        const now = input.lockedAt ?? Date.now();
        const currentPrice = isValidPrice(input.currentPrice) ? input.currentPrice : input.entry;
        const quantity = isValidPrice(input.quantity) ? input.quantity : 1;
        let lockedPosition: ManagedPosition | null = null;

        set((state) => {
          const existing = state.positions[key];
          if (existing?.status === "ACTIVE") {
            lockedPosition = existing;
            return state;
          }

          const basePosition = {
            key,
            symbol: input.symbol.trim().toUpperCase(),
            timeframe: input.timeframe.trim(),
            direction: input.direction,
            entry: input.entry,
            originalStopLoss: input.stopLoss,
            activeStopLoss: input.stopLoss,
            tp1: input.tp1,
            tp2: isValidPrice(input.tp2) ? input.tp2 : null,
            currentPrice,
            quantity,
            lockedAt: now,
          } as const;
          const position: ManagedPosition = {
            ...basePosition,
            status: "ACTIVE",
            tp1HitAt: null,
            trailingActive: false,
            timeline: [
              createEvent("TRADE_LOCKED", "Trade locked for assistant-only monitoring.", now),
              createEvent("TRADE_STARTED", "Position monitoring started. No order was sent.", now),
            ],
            notifications: [],
            lastRecommendation: createInitialRecommendation(basePosition, now),
          };
          lockedPosition = position;

          return { positions: { ...state.positions, [key]: position } };
        });

        return lockedPosition;
      },
      updateMarketPrice: ({ symbol, timeframe, price }) => {
        if (!isValidPrice(price)) return;

        const key = createPositionKey(symbol, timeframe);
        set((state) => {
          const position = state.positions[key];
          if (!position || position.status !== "ACTIVE" || position.currentPrice === price) return state;

          return { positions: { ...state.positions, [key]: { ...position, currentPrice: price } } };
        });
      },
      processCompletedCandle: ({ symbol, timeframe, candles }) => {
        const key = createPositionKey(symbol, timeframe);
        set((state) => {
          const position = state.positions[key];
          if (!position || position.status !== "ACTIVE") return state;

          const evaluation = evaluatePosition(position, candles);
          if (!evaluation) return state;

          const timestamp = evaluation.recommendation.generatedAt;
          const priorRecommendation = position.lastRecommendation?.recommendation;
          const recommendationChanged = priorRecommendation !== evaluation.recommendation.recommendation;
          const timeline = [...position.timeline];
          let status: PositionStatus = position.status;

          if (evaluation.tp1Hit) {
            timeline.push(
              createEvent(
                "TP1_HIT",
                "TP1 reached on a completed candle. Consider booking partial profit manually.",
                timestamp,
                evaluation.recommendation.recommendation
              )
            );
          }

          if (evaluation.stopLossHit) {
            status = "STOPPED_OUT";
            timeline.push(createEvent("STOP_LOSS_HIT", "Stop-loss level reached on a completed candle.", timestamp, "STOP LOSS HIT"));
            timeline.push(createEvent("TRADE_CLOSED", "Monitoring stopped after the stop-loss level was reached.", timestamp));
          } else if (evaluation.tp2Hit) {
            status = "COMPLETED";
            timeline.push(createEvent("TP2_HIT", "TP2 reached on a completed candle. Consider closing any remaining position manually.", timestamp, "TP2 HIT"));
            timeline.push(createEvent("TRADE_CLOSED", "Monitoring completed after TP2 was reached.", timestamp));
          } else if (evaluation.recommendation.recommendation === "EXIT NOW" && recommendationChanged) {
            timeline.push(
              createEvent(
                "EXIT_RECOMMENDATION",
                "Exit guidance changed based on the completed candle. Review the position manually.",
                timestamp,
                "EXIT NOW"
              )
            );
          }

          const nextPosition: ManagedPosition = {
            ...position,
            currentPrice: candles.at(-1)?.close ?? position.currentPrice,
            status,
            tp1HitAt: evaluation.tp1Hit ? timestamp : position.tp1HitAt,
            timeline: timeline.slice(-MAX_TIMELINE_EVENTS),
            notifications: recommendationChanged
              ? [...position.notifications, makeRecommendationNotification(position, evaluation.recommendation, timestamp)].slice(-MAX_NOTIFICATIONS)
              : position.notifications,
            lastRecommendation: evaluation.recommendation,
          };

          return { positions: { ...state.positions, [key]: nextPosition } };
        });
      },
      closePosition: ({ key }) => {
        const now = Date.now();
        set((state) => {
          const position = state.positions[key];
          if (!position || position.status !== "ACTIVE") return state;

          const nextPosition: ManagedPosition = {
            ...position,
            status: "CLOSED",
            timeline: [...position.timeline, createEvent("TRADE_CLOSED", "Position marked closed manually. Monitoring stopped.", now)].slice(
              -MAX_TIMELINE_EVENTS
            ),
          };

          return { positions: { ...state.positions, [key]: nextPosition } };
        });
      },
      acknowledgeSuggestedStopMove: ({ key }) => {
        const now = Date.now();
        set((state) => {
          const position = state.positions[key];
          const recommendation = position?.lastRecommendation;
          const suggestedStop = recommendation?.suggestedStopLoss;
          const isTrailing = recommendation?.recommendation === "MOVE STOP LOSS TO TRAILING";
          const isBreakeven = recommendation?.recommendation === "MOVE STOP LOSS TO BREAKEVEN" || recommendation?.recommendation === "BOOK PARTIAL PROFIT";

          if (!position || position.status !== "ACTIVE" || !isValidPrice(suggestedStop) || (!isTrailing && !isBreakeven)) {
            return state;
          }

          const eventType: PositionEventType = isTrailing ? "TRAILING_ACTIVATED" : "SL_MOVED";
          const message = isTrailing
            ? "Trailing-stop suggestion recorded. Update any exchange order yourself."
            : "Breakeven-stop suggestion recorded. Update any exchange order yourself.";
          const nextPosition: ManagedPosition = {
            ...position,
            activeStopLoss: suggestedStop,
            trailingActive: isTrailing || position.trailingActive,
            timeline: [...position.timeline, createEvent(eventType, message, now, recommendation?.recommendation)].slice(
              -MAX_TIMELINE_EVENTS
            ),
          };

          return { positions: { ...state.positions, [key]: nextPosition } };
        });
      },
      dismissNotification: ({ id }) =>
        set((state) => {
          let changed = false;
          const positions = Object.fromEntries(
            Object.entries(state.positions).map(([key, position]) => {
              const notifications = position.notifications.map((notification) => {
                if (notification.id !== id || notification.dismissed) return notification;
                changed = true;
                return { ...notification, dismissed: true };
              });
              return [key, notifications === position.notifications ? position : { ...position, notifications }];
            })
          ) as Record<string, ManagedPosition>;

          return changed ? { positions } : state;
        }),
    }),
    {
      name: "ai-trader-position-manager",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ positions: state.positions }),
    }
  )
);
