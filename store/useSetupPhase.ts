import { useEffect, useMemo, useState } from "react";
import { parseRiskNumber, useRiskStore } from "@/store/useRiskStore";
import { MARKET_PRICE_STALE_MS, useMarketPriceStore } from "@/store/useMarketPriceStore";

/**
 * useSetupPhase
 *
 * Pure observation hook — no side effects on any store.
 *
 * Reads:
 *   - useRiskStore: entry, stopLoss, action, atr, targetLocked
 *     (structural setup geometry from completed-candle analysis)
 *   - useMarketPriceStore: live price keyed by symbol:interval
 *     (truly live WebSocket price from TradingChart)
 *
 * Phase definitions:
 *
 *   none        — no valid directional setup, or no live price yet
 *   detected    — valid setup exists, price is outside the approach window
 *   approaching — price is within D_approach of entry, from the correct side
 *   triggered   — price has touched or crossed the entry level
 *
 * Threshold formulas:
 *   risk       = |entry - stopLoss|
 *   D_approach = atr > 0 ? max(atr * 1.0, risk * 0.5) : risk * 0.5
 *
 * Long  approaching : currentPrice > entry  AND (currentPrice - entry) <= D_approach
 * Long  triggered   : currentPrice <= entry
 *
 * Short approaching : currentPrice < entry  AND (entry - currentPrice) <= D_approach
 * Short triggered   : currentPrice >= entry
 *
 * Stale detection:
 *   isPriceStale is true when nowMs - updatedAt > MARKET_PRICE_STALE_MS.
 *   A setInterval fires once per second and stores Date.now() in state.
 *   The useMemo consumes this state value (nowMs) instead of calling Date.now()
 *   directly, satisfying the react-hooks/purity rule while still re-evaluating
 *   staleness every second even when no WebSocket tick arrives.
 */

export type SetupPhase = "none" | "detected" | "approaching" | "triggered";

export interface SetupPhaseResult {
  /** Current lifecycle phase of the trade setup. */
  phase: SetupPhase;
  /** Last known live price (null until first WebSocket tick). */
  currentPrice: number | null;
  /** true while the WebSocket stream is connected. */
  isLive: boolean;
  /** true when no price update has arrived for MARKET_PRICE_STALE_MS ms. */
  isPriceStale: boolean;
  /** Approach window size in price units (null when setup is invalid). */
  approachDistance: number | null;
  /** |currentPrice - entry| (null when setup or price is unavailable). */
  distanceToEntry: number | null;
}

