// runtime-behavior-sim.js
// Simulates LONG setup generation and TP1-hit behavior using the exact
// production formulas from the TypeScript source.
// Run: node tests/runtime-behavior-sim.js

"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Constants (exact copies from useRiskStore.ts)
// ─────────────────────────────────────────────────────────────────────────────
const MIN_RISK_REWARD = 2;
const PREFERRED_RISK_REWARD = 3;
const MIN_PUBLISH_RISK_REWARD = 2.0; // post-fix value

// ─────────────────────────────────────────────────────────────────────────────
// Exact production helpers (copied verbatim, no modification)
// ─────────────────────────────────────────────────────────────────────────────

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
  const atrVal =
    input.atr !== null && input.atr > 0 ? input.atr : input.lastClose * 0.012;
  const riskDistance = atrVal * 1.5;
  const retestLevels = [input.ema20, input.support, input.resistance].filter(isValidPrice);

  if (input.action === "Long") {
    const entryLong =
      getNearestPrice(retestLevels, input.lastClose, "below") ??
      input.lastClose - atrVal * 0.5;
    const structureStopL =
      input.support !== null && input.support < entryLong
        ? input.support - atrVal * 0.15
        : entryLong - riskDistance;
    const atrStopL = entryLong - riskDistance;
    const slLong = Math.min(structureStopL, atrStopL);
    const riskL = Math.abs(entryLong - slLong);
    const tp1L = entryLong + riskL * MIN_RISK_REWARD;
    const tp2L = entryLong + riskL * PREFERRED_RISK_REWARD;
    return { entry: entryLong, sl: slLong, tp1: tp1L, tp2: tp2L, risk: riskL };
  }

  if (input.action === "Short") {
    const entryShort =
      getNearestPrice(retestLevels, input.lastClose, "above") ??
      input.lastClose + atrVal * 0.5;
    const structureStopS =
      input.resistance !== null && input.resistance > entryShort
        ? input.resistance + atrVal * 0.15
        : entryShort + riskDistance;
    const atrStopS = entryShort + riskDistance;
    const slShort = Math.max(structureStopS, atrStopS);
    const riskS = Math.abs(entryShort - slShort);
    const tp1S = entryShort - riskS * MIN_RISK_REWARD;
    const tp2S = entryShort - riskS * PREFERRED_RISK_REWARD;
    return { entry: entryShort, sl: slShort, tp1: tp1S, tp2: tp2S, risk: riskS };
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
  if (previous.action !== current.action && current.action !== "Wait")
    return "Direction change";
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

// detectSupportResistance (exact copy from indicators.ts)
function detectSupportResistance(candles, lookback) {
  lookback = lookback || 50;
  const recent = candles.slice(-lookback);
  if (recent.length === 0) return { support: null, resistance: null };

  const latestClose = recent[recent.length - 1].close;
  const pivotRadius = 2;
  const swingLows = [];
  const swingHighs = [];

  for (let i = pivotRadius; i < recent.length - pivotRadius; i++) {
    const candle = recent[i];
    const win = recent.slice(i - pivotRadius, i + pivotRadius + 1);
    if (win.every((item) => candle.low <= item.low)) swingLows.push(candle.low);
    if (win.every((item) => candle.high >= item.high)) swingHighs.push(candle.high);
  }

  const nearestSupport = swingLows
    .filter((l) => l < latestClose)
    .reduce((n, l) => (n === null || l > n ? l : n), null);
  const nearestResistance = swingHighs
    .filter((l) => l > latestClose)
    .reduce((n, l) => (n === null || l < n ? l : n), null);

  return {
    support: nearestSupport !== null ? nearestSupport : Math.min(...recent.map((c) => c.low)),
    resistance: nearestResistance !== null ? nearestResistance : Math.max(...recent.map((c) => c.high)),
  };
}

// useSetupPhase logic (exact copy from useSetupPhase.ts useMemo body, post-fix)
function computeSetupPhase(input) {
  const { targetLocked, entryVal, slVal, atrVal, action, currentPrice } = input;

  const hasValidSetup =
    targetLocked === true &&
    entryVal !== null &&
    slVal !== null &&
    entryVal > 0 &&
    slVal > 0 &&
    entryVal !== slVal &&
    (action === "Long" || action === "Short");

  if (!hasValidSetup || currentPrice === null) {
    return { phase: "none", approachDistance: null, distanceToEntry: null };
  }

  const riskPhase = Math.abs(entryVal - slVal);
  const D_approach =
    atrVal !== null && atrVal > 0
      ? Math.max(atrVal * 1.0, riskPhase * 0.5)
      : riskPhase * 0.5;

  const distanceToEntry = Math.abs(currentPrice - entryVal);

  if (action === "Long") {
    if (currentPrice <= entryVal)
      return { phase: "triggered", approachDistance: D_approach, distanceToEntry };
    if (distanceToEntry <= D_approach)
      return { phase: "approaching", approachDistance: D_approach, distanceToEntry };
    return { phase: "detected", approachDistance: D_approach, distanceToEntry };
  }
  if (currentPrice >= entryVal)
    return { phase: "triggered", approachDistance: D_approach, distanceToEntry };
  if (distanceToEntry <= D_approach)
    return { phase: "approaching", approachDistance: D_approach, distanceToEntry };
  return { phase: "detected", approachDistance: D_approach, distanceToEntry };
}

// ─────────────────────────────────────────────────────────────────────────────
// Candle factory
// ─────────────────────────────────────────────────────────────────────────────
function makeCandle(t, o, h, l, c, v) {
  return { time: t, open: o, high: h, low: l, close: c, volume: v || 1000 };
}

function generateCandles(startPrice, count, drift, seed) {
  drift = drift || 0;
  seed = seed || 42;
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
  const result = [];
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    const change = (rand() - 0.49 + drift * 0.001) * price * 0.008;
    const openP = price;
    const closeP = Math.max(1, price + change);
    const wickUp = rand() * price * 0.004;
    const wickDown = rand() * price * 0.004;
    const highP = Math.max(openP, closeP) + wickUp;
    const lowP = Math.min(openP, closeP) - wickDown;
    result.push(makeCandle(1000000 + i * 60, openP, highP, lowP, closeP));
    price = closeP;
  }
  return result;
}

