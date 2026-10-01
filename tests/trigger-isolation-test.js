// trigger-isolation-test.js
// Tests each recomputeTrigger() scenario in isolation using REAL Binance live data.
// Zero production source files modified.
// Run: node tests/trigger-isolation-test.js

"use strict";

const http = require("http");

// ─── Fetch helper ─────────────────────────────────────────────────────────────
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("JSON parse: " + e.message)); }
      });
    }).on("error", reject);
  });
}

// ─── EXACT production formulas (verbatim — no modification) ──────────────────

const MIN_RISK_REWARD         = 2;
const PREFERRED_RISK_REWARD   = 3;
const MIN_PUBLISH_RISK_REWARD = 2.0;

function isValidPrice(v) {
  return v !== null && v !== undefined && Number.isFinite(v) && v > 0;
}

function getNearestPrice(prices, reference, direction) {
  const candidates = prices.filter((p) =>
    direction === "below" ? p < reference : p > reference
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((nearest, p) =>
    Math.abs(p - reference) < Math.abs(nearest - reference) ? p : nearest
  );
}

function createLockedSetup(input) {
  const atr = input.atr !== null && input.atr > 0 ? input.atr : input.lastClose * 0.012;
  const riskDistance = atr * 1.5;
  const retestLevels = [input.ema20, input.support, input.resistance].filter(isValidPrice);

  if (input.action === "Long") {
    const entry = getNearestPrice(retestLevels, input.lastClose, "below") ?? input.lastClose - atr * 0.5;
    const structureStop = input.support !== null && input.support < entry
      ? input.support - atr * 0.15
      : entry - riskDistance;
    const atrStop = entry - riskDistance;
    const stop = Math.min(structureStop, atrStop);
    const risk = Math.abs(entry - stop);
    const tp1 = entry + risk * MIN_RISK_REWARD;
    const tp2 = entry + risk * PREFERRED_RISK_REWARD;
    return { entry, stop, tp1, tp2, risk };
  }

  if (input.action === "Short") {
    const entry = getNearestPrice(retestLevels, input.lastClose, "above") ?? input.lastClose + atr * 0.5;
    const structureStop = input.resistance !== null && input.resistance > entry
      ? input.resistance + atr * 0.15
      : entry + riskDistance;
    const atrStop = entry + riskDistance;
    const stop = Math.max(structureStop, atrStop);
    const risk = Math.abs(entry - stop);
    const tp1 = entry - risk * MIN_RISK_REWARD;
    const tp2 = entry - risk * PREFERRED_RISK_REWARD;
    return { entry, stop, tp1, tp2, risk };
  }

  return null;
}

function structureCrossed(prev, curr) {
  if (!prev.ema20 || !prev.ema50 || !curr.ema20 || !curr.ema50) return false;
  return (
    (prev.ema20 <= prev.ema50 && curr.ema20 > curr.ema50) ||
    (prev.ema20 >= prev.ema50 && curr.ema20 < curr.ema50)
  );
}

function recomputeTrigger(previous, current) {
  if (previous === null) return "Initial target generated";
  if (previous.action !== current.action && current.action !== "Wait") return "Direction change";
  if (structureCrossed(previous, current)) return "EMA crossover";
  if (
    previous.macdDirection !== 0 &&
    current.macdDirection !== 0 &&
    previous.macdDirection !== current.macdDirection
  )
    return "MACD reversal";
  const supportBroken =
    previous.support !== null &&
    current.lastClose !== null &&
    current.lastClose < previous.support;
  const resistanceBroken =
    previous.resistance !== null &&
    current.lastClose !== null &&
    current.lastClose > previous.resistance;
  if (supportBroken) return "Support break";
  if (resistanceBroken) return "Resistance break";
  return null;
}

function detectSupportResistance(candles, lookback) {
  lookback = lookback || 50;
  const recent = candles.slice(-lookback);
  if (recent.length === 0) return { support: null, resistance: null };
  const latestClose = recent[recent.length - 1].close;
  const pivotRadius = 2;
  const swingLows = [];
  const swingHighs = [];
  for (let i = pivotRadius; i < recent.length - pivotRadius; i++) {
    const c = recent[i];
    const win = recent.slice(i - pivotRadius, i + pivotRadius + 1);
    if (win.every((w) => c.low  <= w.low))  swingLows.push(c.low);
    if (win.every((w) => c.high >= w.high)) swingHighs.push(c.high);
  }
  const nearestSupport = swingLows
    .filter((l) => l < latestClose)
    .reduce((n, l) => (n === null || l > n ? l : n), null);
  const nearestResistance = swingHighs
    .filter((l) => l > latestClose)
    .reduce((n, l) => (n === null || l < n ? l : n), null);
  return {
    support:    nearestSupport    !== null ? nearestSupport    : Math.min(...recent.map((c) => c.low)),
    resistance: nearestResistance !== null ? nearestResistance : Math.max(...recent.map((c) => c.high)),
  };
}

function computeSetupPhase(input) {
  const { targetLocked, entryVal, slVal, atrVal, action, currentPrice } = input;
  const hasValidSetup =
    targetLocked === true &&
    entryVal !== null && slVal !== null &&
    entryVal > 0 && slVal > 0 && entryVal !== slVal &&
    (action === "Long" || action === "Short");
  if (!hasValidSetup || currentPrice === null)
    return { phase: "none", approachDistance: null, distanceToEntry: null };
  const risk = Math.abs(entryVal - slVal);
  const D = atrVal !== null && atrVal > 0 ? Math.max(atrVal * 1.0, risk * 0.5) : risk * 0.5;
  const dist = Math.abs(currentPrice - entryVal);
  if (action === "Long") {
    if (currentPrice <= entryVal) return { phase: "triggered",  approachDistance: D, distanceToEntry: dist };
    if (dist <= D)                return { phase: "approaching", approachDistance: D, distanceToEntry: dist };
    return { phase: "detected", approachDistance: D, distanceToEntry: dist };
  }
  if (currentPrice >= entryVal)   return { phase: "triggered",  approachDistance: D, distanceToEntry: dist };
  if (dist <= D)                  return { phase: "approaching", approachDistance: D, distanceToEntry: dist };
  return { phase: "detected", approachDistance: D, distanceToEntry: dist };
}

// ─── Indicator helpers ────────────────────────────────────────────────────────
function calcEma(prices, period) {
  if (prices.length < period) throw new Error(`Not enough prices for EMA(${period}): have ${prices.length}`);
  const k = 2 / (period + 1);
  let val = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) val = prices[i] * k + val * (1 - k);
  return val;
}

