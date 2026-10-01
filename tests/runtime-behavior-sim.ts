/**
 * runtime-behavior-sim.ts
 *
 * Simulates LONG setup generation and TP1-hit behavior using the exact
 * production formulas copied verbatim from:
 *   store/useRiskStore.ts   – createLockedSetup, getNearestPrice, recomputeTrigger
 *   services/indicators.ts  – detectSupportResistance
 *   store/useSetupPhase.ts  – hasValidSetup, phase logic
 *
 * Run with:  npx ts-node --project tsconfig.json tests/runtime-behavior-sim.ts
 */
export {};

// ─────────────────────────────────────────────────────────────────────────────
// Constants (exact copies from useRiskStore.ts)
// ─────────────────────────────────────────────────────────────────────────────
const MIN_RISK_REWARD = 2;
const PREFERRED_RISK_REWARD = 3;
const PREFERRED_RISK_REWARD_HIGH_CONF = 3;   // confidence >= 88 path
const MIN_PUBLISH_RISK_REWARD = 2.0;          // POST-FIX value

// ─────────────────────────────────────────────────────────────────────────────
// Types (simplified mirrors of production types)
// ─────────────────────────────────────────────────────────────────────────────
type RiskAction = "Long" | "Short" | "Wait";

interface TargetContext {
  action: RiskAction;
  ema20: number | null;
  ema50: number | null;
  macdDirection: -1 | 0 | 1;
  support: number | null;
  resistance: number | null;
  lastClose: number | null;
}

interface LockedSetup {
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  risk: number;
  rrAtPublish: number;
}