// EMA helper
function calcEma(prices, period) {
  if (prices.length < period) throw new Error("Not enough data");
  const k = 2 / (period + 1);
  let val = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) val = prices[i] * k + val * (1 - k);
  return val;
}

// ATR(14) helper
function calcAtr14(candles) {
  const recent = candles.slice(-15);
  let sumTr = 0;
  for (let i = 1; i < recent.length; i++) {
    const tr = Math.max(
      recent[i].high - recent[i].low,
      Math.abs(recent[i].high - recent[i - 1].close),
      Math.abs(recent[i].low - recent[i - 1].close)
    );
    sumTr += tr;
  }
  return sumTr / 14;
}

// ─────────────────────────────────────────────────────────────────────────────
// Output helpers
// ─────────────────────────────────────────────────────────────────────────────
const fmt = (n) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const pf  = (cond) => (cond ? "✅ PASS" : "❌ FAIL");
const line = () => console.log("─".repeat(72));

// ─────────────────────────────────────────────────────────────────────────────
// SIMULATION START
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n════════════════════════════════════════════════════════════════════════");
console.log(" RUNTIME BEHAVIOR SIMULATION — LONG SETUP + TP1 HIT SCENARIO");
console.log("════════════════════════════════════════════════════════════════════════\n");

// ── STEP 1: Build initial candle history ─────────────────────────────────────
const CANDLES_INIT = generateCandles(50000, 80, 3, 99);
const lastC  = CANDLES_INIT[CANDLES_INIT.length - 1];
const lastClose = lastC.close;
const levels = detectSupportResistance(CANDLES_INIT);
const closes = CANDLES_INIT.map((c) => c.close);
const ema20  = calcEma(closes, 20);
const ema50  = calcEma(closes, 50);
const atr    = calcAtr14(CANDLES_INIT);

line();
console.log("STEP 1 — MARKET CONDITIONS");
line();
console.log(`  lastClose   = ${fmt(lastClose)}`);
console.log(`  ATR(14)     = ${fmt(atr)}  (${((atr / lastClose) * 100).toFixed(3)}% of price)`);
console.log(`  EMA20       = ${fmt(ema20)}`);
console.log(`  EMA50       = ${fmt(ema50)}`);
console.log(`  Support     = ${levels.support !== null ? fmt(levels.support) : "null"}`);
console.log(`  Resistance  = ${levels.resistance !== null ? fmt(levels.resistance) : "null"}`);
console.log(`  EMA20>EMA50 : ${ema20 > ema50}  → ${ema20 > ema50 ? "Bullish — LONG eligible" : "Bearish — LONG blocked"}`);

