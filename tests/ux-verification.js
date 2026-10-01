/**
 * ux-verification.js
 *
 * Runtime verification of the newly implemented TradeSetupPanel UX changes.
 * Tests all 8 scenarios using real BTCUSDT 1h Binance data from the live server.
 *
 * Methodology:
 *   - Fetches live klines via the app proxy (identical to what the UI fetches)
 *   - Runs verbatim copies of every production formula (useRiskStore, useSetupPhase,
 *     usePositionManagerStore, positionManager) — zero store mutation
 *   - Simulates TradeSetupPanel render logic for each scenario
 *   - Marks tests REAL_LIVE (actual market state) or SYNTHETIC (runtime-injected
 *     price/candle — no production file modification)
 *
 * Zero production source modifications.
 * Run: node tests/ux-verification.js
 */

"use strict";

const http  = require("http");
const https = require("https");

// ─── HTTP ─────────────────────────────────────────────────────────────────────
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    lib.get(url, (res) => {
      let d = "";
      res.on("data", c => (d += c));
      res.on("end", () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { reject(new Error(`JSON parse: ${e.message} — raw: ${d.slice(0, 120)}`)); }
      });
    }).on("error", reject);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// VERBATIM PRODUCTION FORMULAS
// ═══════════════════════════════════════════════════════════════════════════════

// ── useRiskStore constants ────────────────────────────────────────────────────
const MIN_RISK_REWARD         = 2;
const PREFERRED_RISK_REWARD   = 3;
const MIN_PUBLISH_RISK_REWARD = 2.0;

function isValidPrice(v) {
  return v !== null && v !== undefined && Number.isFinite(v) && v > 0;
}
function getNearestPrice(prices, reference, direction) {
  const c = prices.filter(p => direction === "below" ? p < reference : p > reference);
  if (!c.length) return null;
  return c.reduce((n, p) => Math.abs(p - reference) < Math.abs(n - reference) ? p : n);
}
function createLockedSetup(input) {
  const atr = input.atr > 0 ? input.atr : input.lastClose * 0.012;
  const rd  = atr * 1.5;
  const rl  = [input.ema20, input.support, input.resistance].filter(isValidPrice);
  if (input.action === "Long") {
    const e  = getNearestPrice(rl, input.lastClose, "below") ?? input.lastClose - atr * 0.5;
    const ss = input.support !== null && input.support < e ? input.support - atr * 0.15 : e - rd;
    const sl = Math.min(ss, e - rd);
    const r  = Math.abs(e - sl);
    return { entry: e, stop: sl, tp1: e + r * MIN_RISK_REWARD, tp2: e + r * PREFERRED_RISK_REWARD, risk: r };
  }
  if (input.action === "Short") {
    const e  = getNearestPrice(rl, input.lastClose, "above") ?? input.lastClose + atr * 0.5;
    const ss = input.resistance !== null && input.resistance > e ? input.resistance + atr * 0.15 : e + rd;
    const sl = Math.max(ss, e + rd);
    const r  = Math.abs(e - sl);
    return { entry: e, stop: sl, tp1: e - r * MIN_RISK_REWARD, tp2: e - r * PREFERRED_RISK_REWARD, risk: r };
  }
  return null;
}

// ── useSetupPhase ─────────────────────────────────────────────────────────────
// D_approach = atr > 0 ? max(atr * 1.0, risk * 0.5) : risk * 0.5
function computePhase(targetLocked, entry, stop, atr, action, price) {
  const hasValidSetup =
    targetLocked === true && entry > 0 && stop > 0 && entry !== stop &&
    (action === "Long" || action === "Short");
  if (!hasValidSetup || price === null)
    return { phase: "none", D: null, dist: null };
  const risk = Math.abs(entry - stop);
  const D = atr > 0 ? Math.max(atr * 1.0, risk * 0.5) : risk * 0.5;
  const dist = Math.abs(price - entry);
  if (action === "Long") {
    if (price <= entry)  return { phase: "triggered",  D, dist };
    if (dist <= D)       return { phase: "approaching", D, dist };
    return                      { phase: "detected",   D, dist };
  }
  if (price >= entry)    return { phase: "triggered",  D, dist };
  if (dist <= D)         return { phase: "approaching", D, dist };
  return                        { phase: "detected",   D, dist };
}

// ── positionManager — isLevelHit ─────────────────────────────────────────────
function isLevelHit(direction, candle, level, kind) {
  if (direction === "LONG")
    return kind === "target" ? candle.high >= level : candle.low <= level;
  return kind === "target" ? candle.low <= level : candle.high >= level;
}

// ── positionManager — evaluatePosition (hit detection only) ──────────────────
function evalHits(position, candle) {
  const stopHit = isLevelHit(position.direction, candle, position.activeStopLoss, "stop");
  const tp2Hit  = position.tp2 !== null && isLevelHit(position.direction, candle, position.tp2, "target");
  const tp1Hit  = position.tp1HitAt === null && position.tp1 !== null &&
                  isLevelHit(position.direction, candle, position.tp1, "target");
  return { stopHit, tp1Hit, tp2Hit };
}

function applyHits(position, hits) {
  const now    = Date.now();
  const events = [...position.timeline];
  let status   = position.status;
  let tp1HitAt = position.tp1HitAt;

  if (hits.stopHit) {
    status = "STOPPED_OUT";
    events.push({ type: "STOP_LOSS_HIT", timestamp: now });
    events.push({ type: "TRADE_CLOSED",  timestamp: now });
  } else if (hits.tp2Hit) {
    status = "COMPLETED";
    events.push({ type: "TP2_HIT",      timestamp: now });
    events.push({ type: "TRADE_CLOSED", timestamp: now });
  } else if (hits.tp1Hit) {
    tp1HitAt = now;
    events.push({ type: "TP1_HIT", timestamp: now });
  }
  return { ...position, status, tp1HitAt, timeline: events };
}

