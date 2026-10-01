"use client";

/**
 * AccuracyObserverInit
 *
 * Thin client component whose sole purpose is to start the position-close
 * observer once when the app mounts. It renders nothing visible.
 *
 * Kept separate from LogicAccuracyDashboard so it can live in the layout
 * without pulling in the full dashboard bundle on every page.
 *
 * OBSERVATION ONLY — does not affect any live trading logic.
 */

import { useEffect } from "react";
import { initPositionCloseObserver } from "@/store/useLogicAccuracyStore";

export default function AccuracyObserverInit() {
  useEffect(() => {
    const unsubscribe = initPositionCloseObserver();
    return unsubscribe;
  }, []);

  return null;
}