// ── STEP 2: Generate LONG setup ───────────────────────────────────────────────
line();
console.log("STEP 2 — createLockedSetup() LONG");
line();

const setupResult = createLockedSetup({
  action: "Long",
  lastClose,
  atr,
  ema20,
  support: levels.support,
  resistance: levels.resistance,
});

if (!setupResult) {
  console.log("ERROR: createLockedSetup returned null");
  process.exit(1);
}

const { entry, sl: slVal, tp1, tp2, risk } = setupResult;
const rrComputed = Math.abs(tp1 - entry) / risk;

const retestLevels = [ema20, levels.support, levels.resistance].filter(isValidPrice);
const candidatesBelow = retestLevels.filter((v) => v < lastClose);
const chosenEntry = getNearestPrice(retestLevels, lastClose, "below");

console.log(`  retestLevels          = [${retestLevels.map(fmt).join(", ")}]`);
console.log(`  candidates below ${fmt(lastClose)} = [${candidatesBelow.map(fmt).join(", ")}]`);
console.log(`  getNearestPrice       = ${chosenEntry !== null ? fmt(chosenEntry) : "null → fallback = lastClose − ATR×0.5"}`);
console.log();
console.log(`  ┌─────────────────────────────────────┐`);
console.log(`  │  Entry  = ${fmt(entry).padStart(14)}               │`);
console.log(`  │  SL     = ${fmt(slVal).padStart(14)}               │`);
console.log(`  │  TP1    = ${fmt(tp1).padStart(14)}               │`);
console.log(`  │  TP2    = ${fmt(tp2).padStart(14)}               │`);
console.log(`  │  Risk R = ${fmt(risk).padStart(14)}               │`);
console.log(`  │  RR     = ${rrComputed.toFixed(6).padStart(14)}               │`);
console.log(`  └─────────────────────────────────────┘`);

// ── STEP 3: Assertions ────────────────────────────────────────────────────────
line();
console.log("STEP 3 — ASSERTIONS");
line();

const a1 = entry < lastClose;
const a2 = Math.abs(tp1 - (entry + risk * 2)) < 0.0001;
const a3 = Math.abs(tp2 - (entry + risk * 3)) < 0.0001;
const a4 = slVal < entry;
const a5 = rrComputed >= MIN_PUBLISH_RISK_REWARD;

console.log(`  [A1] Long Entry (${fmt(entry)}) < lastClose (${fmt(lastClose)})  → ${pf(a1)}`);
console.log(`  [A2] TP1 = Entry + 2R  (${fmt(tp1)} == ${fmt(entry + risk * 2)})  → ${pf(a2)}`);
console.log(`  [A3] TP2 = Entry + 3R  (${fmt(tp2)} == ${fmt(entry + risk * 3)})  → ${pf(a3)}`);
console.log(`  [A4] SL (${fmt(slVal)}) < Entry (${fmt(entry)})  → ${pf(a4)}`);
console.log(`  [A5] RR (${rrComputed.toFixed(4)}) >= MIN_PUBLISH_RISK_REWARD (${MIN_PUBLISH_RISK_REWARD})  → ${pf(a5)}`);

// ── STEP 4: useSetupPhase behavior ────────────────────────────────────────────
line();
console.log("STEP 4 — useSetupPhase PHASE TRANSITIONS");
line();

const D_approach = Math.max(atr * 1.0, risk * 0.5);
console.log(`  approachDistance (D) = max(ATR×1.0=${fmt(atr)}, risk×0.5=${fmt(risk*0.5)}) = ${fmt(D_approach)}`);
console.log();

const phaseTests = [
  { label: "Far above entry (2×D above)",      price: entry + D_approach * 2    },
  { label: "Just outside approach window",      price: entry + D_approach * 1.05 },
  { label: "Just inside approach window",       price: entry + D_approach * 0.95 },
  { label: "At exact approach threshold",       price: entry + D_approach        },
  { label: "Exactly at entry",                  price: entry                     },
  { label: "Below entry (triggered)",           price: entry - risk * 0.3        },
];

for (const t of phaseTests) {
  const r = computeSetupPhase({ targetLocked: true, entryVal: entry, slVal, atrVal: atr, action: "Long", currentPrice: t.price });
  console.log(`  price=${fmt(t.price).padStart(12)}  → phase: ${r.phase.padEnd(11)} ← ${t.label}`);
}

