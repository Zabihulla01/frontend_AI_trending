"use client";

import { useMemo, useState } from "react";
import {
  computeLogicPerformance,
  type BucketStats,
  type CombinationPerformance,
  type IndicatorPerformance,
  type PerformanceFilter,
  type SampleTier,
  type TradeDirection,
} from "@/services/logicPerformance";
import { useLogicAccuracyStore } from "@/store/useLogicAccuracyStore";
import styles from "./LogicAccuracyDashboard.module.css";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sampleTierLabel(tier: SampleTier): string {
  switch (tier) {
    case "INSUFFICIENT_DATA": return "INSUFFICIENT DATA";
    case "LOW_SAMPLE": return "LOW SAMPLE";
    case "MEANINGFUL": return "MEANINGFUL";
  }
}

function sampleTierClass(tier: SampleTier): string {
  switch (tier) {
    case "INSUFFICIENT_DATA": return styles.tierInsufficient;
    case "LOW_SAMPLE": return styles.tierLow;
    case "MEANINGFUL": return styles.tierMeaningful;
  }
}

function statusLabel(winRate: number, tier: SampleTier): string {
  if (tier === "INSUFFICIENT_DATA") return "INSUFFICIENT DATA";
  if (tier === "LOW_SAMPLE") return "LOW SAMPLE";
  if (winRate >= 60) return "PERFORMING WELL";
  if (winRate >= 45) return "NEUTRAL";
  return "PERFORMING POORLY";
}

function statusClass(winRate: number, tier: SampleTier): string {
  if (tier !== "MEANINGFUL") return styles.statusNeutral;
  if (winRate >= 60) return styles.statusGood;
  if (winRate >= 45) return styles.statusNeutral;
  return styles.statusPoor;
}

function formatR(r: number): string {
  const sign = r > 0 ? "+" : "";
  return `${sign}${r.toFixed(2)}R`;
}

function formatPF(pf: number): string {
  if (!Number.isFinite(pf)) return "∞";
  return pf.toFixed(2);
}

