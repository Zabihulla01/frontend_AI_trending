"use client";

import { useEffect, useMemo, useState } from "react";
import { useMarketStore } from "@/store/useMarketStore";
import { usePositionManagerStore } from "@/store/usePositionManagerStore";
import styles from "./AIPositionManager.module.css";

type PositionStatus = "ACTIVE" | "COMPLETED" | "STOPPED_OUT" | "CLOSED" | string;

type RecommendationView = {
  recommendation?: string;
  confidence?: number;
  exitScore?: number;
  holdScore?: number;
  currentProfit?: number;
  currentLoss?: number;
  currentRR?: number;
  holdingTime?: number;
  marketHealth?: number | string;
  trendStrength?: number | string;
  reasoning?: string | string[];
  generatedAt?: number;
};

type TimelineEventView = {
  id: string;
  type?: string;
  timestamp: number;
  message?: string;
  recommendation?: string;
};

type NotificationView = {
  id: string;
  positionKey?: string;
  recommendation?: string;
  createdAt: number;
  dismissed?: boolean;
  message?: string;
};

type PositionView = {
  key: string;
  symbol: string;
  timeframe: string;
  direction: "LONG" | "SHORT" | string;
  entry: number;
  originalStopLoss: number;
  activeStopLoss: number;
  tp1: number | null;
  tp2: number | null;
  currentPrice: number;
  lockedAt: number;
  quantity: number;
  status: PositionStatus;
  timeline?: TimelineEventView[];
  notifications?: NotificationView[];
  lastRecommendation?: RecommendationView | null;
  tp1HitAt?: number | null;
  trailingActive?: boolean;
};

const STATUS_COPY: Record<string, { label: string; className: string; detail: string }> = {
  ACTIVE: {
    label: "MONITORING",
    className: "active",
    detail: "Guidance is active for this locked position. No orders are sent from this dashboard.",
  },
  COMPLETED: {
    label: "COMPLETED",
    className: "completed",
    detail: "The final target was reached. Position monitoring has ended.",
  },
  STOPPED_OUT: {
    label: "STOPPED OUT",
    className: "stopped",
    detail: "The stop-loss level was reached. Position monitoring has ended.",
  },
  CLOSED: {
    label: "CLOSED",
    className: "closed",
    detail: "This position was marked closed manually. Position monitoring has ended.",
  },
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatPrice(value: unknown) {
  if (!isFiniteNumber(value) || value <= 0) return "--";

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 1000 ? 2 : value >= 1 ? 4 : 8,
  }).format(value);
}

function formatAmount(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "--";

  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Math.abs(value))}`;
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "--";

  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function formatScore(value: unknown) {
  return isFiniteNumber(value) ? `${Math.round(Math.min(100, Math.max(0, value)))}/100` : "--";
}

function formatDuration(minutes: number | null) {
  if (minutes === null || !Number.isFinite(minutes) || minutes < 0) return "--";

  const totalMinutes = Math.floor(minutes);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const remainingMinutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${remainingMinutes}m`;
  return `${remainingMinutes}m`;
}