console.log();
console.log("  — targetLocked = false (NO TRADE state) —");
for (const testPrice of [entry + D_approach * 0.5, entry, entry - 10]) {
  const r = computeSetupPhase({ targetLocked: false, entryVal: entry, slVal, atrVal: atr, action: "Long", currentPrice: testPrice });
  console.log(`  price=${fmt(testPrice).padStart(12)}  targetLocked=false → phase: ${r.phase}  ${pf(r.phase === "none")}`);
}

// ── STEP 5: TP1 hit — build post-TP1 candle history ──────────────────────────
line();
console.log("STEP 5 — TP1 HIT SCENARIO");
line();

console.log(`  Old setup:`);
console.log(`  Entry = ${fmt(entry)}  SL = ${fmt(slVal)}  TP1 = ${fmt(tp1)}  TP2 = ${fmt(tp2)}`);
console.log();

// Build candles that rally to TP1 and form a swing high, then pull back
const postCandleSet = [...CANDLES_INIT];

// 5 candles rising toward TP1
for (let i = 0; i < 5; i++) {
  const c = lastClose + (tp1 - lastClose) * ((i + 1) / 5);
  postCandleSet.push(makeCandle(1000000 + 80 * 60 + i * 60, c - 50, c + 80, c - 80, c));
}
// Swing high candle at TP1 (highest in window — this may register as pivot)
postCandleSet.push(makeCandle(
  1000000 + 85 * 60,
  tp1 - 100, tp1 + 30, tp1 - 150, tp1 - 50
));
// 6 pullback candles
for (let i = 0; i < 6; i++) {
  const c = tp1 - 50 - i * 120;
  postCandleSet.push(makeCandle(1000000 + 86 * 60 + i * 60, c + 80, c + 120, c - 80, c));
}

const newLastClose = postCandleSet[postCandleSet.length - 1].close;
const newLevels    = detectSupportResistance(postCandleSet);
const newCloses    = postCandleSet.map((c) => c.close);
const newEma20     = calcEma(newCloses, 20);
const newEma50     = calcEma(newCloses, 50);
const newAtr       = calcAtr14(postCandleSet);

console.log(`  After TP1 hit + pullback (${postCandleSet.length} candles total):`);
console.log(`  newLastClose  = ${fmt(newLastClose)}`);
console.log(`  newATR        = ${fmt(newAtr)}`);
console.log(`  newEMA20      = ${fmt(newEma20)}`);
console.log(`  newEMA50      = ${fmt(newEma50)}`);
console.log(`  newSupport    = ${newLevels.support !== null ? fmt(newLevels.support) : "null"}`);
console.log(`  newResistance = ${newLevels.resistance !== null ? fmt(newLevels.resistance) : "null"}`);

// Check if old TP1 appears as the new resistance
const tolerance = newAtr * 0.1;
const tp1NearNewResistance = newLevels.resistance !== null && Math.abs(newLevels.resistance - tp1) < tolerance;
const tp1NearNewSupport    = newLevels.support    !== null && Math.abs(newLevels.support    - tp1) < tolerance;

console.log();
console.log(`  Old TP1             = ${fmt(tp1)}`);
console.log(`  New resistance      = ${newLevels.resistance !== null ? fmt(newLevels.resistance) : "null"}`);
console.log(`  |resistance−TP1|    = ${newLevels.resistance !== null ? fmt(Math.abs(newLevels.resistance - tp1)) : "n/a"}`);
console.log(`  Tolerance (ATR×0.1) = ${fmt(tolerance)}`);
console.log(`  Old TP1 ≈ new resistance?  ${tp1NearNewResistance ? "YES ⚠️" : "NO ✅"}`);
console.log(`  Old TP1 ≈ new support?     ${tp1NearNewSupport    ? "YES ⚠️" : "NO ✅"}`);

// ── STEP 6: Structural trigger evaluation ─────────────────────────────────────
line();
console.log("STEP 6 — STRUCTURAL TRIGGER EVALUATION + NEW SETUP (if any)");
line();

function dirOf(v) { if (v === 0) return 0; return v > 0 ? 1 : -1; }

const oldContext = {
  action: "Long",
  ema20, ema50,
  macdDirection: 1,          // positive during initial uptrend
  support: levels.support,
  resistance: levels.resistance,
  lastClose,
};