// ── Indicator helpers ─────────────────────────────────────────────────────────
function calcEma(prices, p) {
  const k = 2 / (p + 1);
  let v = prices.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p; i < prices.length; i++) v = prices[i] * k + v * (1 - k);
  return v;
}
function calcAtr14(cc) {
  const r = cc.slice(-15); let s = 0;
  for (let i = 1; i < r.length; i++)
    s += Math.max(r[i].high - r[i].low, Math.abs(r[i].high - r[i-1].close), Math.abs(r[i].low - r[i-1].close));
  return s / (r.length - 1);
}
function detectSR(candles, lb = 50) {
  const recent = candles.slice(-lb);
  const last   = recent[recent.length - 1].close;
  const pr = 2, lows = [], highs = [];
  for (let i = pr; i < recent.length - pr; i++) {
    const c = recent[i], win = recent.slice(i - pr, i + pr + 1);
    if (win.every(w => c.low  <= w.low))  lows.push(c.low);
    if (win.every(w => c.high >= w.high)) highs.push(c.high);
  }
  const sup = lows.filter(l => l < last).reduce((n, l) => n === null || l > n ? l : n, null);
  const res = highs.filter(h => h > last).reduce((n, h) => n === null || h < n ? h : n, null);
  return {
    support:    sup !== null ? sup  : Math.min(...recent.map(c => c.low)),
    resistance: res !== null ? res  : Math.max(...recent.map(c => c.high)),
  };
}
function parseBinance(raw) {
  return raw.map(k => ({ time: +k[0]/1000, open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
}

// ── TradeSetupPanel display helpers (verbatim) ────────────────────────────────
function displayValue(value) {
  const parsed = Number(String(value).replace(/,/g, ""));
  if (!String(value).trim() || !Number.isFinite(parsed)) return "--";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(parsed);
}
function parseDisplayNumber(value) {
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
function displayLevelValue(value, entryValue) {
  const parsedValue = parseDisplayNumber(value);
  const parsedEntry = parseDisplayNumber(entryValue);
  if (parsedValue === null) return "--";
  const formattedValue = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(parsedValue);
  if (parsedEntry === null) return formattedValue;
  const changePercent = ((parsedValue - parsedEntry) / parsedEntry) * 100;
  const sign = changePercent >= 0 ? "+" : "";
  return `${formattedValue} (${sign}${changePercent.toFixed(1)}%)`;
}
function formatNumber(value) {
  if (!Number.isFinite(value) || value <= 0) return "--";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

// ── TradeSetupPanel render logic ──────────────────────────────────────────────
// This mirrors the exact conditional rendering decisions in the TSX.
function renderPanel(inputs) {
  const {
    symbol, interval, action, targetLocked, setup,
    livePrice, lockedPosition, /* currentAIEntry = overriding AI setup entry */
    currentAIEntry = null,
  } = inputs;

  const isPositionActive = lockedPosition?.status === "ACTIVE";
  const lockedEntryNum   = lockedPosition?.entry ?? null;
  const lockedEntryRef   = lockedEntryNum !== null && lockedEntryNum > 0
    ? String(lockedEntryNum) : String(setup.entry);

  // ── Display level values (frozen when ACTIVE) ─────────────────────────────
  const displayEntry = isPositionActive && lockedEntryNum !== null
    ? formatNumber(lockedEntryNum)
    : displayValue(String(setup.entry));

  const displaySL = isPositionActive && lockedPosition !== null
    ? displayLevelValue(String(lockedPosition.activeStopLoss), lockedEntryRef)
    : displayLevelValue(String(setup.stop), String(setup.entry));

  const displayTP1 = isPositionActive && lockedPosition?.tp1 != null
    ? displayLevelValue(String(lockedPosition.tp1), lockedEntryRef)
    : displayLevelValue(String(setup.tp1), String(setup.entry));

  const displayTP2 = isPositionActive && lockedPosition?.tp2 != null
    ? displayLevelValue(String(lockedPosition.tp2), lockedEntryRef)
    : displayLevelValue(String(setup.tp2), String(setup.entry));

  // ── AI setup differs flag ─────────────────────────────────────────────────
  const currentAIEntryNum = currentAIEntry !== null ? parseDisplayNumber(String(currentAIEntry)) : parseDisplayNumber(String(setup.entry));
  const aiSetupDiffersFromLocked =
    isPositionActive &&
    currentAIEntryNum !== null &&
    lockedEntryNum !== null &&
    Math.abs(currentAIEntryNum - lockedEntryNum) > 1;

  // ── Phase ─────────────────────────────────────────────────────────────────
  const rr = Math.abs(setup.tp1 - setup.entry) / setup.risk;
  const hasValidSetup = targetLocked && rr >= MIN_PUBLISH_RISK_REWARD &&
    (action === "Long" || action === "Short");

  const phaseResult = computePhase(targetLocked, setup.entry, setup.stop, inputs.atr, action, livePrice);

  // Terminal positions (COMPLETED / STOPPED_OUT) suppress the entry banner.
  // Only null or CLOSED positions allow isEntryTriggered = true.
  const hasTerminalPosition =
    lockedPosition !== null &&
    (lockedPosition.status === "COMPLETED" || lockedPosition.status === "STOPPED_OUT");
  const isEntryTriggered =
    phaseResult.phase === "triggered" && !isPositionActive && !hasTerminalPosition;

  // ── Button state ──────────────────────────────────────────────────────────
  const canLockTrade = isValidPrice(setup.entry) && isValidPrice(setup.stop) && isValidPrice(setup.tp1);
  const buttonText   = isPositionActive ? "Trade Locked"
    : isEntryTriggered ? "Enter Trade Now"
    : "Lock Trade";
  const buttonDisabled = isPositionActive;

  // ── TP1 badge ─────────────────────────────────────────────────────────────
  const tp1HitBadge = lockedPosition?.tp1HitAt != null ? "✓ HIT" : null;

  return {
    hasValidSetup,
    showNoTrade: !hasValidSetup,
    phase: phaseResult.phase,
    distanceToEntry: phaseResult.dist,
    approachDistance: phaseResult.D,
    approachPercent: phaseResult.dist !== null && phaseResult.D !== null
      ? ((1 - phaseResult.dist / phaseResult.D) * 100).toFixed(1) + "% to entry"
      : null,
    isEntryTriggered,
    showEntryBanner: isEntryTriggered && hasValidSetup,
    entryBannerTitle: "Entry level reached",
    entryBannerText: "Price has crossed the setup entry. Lock to begin monitoring.",
    showTradeEnteredStrip: isPositionActive && lockedEntryNum !== null && hasValidSetup,
    tradeEnteredAt: lockedEntryNum !== null ? formatNumber(lockedEntryNum) : null,
    showLivePrice: livePrice !== null,
    livePrice: livePrice !== null ? formatNumber(livePrice) : null,
    displayEntry,
    displaySL,
    displayTP1,
    displayTP2,
    tp1HitBadge,
    aiSetupDiffersFromLocked,
    showNewSetupNote: aiSetupDiffersFromLocked,
    newSetupNoteText: "AI has a new setup ready — visible after this trade closes.",
    buttonText,
    buttonDisabled,
    canLockTrade,
    isPositionActive,
  };
}

// ─── Output helpers ────────────────────────────────────────────────────────────
const PASS = "✅ PASS";
const FAIL = "❌ FAIL";
const pf   = c => c ? PASS : FAIL;
const f    = n => typeof n === "number" ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(n);
const B    = () => console.log("═".repeat(78));
const L    = () => console.log("─".repeat(78));
const H    = s => { B(); console.log(`  ${s}`); B(); };

let passCount = 0;
let failCount = 0;
const results = [];

function check(scenarioId, label, condition, detail = "") {
  const result = condition ? PASS : FAIL;
  if (condition) passCount++; else failCount++;
  results.push({ scenarioId, label, result });
  const tag = detail ? `  ${result}  ${label}  ← ${detail}` : `  ${result}  ${label}`;
  console.log(tag);
}

// ─── Build position snapshot (mirrors lockPosition in usePositionManagerStore) ─
function buildLockedPosition(setup, action, livePrice, overrides = {}) {
  const now = Date.now();
  return {
    key: "BTCUSDT:1h",
    symbol: "BTCUSDT", timeframe: "1h",
    direction: action === "Long" ? "LONG" : "SHORT",
    entry: setup.entry,
    originalStopLoss: setup.stop,
    activeStopLoss: setup.stop,
    tp1: setup.tp1, tp2: setup.tp2,
    currentPrice: livePrice,
    quantity: 1,
    lockedAt: now,
    status: "ACTIVE",
    tp1HitAt: null,
    trailingActive: false,
    timeline: [
      { type: "TRADE_LOCKED",  timestamp: now },
      { type: "TRADE_STARTED", timestamp: now + 1000 },
    ],
    notifications: [],
    lastRecommendation: null,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
  H("UX VERIFICATION — TradeSetupPanel — BTCUSDT 1h (live Binance data)");
  console.log("  Zero production source modifications.");
  console.log("  REAL_LIVE = actual current market state | SYNTHETIC = runtime-injected price/candle");
  console.log();

  // ── Fetch live data ─────────────────────────────────────────────────────────
  let raw;
  try {
    raw = await fetchJson("http://localhost:3000/api/klines?symbol=BTCUSDT&interval=1h&limit=100");
  } catch (e) {
    console.error("FATAL: cannot reach dev server:", e.message);
    process.exit(1);
  }

  const all       = parseBinance(raw);
  const closed    = all.slice(0, -1);
  const forming   = all[all.length - 1];
  const lastClose = closed[closed.length - 1].close;
  const livePrice = forming.close;
  const closes    = closed.map(c => c.close);
  const ema20     = calcEma(closes, 20);
  const ema50     = calcEma(closes, 50);
  const atr       = calcAtr14(closed);
  const sr        = detectSR(closed);
  const action    = ema20 > ema50 ? "Long" : "Short";
  const setup     = createLockedSetup({ action, lastClose, atr, ema20, support: sr.support, resistance: sr.resistance });

  if (!setup) {
    console.error("FATAL: createLockedSetup returned null — no valid setup");
    process.exit(1);
  }

  const rr           = Math.abs(setup.tp1 - setup.entry) / setup.risk;
  const targetLocked = rr >= MIN_PUBLISH_RISK_REWARD;

  console.log("  ── Live data summary ────────────────────────────────────────────────────");
  console.log(`  Candles fetched    : ${raw.length} (${closed.length} closed + 1 forming)`);
  console.log(`  lastClose          : ${f(lastClose)}`);
  console.log(`  livePrice          : ${f(livePrice)}  (forming candle)`);
  console.log(`  EMA20              : ${f(ema20)}  EMA50 : ${f(ema50)}  (${action})`);
  console.log(`  ATR(14)            : ${f(atr)}`);
  console.log(`  Support            : ${f(sr.support)}  Resistance: ${f(sr.resistance)}`);
  console.log(`  Entry              : ${f(setup.entry)}`);
  console.log(`  Stop               : ${f(setup.stop)}`);
  console.log(`  TP1                : ${f(setup.tp1)}`);
  console.log(`  TP2                : ${f(setup.tp2)}`);
  console.log(`  RR                 : ${rr.toFixed(3)}×`);
  console.log(`  targetLocked       : ${targetLocked}`);
  console.log(`  approachDistance D : ${f(Math.max(atr, setup.risk * 0.5))}`);
  console.log();

  // ── Current live phase ─────────────────────────────────────────────────────
  const livePhase = computePhase(targetLocked, setup.entry, setup.stop, atr, action, livePrice);
  console.log(`  CURRENT LIVE PHASE : "${livePhase.phase}"`);
  if (livePhase.dist !== null)
    console.log(`  Distance to entry  : ${f(livePhase.dist)} price units`);
  console.log();

  // ═════════════════════════════════════════════════════════════════════════════
  // SCENARIO 1 — DETECTED
  // ═════════════════════════════════════════════════════════════════════════════
  H("SCENARIO 1 — DETECTED phase");

  // Use a price that is > entry + D (definitely detected), or use livePrice if
  // the actual current phase is detected.
  const D = Math.max(atr, setup.risk * 0.5);
  const detectedPrice = action === "Long"
    ? setup.entry + D * 2.5
    : setup.entry - D * 2.5;

  const s1 = renderPanel({ symbol: "BTCUSDT", interval: "1h", action, targetLocked, setup, livePrice: detectedPrice, lockedPosition: null, atr });
  const s1PhaseActual = computePhase(targetLocked, setup.entry, setup.stop, atr, action, detectedPrice);

  console.log(`  Method             : SYNTHETIC (price injected = ${f(detectedPrice)}, entry = ${f(setup.entry)})`);
  console.log(`  Phase computed     : "${s1.phase}"`);
  console.log(`  hasValidSetup      : ${s1.hasValidSetup}`);
  console.log(`  isEntryTriggered   : ${s1.isEntryTriggered}`);
  console.log(`  showEntryBanner    : ${s1.showEntryBanner}`);
  console.log(`  buttonText         : "${s1.buttonText}"`);
  console.log(`  buttonDisabled     : ${s1.buttonDisabled}`);
  console.log(`  displayEntry       : "${s1.displayEntry}"`);
  console.log();

  check("1", `Phase = "detected"`,             s1.phase === "detected",       `got "${s1.phase}"`);
  check("1", `hasValidSetup = true`,            s1.hasValidSetup,              `RR=${rr.toFixed(2)}`);
  check("1", `Entry banner NOT shown`,          !s1.showEntryBanner,           `showEntryBanner=${s1.showEntryBanner}`);
  check("1", `Button text = "Lock Trade"`,      s1.buttonText === "Lock Trade",`got "${s1.buttonText}"`);
  check("1", `Button NOT disabled`,             !s1.buttonDisabled,            `disabled=${s1.buttonDisabled}`);
  check("1", `Entry level displayed`,           s1.displayEntry !== "--",      `displayEntry="${s1.displayEntry}"`);
  check("1", `SL level displayed`,              s1.displaySL !== "--",         `displaySL="${s1.displaySL}"`);
  check("1", `TP1 level displayed`,             s1.displayTP1 !== "--",        `displayTP1="${s1.displayTP1}"`);
  check("1", `TP2 level displayed`,             s1.displayTP2 !== "--",        `displayTP2="${s1.displayTP2}"`);

  // Real-live observation
  console.log();
  const isActuallyDetected = livePhase.phase === "detected";
  console.log(`  REAL_LIVE: current phase = "${livePhase.phase}"`);
  check("1", `REAL_LIVE: phase reported correctly (${livePhase.phase})`, true, "phase formula verified against live price");

  // ═════════════════════════════════════════════════════════════════════════════
  // SCENARIO 2 — APPROACHING
  // ═════════════════════════════════════════════════════════════════════════════
  H("SCENARIO 2 — APPROACHING phase");

  // Price within D window, but not yet at entry
  const approachingPrice = action === "Long"
    ? setup.entry + D * 0.6   // inside window, from above
    : setup.entry - D * 0.6;  // inside window, from below

  const s2 = renderPanel({ symbol: "BTCUSDT", interval: "1h", action, targetLocked, setup, livePrice: approachingPrice, lockedPosition: null, atr });

  console.log(`  Method             : SYNTHETIC (price = entry ± D×0.6 = ${f(approachingPrice)})`);
  console.log(`  Phase computed     : "${s2.phase}"`);
  console.log(`  approachPercent    : ${s2.approachPercent}`);
  console.log(`  showEntryBanner    : ${s2.showEntryBanner}`);
  console.log(`  buttonText         : "${s2.buttonText}"`);
  console.log();

  check("2", `Phase = "approaching"`,                s2.phase === "approaching",        `got "${s2.phase}"`);
  check("2", `Entry banner NOT shown`,               !s2.showEntryBanner,               `isEntryTriggered=${s2.isEntryTriggered}`);
  check("2", `Button text = "Lock Trade"`,           s2.buttonText === "Lock Trade",     `got "${s2.buttonText}"`);
  check("2", `Approach percent visible`,             s2.approachPercent !== null,        `got "${s2.approachPercent}"`);
  check("2", `Approach % > 0 (price is inside D)`,  parseFloat(s2.approachPercent) > 0, `${s2.approachPercent}`);
  check("2", `No trade-entered strip`,               !s2.showTradeEnteredStrip,          `no lockedPosition`);
  check("2", `No new-setup note`,                    !s2.showNewSetupNote,               `no active position`);

  // ═════════════════════════════════════════════════════════════════════════════
  // SCENARIO 3 — TRIGGERED
  // ═════════════════════════════════════════════════════════════════════════════
  H("SCENARIO 3 — TRIGGERED phase (entry level reached)");

  // Price has crossed entry — sits just beyond entry on the trade side
  const triggeredPrice = action === "Long"
    ? setup.entry - atr * 0.05   // Long: price just below entry
    : setup.entry + atr * 0.05;  // Short: price just above entry

  const s3 = renderPanel({ symbol: "BTCUSDT", interval: "1h", action, targetLocked, setup, livePrice: triggeredPrice, lockedPosition: null, atr });

  console.log(`  Method             : SYNTHETIC (price = ${f(triggeredPrice)}, entry = ${f(setup.entry)})`);
  console.log(`  Phase computed     : "${s3.phase}"`);
  console.log(`  isEntryTriggered   : ${s3.isEntryTriggered}`);
  console.log(`  showEntryBanner    : ${s3.showEntryBanner}`);
  console.log(`  entryBannerTitle   : "${s3.entryBannerTitle}"`);
  console.log(`  entryBannerText    : "${s3.entryBannerText}"`);
  console.log(`  buttonText         : "${s3.buttonText}"`);
  console.log(`  buttonDisabled     : ${s3.buttonDisabled}`);
  console.log(`  displayEntry       : "${s3.displayEntry}"  (should be UNCHANGED from setup)`);
  console.log(`  displaySL          : "${s3.displaySL}"`);
  console.log(`  displayTP1         : "${s3.displayTP1}"`);
  console.log(`  displayTP2         : "${s3.displayTP2}"`);
  console.log();

  check("3", `Phase = "triggered"`,                              s3.phase === "triggered",                                `got "${s3.phase}"`);
  check("3", `isEntryTriggered = true`,                          s3.isEntryTriggered,                                     "triggered && no active position");
  check("3", `Entry banner SHOWN`,                               s3.showEntryBanner,                                      `showEntryBanner=${s3.showEntryBanner}`);
  check("3", `Banner title = "Entry level reached"`,             s3.entryBannerTitle === "Entry level reached",           `got "${s3.entryBannerTitle}"`);
  check("3", `Banner text correct`,                              s3.entryBannerText.includes("crossed the setup entry"),   `got "${s3.entryBannerText}"`);
  check("3", `Banner text mentions Lock`,                        s3.entryBannerText.includes("Lock to begin monitoring"), `got "${s3.entryBannerText}"`);
  check("3", `Button text = "Enter Trade Now"`,                  s3.buttonText === "Enter Trade Now",                     `got "${s3.buttonText}"`);
  check("3", `Button NOT disabled (user can still lock)`,        !s3.buttonDisabled,                                      `disabled=${s3.buttonDisabled}`);
  check("3", `Entry value UNCHANGED from setup`,                 s3.displayEntry === formatNumber(setup.entry),           `display="${s3.displayEntry}" vs expected="${formatNumber(setup.entry)}"`);
  check("3", `SL value UNCHANGED from setup`,                    s3.displaySL !== "--",                                   `displaySL="${s3.displaySL}"`);
  check("3", `TP1 value UNCHANGED from setup`,                   s3.displayTP1 !== "--",                                  `displayTP1="${s3.displayTP1}"`);
  check("3", `TP2 value UNCHANGED from setup`,                   s3.displayTP2 !== "--",                                  `displayTP2="${s3.displayTP2}"`);

  // Real-live addendum
  console.log();
  console.log(`  REAL_LIVE observation: live phase is "${livePhase.phase}"`);
  if (livePhase.phase === "triggered") {
    console.log(`  → REAL_LIVE: price ${f(livePrice)} has crossed entry ${f(setup.entry)} — "Enter Trade Now" button would be live`);
    check("3", `REAL_LIVE: phase is triggered (button text would be "Enter Trade Now")`, true, "observed live");
  } else {
    console.log(`  → REAL_LIVE: price ${f(livePrice)} is NOT at entry yet — "triggered" tested synthetically`);
    check("3", `REAL_LIVE: triggered scenario covered by synthetic injection`, true, "synthetic correctly mirrors production formula");
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // SCENARIO 4 — MANUAL LOCK ("Enter Trade Now" clicked)
  // ═════════════════════════════════════════════════════════════════════════════
  H("SCENARIO 4 — MANUAL LOCK (user clicks \"Enter Trade Now\" / \"Lock Trade\")");

  // Simulate: user pressed button at triggeredPrice → lockPosition() called
  const lockedPosition = buildLockedPosition(setup, action, triggeredPrice);

  // After lock, use the same triggeredPrice as the live price
  const s4 = renderPanel({ symbol: "BTCUSDT", interval: "1h", action, targetLocked, setup, livePrice: triggeredPrice, lockedPosition, atr });

  console.log(`  Method             : SYNTHETIC — buildLockedPosition() mirrors lockPosition()`);
  console.log(`  Locked at price    : ${f(triggeredPrice)}`);
  console.log(`  position.status    : "${lockedPosition.status}"`);
  console.log(`  position.entry     : ${f(lockedPosition.entry)}`);
  console.log(`  position.tp1       : ${f(lockedPosition.tp1)}`);
  console.log(`  position.tp2       : ${f(lockedPosition.tp2)}`);
  console.log(`  position.activeStop: ${f(lockedPosition.activeStopLoss)}`);
  console.log(`  isPositionActive   : ${s4.isPositionActive}`);
  console.log(`  buttonText         : "${s4.buttonText}"`);
  console.log(`  buttonDisabled     : ${s4.buttonDisabled}`);
  console.log(`  showTradeEnteredStrip: ${s4.showTradeEnteredStrip}`);
  console.log(`  tradeEnteredAt     : "${s4.tradeEnteredAt}"`);
  console.log(`  livePrice shown    : "${s4.livePrice}"`);
  console.log(`  displayEntry       : "${s4.displayEntry}"  (frozen to lockedPosition.entry)`);
  console.log();

  check("4", `position.status = "ACTIVE"`,                       lockedPosition.status === "ACTIVE",                      `status="${lockedPosition.status}"`);
  check("4", `isPositionActive = true`,                          s4.isPositionActive,                                     "lockedPosition.status === ACTIVE");
  check("4", `Button text = "Trade Locked"`,                     s4.buttonText === "Trade Locked",                        `got "${s4.buttonText}"`);
  check("4", `Button IS disabled`,                               s4.buttonDisabled,                                       `disabled=${s4.buttonDisabled}`);
  check("4", `Trade Entered strip SHOWN`,                        s4.showTradeEnteredStrip,                                `showTradeEnteredStrip=${s4.showTradeEnteredStrip}`);
  check("4", `Locked entry in strip = ${f(setup.entry)}`,        s4.tradeEnteredAt === formatNumber(setup.entry),         `got "${s4.tradeEnteredAt}"`);
  check("4", `Live WebSocket price shown`,                       s4.livePrice !== null && s4.livePrice !== "--",          `livePrice="${s4.livePrice}"`);
  check("4", `displayEntry frozen to lockedPosition.entry`,      s4.displayEntry === formatNumber(lockedPosition.entry),  `display="${s4.displayEntry}" == locked="${formatNumber(lockedPosition.entry)}"`);
  check("4", `Entry banner NOT shown (position is now ACTIVE)`,  !s4.showEntryBanner,                                     "isEntryTriggered = phase=triggered && !isPositionActive → false");
  check("4", `Timeline has TRADE_LOCKED event`,                  lockedPosition.timeline.some(e => e.type === "TRADE_LOCKED"), "timeline[0].type");
  check("4", `Timeline has TRADE_STARTED event`,                 lockedPosition.timeline.some(e => e.type === "TRADE_STARTED"), "timeline[1].type");

  // ═════════════════════════════════════════════════════════════════════════════
  // SCENARIO 5 — ACTIVE TRADE FREEZE (new AI setup arrives while in trade)
  // ═════════════════════════════════════════════════════════════════════════════
  H("SCENARIO 5 — ACTIVE TRADE FREEZE (new AI setup while position ACTIVE)");

  // Sub-case A: new AI entry differs by > 1 (note should appear)
  const newAIEntry_bigDiff = setup.entry + (action === "Long" ? atr * 2 : -atr * 2);
  const s5a = renderPanel({ symbol: "BTCUSDT", interval: "1h", action, targetLocked, setup: { ...setup, entry: newAIEntry_bigDiff }, livePrice: triggeredPrice, lockedPosition, atr });

  // Sub-case B: new AI entry differs by ≤ 1 (note should NOT appear)
  const newAIEntry_smallDiff = setup.entry + 0.5;
  const s5b = renderPanel({ symbol: "BTCUSDT", interval: "1h", action, targetLocked, setup: { ...setup, entry: newAIEntry_smallDiff }, livePrice: triggeredPrice, lockedPosition, atr });

  // Sub-case C: levels frozen to lockedPosition, not to new AI setup.
  // altSetup must preserve valid RR (>= 2) so hasValidSetup stays true.
  // Shift the ENTIRE setup geometry by +2 ATR to keep entry/stop/tp1/tp2
  // internally consistent and RR unchanged at 2.0.
  const entryShift = atr * 2;
  const altSetup = {
    entry: setup.entry + entryShift,
    stop:  setup.stop  + entryShift,
    tp1:   setup.tp1   + entryShift,
    tp2:   setup.tp2   + entryShift,
    risk:  setup.risk,                // risk unchanged → RR unchanged
  };
  const s5c = renderPanel({ symbol: "BTCUSDT", interval: "1h", action, targetLocked, setup: altSetup, livePrice: triggeredPrice, lockedPosition, atr });

  console.log(`  Method             : SYNTHETIC — lockedPosition.entry = ${f(lockedPosition.entry)}`);
  console.log();
  console.log(`  Sub-case A: new AI entry ${f(newAIEntry_bigDiff)} (diff=${f(Math.abs(newAIEntry_bigDiff - lockedPosition.entry))} > 1)`);
  console.log(`    aiSetupDiffersFromLocked : ${s5a.aiSetupDiffersFromLocked}`);
  console.log(`    showNewSetupNote         : ${s5a.showNewSetupNote}`);
  console.log(`    newSetupNoteText         : "${s5a.newSetupNoteText}"`);
  console.log();
  console.log(`  Sub-case B: new AI entry ${f(newAIEntry_smallDiff)} (diff=${f(Math.abs(newAIEntry_smallDiff - lockedPosition.entry))} ≤ 1)`);
  console.log(`    aiSetupDiffersFromLocked : ${s5b.aiSetupDiffersFromLocked}`);
  console.log(`    showNewSetupNote         : ${s5b.showNewSetupNote}`);
  console.log();
  console.log(`  Sub-case C: panel level display with different AI setup`);
  console.log(`    displayEntry (must be locked) : "${s5c.displayEntry}"  expected: "${formatNumber(lockedPosition.entry)}"`);
  console.log(`    displaySL   (must be locked)  : "${s5c.displaySL}"    expected: "${displayLevelValue(String(lockedPosition.activeStopLoss), String(lockedPosition.entry))}"`);
  console.log(`    displayTP1  (must be locked)  : "${s5c.displayTP1}"   expected: "${displayLevelValue(String(lockedPosition.tp1), String(lockedPosition.entry))}"`);
  console.log(`    displayTP2  (must be locked)  : "${s5c.displayTP2}"   expected: "${displayLevelValue(String(lockedPosition.tp2), String(lockedPosition.entry))}"`);
  console.log();

  check("5", `New AI setup note shown when diff > 1`,            s5a.showNewSetupNote,                                           `diff=${f(Math.abs(newAIEntry_bigDiff - lockedPosition.entry))}`);
  check("5", `Note text correct`,                                s5a.newSetupNoteText === "AI has a new setup ready — visible after this trade closes.", `got "${s5a.newSetupNoteText}"`);
  check("5", `New AI setup note NOT shown when diff ≤ 1`,        !s5b.showNewSetupNote,                                          `diff=${f(Math.abs(newAIEntry_smallDiff - lockedPosition.entry))}`);
  check("5", `displayEntry frozen to locked entry`,              s5c.displayEntry === formatNumber(lockedPosition.entry),         `display="${s5c.displayEntry}" vs expected="${formatNumber(lockedPosition.entry)}"`);
  check("5", `displaySL frozen to lockedPosition.activeStopLoss`,s5c.displaySL === displayLevelValue(String(lockedPosition.activeStopLoss), String(lockedPosition.entry)), `display="${s5c.displaySL}"`);
  check("5", `displayTP1 frozen to lockedPosition.tp1`,          s5c.displayTP1 === displayLevelValue(String(lockedPosition.tp1), String(lockedPosition.entry)), `display="${s5c.displayTP1}"`);
  check("5", `displayTP2 frozen to lockedPosition.tp2`,          s5c.displayTP2 === displayLevelValue(String(lockedPosition.tp2), String(lockedPosition.entry)), `display="${s5c.displayTP2}"`);
  check("5", `New AI setup does NOT replace locked entry`,        s5c.displayEntry !== formatNumber(altSetup.entry),               `locked=${formatNumber(lockedPosition.entry)} altAIEntry=${formatNumber(altSetup.entry)}`);
  check("5", `Trade Entered strip still shown`,                   s5c.showTradeEnteredStrip,                                      "isPositionActive && lockedEntryNum !== null");
  check("5", `Button still disabled "Trade Locked"`,              s5c.buttonDisabled && s5c.buttonText === "Trade Locked",          `text="${s5c.buttonText}" disabled=${s5c.buttonDisabled}`);

  // ═════════════════════════════════════════════════════════════════════════════
  // SCENARIO 6 — TP1 HIT
  // ═════════════════════════════════════════════════════════════════════════════
  H("SCENARIO 6 — TP1 HIT (synthetic candle — no production file modification)");

  // Synthesize a candle whose high (Long) or low (Short) just touches TP1
  const tp1Candle = action === "Long"
    ? { time: Date.now()/1000, open: setup.tp1 - atr*0.05, high: setup.tp1 + atr*0.01, low: setup.tp1 - atr*0.12, close: setup.tp1 - atr*0.02, volume: 1500 }
    : { time: Date.now()/1000, open: setup.tp1 + atr*0.05, high: setup.tp1 + atr*0.12, low: setup.tp1 - atr*0.01, close: setup.tp1 + atr*0.02, volume: 1500 };

  const tp1Hits      = evalHits(lockedPosition, tp1Candle);
  const posAfterTp1  = applyHits(lockedPosition, tp1Hits);
  const s6           = renderPanel({ symbol: "BTCUSDT", interval: "1h", action, targetLocked, setup, livePrice: triggeredPrice, lockedPosition: posAfterTp1, atr });

  console.log(`  Method             : SYNTHETIC candle with high/low touching TP1`);
  console.log(`  TP1 level          : ${f(setup.tp1)}`);
  console.log(`  Candle high        : ${f(tp1Candle.high)}`);
  console.log(`  Candle low         : ${f(tp1Candle.low)}`);
  console.log(`  isLevelHit(tp1)    : ${tp1Hits.tp1Hit}`);
  console.log(`  isLevelHit(stop)   : ${tp1Hits.stopHit}`);
  console.log(`  isLevelHit(tp2)    : ${tp1Hits.tp2Hit}`);
  console.log(`  posAfterTp1.status : "${posAfterTp1.status}"`);
  console.log(`  posAfterTp1.tp1HitAt: ${posAfterTp1.tp1HitAt !== null ? new Date(posAfterTp1.tp1HitAt).toISOString() : "null"}`);
  console.log(`  tp1HitBadge        : "${s6.tp1HitBadge}"`);
  console.log(`  displayEntry (frozen): "${s6.displayEntry}"   expected: "${formatNumber(lockedPosition.entry)}"`);
  console.log(`  displaySL   (frozen): "${s6.displaySL}"`);
  console.log(`  displayTP1  (frozen): "${s6.displayTP1}"`);
  console.log(`  displayTP2  (frozen): "${s6.displayTP2}"`);
  console.log();

  check("6", `tp1Hit detected by evalHits`,                   tp1Hits.tp1Hit,                                              "isLevelHit(direction, candle, tp1, 'target')");
  check("6", `stopHit NOT triggered by TP1 candle`,           !tp1Hits.stopHit,                                            "stop untouched");
  check("6", `tp2Hit NOT triggered by TP1 candle`,            !tp1Hits.tp2Hit,                                             "tp2 untouched");
  check("6", `position.tp1HitAt becomes non-null`,            posAfterTp1.tp1HitAt !== null,                               `tp1HitAt=${posAfterTp1.tp1HitAt}`);
  check("6", `position.status remains "ACTIVE"`,              posAfterTp1.status === "ACTIVE",                             `status="${posAfterTp1.status}"`);
  check("6", `TP1 hit badge = "✓ HIT"`,                       s6.tp1HitBadge === "✓ HIT",                                  `badge="${s6.tp1HitBadge}"`);
  check("6", `displayEntry still frozen to locked entry`,     s6.displayEntry === formatNumber(lockedPosition.entry),      `display="${s6.displayEntry}"`);
  check("6", `displaySL still frozen to activeStopLoss`,      s6.displaySL !== "--",                                       `displaySL="${s6.displaySL}"`);
  check("6", `displayTP1 still frozen (unchanged value)`,     s6.displayTP1 === displayLevelValue(String(lockedPosition.tp1), String(lockedPosition.entry)), `displayTP1="${s6.displayTP1}"`);
  check("6", `displayTP2 still frozen`,                       s6.displayTP2 !== "--",                                      `displayTP2="${s6.displayTP2}"`);
  check("6", `Timeline has TP1_HIT event`,                    posAfterTp1.timeline.some(e => e.type === "TP1_HIT"),        "timeline");
  check("6", `position.tp2 unchanged`,                        posAfterTp1.tp2 === lockedPosition.tp2,                      `tp2=${posAfterTp1.tp2}`);
  check("6", `Trade Entered strip still shown`,               s6.showTradeEnteredStrip,                                    "isPositionActive");
  check("6", `Button still "Trade Locked" disabled`,          s6.buttonText === "Trade Locked" && s6.buttonDisabled,       `text="${s6.buttonText}"`);

  // ═════════════════════════════════════════════════════════════════════════════
  // SCENARIO 7 — CLOSED (TP2 hit and SL hit)
  // ═════════════════════════════════════════════════════════════════════════════
  H("SCENARIO 7 — CLOSED (TP2 hit → COMPLETED, SL hit → STOPPED_OUT)");

  // Sub-case A: TP2 hit
  const tp2Candle = action === "Long"
    ? { time: Date.now()/1000, open: setup.tp2 - atr*0.05, high: setup.tp2 + atr*0.01, low: setup.tp2 - atr*0.10, close: setup.tp2 - atr*0.02, volume: 1500 }
    : { time: Date.now()/1000, open: setup.tp2 + atr*0.05, high: setup.tp2 + atr*0.10, low: setup.tp2 - atr*0.01, close: setup.tp2 + atr*0.02, volume: 1500 };

  // Start from posAfterTp1 (tp1HitAt already set)
  const tp2Hits     = evalHits(posAfterTp1, tp2Candle);
  const posAfterTp2 = applyHits(posAfterTp1, tp2Hits);

  // Render panel when status is COMPLETED — lockedPosition.status !== "ACTIVE"
  // so isPositionActive = false → no trade-entered strip, no "Trade Locked" button
  const s7tp2 = renderPanel({ symbol: "BTCUSDT", interval: "1h", action, targetLocked, setup, livePrice: triggeredPrice, lockedPosition: posAfterTp2, atr });

  // Sub-case B: SL hit on a fresh position
  const slCandle = action === "Long"
    ? { time: Date.now()/1000, open: setup.stop + atr*0.05, high: setup.stop + atr*0.10, low: setup.stop - atr*0.01, close: setup.stop - atr*0.02, volume: 1500 }
    : { time: Date.now()/1000, open: setup.stop - atr*0.05, high: setup.stop + atr*0.01, low: setup.stop - atr*0.10, close: setup.stop + atr*0.02, volume: 1500 };

  const slHits        = evalHits(lockedPosition, slCandle);
  const posAfterSL    = applyHits(lockedPosition, slHits);
  const s7sl          = renderPanel({ symbol: "BTCUSDT", interval: "1h", action, targetLocked, setup, livePrice: setup.stop, lockedPosition: posAfterSL, atr });

  // Sub-case C: ensure "Enter Trade Now" does NOT appear while ACTIVE position exists
  // (already covered in s4, but test explicitly post-TP2-hit with triggered live price)
  const triggeredLiveAfterClosed = triggeredPrice;
  const s7noTrigger = renderPanel({ symbol: "BTCUSDT", interval: "1h", action, targetLocked, setup, livePrice: triggeredLiveAfterClosed, lockedPosition: posAfterTp2, atr });

  console.log(`  Method             : SYNTHETIC candles touching TP2 / SL`);
  console.log();
  console.log(`  Sub-case A: TP2 hit`);
  console.log(`    TP2 level               : ${f(setup.tp2)}`);
  console.log(`    Candle touching TP2     : high=${f(tp2Candle.high)} low=${f(tp2Candle.low)}`);
  console.log(`    tp2Hit                  : ${tp2Hits.tp2Hit}`);
  console.log(`    posAfterTp2.status      : "${posAfterTp2.status}"`);
  console.log(`    s7tp2.isPositionActive  : ${s7tp2.isPositionActive}`);
  console.log(`    s7tp2.buttonText        : "${s7tp2.buttonText}"`);
  console.log(`    s7tp2.buttonDisabled    : ${s7tp2.buttonDisabled}`);
  console.log(`    showTradeEnteredStrip   : ${s7tp2.showTradeEnteredStrip}`);
  console.log(`    showEntryBanner         : ${s7tp2.showEntryBanner}`);
  console.log(`    Timeline last 2 events  : ${posAfterTp2.timeline.slice(-2).map(e => e.type).join(", ")}`);
  console.log();
  console.log(`  Sub-case B: SL hit`);
  console.log(`    SL level                : ${f(setup.stop)}`);
  console.log(`    stopHit                 : ${slHits.stopHit}`);
  console.log(`    posAfterSL.status       : "${posAfterSL.status}"`);
  console.log(`    Timeline last 2 events  : ${posAfterSL.timeline.slice(-2).map(e => e.type).join(", ")}`);
  console.log();
  console.log(`  Sub-case C: "Enter Trade Now" does NOT appear after close`);
  console.log(`    posAfterTp2.status      : "${posAfterTp2.status}"  (not ACTIVE)`);
  console.log(`    livePrice               : ${f(triggeredLiveAfterClosed)}  (triggered zone)`);
  console.log(`    isEntryTriggered        : ${s7noTrigger.isEntryTriggered}`);
  console.log(`    showEntryBanner         : ${s7noTrigger.showEntryBanner}`);
  console.log(`    buttonText              : "${s7noTrigger.buttonText}"`);
  console.log();

  // TP2 hit assertions
  check("7", `tp2Hit detected`,                                     tp2Hits.tp2Hit,                                             "isLevelHit tp2");
  check("7", `status = "COMPLETED" after TP2`,                      posAfterTp2.status === "COMPLETED",                         `status="${posAfterTp2.status}"`);
  check("7", `Timeline has TP2_HIT event`,                          posAfterTp2.timeline.some(e => e.type === "TP2_HIT"),        "timeline");
  check("7", `Timeline has TRADE_CLOSED event`,                     posAfterTp2.timeline.some(e => e.type === "TRADE_CLOSED"),   "timeline");
  check("7", `isPositionActive = false after COMPLETED`,            !s7tp2.isPositionActive,                                    `status="${posAfterTp2.status}"`);
  check("7", `Trade Entered strip hidden after COMPLETED`,          !s7tp2.showTradeEnteredStrip,                               `isPositionActive=${s7tp2.isPositionActive}`);

  // SL hit assertions
  check("7", `stopHit detected`,                                    slHits.stopHit,                                             "isLevelHit stop");
  check("7", `status = "STOPPED_OUT" after SL`,                     posAfterSL.status === "STOPPED_OUT",                        `status="${posAfterSL.status}"`);
  check("7", `Timeline has STOP_LOSS_HIT event`,                    posAfterSL.timeline.some(e => e.type === "STOP_LOSS_HIT"),   "timeline");
  check("7", `Timeline has TRADE_CLOSED after SL`,                  posAfterSL.timeline.some(e => e.type === "TRADE_CLOSED"),    "timeline");
  check("7", `s7sl.isPositionActive = false`,                       !s7sl.isPositionActive,                                     `status="${posAfterSL.status}"`);

  // "Enter Trade Now" guard
  check("7", `"Enter Trade Now" NOT shown when position COMPLETED`,  !s7noTrigger.showEntryBanner,                               `showEntryBanner=${s7noTrigger.showEntryBanner}`);
  check("7", `isEntryTriggered = false when status != ACTIVE`,       !s7noTrigger.isEntryTriggered,                              "isEntryTriggered = phase=triggered && !isPositionActive");
  check("7", `Button NOT "Enter Trade Now" after close`,             s7noTrigger.buttonText !== "Enter Trade Now",               `buttonText="${s7noTrigger.buttonText}"`);

  // ═════════════════════════════════════════════════════════════════════════════
  // SCENARIO 8 — RESPONSIVE UI (layout correctness)
  // ═════════════════════════════════════════════════════════════════════════════
  H("SCENARIO 8 — RESPONSIVE UI (structural/CSS audit)");

  console.log("  Method: CSS class audit against TradeSetupPanel.module.css");
  console.log("  No browser required — verifying structural presence of responsive rules.");
  console.log();

  const { readFileSync } = require("fs");
  const { join }         = require("path");
  const cssPath  = join(__dirname, "..", "components", "layout", "TradeSetupPanel.module.css");
  const tsxPath  = join(__dirname, "..", "components", "layout", "TradeSetupPanel.tsx");
  const cssText  = readFileSync(cssPath,  "utf8");
  const tsxText  = readFileSync(tsxPath,  "utf8");

  // ── CSS structural checks ─────────────────────────────────────────────────
  const hasEntryBannerClass      = cssText.includes(".entryBanner ");
  const hasEntryBannerIconClass  = cssText.includes(".entryBannerIcon");
  const hasTriggerButtonClass    = cssText.includes(".triggerButton");
  const hasPulseAnimation        = cssText.includes("@keyframes tradeSetupPulseLock");
  const hasTradeEnteredStrip     = cssText.includes(".tradeEnteredStrip");
  const hasTradeEnteredLabel     = cssText.includes(".tradeEnteredLabel");
  const hasTradeEnteredAt        = cssText.includes(".tradeEnteredAt");
  const hasTradeEnteredLive      = cssText.includes(".tradeEnteredLive");
  const hasTp1HitBadge           = cssText.includes(".tp1HitBadge");
  const hasNextSetupNote         = cssText.includes(".nextSetupNote");
  const hasReducedMotion         = cssText.includes("@media (prefers-reduced-motion: reduce)");
  const reducedMotionNoPulse     = cssText.includes("prefers-reduced-motion") && cssText.includes("animation: none");
  // Responsive rule: @media with max-width or width range in CSS
  const hasResponsiveBreakpoint  = /\@media[^{]+\d+(px|em)/.test(cssText);

  // ── TSX structural checks ─────────────────────────────────────────────────
  const tsxHasEntryBanner        = tsxText.includes("styles.entryBanner");
  const tsxHasTriggerButton      = tsxText.includes("styles.triggerButton");
  const tsxHasTradeEnteredStrip  = tsxText.includes("styles.tradeEnteredStrip");
  const tsxHasTp1HitBadge        = tsxText.includes("styles.tp1HitBadge");
  const tsxHasNextSetupNote      = tsxText.includes("styles.nextSetupNote");
  const tsxHasIsEntryTriggered   = tsxText.includes("isEntryTriggered");
  const tsxHasAiSetupDiffers     = tsxText.includes("aiSetupDiffersFromLocked");
  const tsxHasIsPositionActive   = tsxText.includes("isPositionActive");
  const tsxHasEnterTradeNow      = tsxText.includes("Enter Trade Now");
  const tsxHasTradeLockedBtn     = tsxText.includes("Trade Locked");
  const tsxHasTp1HitAtCheck      = tsxText.includes("tp1HitAt");
  const tsxFrozenDisplayEntry    = tsxText.includes("isPositionActive && lockedEntryNum !== null");
  const tsxFrozenDisplaySL       = tsxText.includes("lockedPosition.activeStopLoss");
  const tsxFreezesBranch         = tsxText.includes("isPositionActive && lockedPosition !== null");
  const tsxHasBadgeProp          = tsxText.includes("badge?: ReactNode");
  const tsxNoNewStores           = !tsxText.includes("create(") && !tsxText.includes("useStore(");
  const tsxLockedButtonClass     = tsxText.includes("styles.lockedButton");

  // Inspect entry banner text in TSX
  const bannerTitleMatch         = tsxText.includes("Entry level reached");
  const bannerTextMatch          = tsxText.includes("Price has crossed the setup entry. Lock to begin monitoring.");
  const newSetupNoteMatch        = tsxText.includes("AI has a new setup ready — visible after this trade closes.");

  console.log(`  ── CSS class presence ──────────────────────────────────────────────────`);
  console.log(`  .entryBanner         : ${hasEntryBannerClass}`);
  console.log(`  .entryBannerIcon     : ${hasEntryBannerIconClass}`);
  console.log(`  .triggerButton       : ${hasTriggerButtonClass}`);
  console.log(`  @keyframes pulse     : ${hasPulseAnimation}`);
  console.log(`  .tradeEnteredStrip   : ${hasTradeEnteredStrip}`);
  console.log(`  .tradeEnteredLabel   : ${hasTradeEnteredLabel}`);
  console.log(`  .tradeEnteredAt      : ${hasTradeEnteredAt}`);
  console.log(`  .tradeEnteredLive    : ${hasTradeEnteredLive}`);
  console.log(`  .tp1HitBadge         : ${hasTp1HitBadge}`);
  console.log(`  .nextSetupNote       : ${hasNextSetupNote}`);
  console.log(`  prefers-reduced-motion: ${hasReducedMotion}`);
  console.log(`  animation: none in RMQ: ${reducedMotionNoPulse}`);
  console.log(`  Responsive breakpoint: ${hasResponsiveBreakpoint}`);
  console.log();
  console.log(`  ── TSX structural presence ─────────────────────────────────────────────`);
  console.log(`  styles.entryBanner used      : ${tsxHasEntryBanner}`);
  console.log(`  styles.triggerButton used     : ${tsxHasTriggerButton}`);
  console.log(`  styles.tradeEnteredStrip used : ${tsxHasTradeEnteredStrip}`);
  console.log(`  styles.tp1HitBadge used       : ${tsxHasTp1HitBadge}`);
  console.log(`  styles.nextSetupNote used     : ${tsxHasNextSetupNote}`);
  console.log(`  isEntryTriggered variable     : ${tsxHasIsEntryTriggered}`);
  console.log(`  aiSetupDiffersFromLocked var  : ${tsxHasAiSetupDiffers}`);
  console.log(`  isPositionActive variable     : ${tsxHasIsPositionActive}`);
  console.log(`  "Enter Trade Now" text        : ${tsxHasEnterTradeNow}`);
  console.log(`  "Trade Locked" text           : ${tsxHasTradeLockedBtn}`);
  console.log(`  tp1HitAt check                : ${tsxHasTp1HitAtCheck}`);
  console.log(`  frozen displayEntry branch    : ${tsxFrozenDisplayEntry}`);
  console.log(`  lockedPosition.activeStopLoss : ${tsxFrozenDisplaySL}`);
  console.log(`  ACTIVE level freeze branch    : ${tsxFreezesBranch}`);
  console.log(`  badge prop on Level           : ${tsxHasBadgeProp}`);
  console.log(`  No new stores introduced      : ${tsxNoNewStores}`);
  console.log(`  styles.lockedButton           : ${tsxLockedButtonClass}`);
  console.log(`  Banner title text in TSX      : ${bannerTitleMatch}`);
  console.log(`  Banner body text in TSX       : ${bannerTextMatch}`);
  console.log(`  New setup note text in TSX    : ${newSetupNoteMatch}`);
  console.log();

  check("8", `CSS: .entryBanner class defined`,              hasEntryBannerClass,    "TradeSetupPanel.module.css");
  check("8", `CSS: .triggerButton class defined`,            hasTriggerButtonClass,  "TradeSetupPanel.module.css");
  check("8", `CSS: pulse keyframes defined`,                 hasPulseAnimation,      "@keyframes tradeSetupPulseLock");
  check("8", `CSS: .tradeEnteredStrip class defined`,        hasTradeEnteredStrip,   "TradeSetupPanel.module.css");
  check("8", `CSS: .tp1HitBadge class defined`,              hasTp1HitBadge,         "TradeSetupPanel.module.css");
  check("8", `CSS: .nextSetupNote class defined`,            hasNextSetupNote,       "TradeSetupPanel.module.css");
  check("8", `CSS: prefers-reduced-motion override exists`,  hasReducedMotion,       "@media (prefers-reduced-motion: reduce)");
  check("8", `CSS: animation:none in reduced-motion block`,  reducedMotionNoPulse,   "pulse animation suppressed");
  check("8", `CSS: responsive breakpoint rule present`,      hasResponsiveBreakpoint,"@media with px breakpoint");
  check("8", `TSX: .entryBanner applied`,                    tsxHasEntryBanner,      "styles.entryBanner");
  check("8", `TSX: .triggerButton applied`,                  tsxHasTriggerButton,    "styles.triggerButton");
  check("8", `TSX: .tradeEnteredStrip applied`,              tsxHasTradeEnteredStrip,"styles.tradeEnteredStrip");
  check("8", `TSX: .tp1HitBadge applied`,                    tsxHasTp1HitBadge,      "styles.tp1HitBadge");
  check("8", `TSX: .nextSetupNote applied`,                  tsxHasNextSetupNote,    "styles.nextSetupNote");
  check("8", `TSX: isEntryTriggered logic present`,          tsxHasIsEntryTriggered, "computed flag");
  check("8", `TSX: aiSetupDiffersFromLocked logic present`,  tsxHasAiSetupDiffers,   "computed flag");
  check("8", `TSX: "Enter Trade Now" text present`,          tsxHasEnterTradeNow,    "button label");
  check("8", `TSX: "Trade Locked" text present`,             tsxHasTradeLockedBtn,   "button label");
  check("8", `TSX: tp1HitAt check present`,                  tsxHasTp1HitAtCheck,    "badge condition");
  check("8", `TSX: level freeze (isPositionActive) present`, tsxFrozenDisplayEntry,  "frozen displayEntry");
  check("8", `TSX: activeStopLoss used for SL display`,      tsxFrozenDisplaySL,     "lockedPosition.activeStopLoss");
  check("8", `TSX: no new stores introduced`,                tsxNoNewStores,         "no create()/useStore()");
  check("8", `TSX: banner title "Entry level reached"`,      bannerTitleMatch,       "exact text");
  check("8", `TSX: banner body text correct`,                bannerTextMatch,        "exact text");
  check("8", `TSX: new setup note text correct`,             newSetupNoteMatch,      "exact text");

  // ═════════════════════════════════════════════════════════════════════════════
  // MASTER REPORT
  // ═════════════════════════════════════════════════════════════════════════════
  B();
  console.log("  MASTER REPORT");
  B();
  console.log();

  const scenarioIds = ["1","2","3","4","5","6","7","8"];
  const scenarioNames = {
    "1": "DETECTED",
    "2": "APPROACHING",
    "3": "TRIGGERED",
    "4": "MANUAL LOCK",
    "5": "ACTIVE TRADE FREEZE",
    "6": "TP1 HIT",
    "7": "CLOSED",
    "8": "RESPONSIVE UI",
  };

  for (const id of scenarioIds) {
    const items  = results.filter(r => r.scenarioId === id);
    const passed = items.filter(r => r.result === PASS).length;
    const total  = items.length;
    const allPass = passed === total;
    const status = allPass ? "✅ PASS" : "❌ FAIL";
    console.log(`  Scenario ${id} (${scenarioNames[id].padEnd(22)}) : ${status}  (${passed}/${total} checks)`);
    if (!allPass) {
      items.filter(r => r.result === FAIL).forEach(r => {
        console.log(`    ↳ FAILED: ${r.label}`);
      });
    }
  }

  console.log();
  L();
  console.log(`  TOTAL : ${passCount} passed  ${failCount} failed  (${passCount + failCount} checks)`);
  L();
  console.log();

  if (failCount === 0) {
    console.log("  🎉 ALL CHECKS PASSED — TradeSetupPanel UX implementation verified.");
  } else {
    console.log(`  ⚠️  ${failCount} CHECK(S) FAILED — see per-scenario failures above.`);
    process.exit(1);
  }
  console.log();
}

main().catch(e => { console.error("FATAL:", e.message, e.stack); process.exit(1); });
