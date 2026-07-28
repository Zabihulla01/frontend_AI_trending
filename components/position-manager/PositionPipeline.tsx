"use client";

import { useMemo } from "react";
import { useAnalysisStore } from "@/store/useAnalysisStore";
import { useMarketStore } from "@/store/useMarketStore";
import { usePositionManagerStore } from "@/store/usePositionManagerStore";
import { useRiskStore } from "@/store/useRiskStore";
import styles from "./PositionPipeline.module.css";

type StageState = "complete" | "active" | "waiting";

const STAGES = [
  { label: "Market", detail: "Symbol selected" },
  { label: "Structure", detail: "Trend + momentum" },
  { label: "Setup", detail: "Risk and targets" },
  { label: "Signal", detail: "Strong conviction" },
  { label: "Lock", detail: "Position snapshot" },
  { label: "Protect", detail: "Manage loss / profit" },
] as const;

function getStructureScore(checks: Record<string, boolean> | undefined) {
  if (!checks) return 0;
  return Object.values(checks).filter(Boolean).length;
}

export default function PositionPipeline() {
  const symbol = useMarketStore((state) => state.symbol);
  const interval = useMarketStore((state) => state.interval);
  const analysisStatus = useAnalysisStore((state) => state.status);
  const results = useAnalysisStore((state) => state.results);
  const targetLocked = useRiskStore((state) => state.targetLocked);
  const action = useRiskStore((state) => state.action);
  const positionKey = usePositionManagerStore((state) => state.getPositionKey(symbol, interval));
  const position = usePositionManagerStore((state) => state.positions[positionKey]);

  const analysis = useMemo(
    () => results[interval as keyof typeof results] ?? Object.values(results).find((result) => result !== undefined),
    [interval, results]
  );

  const marketReady = Boolean(symbol && analysisStatus === "ready" && analysis);
  const structureReady = marketReady && analysis!.trend !== "Neutral" && getStructureScore(analysis!.setupChecks) >= 4;
  const setupReady = structureReady && targetLocked && (action === "Long" || action === "Short");
  const convictionReady = setupReady &&
    ((action === "Long" && analysis!.signal === "Strong Buy") || (action === "Short" && analysis!.signal === "Strong Sell"));
  const lockReady = convictionReady && position?.status === "ACTIVE";
  const protectionReady = lockReady && position?.status === "ACTIVE";

  const complete = [marketReady, structureReady, setupReady, convictionReady, lockReady, protectionReady];
  const activeIndex = complete.findIndex((value) => !value);
  const currentIndex = activeIndex === -1 ? STAGES.length - 1 : activeIndex;

  const states: StageState[] = STAGES.map((_, index) => {
    if (complete[index]) return "complete";
    if (index === currentIndex) return "active";
    return "waiting";
  });

  const statusCopy = !marketReady
    ? "Select a market to start the scan"
    : !structureReady
    ? "Waiting for aligned market structure"
    : !setupReady
    ? "Build and lock a risk-defined setup"
    : !convictionReady
    ? "Strong Buy confirmation required"
    : !lockReady
    ? "Lock the position to start management"
    : "AI manager protecting the position";

  return (
    <section className={styles.pipeline} aria-labelledby="position-pipeline-title">
      <div className={styles.pipelineHeader}>
        <div>
          <p className={styles.eyebrow}>Execution plan</p>
          <h3 id="position-pipeline-title">Position pipeline</h3>
        </div>
        <span className={styles.stageCount}>{Math.max(0, complete.filter(Boolean).length)}/{STAGES.length}</span>
      </div>

      <div className={styles.track} aria-label="Position management stages">
        {STAGES.map((stage, index) => (
          <div className={`${styles.stage} ${styles[states[index]]}`} key={stage.label}>
            <div className={styles.node} aria-hidden="true">
              {states[index] === "complete" ? "✓" : index + 1}
            </div>
            {index < STAGES.length - 1 ? <span className={styles.connector} aria-hidden="true" /> : null}
            <div className={styles.stageCopy}>
              <strong>{stage.label}</strong>
              <span>{stage.detail}</span>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.status}>
        <span className={styles.pulse} aria-hidden="true" />
        <span>{statusCopy}</span>
      </div>
      <p className={styles.note}>Assistant only · no exchange orders are sent</p>
    </section>
  );
}