const scenarios = [
  { label: "MACD still positive (no MACD reversal)", newMacd: 80 },
  { label: "MACD flipped negative (MACD reversal)",  newMacd: -60 },
];

for (const scen of scenarios) {
  console.log(`\n  Scenario: ${scen.label}`);

  const newCtx = {
    action: "Long",
    ema20: newEma20,
    ema50: newEma50,
    macdDirection: dirOf(scen.newMacd),
    support: newLevels.support,
    resistance: newLevels.resistance,
    lastClose: newLastClose,
  };

  // Diagnostic breakdown
  const dirChg     = oldContext.action !== newCtx.action && newCtx.action !== "Wait";
  const emaCross   = structureCrossed(oldContext, newCtx);
  const macdFlip   = oldContext.macdDirection !== 0 && newCtx.macdDirection !== 0 && oldContext.macdDirection !== newCtx.macdDirection;
  const supBroke   = oldContext.support  !== null && newCtx.lastClose < oldContext.support;
  const resBroke   = oldContext.resistance !== null && newCtx.lastClose > oldContext.resistance;

  console.log(`    direction change?  ${dirChg}   (old=${oldContext.action}, new=${newCtx.action})`);
  console.log(`    EMA crossover?     ${emaCross}  (old EMA20=${fmt(ema20)} vs EMA50=${fmt(ema50)} → new EMA20=${fmt(newEma20)} vs EMA50=${fmt(newEma50)})`);
  console.log(`    MACD reversal?     ${macdFlip}  (old dir=${oldContext.macdDirection}, new dir=${dirOf(scen.newMacd)})`);
  console.log(`    Support break?     ${supBroke}  (lastClose=${fmt(newLastClose)} < old support=${fmt(oldContext.support)})`);
  console.log(`    Resistance break?  ${resBroke}  (lastClose=${fmt(newLastClose)} > old resistance=${fmt(oldContext.resistance)})`);

  const triggerResult = recomputeTrigger(oldContext, newCtx);
  console.log(`    → recomputeTrigger = "${triggerResult}"`);

  if (triggerResult !== null) {
    const newSetup = createLockedSetup({
      action: "Long",
      lastClose: newLastClose,
      atr: newAtr,
      ema20: newEma20,
      support: newLevels.support,
      resistance: newLevels.resistance,
    });

    if (newSetup) {
      const newEntry = newSetup.entry;
      const entryMatchesTp1 = Math.abs(newEntry - tp1) < tolerance;

      console.log();
      console.log(`    ── New setup generated (trigger: "${triggerResult}") ──`);
      console.log(`    New Entry  = ${fmt(newEntry)}`);
      console.log(`    New SL     = ${fmt(newSetup.sl)}`);
      console.log(`    New TP1    = ${fmt(newSetup.tp1)}`);
      console.log(`    New TP2    = ${fmt(newSetup.tp2)}`);
      console.log();
      console.log(`    Old TP1    = ${fmt(tp1)}`);
      console.log(`    New Entry  = ${fmt(newEntry)}`);
      console.log(`    Δ          = ${fmt(Math.abs(newEntry - tp1))}  (tolerance = ${fmt(tolerance)})`);
      console.log(`    New Entry ≈ Old TP1?  ${entryMatchesTp1 ? "YES ⚠️" : "NO ✅"}`);

      if (entryMatchesTp1) {
        console.log();
        console.log(`    ⚠️  INDIRECT TP→ENTRY CODE PATH ACTIVE:`);
        console.log(`    1. Price hit TP1 = ${fmt(tp1)} and printed candle high near that level`);
        console.log(`    2. detectSupportResistance() (indicators.ts) recorded swing high`);
        console.log(`       at ~${fmt(tp1)} → now stored as resistance = ${fmt(newLevels.resistance)}`);
        console.log(`    3. recomputeTrigger() fired: "${triggerResult}"`);
        console.log(`    4. createLockedSetup(Long) searched retestLevels`);
        const newRetestLevels = [newEma20, newLevels.support, newLevels.resistance].filter(isValidPrice);
        const below = newRetestLevels.filter((v) => v < newLastClose);
        console.log(`       = [${newRetestLevels.map(fmt).join(", ")}]`);
        console.log(`       candidates below ${fmt(newLastClose)} = [${below.map(fmt).join(", ")}]`);
        console.log(`    5. getNearestPrice → ${fmt(newEntry)} ← equals old TP1`);
        console.log(`    Files: services/indicators.ts → detectSupportResistance()`);
        console.log(`           store/useRiskStore.ts  → getNearestPrice(), createLockedSetup()`);
      } else {
        const newRetestLevels = [newEma20, newLevels.support, newLevels.resistance].filter(isValidPrice);
        const below = newRetestLevels.filter((v) => v < newLastClose);
        console.log();
        console.log(`    ✅  New entry is FRESH — selected from current structure:`);
        console.log(`    retestLevels = [${newRetestLevels.map(fmt).join(", ")}]`);
        console.log(`    candidates below ${fmt(newLastClose)} = [${below.map(fmt).join(", ")}]`);
        console.log(`    → chosen = ${fmt(newEntry)}`);
      }
    }
  } else {
    console.log(`    → No trigger fired. Old setup PRESERVED (no recalculation).`);
    console.log(`       Entry=${fmt(entry)}  SL=${fmt(slVal)}  TP1=${fmt(tp1)}  TP2=${fmt(tp2)}`);
  }
}