export function useSetupPhase(symbol: string, interval: string): SetupPhaseResult {
  const key = `${symbol}:${interval}`;

  // ── Risk setup inputs (structural — derived from completed candles) ────────
  const entryPrice   = useRiskStore((s) => s.entryPrice);
  const stopLoss     = useRiskStore((s) => s.stopLoss);
  const action       = useRiskStore((s) => s.action);
  const atrStr       = useRiskStore((s) => s.atr);
  // Included in hasValidSetup so the phase is inactive (none) whenever the
  // panel shows NO TRADE.  TradeSetupPanel.hasDirectionalSetup requires
  // targetLocked === true, so the phase must mirror that requirement.
  // targetLocked toggling false→true also signals that a structural trigger
  // generated fresh levels, which resets the approach thresholds even when
  // the numeric entry/sl values happen to be identical to the previous setup.
  const targetLocked = useRiskStore((s) => s.targetLocked);

  // ── Live price ─────────────────────────────────────────────────────────────
  const priceEntry = useMarketPriceStore((s) => s.prices[key] ?? null);

  // ── Stale timer ───────────────────────────────────────────────────────────
  // We store the current wall-clock time in state so that the useMemo below
  // can consume it as a stable React value rather than calling Date.now()
  // directly (which is an impure call inside a memo).  The interval fires once
  // per second, bumping nowMs and therefore re-running the memo to re-evaluate
  // staleness even when no new WebSocket tick arrives.
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);

    return () => clearInterval(id);
  }, []);

  // ── Phase computation ─────────────────────────────────────────────────────
  return useMemo(() => {
    const entry        = parseRiskNumber(entryPrice);
    const sl           = parseRiskNumber(stopLoss);
    const atr          = parseRiskNumber(atrStr);
    const currentPrice = priceEntry?.price    ?? null;
    const updatedAt    = priceEntry?.updatedAt ?? null;
    const isLive       = priceEntry?.isLive    ?? false;

    const isPriceStale =
      updatedAt === null || nowMs - updatedAt > MARKET_PRICE_STALE_MS;

    // ── Guard: need valid directional setup and a live price ─────────────────
    // targetLocked must be true so the phase is inactive whenever the panel
    // shows NO TRADE (TradeSetupPanel.hasDirectionalSetup = targetLocked &&
    // directional action).  Without this, a store that holds numeric
    // entry/SL levels but targetLocked=false (e.g. RR rejected, or a legacy
    // setup whose RR was below the publish threshold) would still advance to
    // "approaching" or "triggered" while the panel displays nothing.
    const hasValidSetup =
      targetLocked === true &&
      entry !== null &&
      sl !== null &&
      entry > 0 &&
      sl > 0 &&
      entry !== sl &&
      (action === "Long" || action === "Short");

    if (!hasValidSetup || currentPrice === null) {
      return {
        phase: "none" as SetupPhase,
        currentPrice,
        isLive,
        isPriceStale,
        approachDistance: null,
        distanceToEntry: null,
      };
    }

    // ── Threshold derivation ──────────────────────────────────────────────────
    const risk       = Math.abs(entry - sl);
    const D_approach =
      atr !== null && atr > 0
        ? Math.max(atr * 1.0, risk * 0.5)
        : risk * 0.5;

    const distanceToEntry = Math.abs(currentPrice - entry);

    // ── Long ──────────────────────────────────────────────────────────────────
    // Price travels from above (high) down toward entry.
    if (action === "Long") {
      if (currentPrice <= entry) {
        return {
          phase: "triggered" as SetupPhase,
          currentPrice,
          isLive,
          isPriceStale,
          approachDistance: D_approach,
          distanceToEntry,
        };
      }

      // currentPrice > entry here.
      if (distanceToEntry <= D_approach) {
        return {
          phase: "approaching" as SetupPhase,
          currentPrice,
          isLive,
          isPriceStale,
          approachDistance: D_approach,
          distanceToEntry,
        };
      }

      return {
        phase: "detected" as SetupPhase,
        currentPrice,
        isLive,
        isPriceStale,
        approachDistance: D_approach,
        distanceToEntry,
      };
    }

    // ── Short ─────────────────────────────────────────────────────────────────
    // Price travels from below (low) up toward entry.
    if (currentPrice >= entry) {
      return {
        phase: "triggered" as SetupPhase,
        currentPrice,
        isLive,
        isPriceStale,
        approachDistance: D_approach,
        distanceToEntry,
      };
    }

    // currentPrice < entry here.
    if (distanceToEntry <= D_approach) {
      return {
        phase: "approaching" as SetupPhase,
        currentPrice,
        isLive,
        isPriceStale,
        approachDistance: D_approach,
        distanceToEntry,
      };
    }

    return {
      phase: "detected" as SetupPhase,
      currentPrice,
      isLive,
      isPriceStale,
      approachDistance: D_approach,
      distanceToEntry,
    };

    // targetLocked is used in hasValidSetup (phase is none when the store has
    // no published setup) and also signals a fresh structural trigger: when
    // applyTradePlan regenerates a setup with the same numeric entry/sl,
    // targetLocked toggling false→true is the only signal that the geometry
    // is fresh and approach thresholds should reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryPrice, stopLoss, atrStr, action, targetLocked, priceEntry, nowMs]);
}
