/**
 * store/useLogicAccuracyStore.ts
 *
 * Persisted Zustand store for the Logic Accuracy / Trade Learning Engine.
 *
 * OBSERVATION ONLY — this store:
 *   - Captures an immutable LogicSnapshot when a position is locked
 *   - Records a TradeOutcome when Position Protection closes a position
 *   - Never modifies any existing store's state
 *   - Never feeds data back into live trading logic
 *
 * The subscribe observer watches usePositionManagerStore externally.
 * No existing store files are modified.
 *
 * Unique trade ID: `${positionKey}:${lockedAt}` — same symbol/timeframe can
 * have multiple trades because lockedAt differs for each lock event.
 *
 * Terminal-state detection: any non-terminal → COMPLETED | STOPPED_OUT | CLOSED.
 * Non-terminal states: "ACTIVE" (and any unknown future state that is not terminal).
 * Idempotent: once an outcome exists for a snapshotId, a second call is a no-op.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  classifyAdx,
  classifyConfidence,
  classifyEma,
  classifyMacd,
  classifyMomentum,
  classifyRsi,
  classifyVolume,
  classifyVwap,
  type CloseReason,
  type CompletedTradeRecord,
  type LogicSnapshot,
  type TradeOutcome,
} from "@/services/logicPerformance";

// ---------------------------------------------------------------------------
// Internal terminal-state helpers
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set(["COMPLETED", "STOPPED_OUT", "CLOSED"]);

function isTerminalStatus(status: string): status is CloseReason {
  return TERMINAL_STATUSES.has(status);
}

function isNonTerminalStatus(status: string): boolean {
  return !isTerminalStatus(status);
}

// ---------------------------------------------------------------------------
// Unique ID generator
// ---------------------------------------------------------------------------

/**
 * Generates a unique ID for each lock event.
 * Format: `{symbol}:{interval}:{lockedAt}:{random}`
 * This ensures two locks of the same symbol/timeframe at different times
 * each get a distinct ID.
 */
