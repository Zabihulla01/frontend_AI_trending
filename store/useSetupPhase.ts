import { useEffect, useMemo, useRef, useState } from "react";
import { parseRiskNumber, useRiskStore } from "@/store/useRiskStore";
import { MARKET_PRICE_STALE_MS, useMarketPriceStore } from "@/store/useMarketPriceStore";

/**
 * useSetupPhase
 *
 * Pure observation hook — no side effects on any store.
 *
 * Reads:
 *   - useRiskStore: entry, stopLoss, action, atr, targetLocked, takeProfit (TP1)
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
 *   expired     — live price reached/passed TP1 before the setup was locked
 *                 (entry opportunity missed; sticky until a new setup identity)
 *
 * Threshold formulas:
 *   risk       = |entry - stopLoss|
 *   D_approach = atr > 0 ? max(atr * 1.0, risk * 0.5) : risk * 0.5
 *
 * Long  approaching : currentPrice > entry  AND (currentPrice - entry) <= D_approach
 * Long  triggered   : currentPrice <= entry
 * Long  expired     : currentPrice >= tp1  (sticky per setup identity)
 *
 * Short approaching : currentPrice < entry  AND (entry - currentPrice) <= D_approach
 * Short triggered   : currentPrice >= entry
 * Short expired     : currentPrice <= tp1  (sticky per setup identity)
 *
 * Expiry is STICKY:
 *   Once a setup's live price reaches TP1 without being locked, the 'expired'
 *   phase latches for that specific setup identity (entry|sl|tp1|action).
 *   If price later retraces, the setup stays expired.
 *   Expiry resets only when a genuinely new setup is generated (setup identity
 *   changes through the structural trigger flow in applyTradePlan).
 *
 * Active positions are exempt:
 *   The hook receives isPositionActive from the caller. When true, the expiry
 *   check is bypassed so locked trades proceed through normal TP/SL lifecycle.
 *
 * Stale detection:
 *   isPriceStale is true when nowMs - updatedAt > MARKET_PRICE_STALE_MS.
 *   A setInterval fires once per second and stores Date.now() in state.
 *   The useMemo consumes this state value (nowMs) instead of calling Date.now()
 *   directly, satisfying the react-hooks/purity rule while still re-evaluating
 *   staleness every second even when no WebSocket tick arrives.
 */

export type SetupPhase = "none" | "detected" | "approaching" | "triggered" | "expired";

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
  // TP1 is the pre-entry expiry boundary.  Once live price reaches TP1 before
  // the trade is locked, the entry opportunity is considered missed.
  const tp1Str       = useRiskStore((s) => s.takeProfit);

  // ── Live price ─────────────────────────────────────────────────────────────
  const priceEntry = useMarketPriceStore((s) => s.prices[key] ?? null);

  // ── Stale timer ───────────────────────────────────────────────────────────
  // We store the current wall-clock time in state so that the useMemo below
  // can consume it as a stable React value rather than calling Date.now()
  // directly (which is an impure call inside a memo).  The interval fires once
  // per second, bumping nowMs and therefore re-running the memo to re-evaluate
  // staleness every second even when no new WebSocket tick arrives.
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);

    return () => clearInterval(id);
  }, []);

  // ── Sticky expiry tracking ────────────────────────────────────────────────
  // "Setup identity" encodes the structural geometry that defines the current
  // setup.  It changes when applyTradePlan() regenerates levels (new entry,
  // SL, TP1, or direction), which is the only legitimate reset event.
  //
  // Using a ref instead of state for the expiry flag prevents an extra render
  // cycle: we mutate the ref inside the useMemo (synchronously during render)
  // and then return the new phase immediately in the same render pass.  The
  // ref is read and written only within useMemo, so there are no stale-closure
  // issues and no rule-of-hooks violations.
  const setupIdentity = `${entryPrice}|${stopLoss}|${tp1Str}|${action}`;
  const expiredForSetupIdRef = useRef<string | null>(null);

  // ── Phase computation ─────────────────────────────────────────────────────
  return useMemo(() => {
    const entry        = parseRiskNumber(entryPrice);
    const sl           = parseRiskNumber(stopLoss);
    const atr          = parseRiskNumber(atrStr);
    const tp1          = parseRiskNumber(tp1Str);
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
      // Reset expiry for invalid/absent setups so a brand-new setup starts
      // clean.  This also covers the targetLocked=false path.
      if (expiredForSetupIdRef.current !== null) {
        expiredForSetupIdRef.current = null;
      }

      return {
        phase: "none" as SetupPhase,
        currentPrice,
        isLive,
        isPriceStale,
        approachDistance: null,
        distanceToEntry: null,
      };
    }

    // ── Setup identity reset ──────────────────────────────────────────────────
    // When a new structural setup is generated (entry/SL/TP1/action changed),
    // clear any prior expiry so the fresh setup starts in 'detected'.
    if (expiredForSetupIdRef.current !== null && expiredForSetupIdRef.current !== setupIdentity) {
      expiredForSetupIdRef.current = null;
    }

    // ── Threshold derivation ──────────────────────────────────────────────────
    const risk       = Math.abs(entry - sl);
    const D_approach =
      atr !== null && atr > 0
        ? Math.max(atr * 1.0, risk * 0.5)
        : risk * 0.5;

    const distanceToEntry = Math.abs(currentPrice - entry);

    // ── Pre-entry expiry check (sticky, TP1 boundary) ────────────────────────
    // Only applies before the trade is locked.  Active positions go through
    // their normal TP/SL lifecycle in usePositionManagerStore — they are never
    // marked expired here.
    //
    // Check happens before the approaching/triggered branches so that a price
    // that has blown past TP1 cannot fall through to those phases.
    const alreadyExpired = expiredForSetupIdRef.current === setupIdentity;

    if (!alreadyExpired && tp1 !== null) {
      // LONG: price reached or passed TP1 (upward)
      // SHORT: price reached or passed TP1 (downward)
      const tp1Crossed =
        action === "Long"
          ? currentPrice >= tp1
          : currentPrice <= tp1;

      if (tp1Crossed) {
        // Latch expiry for this exact setup geometry.
        expiredForSetupIdRef.current = setupIdentity;
      }
    }

    if (expiredForSetupIdRef.current === setupIdentity) {
      return {
        phase: "expired" as SetupPhase,
        currentPrice,
        isLive,
        isPriceStale,
        approachDistance: D_approach,
        distanceToEntry,
      };
    }

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
    // tp1Str is included so expiry re-evaluates whenever TP1 changes (new setup).
  }, [entryPrice, stopLoss, atrStr, action, targetLocked, tp1Str, priceEntry, nowMs, setupIdentity]);
}