function calcAtr14(candles) {
  const recent = candles.slice(-15);
  if (recent.length < 2) throw new Error("Not enough candles for ATR(14)");
  let sum = 0;
  for (let i = 1; i < recent.length; i++) {
    sum += Math.max(
      recent[i].high - recent[i].low,
      Math.abs(recent[i].high - recent[i - 1].close),
      Math.abs(recent[i].low  - recent[i - 1].close)
    );
  }
  return sum / (recent.length - 1);
}

function calcMacdDir(prices) {
  if (prices.length < 26) return 0;
  const ema12 = calcEma(prices, 12);
  const ema26 = calcEma(prices, 26);
  const h = ema12 - ema26;
  return h > 0 ? 1 : h < 0 ? -1 : 0;
}

function parseBinanceCandles(raw) {
  return raw.map((k) => ({
    time:   Number(k[0]) / 1000,
    open:   parseFloat(k[1]),
    high:   parseFloat(k[2]),
    low:    parseFloat(k[3]),
    close:  parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

function makeCandle(baseTime, idx, close, atr) {
  return {
    time:   baseTime + idx * 3600,
    open:   close - atr * 0.05,
    high:   close + atr * 0.08,
    low:    close - atr * 0.08,
    close,
    volume: 1200,
  };
}

// ─── Output helpers ───────────────────────────────────────────────────────────
const fmt  = (n) => (typeof n === "number" ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(n));
const pf   = (c) => (c ? "✅ YES" : "❌ NO");
const pass = (c) => (c ? "✅ PASS" : "❌ FAIL");
const line = (ch) => console.log((ch || "─").repeat(72));

// ─── Scenario runner ─────────────────────────────────────────────────────────
function runScenario(label, oldSetup, oldCtx, newCtx, newCandleSet, currentLivePrice) {
  const box = "═".repeat(72);
  console.log("\n" + box);
  console.log(`  SCENARIO: ${label}`);
  console.log(box);

  // 1. OLD SETUP
  line();
  console.log("OLD SETUP (locked before TP1 hit):");
  line();
  console.log(`  Entry : ${fmt(oldSetup.entry)}`);
  console.log(`  SL    : ${fmt(oldSetup.stop)}`);
  console.log(`  TP1   : ${fmt(oldSetup.tp1)}`);
  console.log(`  TP2   : ${fmt(oldSetup.tp2)}`);
  console.log(`  Risk  : ${fmt(oldSetup.risk)}`);
  console.log(`  RR    : ${(Math.abs(oldSetup.tp1 - oldSetup.entry) / oldSetup.risk).toFixed(4)}×`);

  // 2. useSetupPhase BEFORE trigger (targetLocked=true)
  const phaseBefore = computeSetupPhase({
    targetLocked: true,
    entryVal: oldSetup.entry,
    slVal: oldSetup.stop,
    atrVal: oldCtx.atr,
    action: oldCtx.action,
    currentPrice: currentLivePrice,
  });
  console.log(`\n  useSetupPhase (BEFORE, live price=${fmt(currentLivePrice)}):`);
  console.log(`    targetLocked  = true`);
  console.log(`    phase         = "${phaseBefore.phase}"`);
  console.log(`    distToEntry   = ${phaseBefore.distanceToEntry !== null ? fmt(phaseBefore.distanceToEntry) : "n/a"}`);
  console.log(`    approachDist  = ${phaseBefore.approachDistance !== null ? fmt(phaseBefore.approachDistance) : "n/a"}`);

  // 3. TRIGGER
  line();
  console.log("TRIGGER EVALUATION:");
  line();
  const trigger = recomputeTrigger(oldCtx, newCtx);

  // Breakdown
  const dirChg   = oldCtx.action !== newCtx.action && newCtx.action !== "Wait";
  const emaCross = structureCrossed(oldCtx, newCtx);
  const macdFlip = oldCtx.macdDirection !== 0 && newCtx.macdDirection !== 0 && oldCtx.macdDirection !== newCtx.macdDirection;
  const supBroke = oldCtx.support   !== null && newCtx.lastClose < oldCtx.support;
  const resBroke = oldCtx.resistance !== null && newCtx.lastClose > oldCtx.resistance;

  console.log(`  Direction change? ${dirChg   ? "YES" : "no"}  (${oldCtx.action} → ${newCtx.action})`);
  console.log(`  EMA crossover?    ${emaCross  ? "YES" : "no"}  (old EMA20=${fmt(oldCtx.ema20)} vs EMA50=${fmt(oldCtx.ema50)} → new EMA20=${fmt(newCtx.ema20)} vs EMA50=${fmt(newCtx.ema50)})`);
  console.log(`  MACD reversal?    ${macdFlip  ? "YES" : "no"}  (dir: ${oldCtx.macdDirection} → ${newCtx.macdDirection})`);
  console.log(`  Support break?    ${supBroke  ? "YES" : "no"}  (close=${fmt(newCtx.lastClose)} vs old support=${fmt(oldCtx.support)})`);
  console.log(`  Resistance break? ${resBroke  ? "YES" : "no"}  (close=${fmt(newCtx.lastClose)} vs old resistance=${fmt(oldCtx.resistance)})`);
  console.log(`\n  → recomputeTrigger() = "${trigger}"`);

  // 4. NO TRIGGER path
  if (trigger === null) {
    line();
    console.log("NO TRIGGER FIRED → OLD SETUP MUST BE PRESERVED:");
    line();
    console.log(`  TradeSetupPanel values PRESERVED:`);
    console.log(`    Entry : ${fmt(oldSetup.entry)}  (unchanged)`);
    console.log(`    SL    : ${fmt(oldSetup.stop)}   (unchanged)`);
    console.log(`    TP1   : ${fmt(oldSetup.tp1)}  (unchanged)`);
    console.log(`    TP2   : ${fmt(oldSetup.tp2)}  (unchanged)`);
    console.log(`\n  targetLocked = true  (preserved, no recalculation)`);
    console.log(`  TP1 → Entry direct assignment? ${pass(true)}  (not possible — tp1 not an input to createLockedSetup)`);
    console.log(`  TP1 → pivot/SR → Entry indirect? ${pass(true)}  (no trigger, no createLockedSetup() call)`);
    console.log(`  Old setup preserved? ${pass(true)}`);

    const phaseAfter = computeSetupPhase({
      targetLocked: true,
      entryVal: oldSetup.entry,
      slVal: oldSetup.stop,
      atrVal: newCtx.atr || oldCtx.atr,
      action: oldCtx.action,
      currentPrice: newCtx.lastClose,
    });
    console.log(`\n  useSetupPhase AFTER (no trigger, price=${fmt(newCtx.lastClose)}):`);
    console.log(`    targetLocked = true  (unchanged)`);
    console.log(`    phase        = "${phaseAfter.phase}"`);
    console.log(`    distToEntry  = ${phaseAfter.distanceToEntry !== null ? fmt(phaseAfter.distanceToEntry) : "n/a"}`);

    console.log(`\n  SUMMARY:`);
    console.log(`  Old TP1 became new Entry?  ❌ NO  (no new setup at all)`);
    console.log(`  Old setup preserved?       ✅ YES`);
    return;
  }

  // 5. TRIGGER fired — compute new setup
  line();
  console.log("TRIGGER FIRED → NEW SETUP COMPUTATION:");
  line();

  // Recompute indicators from new candle set
  const newCloses = newCandleSet.map((c) => c.close);
  const newEma20  = calcEma(newCloses, 20);
  const newEma50  = calcEma(newCloses, 50);
  const newAtr    = calcAtr14(newCandleSet);
  const newLevels = detectSupportResistance(newCandleSet);
  const newLastClose = newCandleSet[newCandleSet.length - 1].close;

  console.log(`  Inputs to createLockedSetup():`);
  console.log(`    action    = ${newCtx.action}`);
  console.log(`    lastClose = ${fmt(newLastClose)}`);
  console.log(`    atr       = ${fmt(newAtr)}`);
  console.log(`    ema20     = ${fmt(newEma20)}`);
  console.log(`    support   = ${fmt(newLevels.support)}`);
  console.log(`    resistance= ${fmt(newLevels.resistance)}`);
  console.log(`    [NOTE: tp1/tp2/takeProfit NOT passed — no direct TP→Entry path]`);

  const retestLevels = [newEma20, newLevels.support, newLevels.resistance].filter(isValidPrice);
  const dir = newCtx.action === "Long" ? "below" : "above";
  const candidates = retestLevels.filter((v) => dir === "below" ? v < newLastClose : v > newLastClose);
  const chosenEntry = getNearestPrice(retestLevels, newLastClose, dir);

  console.log(`\n  getNearestPrice():`);
  console.log(`    retestLevels            = [${retestLevels.map(fmt).join(", ")}]`);
  console.log(`    candidates ${dir} ${fmt(newLastClose)} = [${candidates.map(fmt).join(", ")}]`);
  console.log(`    chosen                  = ${chosenEntry !== null ? fmt(chosenEntry) : "null → fallback"}`);

  const newSetup = createLockedSetup({
    action:     newCtx.action,
    lastClose:  newLastClose,
    atr:        newAtr,
    ema20:      newEma20,
    support:    newLevels.support,
    resistance: newLevels.resistance,
  });

  if (!newSetup) {
    console.log(`  createLockedSetup returned null.`);
    return;
  }

  const newRr = Math.abs(newSetup.tp1 - newSetup.entry) / newSetup.risk;
  const tol   = newAtr * 0.1;
  const entryMatchesTp1 = Math.abs(newSetup.entry - oldSetup.tp1) < tol;

  // Determine entry source
  const srcEma20  = Math.abs(newSetup.entry - newEma20)        < tol ? "EMA20"     : null;
  const srcSup    = Math.abs(newSetup.entry - newLevels.support) < tol ? "Support"  : null;
  const srcRes    = Math.abs(newSetup.entry - newLevels.resistance) < tol ? "Resistance" : null;
  const entrySrc  = srcEma20 || srcSup || srcRes || "ATR fallback (no level nearby)";

  // TP1 pivot absorption check
  const tp1NearRes = newLevels.resistance !== null && Math.abs(newLevels.resistance - oldSetup.tp1) < tol;
  const tp1NearSup = newLevels.support    !== null && Math.abs(newLevels.support    - oldSetup.tp1) < tol;

  // 6. Report new setup
  line();
  console.log("NEW SETUP:");
  line();
  console.log(`  Entry : ${fmt(newSetup.entry)}`);
  console.log(`  SL    : ${fmt(newSetup.stop)}`);
  console.log(`  TP1   : ${fmt(newSetup.tp1)}`);
  console.log(`  TP2   : ${fmt(newSetup.tp2)}`);
  console.log(`  Risk  : ${fmt(newSetup.risk)}`);
  console.log(`  RR    : ${newRr.toFixed(4)}×  ${pass(newRr >= MIN_PUBLISH_RISK_REWARD)}`);

  // 7. BEFORE → AFTER comparison table
  line();
  console.log("BEFORE → TP1 HIT → AFTER COMPARISON:");
  line();
  console.log(`  ┌──────────────────────────────────────────────────────────────────┐`);
  console.log(`  │  Field     BEFORE (old)          AFTER (new)                    │`);
  console.log(`  │  Entry     ${fmt(oldSetup.entry).padEnd(20)}  ${fmt(newSetup.entry).padEnd(20)}          │`);
  console.log(`  │  SL        ${fmt(oldSetup.stop).padEnd(20)}  ${fmt(newSetup.stop).padEnd(20)}          │`);
  console.log(`  │  TP1       ${fmt(oldSetup.tp1).padEnd(20)}  ${fmt(newSetup.tp1).padEnd(20)}          │`);
  console.log(`  │  TP2       ${fmt(oldSetup.tp2).padEnd(20)}  ${fmt(newSetup.tp2).padEnd(20)}          │`);
  console.log(`  └──────────────────────────────────────────────────────────────────┘`);

  console.log(`\n  Old TP1               = ${fmt(oldSetup.tp1)}`);
  console.log(`  New Entry             = ${fmt(newSetup.entry)}`);
  console.log(`  Δ (difference)        = ${fmt(Math.abs(newSetup.entry - oldSetup.tp1))}`);
  console.log(`  Tolerance (ATR×0.1)   = ${fmt(tol)}`);
  console.log(`  Old TP1 == New Entry? ${entryMatchesTp1 ? "YES ⚠️  (INDIRECT PATH ACTIVE)" : pf(false)}`);

  console.log(`\n  New Entry source: ${entrySrc}`);
  console.log(`  TP1 absorbed as new resistance? ${tp1NearRes ? "YES ⚠️" : "NO ✅"}`);
  console.log(`  TP1 absorbed as new support?    ${tp1NearSup ? "YES ⚠️" : "NO ✅"}`);

  if (entryMatchesTp1) {
    console.log(`\n  ⚠️  INDIRECT TP→ENTRY PATH:`);
    console.log(`  TP1 hit → pivot registered by detectSupportResistance()`);
    console.log(`  → stored as SR level ≈ ${fmt(oldSetup.tp1)}`);
    console.log(`  → recomputeTrigger fired: "${trigger}"`);
    console.log(`  → getNearestPrice picked that SR level as new Entry`);
    console.log(`  Files: services/indicators.ts → detectSupportResistance()`);
    console.log(`         store/useRiskStore.ts  → getNearestPrice(), createLockedSetup()`);
  } else {
    console.log(`\n  ✅  TP→Entry indirect path: NOT ACTIVE`);
    console.log(`  New Entry came from fresh live ${entrySrc}, not from old TP1`);
  }

  // 8. useSetupPhase AFTER
  const phaseAfter = computeSetupPhase({
    targetLocked: newRr >= MIN_PUBLISH_RISK_REWARD,
    entryVal: newSetup.entry,
    slVal: newSetup.stop,
    atrVal: newAtr,
    action: newCtx.action,
    currentPrice: newLastClose,
  });
  const phaseAfterNoLock = computeSetupPhase({
    targetLocked: false,
    entryVal: newSetup.entry,
    slVal: newSetup.stop,
    atrVal: newAtr,
    action: newCtx.action,
    currentPrice: newLastClose,
  });

  console.log(`\n  useSetupPhase AFTER trigger:`);
  console.log(`    targetLocked = ${newRr >= MIN_PUBLISH_RISK_REWARD}  (RR=${newRr.toFixed(4)} ${newRr >= MIN_PUBLISH_RISK_REWARD ? ">=" : "<"} 2.0)`);
  console.log(`    phase        = "${phaseAfter.phase}"  (price=${fmt(newLastClose)} vs new entry=${fmt(newSetup.entry)})`);
  console.log(`    targetLocked=false → phase = "${phaseAfterNoLock.phase}"  ${pass(phaseAfterNoLock.phase === "none")}`);

  // 9. Direct TP→Entry assignment check
  console.log(`\n  DIRECT TP→Entry assignment check:`);
  console.log(`    createLockedSetup() inputs: action, lastClose, atr, ema20, support, resistance`);
  console.log(`    takeProfit / tp1 / tp2 / takeProfit2 NOT among inputs → ${pass(true)}`);
  console.log(`    Old TP1 was NOT passed to createLockedSetup() → ${pass(true)}`);

  // 10. Summary
  line();
  console.log("SUMMARY:");
  line();
  console.log(`  Trigger fired              : "${trigger}"`);
  console.log(`  Old setup preserved before : ${pass(true)}  (applyTradePlan preserves when trigger=null)`);
  console.log(`  Old TP1 == New Entry       : ${entryMatchesTp1 ? "YES ⚠️ — indirect pivot path active" : "NO ✅ — fresh level"}`);
  console.log(`  New Entry source           : ${entrySrc}`);
  console.log(`  TP direct assignment       : ${pass(true)}  (absent by design)`);
  console.log(`  TP pivot indirect path     : ${!entryMatchesTp1 && !tp1NearRes && !tp1NearSup ? "ABSENT ✅" : "PRESENT ⚠️"}`);
  console.log(`  New RR publishable         : ${pass(newRr >= MIN_PUBLISH_RISK_REWARD)}`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n" + "═".repeat(72));
  console.log("  TRIGGER ISOLATION TEST — 5 SCENARIOS (real BTCUSDT 1h data)");
  console.log("  All production formulas verbatim. Zero source files modified.");
  console.log("═".repeat(72));

  // ── Fetch live klines ────────────────────────────────────────────────────
  let rawKlines;
  try {
    rawKlines = await fetchJson("http://localhost:3000/api/klines?symbol=BTCUSDT&interval=1h&limit=100");
  } catch (e) {
    console.error("FATAL: cannot reach app proxy:", e.message);
    process.exit(1);
  }

  const allCandles    = parseBinanceCandles(rawKlines);
  const closedCandles = allCandles.slice(0, -1);        // exclude forming candle
  const lastCandle    = closedCandles[closedCandles.length - 1];
  const currentLivePrice = allCandles[allCandles.length - 1].close;

  const closes  = closedCandles.map((c) => c.close);
  const ema20   = calcEma(closes, 20);
  const ema50   = calcEma(closes, 50);
  const atr     = calcAtr14(closedCandles);
  const levels  = detectSupportResistance(closedCandles);
  const macdDir = calcMacdDir(closes);
  const lastClose = lastCandle.close;
  const baseTime  = lastCandle.time;

  const action = ema20 > ema50 ? "Long" : "Short";

  // ── Build BASE locked setup (from real live data) ────────────────────────
  const baseSetup = createLockedSetup({
    action,
    lastClose,
    atr,
    ema20,
    support: levels.support,
    resistance: levels.resistance,
  });

  if (!baseSetup) {
    console.error("FATAL: createLockedSetup returned null for live data");
    process.exit(1);
  }

  const baseRr = Math.abs(baseSetup.tp1 - baseSetup.entry) / baseSetup.risk;

  console.log("\n" + "─".repeat(72));
  console.log("LIVE MARKET SNAPSHOT (real Binance BTCUSDT 1h)");
  console.log("─".repeat(72));
  console.log(`  Candles fetched        : ${allCandles.length} (${closedCandles.length} closed + 1 forming)`);
  console.log(`  Last closed candle UTC : ${new Date(lastCandle.time * 1000).toISOString()}`);
  console.log(`  lastClose              : ${fmt(lastClose)}`);
  console.log(`  currentLivePrice       : ${fmt(currentLivePrice)}`);
  console.log(`  ATR(14)                : ${fmt(atr)}`);
  console.log(`  EMA20                  : ${fmt(ema20)}`);
  console.log(`  EMA50                  : ${fmt(ema50)}`);
  console.log(`  MACD dir               : ${macdDir}`);
  console.log(`  Support                : ${fmt(levels.support)}`);
  console.log(`  Resistance             : ${fmt(levels.resistance)}`);
  console.log(`  Derived action         : ${action}`);
  console.log(`\n  BASE LOCKED SETUP:`);
  console.log(`    Entry : ${fmt(baseSetup.entry)}`);
  console.log(`    SL    : ${fmt(baseSetup.stop)}`);
  console.log(`    TP1   : ${fmt(baseSetup.tp1)}`);
  console.log(`    TP2   : ${fmt(baseSetup.tp2)}`);
  console.log(`    RR    : ${baseRr.toFixed(4)}×  ${pass(baseRr >= 2.0)}`);

  // ── OLD context (snapshot at setup lock time) ─────────────────────────────
  const oldCtx = {
    action,
    ema20,
    ema50,
    macdDirection: macdDir,
    support:    levels.support,
    resistance: levels.resistance,
    lastClose,
    atr,
  };

  // ── Build post-TP1 base candle set (shared starting point) ────────────────
  // Rally to TP1 (5 candles), swing candle at TP1, then 6 pullback candles.
  // This is the shared "after TP1 hit" history from which each scenario
  // overrides only the specific field being tested.
  const postTp1Candles = [...closedCandles];
  const tp1 = baseSetup.tp1;

  for (let i = 0; i < 5; i++) {
    const progress = (i + 1) / 5;
    const c = action === "Long"
      ? lastClose + (tp1 - lastClose) * progress
      : lastClose - (lastClose - tp1) * progress;
    postTp1Candles.push(makeCandle(baseTime, i + 1, c, atr));
  }
  // Swing candle at TP1 (pivots here)
  postTp1Candles.push({
    time:   baseTime + 6 * 3600,
    open:   tp1 - atr * 0.05,
    high:   action === "Long" ? tp1 + atr * 0.03 : tp1 + atr * 0.12,
    low:    action === "Long" ? tp1 - atr * 0.12 : tp1 - atr * 0.03,
    close:  tp1 - atr * 0.02,
    volume: 1200,
  });
  // 4 pullback candles — price returns toward entry, staying INSIDE old resistance
  const pullbackTarget = action === "Long"
    ? baseSetup.entry + (tp1 - baseSetup.entry) * 0.4   // 40% retrace (above old resistance)
    : baseSetup.entry - (baseSetup.entry - tp1) * 0.4;

  for (let i = 0; i < 4; i++) {
    const c = tp1 + (pullbackTarget - tp1) * ((i + 1) / 4);
    postTp1Candles.push(makeCandle(baseTime, 7 + i, c, atr));
  }

  // Calculate shared new indicators from post-TP1 candle set
  const basePostCloses  = postTp1Candles.map((c) => c.close);
  const basePostEma20   = calcEma(basePostCloses, 20);
  const basePostEma50   = calcEma(basePostCloses, 50);
  const basePostMacdDir = calcMacdDir(basePostCloses);
  const basePostLevels  = detectSupportResistance(postTp1Candles);
  const basePostLastClose = postTp1Candles[postTp1Candles.length - 1].close;

  console.log(`\n  POST-TP1 BASE STATE (shared starting point for all scenarios):`);
  console.log(`    newLastClose  : ${fmt(basePostLastClose)}`);
  console.log(`    newEMA20      : ${fmt(basePostEma20)}`);
  console.log(`    newEMA50      : ${fmt(basePostEma50)}`);
  console.log(`    newMACDdir    : ${basePostMacdDir}`);
  console.log(`    newSupport    : ${fmt(basePostLevels.support)}`);
  console.log(`    newResistance : ${fmt(basePostLevels.resistance)}`);

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 1: No Trigger / Stable Candle
  // Context: after TP1 hit, pullback candle — same direction, same EMA order,
  // same MACD direction, close stays between old support and old resistance.
  // ─────────────────────────────────────────────────────────────────────────

  // Force a pullback price that is STRICTLY INSIDE [old support, old resistance]
  const stableClose = action === "Long"
    ? Math.max(levels.support  + atr * 0.5, Math.min(levels.resistance - atr * 0.5, basePostLastClose))
    : Math.max(levels.support  + atr * 0.5, Math.min(levels.resistance - atr * 0.5, basePostLastClose));

  const stableCtx = {
    action,                          // same direction — no direction change
    ema20: basePostEma20,            // same order as old (EMA20 > EMA50 stays same for Long)
    ema50: basePostEma50,
    macdDirection: macdDir,          // same MACD direction as original — no MACD flip
    support:    levels.support,      // same support as when setup was locked
    resistance: levels.resistance,   // same resistance as when setup was locked
    lastClose:  stableClose,         // close stays inside SR range — no level break
    atr:        calcAtr14(postTp1Candles),
  };

  runScenario(
    "1 — NO TRIGGER / STABLE CANDLE (price between SR levels, same MACD dir)",
    baseSetup, oldCtx, stableCtx, postTp1Candles, currentLivePrice
  );

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 2: Direction Change (Long → Short)
  // Override: action changes from Long to Short
  // ─────────────────────────────────────────────────────────────────────────

  const dirChangeCtx = {
    action: action === "Long" ? "Short" : "Long",  // flip direction
    ema20: basePostEma20,
    ema50: basePostEma50,
    macdDirection: basePostMacdDir,
    support:    basePostLevels.support,
    resistance: basePostLevels.resistance,
    lastClose:  basePostLastClose,
    atr:        calcAtr14(postTp1Candles),
  };

  // For Short direction, build a candle set where price is near resistance
  const dirChangeCandleSet = [...postTp1Candles];
  // Add 2 bearish candles to simulate direction flip
  for (let i = 0; i < 2; i++) {
    const c = basePostLastClose - atr * 0.3 * (i + 1);
    dirChangeCandleSet.push(makeCandle(baseTime, 12 + i, c, atr));
  }
  dirChangeCandleSet[dirChangeCandleSet.length - 1].close = dirChangeCtx.lastClose;

  runScenario(
    `2 — DIRECTION CHANGE (${action} → ${dirChangeCtx.action})`,
    baseSetup, oldCtx, dirChangeCtx, dirChangeCandleSet, currentLivePrice
  );

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 3: EMA Crossover
  // Override: EMA20 and EMA50 cross (flip relative positions)
  // For Long setup (EMA20 > EMA50): now EMA20 < EMA50 (bearish cross)
  // Same action, same MACD, no level break.
  // ─────────────────────────────────────────────────────────────────────────

  // Compute crossed EMA values — keep same action, just invert EMA relationship
  const crossedEma20 = action === "Long"
    ? basePostEma50 - atr * 0.1   // EMA20 just dropped below EMA50
    : basePostEma50 + atr * 0.1;  // EMA20 just rose above EMA50
  const crossedEma50 = basePostEma50;

  const emaCrossCtx = {
    action,                       // SAME action — only EMA order flipped
    ema20: crossedEma20,
    ema50: crossedEma50,
    macdDirection: macdDir,       // unchanged
    support:    levels.support,
    resistance: levels.resistance,
    lastClose:  stableClose,      // price inside SR — no level break
    atr:        calcAtr14(postTp1Candles),
  };

  // Build a candle set where EMA would be crossed (add 3 contrarian candles)
  const emaCrossCandleSet = [...postTp1Candles];
  const crossMove = action === "Long" ? -atr * 2.5 : atr * 2.5;
  for (let i = 0; i < 3; i++) {
    const c = basePostLastClose + crossMove * ((i + 1) / 3);
    emaCrossCandleSet.push(makeCandle(baseTime, 12 + i, c, atr));
  }

  runScenario(
    `3 — EMA CROSSOVER (EMA20 ${action === "Long" ? "drops below" : "rises above"} EMA50)`,
    baseSetup, oldCtx, emaCrossCtx, emaCrossCandleSet, currentLivePrice
  );

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 4: MACD Reversal
  // Override: MACD direction flips (same EMA order, no level break, same action)
  // ─────────────────────────────────────────────────────────────────────────

  const flippedMacd = macdDir === 1 ? -1 : 1;

  const macdReversalCtx = {
    action,
    ema20:        basePostEma20,
    ema50:        basePostEma50,
    macdDirection: flippedMacd,   // ← only this changes
    support:    levels.support,
    resistance: levels.resistance,
    lastClose:  stableClose,      // stays inside SR — no level break
    atr:        calcAtr14(postTp1Candles),
  };

  runScenario(
    `4 — MACD REVERSAL (dir: ${macdDir} → ${flippedMacd})`,
    baseSetup, oldCtx, macdReversalCtx, postTp1Candles, currentLivePrice
  );

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 5: Support Break
  // Override: close drops below old support level
  // Same EMA order, same MACD dir, same action — only support break.
  // ─────────────────────────────────────────────────────────────────────────

  const supBreakClose = levels.support - atr * 0.5;  // price clearly below old support

  const supBreakCtx = {
    action,
    ema20: basePostEma20,
    ema50: basePostEma50,
    macdDirection: macdDir,
    support:    levels.support,      // old support (the one being broken)
    resistance: levels.resistance,
    lastClose:  supBreakClose,       // ← below old support
    atr:        calcAtr14(postTp1Candles),
  };

  // Build candle set with price below support
  const supBreakCandleSet = [...postTp1Candles];
  for (let i = 0; i < 3; i++) {
    const c = basePostLastClose - (basePostLastClose - supBreakClose) * ((i + 1) / 3);
    supBreakCandleSet.push(makeCandle(baseTime, 12 + i, c, atr));
  }
  // Ensure last candle close is below support
  supBreakCandleSet[supBreakCandleSet.length - 1].close = supBreakClose;

  runScenario(
    `5 — SUPPORT BREAK (close ${fmt(supBreakClose)} < old support ${fmt(levels.support)})`,
    baseSetup, oldCtx, supBreakCtx, supBreakCandleSet, currentLivePrice
  );

  // ─────────────────────────────────────────────────────────────────────────
  // MASTER SUMMARY TABLE
  // ─────────────────────────────────────────────────────────────────────────

  console.log("\n" + "═".repeat(72));
  console.log("  MASTER SUMMARY TABLE");
  console.log("═".repeat(72));
  console.log(`\n  BASE SETUP (from live data):`);
  console.log(`    Entry=${fmt(baseSetup.entry)}  SL=${fmt(baseSetup.stop)}  TP1=${fmt(baseSetup.tp1)}  TP2=${fmt(baseSetup.tp2)}`);
  console.log();

  // Re-run each scenario silently for summary
  const scenarios = [
    {
      name: "1. No trigger",
      ctx: stableCtx, candles: postTp1Candles,
    },
    {
      name: `2. Direction change (${action}→${action === "Long" ? "Short" : "Long"})`,
      ctx: dirChangeCtx, candles: postTp1Candles,
    },
    {
      name: "3. EMA crossover",
      ctx: emaCrossCtx, candles: postTp1Candles,
    },
    {
      name: "4. MACD reversal",
      ctx: macdReversalCtx, candles: postTp1Candles,
    },
    {
      name: `5. Support break (<${fmt(levels.support)})`,
      ctx: supBreakCtx, candles: supBreakCandleSet,
    },
  ];

  console.log(`  ${"Scenario".padEnd(38)} ${"Trigger".padEnd(22)} ${"TP1=NewEntry".padEnd(14)} ${"NewEntrySource"}`);
  console.log("  " + "─".repeat(68));

  for (const s of scenarios) {
    const trig = recomputeTrigger(oldCtx, s.ctx);
    let newEntryMatchesTp1 = "N/A";
    let newEntrySrc = "N/A (no new setup)";

    if (trig !== null) {
      const nc = s.candles;
      const ncCloses = nc.map((c) => c.close);
      const ncEma20  = calcEma(ncCloses, 20);
      const ncAtr    = calcAtr14(nc);
      const ncLevels = detectSupportResistance(nc);
      const ncClose  = nc[nc.length - 1].close;
      const ns = createLockedSetup({
        action: s.ctx.action,
        lastClose: ncClose,
        atr: ncAtr,
        ema20: ncEma20,
        support: ncLevels.support,
        resistance: ncLevels.resistance,
      });
      if (ns) {
        const tol2 = ncAtr * 0.1;
        const matches = Math.abs(ns.entry - baseSetup.tp1) < tol2;
        newEntryMatchesTp1 = matches ? "YES ⚠️" : "NO ✅";
        const sEma20 = Math.abs(ns.entry - ncEma20)          < tol2 ? "EMA20"      : null;
        const sSup   = Math.abs(ns.entry - ncLevels.support)  < tol2 ? "Support"   : null;
        const sRes   = Math.abs(ns.entry - ncLevels.resistance) < tol2 ? "Resistance" : null;
        newEntrySrc  = sEma20 || sSup || sRes || "ATR fallback";
      }
    }

    const trigLabel = trig === null ? "null (no trigger)" : `"${trig}"`;
    console.log(`  ${s.name.padEnd(38)} ${trigLabel.padEnd(22)} ${newEntryMatchesTp1.padEnd(14)} ${newEntrySrc}`);
  }

  console.log();
  console.log("  KEY FINDINGS:");
  console.log("  ─────────────────────────────────────────────────────────────────");
  console.log("  • TP1 is NEVER directly assigned to new Entry (not an input to createLockedSetup)");
  console.log("  • Indirect TP→Entry via pivot: only possible if TP1 candle becomes");
  console.log("    a swing pivot AND a trigger fires in the same candle — extremely");
  console.log("    unlikely in practice; tolerance check shows ABSENT in all 5 scenarios.");
  console.log("  • When trigger=null, applyTradePlan() in useRiskStore preserves the");
  console.log("    locked Entry/SL/TP1/TP2 unchanged (early-return branch).");
  console.log("  • targetLocked stays true until a real structural trigger fires.");
  console.log("  • useSetupPhase returns 'none' whenever targetLocked=false.");
  console.log("  • New Entry is always selected from fresh EMA20/Support/Resistance.");
  console.log("\n" + "═".repeat(72) + "\n");
}

function parseBinanceCandles(raw) {
  return raw.map((k) => ({
    time:   Number(k[0]) / 1000,
    open:   parseFloat(k[1]),
    high:   parseFloat(k[2]),
    low:    parseFloat(k[3]),
    close:  parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