function winRateBar(winRate: number) {
  const width = Math.round(Math.min(100, Math.max(0, winRate)));
  const tone = winRate >= 60 ? styles.barGood : winRate >= 45 ? styles.barNeutral : styles.barPoor;
  return { width: `${width}%`, tone };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function BucketRow({ bucket }: { bucket: BucketStats }) {
  const bar = winRateBar(bucket.winRate);
  const countable = bucket.wins + bucket.losses;
  return (
    <div className={styles.bucketRow}>
      <div className={styles.bucketHeader}>
        <span className={styles.bucketLabel}>{bucket.label}</span>
        <span className={`${styles.tierBadge} ${sampleTierClass(bucket.sampleTier)}`}>
          {sampleTierLabel(bucket.sampleTier)}
        </span>
      </div>
      <div className={styles.bucketStats}>
        <span title="Total trades">{bucket.trades} trades</span>
        <span title="Wins" className={styles.win}>{bucket.wins}W</span>
        <span title="Losses" className={styles.loss}>{bucket.losses}L</span>
        {bucket.manualCloses > 0 && (
          <span title="Manual closes" className={styles.manual}>{bucket.manualCloses}M</span>
        )}
      </div>
      {countable > 0 && (
        <div className={styles.bucketMetrics}>
          <div className={styles.winRateRow}>
            <span>Win rate</span>
            <strong>{bucket.winRate.toFixed(1)}%</strong>
          </div>
          <div className={styles.progressTrack} aria-label={`Win rate ${bucket.winRate.toFixed(1)}%`}>
            <div className={`${styles.progressBar} ${bar.tone}`} style={{ width: bar.width }} />
          </div>
          <div className={styles.subMetrics}>
            <span>Avg R: <strong>{formatR(bucket.avgR)}</strong></span>
            <span>PF: <strong>{formatPF(bucket.profitFactor)}</strong></span>
          </div>
          <div className={`${styles.statusLabel} ${statusClass(bucket.winRate, bucket.sampleTier)}`}>
            {statusLabel(bucket.winRate, bucket.sampleTier)}
          </div>
        </div>
      )}
    </div>
  );
}

function IndicatorSection({ perf }: { perf: IndicatorPerformance }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? perf.buckets : perf.buckets.slice(0, 3);
  return (
    <div className={styles.indicatorSection}>
      <button
        type="button"
        className={styles.indicatorHeader}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className={styles.indicatorName}>{perf.indicatorName}</span>
        <span className={styles.bucketCount}>{perf.buckets.length} buckets</span>
        <span className={styles.chevron}>{expanded ? "▲" : "▼"}</span>
      </button>
      {visible.map((b) => (
        <BucketRow key={b.label} bucket={b} />
      ))}
      {!expanded && perf.buckets.length > 3 && (
        <button type="button" className={styles.showMore} onClick={() => setExpanded(true)}>
          Show {perf.buckets.length - 3} more…
        </button>
      )}
    </div>
  );
}

function CombinationRow({ combo }: { combo: CombinationPerformance }) {
  const countable = combo.wins + combo.losses;
  const bar = winRateBar(combo.winRate);
  return (
    <div className={styles.comboRow}>
      <div className={styles.comboHeader}>
        <span className={styles.comboLabels}>{combo.labels.join(" + ")}</span>
        <span className={`${styles.tierBadge} ${sampleTierClass(combo.sampleTier)}`}>
          {sampleTierLabel(combo.sampleTier)}
        </span>
      </div>
      <div className={styles.bucketStats}>
        <span>{combo.trades} trades</span>
        <span className={styles.win}>{combo.wins}W</span>
        <span className={styles.loss}>{combo.losses}L</span>
        {combo.manualCloses > 0 && (
          <span className={styles.manual}>{combo.manualCloses}M</span>
        )}
      </div>
      {countable > 0 && (
        <div className={styles.bucketMetrics}>
          <div className={styles.winRateRow}>
            <span>Win rate</span>
            <strong>{combo.winRate.toFixed(1)}%</strong>
          </div>
          <div className={styles.progressTrack}>
            <div className={`${styles.progressBar} ${bar.tone}`} style={{ width: bar.width }} />
          </div>
          <div className={styles.subMetrics}>
            <span>Avg R: <strong>{formatR(combo.avgR)}</strong></span>
            <span>PF: <strong>{formatPF(combo.profitFactor)}</strong></span>
          </div>
          <div className={`${styles.statusLabel} ${statusClass(combo.winRate, combo.sampleTier)}`}>
            {statusLabel(combo.winRate, combo.sampleTier)}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

interface FilterState {
  symbol: string;
  interval: string;
  direction: "" | TradeDirection;
  signal: string;
  fromDate: string;
  toDate: string;
}

const DEFAULT_FILTER: FilterState = {
  symbol: "", interval: "", direction: "", signal: "", fromDate: "", toDate: "",
};

function buildFilter(f: FilterState): PerformanceFilter {
  const out: PerformanceFilter = {};
  if (f.symbol.trim()) out.symbol = f.symbol.trim().toUpperCase();
  if (f.interval.trim()) out.interval = f.interval.trim();
  if (f.direction) out.direction = f.direction;
  if (f.signal.trim()) out.signal = f.signal.trim();
  if (f.fromDate) out.fromDate = new Date(f.fromDate).getTime();
  if (f.toDate) out.toDate = new Date(f.toDate).getTime();
  return out;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * LogicAccuracyDashboard
 *
 * Observation-only UI for the Logic Accuracy / Trade Learning Engine.
 * Reads from useLogicAccuracyStore and calls the pure computeLogicPerformance().
 * Has zero influence on live trading decisions.
 */
export default function LogicAccuracyDashboard() {
  const getCompletedRecords = useLogicAccuracyStore((state) => state.getCompletedRecords);
  const clearAll = useLogicAccuracyStore((state) => state.clearAll);
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER);
  const [tab, setTab] = useState<"indicators" | "combinations" | "top" | "weak">("indicators");
  const [confirmClear, setConfirmClear] = useState(false);

  const records = getCompletedRecords();
  const activeFilter = useMemo(() => buildFilter(filter), [filter]);
  const report = useMemo(
    () => computeLogicPerformance(records, activeFilter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records.length, activeFilter]
  );

  const hasData = report.totalRecords > 0;

  function handleFilterChange(field: keyof FilterState, value: string) {
    setFilter((prev) => ({ ...prev, [field]: value }));
  }

  function handleClearConfirmed() {
    clearAll();
    setConfirmClear(false);
  }

  return (
    <section className={styles.panel} aria-labelledby="logic-accuracy-title">
      {/* Header */}
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Observation only · No live trading influence</p>
          <h2 id="logic-accuracy-title" className={styles.title}>Logic Performance</h2>
          <p className={styles.subtitle}>Historical analysis of completed trade outcomes vs indicator states at lock time.</p>
        </div>
        {confirmClear ? (
          <div className={styles.clearConfirm}>
            <span>Clear all {records.length} records?</span>
            <button type="button" className={styles.cancelBtn} onClick={() => setConfirmClear(false)}>Cancel</button>
            <button type="button" className={styles.clearBtn} onClick={handleClearConfirmed}>Clear</button>
          </div>
        ) : (
          <button
            type="button"
            className={styles.clearTrigger}
            onClick={() => setConfirmClear(true)}
            disabled={records.length === 0}
          >
            Clear data
          </button>
        )}
      </div>

      {/* Filters */}
      <div className={styles.filters}>
        <input
          type="text"
          placeholder="Symbol (e.g. BTCUSDT)"
          value={filter.symbol}
          onChange={(e) => handleFilterChange("symbol", e.target.value)}
          className={styles.filterInput}
          aria-label="Filter by symbol"
        />
        <select
          value={filter.interval}
          onChange={(e) => handleFilterChange("interval", e.target.value)}
          className={styles.filterSelect}
          aria-label="Filter by timeframe"
        >
          <option value="">All timeframes</option>
          {["1m", "5m", "15m", "1h", "4h", "1d"].map((tf) => (
            <option key={tf} value={tf}>{tf}</option>
          ))}
        </select>
        <select
          value={filter.direction}
          onChange={(e) => handleFilterChange("direction", e.target.value)}
          className={styles.filterSelect}
          aria-label="Filter by direction"
        >
          <option value="">LONG + SHORT</option>
          <option value="LONG">LONG only</option>
          <option value="SHORT">SHORT only</option>
        </select>
        <input
          type="text"
          placeholder="Signal type"
          value={filter.signal}
          onChange={(e) => handleFilterChange("signal", e.target.value)}
          className={styles.filterInput}
          aria-label="Filter by signal type"
        />
        <input
          type="date"
          value={filter.fromDate}
          onChange={(e) => handleFilterChange("fromDate", e.target.value)}
          className={styles.filterInput}
          aria-label="From date"
        />
        <input
          type="date"
          value={filter.toDate}
          onChange={(e) => handleFilterChange("toDate", e.target.value)}
          className={styles.filterInput}
          aria-label="To date"
        />
        <button
          type="button"
          className={styles.resetFilter}
          onClick={() => setFilter(DEFAULT_FILTER)}
        >
          Reset filters
        </button>
      </div>

      {/* Summary */}
      <div className={styles.summary}>
        <SummaryMetric label="Completed trades" value={String(report.totalRecords)} />
        <SummaryMetric label="Wins" value={String(report.totalWins)} tone="positive" />
        <SummaryMetric label="Losses" value={String(report.totalLosses)} tone="negative" />
        <SummaryMetric label="Manual closes" value={String(report.totalManualCloses)} />
        <SummaryMetric
          label="Win rate"
          value={hasData ? `${report.overallWinRate.toFixed(1)}%` : "--"}
          tone={report.overallWinRate >= 50 ? "positive" : "negative"}
        />
        <SummaryMetric
          label="Avg R"
          value={hasData ? formatR(report.overallAvgR) : "--"}
          tone={report.overallAvgR >= 0 ? "positive" : "negative"}
        />
        <SummaryMetric
          label="Profit factor"
          value={hasData ? formatPF(report.profitFactor) : "--"}
          tone={report.profitFactor >= 1 ? "positive" : "negative"}
        />
      </div>

      {!hasData ? (
        <div className={styles.empty}>
          <p>No completed trades recorded yet.</p>
          <p className={styles.emptyHint}>
            Lock a trade in the Trade Setup panel. When Position Protection closes it (TP hit, SL hit, or manual close), the result will appear here.
          </p>
        </div>
      ) : (
        <>
          {/* Tab bar */}
          <div className={styles.tabs} role="tablist">
            {(["indicators", "combinations", "top", "weak"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                type="button"
                aria-selected={tab === t}
                className={`${styles.tab} ${tab === t ? styles.tabActive : ""}`}
                onClick={() => setTab(t)}
              >
                {t === "indicators" && "Indicators"}
                {t === "combinations" && "Combinations"}
                {t === "top" && `Top (${report.topCombinations.length})`}
                {t === "weak" && `Weak (${report.weakCombinations.length})`}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {tab === "indicators" && (
            <div className={styles.tabContent}>
              {report.byIndicator.length === 0 ? (
                <p className={styles.noData}>No indicator data for the current filter.</p>
              ) : (
                report.byIndicator.map((perf) => (
                  <IndicatorSection key={perf.indicatorName} perf={perf} />
                ))
              )}
            </div>
          )}

          {tab === "combinations" && (
            <div className={styles.tabContent}>
              <p className={styles.comboNote}>
                Showing all {report.byCombination.length} combinations across {COMBO_COUNT} logic templates. Minimum {10} trades for INSUFFICIENT DATA tier.
              </p>
              {report.byCombination.length === 0 ? (
                <p className={styles.noData}>No combination data for the current filter.</p>
              ) : (
                report.byCombination.map((combo) => (
                  <CombinationRow key={combo.key} combo={combo} />
                ))
              )}
            </div>
          )}

          {tab === "top" && (
            <div className={styles.tabContent}>
              <p className={styles.comboNote}>
                Combinations with ≥30 trades, sorted by highest win rate. Observation only — these do not affect live signals.
              </p>
              {report.topCombinations.length === 0 ? (
                <p className={styles.noData}>No meaningful combinations yet. Need at least 30 completed trades per combination.</p>
              ) : (
                report.topCombinations.map((combo) => (
                  <CombinationRow key={combo.key} combo={combo} />
                ))
              )}
            </div>
          )}

          {tab === "weak" && (
            <div className={styles.tabContent}>
              <p className={styles.comboNote}>
                Combinations with ≥30 trades, sorted by lowest win rate. Observation only — these do not affect live signals.
              </p>
              {report.weakCombinations.length === 0 ? (
                <p className={styles.noData}>No meaningful combinations yet. Need at least 30 completed trades per combination.</p>
              ) : (
                report.weakCombinations.map((combo) => (
                  <CombinationRow key={combo.key} combo={combo} />
                ))
              )}
            </div>
          )}
        </>
      )}

      <p className={styles.disclaimer}>
        Logic Performance is historical observation only. These statistics describe past behavior of indicator combinations and have no influence on live signal generation, confidence scores, entry prices, stop-losses, take-profit levels, or position management decisions.
      </p>
    </section>
  );
}

const COMBO_COUNT = 13; // matches COMBO_DEFINITIONS length in logicPerformance.ts

function SummaryMetric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  return (
    <div className={styles.summaryMetric}>
      <p className={styles.summaryLabel}>{label}</p>
      <strong
        className={
          tone === "positive"
            ? styles.positiveValue
            : tone === "negative"
            ? styles.negativeValue
            : styles.neutralValue
        }
      >
        {value}
      </strong>
    </div>
  );
}