function generateSnapshotId(symbol: string, interval: string, lockedAt: number): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${symbol.toUpperCase()}:${interval}:${lockedAt}:${rand}`;
}

// ---------------------------------------------------------------------------
// Store input types
// ---------------------------------------------------------------------------

/**
 * All values needed to build a LogicSnapshot.
 * Provided by TradeSetupPanel at the moment handleLockTrade() fires.
 */
export interface CaptureSnapshotInput {
  symbol: string;
  interval: string;
  direction: "LONG" | "SHORT";
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number | null;
  lockedAt: number;

  // From useRiskStore at lock time
  confidence: number;
  riskScore: string;

  // Indicators — from useAnalysisStore / useRiskStore at lock time
  rsi: number | null;
  ema20: number | null;
  ema50: number | null;
  macd: number | null;
  macdHistogram: number | null;
  adx: number | null;
  vwap: number | null;
  atr: number | null;
  volume: number;
  volumeSpike: number;
  support: number | null;
  resistance: number | null;
  momentum: number;

  // From analysis result
  signal: string;
  trendStrength: number;
}

// ---------------------------------------------------------------------------
// Store state
// ---------------------------------------------------------------------------

interface LogicAccuracyState {
  /** Map of snapshotId → LogicSnapshot. Immutable once written. */
  snapshots: Record<string, LogicSnapshot>;

  /** Map of snapshotId → TradeOutcome. Written once when position closes. */
  outcomes: Record<string, TradeOutcome>;

  /**
   * Map of positionKey → snapshotId.
   * Used by the observer to find which snapshot belongs to a closing position.
   * A position key can be reused over time; this always holds the latest
   * snapshotId for that position key so the observer matches correctly.
   */
  positionKeyToSnapshotId: Record<string, string>;

  /** Set of snapshotIds that already have an outcome (for idempotency). */
  recordedOutcomes: Record<string, true>;

  /**
   * Capture an immutable LogicSnapshot when a position is locked.
   * Called from TradeSetupPanel.handleLockTrade() after lockPosition().
   */
  captureLogicSnapshot: (input: CaptureSnapshotInput) => string | null;

  /**
   * Record the outcome of a closed position.
   * Called by the Zustand subscribe observer — idempotent.
   * Returns true if a new outcome was recorded, false if already recorded.
   */
  recordOutcome: (input: {
    snapshotId: string;
    closeReason: CloseReason;
    entryPrice: number;
    exitPrice: number;
    lockedAt: number;
    closedAt: number;
    direction: "LONG" | "SHORT";
    originalStopLoss: number;
  }) => boolean;

  /**
   * Returns all CompletedTradeRecords (snapshot + outcome pairs).
   * Used by the UI and the pure analysis engine.
   */
  getCompletedRecords: () => CompletedTradeRecord[];

  /** Clear all data — for testing / manual reset only. */
  clearAll: () => void;
}

// ---------------------------------------------------------------------------
// R-Multiple calculation
// ---------------------------------------------------------------------------

function calculateRMultiple(
  entryPrice: number,
  exitPrice: number,
  originalStopLoss: number,
  direction: "LONG" | "SHORT"
): number {
  const risk = Math.abs(entryPrice - originalStopLoss);
  if (risk <= 0 || !Number.isFinite(risk)) return 0;

  const move =
    direction === "LONG"
      ? exitPrice - entryPrice
      : entryPrice - exitPrice;

  return Math.round((move / risk) * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useLogicAccuracyStore = create<LogicAccuracyState>()(
  persist(
    (set, get) => ({
      snapshots: {},
      outcomes: {},
      positionKeyToSnapshotId: {},
      recordedOutcomes: {},

      captureLogicSnapshot: (input) => {
        // Basic sanity — don't capture obviously invalid positions
        if (
          !input.symbol.trim() ||
          !input.interval.trim() ||
          !Number.isFinite(input.entry) ||
          input.entry <= 0 ||
          !Number.isFinite(input.stopLoss) ||
          input.stopLoss <= 0 ||
          !Number.isFinite(input.tp1) ||
          input.tp1 <= 0
        ) {
          return null;
        }

        const snapshotId = generateSnapshotId(input.symbol, input.interval, input.lockedAt);
        const positionKey = `${input.symbol.toUpperCase()}:${input.interval}`;

        const snapshot: LogicSnapshot = {
          id: snapshotId,
          symbol: input.symbol.toUpperCase(),
          interval: input.interval,
          direction: input.direction,
          entry: input.entry,
          stopLoss: input.stopLoss,
          target: input.tp1,
          target2: input.tp2,
          confidence: input.confidence,
          riskScore: input.riskScore,

          indicators: {
            rsi: input.rsi,
            ema20: input.ema20,
            ema50: input.ema50,
            macd: input.macd,
            macdHistogram: input.macdHistogram,
            adx: input.adx,
            vwap: input.vwap,
            atr: input.atr,
            volume: input.volume,
            volumeSpike: input.volumeSpike,
            support: input.support,
            resistance: input.resistance,
            momentum: input.momentum,
          },

          // Pre-classify at capture time — never updated after this point
          indicatorStates: {
            rsi: classifyRsi(input.rsi),
            ema: classifyEma(input.ema20, input.ema50),
            macd: classifyMacd(input.macdHistogram),
            adx: classifyAdx(input.adx),
            vwap: classifyVwap(input.entry, input.vwap),
            volume: classifyVolume(input.volumeSpike),
            momentum: classifyMomentum(input.momentum),
            confidence: classifyConfidence(input.confidence),
          },

          signal: input.signal,
          trendStrength: input.trendStrength,
          createdAt: input.lockedAt,
        };

        set((state) => ({
          snapshots: { ...state.snapshots, [snapshotId]: snapshot },
          // Map this position key to the latest snapshot ID
          positionKeyToSnapshotId: {
            ...state.positionKeyToSnapshotId,
            [positionKey]: snapshotId,
          },
        }));

        return snapshotId;
      },

      recordOutcome: (input) => {
        // Idempotency guard — same outcome cannot be recorded twice
        const state = get();
        if (state.recordedOutcomes[input.snapshotId]) {
          return false;
        }

        // Snapshot must exist
        const snapshot = state.snapshots[input.snapshotId];
        if (!snapshot) {
          return false;
        }

        const rMultiple = calculateRMultiple(
          input.entryPrice,
          input.exitPrice,
          input.originalStopLoss,
          input.direction
        );

        const outcome: TradeOutcome = {
          snapshotId: input.snapshotId,
          closeReason: input.closeReason,
          entryPrice: input.entryPrice,
          exitPrice: input.exitPrice,
          rMultiple,
          duration: Math.max(0, input.closedAt - input.lockedAt),
          closedAt: input.closedAt,
        };

        set((state) => ({
          outcomes: { ...state.outcomes, [input.snapshotId]: outcome },
          recordedOutcomes: { ...state.recordedOutcomes, [input.snapshotId]: true },
        }));

        return true;
      },

      getCompletedRecords: () => {
        const { snapshots, outcomes } = get();
        const records: CompletedTradeRecord[] = [];

        for (const [id, outcome] of Object.entries(outcomes)) {
          const snapshot = snapshots[id];
          if (snapshot) {
            records.push({ snapshot, outcome });
          }
        }

        // Chronological order — oldest first
        return records.sort((a, b) => a.snapshot.createdAt - b.snapshot.createdAt);
      },

      clearAll: () =>
        set({
          snapshots: {},
          outcomes: {},
          positionKeyToSnapshotId: {},
          recordedOutcomes: {},
        }),
    }),
    {
      name: "ai-trader-logic-accuracy",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        snapshots: state.snapshots,
        outcomes: state.outcomes,
        positionKeyToSnapshotId: state.positionKeyToSnapshotId,
        recordedOutcomes: state.recordedOutcomes,
      }),
    }
  )
);

// ---------------------------------------------------------------------------
// Position close observer
// ---------------------------------------------------------------------------

/**
 * Subscribes to usePositionManagerStore and records outcomes when positions
 * transition from any non-terminal state to a terminal state.
 *
 * This function must be called once at app startup (from a top-level component
 * or layout). It is safe to call multiple times — the unsubscribe function
 * returned by the first call should be retained.
 *
 * IMPORTANT: This observer is entirely passive. It reads from
 * usePositionManagerStore but never writes to it or any other existing store.
 */
export function initPositionCloseObserver(): () => void {
  // Lazy import to avoid circular references at module load time.
  // The import is deferred until this function is actually called (at runtime).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { usePositionManagerStore } = require("@/store/usePositionManagerStore") as typeof import("@/store/usePositionManagerStore");

  return usePositionManagerStore.subscribe((state, prevState) => {
    const accuracyStore = useLogicAccuracyStore.getState();

    for (const [positionKey, position] of Object.entries(state.positions)) {
      const prevPosition = prevState.positions[positionKey];

      // We need a transition: previous status was non-terminal, current is terminal
      const prevStatus = prevPosition?.status ?? "ACTIVE";
      const currStatus = position.status;

      if (!isTerminalStatus(currStatus)) continue;
      if (!isNonTerminalStatus(prevStatus)) continue;

      // Find the snapshot ID for this position key
      const snapshotId = accuracyStore.positionKeyToSnapshotId[positionKey];
      if (!snapshotId) continue;

      // Determine the close timestamp from the timeline if available
      const closedEvent = [...(position.timeline ?? [])]
        .reverse()
        .find((ev) => ev.type === "TRADE_CLOSED");
      const closedAt = closedEvent?.timestamp ?? Date.now();

      // Snapshot must exist and contain a lockedAt
      const snapshot = accuracyStore.snapshots[snapshotId];
      if (!snapshot) continue;

      accuracyStore.recordOutcome({
        snapshotId,
        closeReason: currStatus as CloseReason,
        entryPrice: position.entry,
        exitPrice: position.currentPrice,
        lockedAt: snapshot.createdAt,
        closedAt,
        direction: position.direction as "LONG" | "SHORT",
        originalStopLoss: position.originalStopLoss,
      });
    }
  });
}