function formatTimestamp(timestamp: unknown) {
  if (!isFiniteNumber(timestamp) || timestamp <= 0) return "Time unavailable";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

function humanize(value: string | undefined) {
  if (!value) return "No recommendation yet";

  return value
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function getPnl(position: PositionView) {
  if (!isFiniteNumber(position.entry) || !isFiniteNumber(position.currentPrice) || position.entry <= 0) {
    return { percent: null, amount: null };
  }

  const directionMultiplier = position.direction === "SHORT" ? -1 : 1;
  const priceMove = (position.currentPrice - position.entry) * directionMultiplier;
  const percent = (priceMove / position.entry) * 100;
  const amount = isFiniteNumber(position.quantity) ? priceMove * position.quantity : null;

  return { percent, amount };
}

function getHoldingMinutes(position: PositionView, now: number) {
  const recommendationHoldingTime = position.lastRecommendation?.holdingTime;
  const storedHoldingTime =
    isFiniteNumber(recommendationHoldingTime) && recommendationHoldingTime >= 0 ? recommendationHoldingTime : null;

  if (!isFiniteNumber(position.lockedAt) || position.lockedAt <= 0 || now <= 0) return storedHoldingTime;

  const elapsedHoldingTime = Math.max(0, (now - position.lockedAt) / 60000);
  return storedHoldingTime === null ? elapsedHoldingTime : Math.max(storedHoldingTime, elapsedHoldingTime);
}

function getStatus(status: PositionStatus) {
  return STATUS_COPY[status] ?? {
    label: humanize(status),
    className: "closed",
    detail: "This position is no longer being actively monitored.",
  };
}

function getReasoning(recommendation: RecommendationView | null | undefined) {
  const reasoning = recommendation?.reasoning;
  if (Array.isArray(reasoning)) return reasoning.filter(Boolean).join(" ");
  return reasoning?.trim() || "Awaiting the next completed candle before a position-management update is available.";
}

function isStopMoveRecommendation(recommendation: string | undefined) {
  const normalized = recommendation?.replace(/\s+/g, "_").toUpperCase() ?? "";
  return normalized.includes("MOVE_STOP") || normalized.includes("MOVE_SL") || normalized === "BOOK_PARTIAL_PROFIT";
}

function getStopActionCopy(recommendation: string | undefined) {
  const normalized = recommendation?.replace(/\s+/g, "_").toUpperCase() ?? "";
  return normalized.includes("TRAIL") ? "Record trailing-stop suggestion" : "Record breakeven-stop suggestion";
}

function getRecommendationCopy(recommendation: string | undefined, isActive: boolean) {
  if (isActive && recommendation?.trim().toUpperCase() === "HOLD") {
    return "HOLD — WAIT FOR STRUCTURE BREAK";
  }

  return humanize(recommendation);
}

function metricTone(value: number | null) {
  if (value === null || value === 0) return "neutral";
  return value > 0 ? "positive" : "negative";
}

export default function AIPositionManager() {
  const symbol = useMarketStore((state) => state.symbol);
  const interval = useMarketStore((state) => state.interval);
  const positions = usePositionManagerStore((state) => state.positions);
  const closePosition = usePositionManagerStore((state) => state.closePosition);
  const acknowledgeSuggestedStopMove = usePositionManagerStore((state) => state.acknowledgeSuggestedStopMove);
  const dismissNotification = usePositionManagerStore((state) => state.dismissNotification);
  const getPositionKey = usePositionManagerStore((state) => state.getPositionKey);
  const [closeConfirmationKey, setCloseConfirmationKey] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const positionKey = getPositionKey(symbol, interval);
  const position = positions[positionKey] as PositionView | undefined;

  const notifications = useMemo(
    () =>
      (position?.notifications ?? [])
        .filter((notification) => !notification.dismissed)
        .sort((left, right) => right.createdAt - left.createdAt),
    [position?.notifications]
  );
  const timeline = useMemo(
    () => [...(position?.timeline ?? [])].sort((left, right) => left.timestamp - right.timestamp),
    [position?.timeline]
  );

  if (!position) {
    return (
      <section className={styles.panel} aria-labelledby="ai-position-manager-title">
        <div className={styles.header}>
          <div>
          <p className={styles.eyebrow}>Stage 2 · Protection mode</p>
          <h2 id="ai-position-manager-title" className={styles.title}>
              Position Protection
            </h2>
          </div>
          <span className={`${styles.statusBadge} ${styles.inactive}`}>NO POSITION</span>
        </div>

        <div className={styles.emptyState}>
          <strong>No locked position for {symbol} · {interval}</strong>
          <p>Lock a valid trade setup to receive non-executing management guidance after completed candles.</p>
        </div>

        <p className={styles.disclaimer}>
          Decision-support only. Review market conditions and manage any orders yourself; this dashboard does not connect to an exchange or guarantee outcomes.
        </p>
      </section>
    );
  }

  const status = getStatus(position.status);
  const recommendation = position.lastRecommendation;
  const recommendationLabel = getRecommendationCopy(recommendation?.recommendation, position.status === "ACTIVE");
  const pnl = getPnl(position);
  const holdingMinutes = getHoldingMinutes(position, now);
  const isActive = position.status === "ACTIVE";
  const isConfirmingClose = closeConfirmationKey === position.key;
  const canRecordStopSuggestion = isActive && isStopMoveRecommendation(recommendation?.recommendation);
  const statusClass = styles[status.className] ?? styles.closed;
  const reason = getReasoning(recommendation);

  return (
    <section className={styles.panel} aria-labelledby="ai-position-manager-title">
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Stage 2 · Protection mode</p>
          <h2 id="ai-position-manager-title" className={styles.title}>
            Position Protection
          </h2>
          <p className={styles.positionIdentity}>
            {position.symbol} · {position.timeframe} · {position.direction}
          </p>
        </div>
        <span className={`${styles.statusBadge} ${statusClass}`}>{status.label}</span>
      </div>

      {notifications.length > 0 ? (
        <div className={styles.notifications} aria-live="polite" aria-label="Position recommendation updates">
          {notifications.map((notification) => (
            <div key={notification.id} className={styles.notification} role="status">
              <div>
                <p className={styles.notificationTitle}>Recommendation updated</p>
                <p>{notification.message?.trim() || humanize(notification.recommendation)}</p>
                <time dateTime={new Date(notification.createdAt).toISOString()}>{formatTimestamp(notification.createdAt)}</time>
              </div>
              <button
                type="button"
                className={styles.dismissButton}
                onClick={() => dismissNotification({ id: notification.id })}
                aria-label="Dismiss recommendation update"
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <p className={styles.statusDetail}>
        {isActive
          ? "Entry is locked. The assistant now focuses only on reducing loss and protecting profit from completed candles. No new entry signal is used."
          : status.detail}
      </p>

      <div className={styles.metrics}>
        <Metric label="Entry" value={formatPrice(position.entry)} />
        <Metric label="Current price" value={formatPrice(position.currentPrice)} />
        <Metric label="PnL %" value={formatPercent(pnl.percent)} tone={metricTone(pnl.percent)} />
        <Metric label="PnL amount" value={formatAmount(pnl.amount)} tone={metricTone(pnl.amount)} />
        <Metric label="Holding time" value={formatDuration(holdingMinutes)} />
        <Metric
          label="Current R Multiple"
          value={isFiniteNumber(recommendation?.currentRR) ? recommendation.currentRR.toFixed(2) : "--"}
          description="Realized price movement measured against the original risk."
        />
      </div>

      <div className={styles.levels} aria-label="Locked trade levels">
        <Level label="TP2" value={formatPrice(position.tp2)} tone="positive" />
        <Level label="TP1" value={formatPrice(position.tp1)} tone="positive" />
        <Level label="Active SL" value={formatPrice(position.activeStopLoss)} tone="negative" />
        {position.trailingActive ? <span className={styles.trailingFlag}>TRAILING ACTIVE</span> : null}
        {position.tp1HitAt ? <span className={styles.tpFlag}>TP1 HIT</span> : null}
      </div>

      <section className={styles.guidance} aria-labelledby="position-guidance-title">
        <div className={styles.guidanceHeader}>
          <div>
            <p className={styles.sectionLabel}>Protection decision</p>
            <h3 id="position-guidance-title" className={styles.recommendation}>
              {recommendationLabel}
            </h3>
          </div>
          <div className={styles.confidence}>
            <span>Guidance confidence</span>
            <strong>{isFiniteNumber(recommendation?.confidence) ? `${Math.round(recommendation.confidence)}%` : "--"}</strong>
          </div>
        </div>

        <div className={styles.scoreGrid}>
          <Score label="Exit score" value={recommendation?.exitScore} tone="negative" />
          <Score label="Hold score" value={recommendation?.holdScore} tone="positive" />
          <ContextMetric label="Market health" value={recommendation?.marketHealth} />
          <ContextMetric label="Trend strength" value={recommendation?.trendStrength} />
        </div>

        <div className={styles.reasoning}>
          <p className={styles.sectionLabel}>Why this is suggested</p>
          <p>{reason}</p>
        </div>
      </section>

      {isActive ? (
        <div className={styles.actions}>
          {canRecordStopSuggestion ? (
            <button
              type="button"
              className={styles.secondaryAction}
              onClick={() => acknowledgeSuggestedStopMove({ key: position.key })}
            >
              {getStopActionCopy(recommendation?.recommendation)}
            </button>
          ) : null}

          {isConfirmingClose ? (
            <div className={styles.confirmClose}>
              <p>Mark this position closed? This only stops dashboard monitoring; it never sends an exchange order.</p>
              <div>
                <button type="button" className={styles.cancelAction} onClick={() => setCloseConfirmationKey(null)}>
                  Cancel
                </button>
                <button type="button" className={styles.closeAction} onClick={() => closePosition({ key: position.key })}>
                  Confirm close
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className={styles.closeAction} onClick={() => setCloseConfirmationKey(position.key)}>
              Close position
            </button>
          )}
        </div>
      ) : null}

      <section className={styles.timelineSection} aria-labelledby="position-timeline-title">
        <div className={styles.sectionHeading}>
          <p className={styles.sectionLabel}>Position history</p>
          <h3 id="position-timeline-title">Trade timeline</h3>
        </div>

        {timeline.length > 0 ? (
          <ol className={styles.timeline}>
            {timeline.map((event) => (
              <li key={event.id} className={styles.timelineItem}>
                <span className={styles.timelineDot} aria-hidden="true" />
                <div>
                  <p>{event.message?.trim() || humanize(event.type)}</p>
                  {event.recommendation ? <span>{humanize(event.recommendation)}</span> : null}
                  <time dateTime={new Date(event.timestamp).toISOString()}>{formatTimestamp(event.timestamp)}</time>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.timelineEmpty}>No events have been recorded for this position yet.</p>
        )}
      </section>

      <p className={styles.disclaimer}>
        Guidance is probabilistic and based on available market data. It is not investment advice, does not execute trades, and cannot assure profit or prevent loss.
      </p>
    </section>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
  description,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "neutral";
  description?: string;
}) {
  return (
    <div
      className={`${styles.metric} ${tone === "positive" ? styles.positiveMetric : tone === "negative" ? styles.negativeMetric : ""}`}
      title={description}
    >
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
  );
}

function Level({ label, value, tone }: { label: string; value: string; tone: "positive" | "negative" }) {
  return (
    <div className={`${styles.level} ${tone === "positive" ? styles.positiveLevel : styles.negativeLevel}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Score({ label, value, tone }: { label: string; value: unknown; tone: "positive" | "negative" }) {
  const score = isFiniteNumber(value) ? Math.min(100, Math.max(0, value)) : null;

  return (
    <div className={styles.score}>
      <div>
        <span>{label}</span>
        <strong>{formatScore(score)}</strong>
      </div>
      <div className={styles.scoreTrack} aria-label={`${label}: ${formatScore(score)}`}>
        <span className={tone === "positive" ? styles.positiveScore : styles.negativeScore} style={{ width: `${score ?? 0}%` }} />
      </div>
    </div>
  );
}

function ContextMetric({ label, value }: { label: string; value: number | string | undefined }) {
  const display = isFiniteNumber(value) ? `${Math.round(Math.min(100, Math.max(0, value)))}/100` : value?.trim() || "--";

  return (
    <div className={styles.contextMetric}>
      <span>{label}</span>
      <strong>{display}</strong>
    </div>
  );
}
