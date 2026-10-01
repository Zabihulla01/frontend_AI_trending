"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";
import { useAnalysisStore } from "@/store/useAnalysisStore";
import { useMarketStore } from "@/store/useMarketStore";
import { getPositionKey, usePositionManagerStore } from "@/store/usePositionManagerStore";
import { calculateRisk, useRiskStore } from "@/store/useRiskStore";
import { useSetupPhase } from "@/store/useSetupPhase";
// Logic Accuracy: observation-only — capture a snapshot when a trade is locked.
// This import does NOT affect any existing trading logic.
import { useLogicAccuracyStore } from "@/store/useLogicAccuracyStore";
import styles from "./TradeSetupPanel.module.css";

function displayValue(value: string) {
  const parsed = Number(value.replace(/,/g, ""));

  if (!value.trim() || !Number.isFinite(parsed)) {
    return "--";
  }

  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(parsed);
}

function parseDisplayNumber(value: string) {
  const parsed = Number(value.replace(/,/g, ""));

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function displayLevelValue(value: string, entryValue: string) {
  const parsedValue = parseDisplayNumber(value);
  const parsedEntry = parseDisplayNumber(entryValue);

  if (parsedValue === null) {
    return "--";
  }

  const formattedValue = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(parsedValue);

  if (parsedEntry === null) {
    return formattedValue;
  }

  const changePercent = ((parsedValue - parsedEntry) / parsedEntry) * 100;
  const sign = changePercent >= 0 ? "+" : "";

  return `${formattedValue} (${sign}${changePercent.toFixed(1)}%)`;
}

function formatNumber(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "--";
  }

  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function getDirectionLabel(action: string) {
  if (action === "Long") return "BUY";
  if (action === "Short") return "SELL";
  return "NO TRADE";
}

function getTradeQuality(riskRewardRatio: number) {
  if (!Number.isFinite(riskRewardRatio) || riskRewardRatio < 1.5) return "Reject";
  if (riskRewardRatio < 2) return "Acceptable";
  if (riskRewardRatio < 3) return "Good";
  return "Excellent";
}

function getConfidenceThrottle(confidence: number | null | undefined) {
  if (confidence === null || confidence === undefined || !Number.isFinite(confidence)) return 1;
  if (confidence < 62) return 0.35;
  if (confidence < 70) return 0.5;
  if (confidence < 80) return 0.75;
  return 1;
}

export default function TradeSetupPanel() {
  const symbol = useMarketStore((state) => state.symbol);
  const interval = useMarketStore((state) => state.interval);
  const analysisResults = useAnalysisStore((state) => state.results);
  const lockPosition = usePositionManagerStore((state) => state.lockPosition);
  // Logic Accuracy: observation-only selector — does not affect trading logic
  const captureLogicSnapshot = useLogicAccuracyStore((state) => state.captureLogicSnapshot);
  const accountBalance = useRiskStore((state) => state.accountBalance);
  const riskPercentage = useRiskStore((state) => state.riskPercentage);
  const entryPrice = useRiskStore((state) => state.entryPrice);
  const stopLoss = useRiskStore((state) => state.stopLoss);
  const takeProfit = useRiskStore((state) => state.takeProfit);
  const takeProfit2 = useRiskStore((state) => state.takeProfit2);
  const atr = useRiskStore((state) => state.atr);
  const action = useRiskStore((state) => state.action);
  const targetLocked = useRiskStore((state) => state.targetLocked);
  const targetLockReason = useRiskStore((state) => state.targetLockReason);
  const recalculateMode = useRiskStore((state) => state.recalculateMode);
  const confidence = useRiskStore((state) => state.confidence);
  const positionKey = getPositionKey(symbol, interval);
  const lockedPosition = usePositionManagerStore((state) => state.positions[positionKey] ?? null);
  const setupPhase = useSetupPhase(symbol, interval);
  const inputs = useMemo(
    () => ({ accountBalance, riskPercentage, entryPrice, stopLoss, takeProfit, atr, action }),
    [accountBalance, action, atr, entryPrice, riskPercentage, stopLoss, takeProfit]
  );
  const result = useMemo(() => calculateRisk(inputs), [inputs]);
  const hasDirectionalSetup = targetLocked && (action === "Long" || action === "Short");
  const hasValidSetup = hasDirectionalSetup && !result.isRejected;
  const directionLabel = getDirectionLabel(action);
  const confidenceThrottle = getConfidenceThrottle(confidence);
  const adjustedPositionSize = result.positionSize * confidenceThrottle;
  const throttleLabel = confidenceThrottle < 1 ? `${Math.round(confidenceThrottle * 100)}% of base size` : "Full size";
  const confidenceLabel = confidence !== null && Number.isFinite(confidence) ? `${Math.round(confidence)}%` : "--";
  const invalidReason = hasDirectionalSetup
    ? result.warning ?? "Rejected because reward does not justify risk"
    : targetLockReason || "NO TRADE";
  const lockLevels = useMemo(
    () => ({
      entry: parseDisplayNumber(entryPrice),
      stopLoss: parseDisplayNumber(stopLoss),
      tp1: parseDisplayNumber(takeProfit),
      tp2: parseDisplayNumber(takeProfit2),
    }),
    [entryPrice, stopLoss, takeProfit, takeProfit2]
  );
  const canLockTrade = lockLevels.entry !== null && lockLevels.stopLoss !== null && lockLevels.tp1 !== null;
  const currentPrice = useMemo(() => {
    const latestAnalysis = analysisResults[interval as keyof typeof analysisResults];

    return latestAnalysis && Number.isFinite(latestAnalysis.lastClose) ? latestAnalysis.lastClose : null;
  }, [analysisResults, interval]);
  const isPositionActive = lockedPosition?.status === "ACTIVE";

  // ── Derived display values ────────────────────────────────────────────────
  // When a position is ACTIVE, freeze the level display to the locked snapshot
  // so that ongoing AI setup updates do not overwrite what the user traded.
  // All formatting is kept consistent with the non-active path.
  const lockedEntryNum = lockedPosition?.entry ?? null;
  const lockedEntryRef = lockedEntryNum !== null && lockedEntryNum > 0
    ? String(lockedEntryNum)
    : inputs.entryPrice;

  const displayEntry = isPositionActive && lockedEntryNum !== null
    ? formatNumber(lockedEntryNum)
    : displayValue(inputs.entryPrice);

  const displaySL = isPositionActive && lockedPosition !== null
    ? displayLevelValue(String(lockedPosition.activeStopLoss), lockedEntryRef)
    : displayLevelValue(inputs.stopLoss, inputs.entryPrice);

  const displayTP1 = isPositionActive && lockedPosition?.tp1 !== null && lockedPosition?.tp1 !== undefined
    ? displayLevelValue(String(lockedPosition.tp1), lockedEntryRef)
    : displayLevelValue(inputs.takeProfit, inputs.entryPrice);

  const displayTP2 = isPositionActive && lockedPosition?.tp2 !== null && lockedPosition?.tp2 !== undefined
    ? displayLevelValue(String(lockedPosition.tp2), lockedEntryRef)
    : displayLevelValue(takeProfit2, inputs.entryPrice);

  // Show "AI has a new setup" note only when an active position exists and the
  // current AI entry has moved more than 1 price unit away from the locked entry.
  const aiSetupDiffersFromLocked =
    isPositionActive &&
    lockLevels.entry !== null &&
    lockedEntryNum !== null &&
    Math.abs(lockLevels.entry - lockedEntryNum) > 1;

  // ── Entry-zone trigger flag ───────────────────────────────────────────────
  // Only fire the "Enter Trade Now" banner when:
  //   1. Phase has hit the triggered zone, AND
  //   2. No position is currently ACTIVE (already locked), AND
  //   3. No terminal position exists (COMPLETED / STOPPED_OUT) — these suppress
  //      the banner so it does not re-appear while the closed trade's price
  //      geometry is still in the triggered zone.
  // A manually-CLOSED position (user explicitly cleared it) allows re-entry.
  const hasTerminalPosition =
    lockedPosition !== null &&
    (lockedPosition.status === "COMPLETED" || lockedPosition.status === "STOPPED_OUT");
  const isEntryTriggered =
    setupPhase.phase === "triggered" && !isPositionActive && !hasTerminalPosition;

  const handleLockTrade = () => {
    if (!canLockTrade || lockLevels.entry === null || lockLevels.stopLoss === null || lockLevels.tp1 === null) {
      return;
    }

    lockPosition({
      symbol,
      timeframe: interval,
      direction: action === "Long" ? "LONG" : "SHORT",
      entry: lockLevels.entry,
      stopLoss: lockLevels.stopLoss,
      tp1: lockLevels.tp1,
      tp2: lockLevels.tp2,
      currentPrice: currentPrice ?? lockLevels.entry,
      quantity: adjustedPositionSize > 0 ? adjustedPositionSize : undefined,
      lockedAt: Date.now(),
    });

    // ── Logic Accuracy: observation-only ─────────────────────────────────────
    // Capture an immutable snapshot of the indicator state at this exact moment.
    // This call has zero effect on position management, trading decisions,
    // TP/SL levels, confidence, or any existing store logic.
    const latestAnalysis = analysisResults[interval as keyof typeof analysisResults] ?? null;
    const lockedAt = Date.now();
    captureLogicSnapshot({
      symbol,
      interval,
      direction: action === "Long" ? "LONG" : "SHORT",
      entry: lockLevels.entry,
      stopLoss: lockLevels.stopLoss,
      tp1: lockLevels.tp1,
      tp2: lockLevels.tp2 ?? null,
      lockedAt,
      confidence: confidence ?? 0,
      riskScore: latestAnalysis?.risk ?? "Low",
      rsi: latestAnalysis?.rsi ?? null,
      ema20: latestAnalysis?.ema20 ?? null,
      ema50: latestAnalysis?.ema50 ?? null,
      macd: latestAnalysis?.macd ?? null,
      macdHistogram: latestAnalysis?.macdHistogram ?? null,
      adx: latestAnalysis?.adx ?? null,
      vwap: latestAnalysis?.vwap ?? null,
      atr: latestAnalysis?.atr ?? null,
      volume: latestAnalysis?.currentVolume ?? 0,
      volumeSpike: latestAnalysis?.volumeSpike ?? 1,
      support: latestAnalysis?.support ?? null,
      resistance: latestAnalysis?.resistance ?? null,
      momentum: latestAnalysis?.momentum ?? 0,
      signal: latestAnalysis?.signal ?? "Neutral",
      trendStrength: latestAnalysis?.trendStrength ?? 0,
    });
    // ── End Logic Accuracy ───────────────────────────────────────────────────
  };

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <p className={styles.title}>Trade Setup</p>
        <span className={`${styles.badge} ${action === "Long" ? styles.buy : action === "Short" ? styles.sell : styles.neutral}`}>
          {directionLabel}
        </span>
      </div>

      {!hasValidSetup ? (
        <div className={styles.emptySetup}>
          <strong>NO TRADE</strong>
          <span>{invalidReason}</span>
        </div>
      ) : (
        <>
          {/* ── Entry-level-reached banner (phase = triggered, no active position) ── */}
          {isEntryTriggered && (
            <div className={styles.entryBanner}>
              <span className={styles.entryBannerIcon}>⚡</span>
              <div>
                <strong>Entry level reached</strong>
                <p>Price has crossed the setup entry. Lock to begin monitoring.</p>
              </div>
            </div>
          )}

          {/* ── Trade-entered confirmation strip (position ACTIVE) ─────────────── */}
          {isPositionActive && lockedEntryNum !== null && (
            <div className={styles.tradeEnteredStrip}>
              <span className={styles.tradeEnteredLabel}>Trade Entered</span>
              <span className={styles.tradeEnteredAt}>at {formatNumber(lockedEntryNum)}</span>
              {setupPhase.currentPrice !== null && (
                <span className={styles.tradeEnteredLive}>
                  Live: {formatNumber(setupPhase.currentPrice)}
                  {setupPhase.isPriceStale && " (stale)"}
                </span>
              )}
            </div>
          )}

          <div className={styles.levels}>
            <Level label="TP2" value={displayTP2} tone="positive" />
            <Connector tone="positive" />
            <Level
              label="TP1"
              value={displayTP1}
              tone="positive"
              badge={
                lockedPosition?.tp1HitAt != null ? (
                  <span className={styles.tp1HitBadge}>✓ HIT</span>
                ) : null
              }
            />
            <Connector tone="positive" />
            <Level label="Entry" value={displayEntry} />
            <Connector tone="negative" />
            <Level label="SL" value={displaySL} tone="negative" />
          </div>

          {/* ── New AI setup note (appears while position is active) ────────────── */}
          {aiSetupDiffersFromLocked && (
            <p className={styles.nextSetupNote}>
              AI has a new setup ready — visible after this trade closes.
            </p>
          )}

          <div className={styles.metrics}>
            <Metric label="Initial RR" value={result.riskRewardRatio > 0 ? formatNumber(result.riskRewardRatio) : "--"} />
            <Metric label="Position Size" value={formatNumber(adjustedPositionSize)} />
            <Metric label="Setup Confidence" value={confidenceLabel} />
            <Metric label="Size Adjustment" value={throttleLabel} />
            <Metric label="Trade Quality" value={getTradeQuality(result.riskRewardRatio)} />
            <Metric label="Setup State" value={setupPhase.phase.toUpperCase()} />
            <Metric label="Recalculate" value={recalculateMode} />
          </div>

          {setupPhase.phase !== "none" && (
            <div className={styles.phaseIndicator}>
              <span className={styles[`phase_${setupPhase.phase}` as keyof typeof styles]}>
                {setupPhase.phase.toUpperCase()}
              </span>
              {setupPhase.currentPrice !== null && (
                <span className={styles.livePrice}>
                  Live: {formatNumber(setupPhase.currentPrice)}
                  {setupPhase.isPriceStale && " (stale)"}
                  {!setupPhase.isLive && !setupPhase.isPriceStale && " (reconnecting)"}
                </span>
              )}
              {setupPhase.phase === "approaching" &&
                setupPhase.distanceToEntry !== null &&
                setupPhase.approachDistance !== null && (
                  <span className={styles.approachProgress}>
                    {((1 - setupPhase.distanceToEntry / setupPhase.approachDistance) * 100).toFixed(0)}% to entry
                  </span>
                )}
            </div>
          )}

          {confidenceThrottle < 1 ? (
            <p className={styles.warning}>Position size reduced because conviction is below the auto-trade threshold.</p>
          ) : null}

          <p className={styles.reason}>Reason: {targetLockReason}</p>

          {canLockTrade ? (
            <div className={styles.lockAction}>
              <button
                type="button"
                onClick={handleLockTrade}
                disabled={isPositionActive}
                className={`${styles.lockButton} ${isPositionActive ? styles.lockedButton : ""} ${isEntryTriggered ? styles.triggerButton : ""}`}
              >
                {isPositionActive ? "Trade Locked" : isEntryTriggered ? "Enter Trade Now" : "Lock Trade"}
              </button>
              <p className={styles.lockNote}>
                {isPositionActive
                  ? "This setup snapshot is being monitored by the AI Position Manager."
                  : "Locks this setup for assistant-only monitoring. No order will be placed."}
              </p>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function Level({
  label,
  value,
  tone = "neutral",
  badge,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "neutral";
  badge?: ReactNode;
}) {
  return (
    <div className={`${styles.level} ${styles[tone]}`}>
      <p>
        {label}
        {badge}
      </p>
      <strong>{value}</strong>
    </div>
  );
}

function Connector({ tone }: { tone: "positive" | "negative" }) {
  return (
    <div className={`${styles.connector} ${styles[tone]}`}>
      <span />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metric}>
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
  );
}
