"use client";

import { useMemo } from "react";
import { useAnalysisStore } from "@/store/useAnalysisStore";
import { useMarketStore } from "@/store/useMarketStore";
import { getPositionKey, usePositionManagerStore } from "@/store/usePositionManagerStore";
import { calculateRisk, useRiskStore } from "@/store/useRiskStore";
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
    const matchingTimeframe = Object.values(analysisResults).find((analysis) => analysis?.timeframe === interval);
    const latestAnalysis = matchingTimeframe ?? Object.values(analysisResults).find((analysis) => analysis !== undefined);

    return latestAnalysis && Number.isFinite(latestAnalysis.lastClose) ? latestAnalysis.lastClose : null;
  }, [analysisResults, interval]);
  const isPositionActive = lockedPosition?.status === "ACTIVE";

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
          <div className={styles.levels}>
            <Level label="TP2" value={displayLevelValue(takeProfit2, inputs.entryPrice)} tone="positive" />
            <Connector tone="positive" />
            <Level label="TP1" value={displayLevelValue(inputs.takeProfit, inputs.entryPrice)} tone="positive" />
            <Connector tone="positive" />
            <Level label="Entry" value={displayValue(inputs.entryPrice)} />
            <Connector tone="negative" />
            <Level label="SL" value={displayLevelValue(inputs.stopLoss, inputs.entryPrice)} tone="negative" />
          </div>

          <div className={styles.metrics}>
            <Metric label="Initial RR" value={result.riskRewardRatio > 0 ? formatNumber(result.riskRewardRatio) : "--"} />
            <Metric label="Position Size" value={formatNumber(adjustedPositionSize)} />
            <Metric label="Setup Confidence" value={confidenceLabel} />
            <Metric label="Size Adjustment" value={throttleLabel} />
            <Metric label="Trade Quality" value={getTradeQuality(result.riskRewardRatio)} />
            <Metric label="Setup State" value="LOCKED" />
            <Metric label="Recalculate" value={recalculateMode} />
          </div>

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
                className={`${styles.lockButton} ${isPositionActive ? styles.lockedButton : ""}`}
              >
                {isPositionActive ? "Trade Locked" : "Lock Trade"}
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

function Level({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "positive" | "negative" | "neutral" }) {
  return (
    <div className={`${styles.level} ${styles[tone]}`}>
      <p>{label}</p>
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