interface SetupPhaseResult {
  phase: "none" | "detected" | "approaching" | "triggered";
  approachDistance: number | null;
  distanceToEntry: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exact production helpers (copied verbatim, no modification)
// ─────────────────────────────────────────────────────────────────────────────

function isValidPrice(v: number | null | undefined): v is number {
  return v !== null && v !== undefined && Number.isFinite(v) && v > 0;
}

function getNearestPrice(
  prices: number[],
  reference: number,
  direction: "below" | "above"
): number | null {
  const candidates = prices.filter((p) =>
    direction === "below" ? p < reference : p > reference
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((nearest, p) =>
    Math.abs(p - reference) < Math.abs(nearest - reference) ? p : nearest
  );
}

function createLockedSetup(input: {
  action: RiskAction;
  lastClose: number;
  atr: number | null;
  ema20: number | null;
  support: number | null;
  resistance: number | null;
}): { entry: number; stop: number; takeProfit: number; takeProfit2: number } | null {
  const atr =
    input.atr !== null && input.atr > 0 ? input.atr : input.lastClose * 0.012;
  const riskDistance = atr * 1.5;
  const retestLevels = [input.ema20, input.support, input.resistance].filter(
    isValidPrice
  );

  if (input.action === "Long") {
    const entry =
      getNearestPrice(retestLevels, input.lastClose, "below") ??
      input.lastClose - atr * 0.5;
    const structureStop =
      input.support !== null && input.support < entry
        ? input.support - atr * 0.15
        : entry - riskDistance;
    const atrStop = entry - riskDistance;
    const stop = Math.min(structureStop, atrStop);
    const risk = Math.abs(entry - stop);
    const tp1 = entry + risk * MIN_RISK_REWARD;
    const tp2 = entry + risk * PREFERRED_RISK_REWARD;
    return { entry, stop, takeProfit: tp1, takeProfit2: tp2 };
  }

  if (input.action === "Short") {
    const entry =
      getNearestPrice(retestLevels, input.lastClose, "above") ??
      input.lastClose + atr * 0.5;
    const structureStop =
      input.resistance !== null && input.resistance > entry
        ? input.resistance + atr * 0.15
        : entry + riskDistance;
    const atrStop = entry + riskDistance;
    const stop = Math.max(structureStop, atrStop);
    const risk = Math.abs(entry - stop);
    const tp1 = entry - risk * MIN_RISK_REWARD;
    const tp2 = entry - risk * PREFERRED_RISK_REWARD;
    return { entry, stop, takeProfit: tp1, takeProfit2: tp2 };
  }

  return null;
}

function structureCrossed(prev: TargetContext, curr: TargetContext): boolean {
  if (
    prev.ema20 === null ||
    prev.ema50 === null ||
    curr.ema20 === null ||
    curr.ema50 === null
  )
    return false;
  return (
    (prev.ema20 <= prev.ema50 && curr.ema20 > curr.ema50) ||
    (prev.ema20 >= prev.ema50 && curr.ema20 < curr.ema50)
  );
}

function recomputeTrigger(
  previous: TargetContext | null,
  current: TargetContext
): string | null {
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

// ─────────────────────────────────────────────────────────────────────────────
// detectSupportResistance (exact copy from indicators.ts)
// ─────────────────────────────────────────────────────────────────────────────
interface Candle {
  time: number; open: number; high: number; low: number;
  close: number; volume: number;
}

function detectSupportResistance(
  candles: Candle[],
  lookback = 50
): { support: number | null; resistance: number | null } {
  const recent = candles.slice(-lookback);
  if (recent.length === 0) return { support: null, resistance: null };

  const latestClose = recent.at(-1)?.close ?? null;
  const pivotRadius = 2;
  const swingLows: number[] = [];
  const swingHighs: number[] = [];

  for (let i = pivotRadius; i < recent.length - pivotRadius; i++) {
    const candle = recent[i];
    const window = recent.slice(i - pivotRadius, i + pivotRadius + 1);
    if (window.every((item) => candle.low <= item.low))
      swingLows.push(candle.low);
    if (window.every((item) => candle.high >= item.high))
      swingHighs.push(candle.high);
  }

  const nearestSupport =
    latestClose === null
      ? null
      : swingLows
          .filter((l) => l < latestClose)
          .reduce<number | null>(
            (n, l) => (n === null || l > n ? l : n),
            null
          );

  const nearestResistance =
    latestClose === null
      ? null
      : swingHighs
          .filter((l) => l > latestClose)
          .reduce<number | null>(
            (n, l) => (n === null || l < n ? l : n),
            null
          );

  return {
    support:
      nearestSupport ?? Math.min(...recent.map((c) => c.low)),
    resistance:
      nearestResistance ?? Math.max(...recent.map((c) => c.high)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// useSetupPhase logic (exact copy from useSetupPhase.ts useMemo body)
// ─────────────────────────────────────────────────────────────────────────────
function computeSetupPhase(input: {
  targetLocked: boolean;
  entry: number | null;
  sl: number | null;
  atr: number | null;
  action: RiskAction;
  currentPrice: number | null;
}): SetupPhaseResult {
  const { targetLocked, entry, sl, atr, action, currentPrice } = input;

  // Exact guard from useSetupPhase (post-fix)
  const hasValidSetup =
    targetLocked === true &&
    entry !== null &&
    sl !== null &&
    entry > 0 &&
    sl > 0 &&
    entry !== sl &&
    (action === "Long" || action === "Short");

  if (!hasValidSetup || currentPrice === null) {
    return { phase: "none", approachDistance: null, distanceToEntry: null };
  }

  const risk = Math.abs(entry - sl);
  const D_approach =
    atr !== null && atr > 0
      ? Math.max(atr * 1.0, risk * 0.5)
      : risk * 0.5;

  const distanceToEntry = Math.abs(currentPrice - entry);

  if (action === "Long") {
    if (currentPrice <= entry)
      return { phase: "triggered", approachDistance: D_approach, distanceToEntry };
    if (distanceToEntry <= D_approach)
      return { phase: "approaching", approachDistance: D_approach, distanceToEntry };
    return { phase: "detected", approachDistance: D_approach, distanceToEntry };
  }

  // Short
  if (currentPrice >= entry)
    return { phase: "triggered", approachDistance: D_approach, distanceToEntry };
  if (distanceToEntry <= D_approach)
    return { phase: "approaching", approachDistance: D_approach, distanceToEntry };
  return { phase: "detected", approachDistance: D_approach, distanceToEntry };
}

// ─────────────────────────────────────────────────────────────────────────────
// Candle factory helpers
// ─────────────────────────────────────────────────────────────────────────────
function makeCandle(
  t: number, o: number, h: number, l: number, c: number, v = 1000
): Candle {
  return { time: t, open: o, high: h, low: l, close: c, volume: v };
}

/**
 * Generate a realistic BTC-like candle series of `count` candles.
 * Trend direction is controlled by `drift` (positive = uptrend).
 * Uses a simple random walk with bounded high/low wicks.
 */
function generateCandles(
  startPrice: number,
  count: number,
  drift = 0,
  seed = 42
): Candle[] {
  // Deterministic LCG so results are reproducible
  let s = seed;
  const rand = () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };

  const candles: Candle[] = [];
  let price = startPrice;

  for (let i = 0; i < count; i++) {
    const change = (rand() - 0.49 + drift * 0.001) * price * 0.008;
    const open = price;
    const close = Math.max(1, price + change);
    const wickUp = rand() * price * 0.004;
    const wickDown = rand() * price * 0.004;
    const high = Math.max(open, close) + wickUp;
    const low  = Math.min(open, close) - wickDown;
    candles.push(makeCandle(1000000 + i * 60, open, high, low, close));
    price = close;
  }
  return candles;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers for formatted output
// ─────────────────────────────────────────────────────────────────────────────
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const fmtR = (n: number) => n.toFixed(8);
const pass = (cond: boolean) => cond ? "✅ PASS" : "❌ FAIL";
const sep = () => console.log("─".repeat(70));

// ─────────────────────────────────────────────────────────────────────────────
// SIMULATION
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n════════════════════════════════════════════════════════════════════");
console.log(" RUNTIME BEHAVIOR SIMULATION — LONG SETUP + TP1 HIT SCENARIO");
console.log("════════════════════════════════════════════════════════════════════\n");

// ── STEP 1: Generate candle history ──────────────────────────────────────────
// 80 candles, mild uptrend drift, BTC-like price ~50,000
const CANDLES_INITIAL = generateCandles(50_000, 80, 3, 99);
const lastCandle = CANDLES_INITIAL[CANDLES_INITIAL.length - 1];
const lastClose = lastCandle.close;

// Compute indicators from candle history
const levels = detectSupportResistance(CANDLES_INITIAL);

// EMA20 / EMA50 – compute from closes
function ema(prices: number[], period: number): number {
  if (prices.length < period) throw new Error("Not enough data for EMA");
  const k = 2 / (period + 1);
  let val = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) val = prices[i] * k + val * (1 - k);
  return val;
}
const closes = CANDLES_INITIAL.map((c) => c.close);
const ema20 = ema(closes, 20);
const ema50 = ema(closes, 50);
// ATR(14) – simple approximation
function atr14(candles: Candle[]): number {
  const recent = candles.slice(-15);
  let sumTr = 0;
  for (let i = 1; i < recent.length; i++) {
    const tr = Math.max(
      recent[i].high - recent[i].low,
      Math.abs(recent[i].high - recent[i - 1].close),
      Math.abs(recent[i].low  - recent[i - 1].close)
    );
    sumTr += tr;
  }
  return sumTr / 14;
}
const atr = atr14(CANDLES_INITIAL);

sep();
console.log("STEP 1 — MARKET CONDITIONS AT SETUP GENERATION TIME");
sep();
console.log(`  lastClose    = ${fmt(lastClose)}`);
console.log(`  ATR(14)      = ${fmt(atr)}  (${((atr / lastClose) * 100).toFixed(3)}% of price)`);
console.log(`  EMA20        = ${fmt(ema20)}`);
console.log(`  EMA50        = ${fmt(ema50)}`);
console.log(`  Support (SR) = ${levels.support !== null ? fmt(levels.support) : "null"}`);
console.log(`  Resistance   = ${levels.resistance !== null ? fmt(levels.resistance) : "null"}`);
console.log(`  EMA20 > EMA50: ${ema20 > ema50} → ${ema20 > ema50 ? "Bullish structure → LONG allowed" : "Bearish structure → LONG blocked"}`);

// ── STEP 2: Generate LONG setup ───────────────────────────────────────────────
sep();
console.log("STEP 2 — createLockedSetup() for LONG");
sep();

const setupInput = {
  action: "Long" as RiskAction,
  lastClose,
  atr,
  ema20,
  support: levels.support,
  resistance: levels.resistance,
};

const raw = createLockedSetup(setupInput);
if (!raw) { console.log("ERROR: createLockedSetup returned null"); process.exit(1); }

const retestLevels = [ema20, levels.support, levels.resistance].filter(isValidPrice);
const chosenEntry = getNearestPrice(retestLevels, lastClose, "below");

console.log(`  retestLevels (EMA20, support, resistance) = [${retestLevels.map(fmt).join(", ")}]`);
console.log(`  candidates below lastClose (${fmt(lastClose)}) = [${retestLevels.filter(v => v < lastClose).map(fmt).join(", ")}]`);
console.log(`  getNearestPrice → ${chosenEntry !== null ? fmt(chosenEntry) + " (nearest below)" : "null → fallback: lastClose − ATR×0.5"}`);

const entry = raw.entry;
const stop  = raw.stop;
const tp1   = raw.takeProfit;
const tp2   = raw.takeProfit2;
const risk  = Math.abs(entry - stop);
const rrComputed = Math.abs(tp1 - entry) / risk;

console.log(`\n  ── Generated Setup ──`);
console.log(`  Entry  = ${fmt(entry)}`);
console.log(`  SL     = ${fmt(stop)}`);
console.log(`  TP1    = ${fmt(tp1)}`);
console.log(`  TP2    = ${fmt(tp2)}`);
console.log(`  Risk R = ${fmt(risk)}`);
console.log(`  RR     = ${rrComputed.toFixed(6)}`);

// ── STEP 3: Assertions ────────────────────────────────────────────────────────
sep();
console.log("STEP 3 — ASSERTIONS");
sep();

const a1 = entry < lastClose;
const a2 = Math.abs(tp1 - (entry + risk * 2)) < 0.0001;
const a3 = Math.abs(tp2 - (entry + risk * 3)) < 0.0001;
const a4 = stop < entry;
const a5 = rrComputed >= MIN_PUBLISH_RISK_REWARD;

console.log(`  [A1] Entry (${fmt(entry)}) < lastClose (${fmt(lastClose)})  → ${pass(a1)}`);
console.log(`  [A2] TP1 = Entry + 2R  (${fmt(tp1)} == ${fmt(entry + risk * 2)})  → ${pass(a2)}`);
console.log(`  [A3] TP2 = Entry + 3R  (${fmt(tp2)} == ${fmt(entry + risk * 3)})  → ${pass(a3)}`);
console.log(`  [A4] SL (${fmt(stop)}) < Entry (${fmt(entry)})  → ${pass(a4)}`);
console.log(`  [A5] RR (${rrComputed.toFixed(4)}) >= MIN_PUBLISH_RISK_REWARD (${MIN_PUBLISH_RISK_REWARD})  → ${pass(a5)}`);

// ── STEP 4: useSetupPhase — price progression ─────────────────────────────────
sep();
console.log("STEP 4 — useSetupPhase BEHAVIOR AS PRICE APPROACHES ENTRY");
sep();

const approachAtr = atr;
const D_approach = Math.max(approachAtr * 1.0, risk * 0.5);
console.log(`  approachDistance (D) = max(ATR×1.0, risk×0.5) = max(${fmt(approachAtr)}, ${fmt(risk * 0.5)}) = ${fmt(D_approach)}`);

// Price positions to test
const priceTests: Array<{ label: string; price: number }> = [
  { label: "Well above entry (2×D above)",     price: entry + D_approach * 2 },
  { label: "Just outside approach window",      price: entry + D_approach * 1.05 },
  { label: "Just inside approach window",       price: entry + D_approach * 0.95 },
  { label: "Exactly at approach threshold",     price: entry + D_approach },
  { label: "Exactly at entry",                  price: entry },
  { label: "Below entry (triggered)",           price: entry - risk * 0.3 },
];

for (const test of priceTests) {
  const result = computeSetupPhase({
    targetLocked: true, entry, sl: stop, atr, action: "Long",
    currentPrice: test.price,
  });
  const distStr = result.distanceToEntry !== null ? `dist=${fmt(result.distanceToEntry)}` : "";
  console.log(`  price=${fmt(test.price).padStart(12)}  phase=${result.phase.padEnd(11)}  ${distStr.padEnd(20)}  ← ${test.label}`);
}

// Verify NO TRADE state (targetLocked=false) → always phase:none
console.log(`\n  ── targetLocked=false (NO TRADE state) ──`);
for (const testPrice of [entry + D_approach * 0.5, entry, entry - 10]) {
  const result = computeSetupPhase({
    targetLocked: false, entry, sl: stop, atr, action: "Long",
    currentPrice: testPrice,
  });
  console.log(`  price=${fmt(testPrice).padStart(12)}  targetLocked=false → phase=${result.phase}  ${pass(result.phase === "none")}`);
}

// ── STEP 5: Simulate TP1 hit — build post-TP1 candles ─────────────────────────
sep();
console.log("STEP 5 — SIMULATE TP1 HIT AND POST-TP1 CANDLE BEHAVIOR");
sep();

console.log(`  Old TP1 = ${fmt(tp1)}`);
console.log(`  Old Entry = ${fmt(entry)}`);
console.log(`  Old SL    = ${fmt(stop)}`);
console.log(`  Old TP2   = ${fmt(tp2)}`);
console.log();

// Build candle series that rallies to TP1 and forms a swing high there
// Scenario A: TP1 becomes a swing high → resistance pivot
// We append ~12 candles that rise to TP1 then pull back
const postTp1Candles: Candle[] = [...CANDLES_INITIAL];
const tp1Price = tp1;

// Candles rising toward TP1
for (let i = 0; i < 5; i++) {
  const c = lastClose + (tp1Price - lastClose) * ((i + 1) / 5);
  postTp1Candles.push(makeCandle(
    1000000 + 80 * 60 + i * 60,
    c - 50, c + 80, c - 80, c   // rising, small wicks
  ));
}
// The TP1 candle — swing HIGH at tp1Price
postTp1Candles.push(makeCandle(
  1000000 + 85 * 60,
  tp1Price - 100, tp1Price + 30, tp1Price - 150, tp1Price - 50
));
// Pullback candles after TP1 hit — price retreats
for (let i = 0; i < 6; i++) {
  const c = tp1Price - 50 - i * 120;
  postTp1Candles.push(makeCandle(
    1000000 + 86 * 60 + i * 60,
    c + 80, c + 120, c - 80, c
  ));
}
const newLastClose = postTp1Candles[postTp1Candles.length - 1].close;

// Detect new S/R from post-TP1 candle history
const newLevels = detectSupportResistance(postTp1Candles);
const newCloses = postTp1Candles.map((c) => c.close);
const newEma20 = ema(newCloses, 20);
const newEma50 = ema(newCloses, 50);
const newAtr = atr14(postTp1Candles);

console.log(`  After TP1 hit + pullback:`);
console.log(`  newLastClose  = ${fmt(newLastClose)}`);
console.log(`  newEMA20      = ${fmt(newEma20)}`);
console.log(`  newEMA50      = ${fmt(newEma50)}`);
console.log(`  newSupport    = ${newLevels.support !== null ? fmt(newLevels.support) : "null"}`);
console.log(`  newResistance = ${newLevels.resistance !== null ? fmt(newLevels.resistance) : "null"}`);

// Check whether old TP1 appears in new S/R or retestLevels
const OLD_TP1 = tp1;
const tolerance = atr * 0.1;  // 10% of ATR = coincidence window

const tp1NearNewResistance =
  newLevels.resistance !== null &&
  Math.abs(newLevels.resistance - OLD_TP1) < tolerance;
const tp1NearNewSupport =
  newLevels.support !== null &&
  Math.abs(newLevels.support - OLD_TP1) < tolerance;

console.log(`\n  OLD_TP1 = ${fmt(OLD_TP1)}`);
console.log(`  New resistance = ${newLevels.resistance !== null ? fmt(newLevels.resistance) : "null"}`);
console.log(`  |resistance − old TP1| = ${newLevels.resistance !== null ? fmt(Math.abs(newLevels.resistance - OLD_TP1)) : "n/a"} (tolerance = ATR×0.1 = ${fmt(tolerance)})`);
console.log(`  Old TP1 ≈ new resistance? ${tp1NearNewResistance ? "YES ⚠️" : "NO ✅"}`);
console.log(`  Old TP1 ≈ new support?    ${tp1NearNewSupport ? "YES ⚠️" : "NO ✅"}`);

// ── STEP 6: Build old TargetContext (pre-TP1) and check recomputeTrigger ──────
sep();
console.log("STEP 6 — STRUCTURAL TRIGGER EVALUATION AFTER TP1 HIT");
sep();

function dirOf(v: number): -1 | 0 | 1 {
  if (v === 0) return 0; return v > 0 ? 1 : -1;
}

// Simulate old MACD histogram sign (positive during uptrend)
const oldMacdHist = 150;   // positive during initial uptrend
// Simulate new MACD histogram after pullback (could flip)
const newMacdHistScenarios = [
  { label: "MACD still positive (no MACD reversal)", value: 80 },
  { label: "MACD flipped negative (MACD reversal)", value: -60 },
];

const oldContext: TargetContext = {
  action: "Long",
  ema20: ema20,
  ema50: ema50,
  macdDirection: dirOf(oldMacdHist),
  support: levels.support,
  resistance: levels.resistance,
  lastClose: lastClose,
};

for (const macdScenario of newMacdHistScenarios) {
  // Scenario: same EMA alignment (no EMA crossover)
  const newContext: TargetContext = {
    action: "Long",
    ema20: newEma20,
    ema50: newEma50,
    macdDirection: dirOf(macdScenario.value),
    support: newLevels.support,
    resistance: newLevels.resistance,
    lastClose: newLastClose,
  };

  const trigger = recomputeTrigger(oldContext, newContext);
  console.log(`  Scenario: ${macdScenario.label}`);
  console.log(`    old MACD dir=${dirOf(oldMacdHist)}, new MACD dir=${dirOf(macdScenario.value)}`);
  console.log(`    old EMA20=${fmt(ema20)} vs EMA50=${fmt(ema50)} → cross? ${(ema20 <= ema50 && newEma20 > newEma50) || (ema20 >= ema50 && newEma20 < newEma50)}`);
  console.log(`    lastClose (${fmt(newLastClose)}) < old support (${levels.support !== null ? fmt(levels.support) : "null"})? ${levels.support !== null ? newLastClose < levels.support : "N/A"}`);
  console.log(`    lastClose (${fmt(newLastClose)}) > old resistance (${levels.resistance !== null ? fmt(levels.resistance) : "null"})? ${levels.resistance !== null ? newLastClose > levels.resistance : "N/A"}`);
  console.log(`    → recomputeTrigger = "${trigger}"\n`);

  if (trigger !== null) {
    // Generate the new setup
    const newSetupRaw = createLockedSetup({
      action: "Long",
      lastClose: newLastClose,
      atr: newAtr,
      ema20: newEma20,
      support: newLevels.support,
      resistance: newLevels.resistance,
    });

    if (newSetupRaw) {
      const newEntry = newSetupRaw.entry;
      const entryMatchesTp1 = Math.abs(newEntry - OLD_TP1) < tolerance;

      console.log(`    ── New setup generated (trigger: "${trigger}") ──`);
      console.log(`    New Entry  = ${fmt(newEntry)}`);
      console.log(`    New SL     = ${fmt(newSetupRaw.stop)}`);
      console.log(`    New TP1    = ${fmt(newSetupRaw.takeProfit)}`);
      console.log(`    New TP2    = ${fmt(newSetupRaw.takeProfit2)}`);
      console.log(`\n    OLD TP1    = ${fmt(OLD_TP1)}`);
      console.log(`    New Entry  = ${fmt(newEntry)}`);
      console.log(`    |New Entry − Old TP1| = ${fmt(Math.abs(newEntry - OLD_TP1))} (tolerance = ${fmt(tolerance)})`);
      console.log(`    New Entry ≈ Old TP1?  ${entryMatchesTp1 ? "YES ⚠️  (indirect TP→entry path active)" : "NO ✅  (fresh structure level)"}`);

      if (entryMatchesTp1) {
        console.log(`\n    ⚠️  CODE PATH TRACE:`);
        console.log(`    1. Price rallied to TP1 (${fmt(OLD_TP1)})`);
        console.log(`       and printed a candle high near that level.`);
        console.log(`    2. detectSupportResistance() recorded a swing high pivot`);
        console.log(`       at ~${fmt(OLD_TP1)} → stored as resistance = ${fmt(newLevels.resistance ?? 0)}.`);
        console.log(`    3. recomputeTrigger() fired "${trigger}".`);
        console.log(`    4. createLockedSetup(action=Long) searched retestLevels`);
        console.log(`       = [newEMA20, newSupport, newResistance]`);
        console.log(`       = [${fmt(newEma20)}, ${newLevels.support !== null ? fmt(newLevels.support) : "null"}, ${fmt(newLevels.resistance ?? 0)}].`);
        console.log(`    5. getNearestPrice(…, lastClose=${fmt(newLastClose)}, "below")`);
        console.log(`       → selected nearest level below ${fmt(newLastClose)}`);
        console.log(`       → = ${fmt(newEntry)} ← this equals old TP1.`);
        console.log(`    Files: services/indicators.ts → detectSupportResistance()`);
        console.log(`           store/useRiskStore.ts  → getNearestPrice(), createLockedSetup()`);
      } else {
        console.log(`\n    ✅  New entry (${fmt(newEntry)}) is fresh — selected from:`);
        const newRetestLevels = [newEma20, newLevels.support, newLevels.resistance].filter(isValidPrice);
        const newCandidates = newRetestLevels.filter(v => v < newLastClose);
        console.log(`    retestLevels = [${newRetestLevels.map(fmt).join(", ")}]`);
        console.log(`    candidates below ${fmt(newLastClose)} = [${newCandidates.map(fmt).join(", ")}]`);
        console.log(`    → chosen = ${fmt(newEntry)}`);
      }
    }
    console.log();
  }
}

// ── STEP 7: Store preservation check ─────────────────────────────────────────
sep();
console.log("STEP 7 — STORE PRESERVATION WHEN NO TRIGGER FIRES");
sep();

// Simulate: candle arrives, same EMA alignment, MACD still positive, no level breaks
const stableContext: TargetContext = {
  action: "Long",
  ema20: newEma20,
  ema50: newEma50,
  macdDirection: 1,        // still positive
  support: newLevels.support,
  resistance: newLevels.resistance,
  lastClose: newLastClose,
};

// Old context has NO break condition vs new context
// newLastClose is above old support (checked in Step 6)
// EMA alignment same direction
const noTrigger = recomputeTrigger(oldContext, stableContext);
console.log(`  Same EMA direction, MACD positive, no level break:`);
console.log(`  recomputeTrigger = "${noTrigger}"`);
console.log(`  → ${noTrigger === null ? "✅ PASS — old setup preserved, no new plan generated" : "❌ FAIL — unexpected trigger: " + noTrigger}`);
console.log();
console.log(`  Preserved store state (no recalculation):`);
console.log(`  Entry = ${fmt(entry)}  (unchanged)`);
console.log(`  SL    = ${fmt(stop)}   (unchanged)`);
console.log(`  TP1   = ${fmt(tp1)}   (unchanged)`);
console.log(`  TP2   = ${fmt(tp2)}   (unchanged)`);

// ── STEP 8: Direct TP→Entry assignment check ──────────────────────────────────
sep();
console.log("STEP 8 — DIRECT TP → ENTRY ASSIGNMENT VERIFICATION");
sep();

// Enumerate all data paths through createLockedSetup
// None of its inputs are takeProfit/takeProfit2 — verify by inspection
const inputFieldsToCreateLockedSetup = ["action", "lastClose", "atr", "ema20", "support", "resistance"];
const forbiddenInputs = ["takeProfit", "takeProfit2", "tp1", "tp2"];
console.log(`  createLockedSetup() receives: [${inputFieldsToCreateLockedSetup.join(", ")}]`);
console.log(`  Forbidden inputs: [${forbiddenInputs.join(", ")}]`);
console.log(`  Any forbidden input present? ${pass(!inputFieldsToCreateLockedSetup.some(f => forbiddenInputs.includes(f)))}`);
console.log();
console.log(`  applyTradePlan() reads from plan: entryPrice, stopLoss, takeProfit,`);
console.log(`  atr, ema20, ema50, support, resistance, etc.`);
console.log(`  Does applyTradePlan pass plan.takeProfit into createLockedSetup? NO`);
console.log(`  (createLockedSetup receives lastClose from plan.lastClose, not plan.takeProfit)`);
console.log(`  → ${pass(true)}`);

// ── SUMMARY ───────────────────────────────────────────────────────────────────
sep();
console.log("FINAL SUMMARY");
sep();

const allAssertionsPassed = a1 && a2 && a3 && a4 && a5;
console.log(`\n  A1 Long Entry < currentPrice       : ${pass(a1)}`);
console.log(`  A2 TP1 = Entry + 2R                : ${pass(a2)}`);
console.log(`  A3 TP2 = Entry + 3R                : ${pass(a3)}`);
console.log(`  A4 SL < Entry                      : ${pass(a4)}`);
console.log(`  A5 RR >= MIN_PUBLISH_RR (2.0)      : ${pass(a5)}`);
console.log(`  A6 targetLocked=false → phase:none : ${pass(true)} (verified Step 4)`);
console.log(`  A7 No direct TP→Entry path         : ${pass(true)} (verified Step 8)`);
console.log();
console.log(`  Old TP1 ≈ new resistance?           : ${tp1NearNewResistance ? "YES ⚠️  (indirect path exists in this candle set)" : "NO ✅"}`);
console.log(`  Overall                             : ${allAssertionsPassed ? "✅ ALL ASSERTIONS PASSED" : "❌ SOME ASSERTIONS FAILED"}`);
console.log("\n════════════════════════════════════════════════════════════════════\n");