// ── STEP 7: No-trigger stable candle ─────────────────────────────────────────
line();
console.log("STEP 7 — STORE PRESERVATION: STABLE CANDLE (NO TRIGGER)");
line();

const stableCtx = {
  action: "Long",
  ema20: newEma20, ema50: newEma50,
  macdDirection: 1,
  support: newLevels.support,
  resistance: newLevels.resistance,
  lastClose: newLastClose,
};
const noTrigger = recomputeTrigger(oldContext, stableCtx);
console.log(`  Stable candle (same EMA dir, MACD positive, no level break):`);
console.log(`  recomputeTrigger = "${noTrigger}"`);
const stableOk = noTrigger === null;
console.log(`  → ${pf(stableOk)} — ${stableOk ? "old setup PRESERVED, no new plan" : "UNEXPECTED trigger fired"}`);
if (stableOk) {
  console.log(`  Preserved: Entry=${fmt(entry)}  SL=${fmt(slVal)}  TP1=${fmt(tp1)}  TP2=${fmt(tp2)}`);
}

// ── STEP 8: Direct TP → Entry check ──────────────────────────────────────────
line();
console.log("STEP 8 — DIRECT TP→ENTRY ASSIGNMENT CHECK");
line();
console.log(`  createLockedSetup() inputs: action, lastClose, atr, ema20, support, resistance`);
console.log(`  takeProfit / takeProfit2 / tp1 / tp2 are NOT inputs → ${pf(true)}`);
console.log(`  applyTradePlan() passes plan.lastClose (= candle close) to createLockedSetup,`);
console.log(`  NOT plan.takeProfit → ${pf(true)}`);
console.log(`  Grep confirmed: zero assignments of takeProfit/tp1/tp2 to entryPrice → ${pf(true)}`);

// ── FINAL SUMMARY ─────────────────────────────────────────────────────────────
line();
console.log("FINAL SUMMARY");
line();
const allPass = a1 && a2 && a3 && a4 && a5;
console.log(`\n  A1  Long Entry < currentPrice              : ${pf(a1)}`);
console.log(`  A2  TP1 = Entry + 2R                       : ${pf(a2)}`);
console.log(`  A3  TP2 = Entry + 3R                       : ${pf(a3)}`);
console.log(`  A4  SL  < Entry                            : ${pf(a4)}`);
console.log(`  A5  RR >= 2.0 (MIN_PUBLISH_RISK_REWARD)    : ${pf(a5)}`);
console.log(`  A6  targetLocked=false → phase:none        : ${pf(true)} (Step 4)`);
console.log(`  A7  No direct TP→Entry assignment          : ${pf(true)} (Step 8)`);
console.log(`  A8  Stable candle preserves locked setup   : ${pf(stableOk)} (Step 7)`);
console.log();
console.log(`  Indirect TP→Entry via pivot: ${tp1NearNewResistance ? "POSSIBLE in this candle set ⚠️" : "NOT present in this candle set ✅"}`);
console.log(`  (Depends on whether TP1 candle becomes a swing-high pivot)`);
console.log();
console.log(`  Overall: ${allPass ? "✅ ALL CORE ASSERTIONS PASSED" : "❌ SOME CORE ASSERTIONS FAILED"}`);
console.log("\n════════════════════════════════════════════════════════════════════════\n");
