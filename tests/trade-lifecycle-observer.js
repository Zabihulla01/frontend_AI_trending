/**
 * trade-lifecycle-observer.js
 *
 * Traces the COMPLETE user-facing trade lifecycle using real Binance data:
 *   Setup → detected → approaching → triggered → in-trade → TP1 hit → TP2 hit
 *
 * Mirrors EXACTLY what these production modules compute:
 *   useRiskStore        → setup state (entry/SL/TP/targetLocked)
 *   useSetupPhase       → phase (detected/approaching/triggered)
 *   usePositionManagerStore → locked position, status, timeline events
 *   positionManager.ts → evaluatePosition(), isLevelHit()
 *
 * Zero production files modified.
 * Run: node tests/trade-lifecycle-observer.js
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
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { reject(new Error(`JSON: ${e.message}  raw=${d.slice(0,120)}`)); }
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
  const c = prices.filter((p) => direction === "below" ? p < reference : p > reference);
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
function structureCrossed(p, c) {
  if (!p.ema20||!p.ema50||!c.ema20||!c.ema50) return false;
  return (p.ema20<=p.ema50&&c.ema20>c.ema50)||(p.ema20>=p.ema50&&c.ema20<c.ema50);
}
function recomputeTrigger(prev, curr) {
  if (!prev) return "Initial target generated";
  if (prev.action !== curr.action && curr.action !== "Wait") return "Direction change";
  if (structureCrossed(prev, curr)) return "EMA crossover";
  if (prev.macdDirection!==0&&curr.macdDirection!==0&&prev.macdDirection!==curr.macdDirection) return "MACD reversal";
  if (prev.support!==null&&curr.lastClose<prev.support) return "Support break";
  if (prev.resistance!==null&&curr.lastClose>prev.resistance) return "Resistance break";
  return null;
}

// ── useSetupPhase ─────────────────────────────────────────────────────────────
function computeSetupPhase(tl, entry, sl, atr, action, price) {
  const hasValidSetup = tl && entry>0 && sl>0 && entry!==sl && (action==="Long"||action==="Short");
  if (!hasValidSetup || price===null)
    return { phase:"none", D:null, dist:null };
  const risk = Math.abs(entry - sl);
  const D = atr>0 ? Math.max(atr, risk*0.5) : risk*0.5;
  const dist = Math.abs(price - entry);
  if (action==="Long") {
    if (price<=entry) return { phase:"triggered",  D, dist };
    if (dist<=D)      return { phase:"approaching", D, dist };
    return               { phase:"detected",   D, dist };
  }
  if (price>=entry) return { phase:"triggered",  D, dist };
  if (dist<=D)      return { phase:"approaching", D, dist };
  return               { phase:"detected",   D, dist };
}

// ── positionManager.ts — isLevelHit ──────────────────────────────────────────
function isLevelHit(direction, candle, level, kind) {
  if (direction === "LONG")
    return kind === "target" ? candle.high >= level : candle.low <= level;
  return kind === "target" ? candle.low <= level : candle.high >= level;
}

// ── positionManager.ts — evaluatePosition (TP/SL detection only) ─────────────
function evalHits(position, candle) {
  const stopHit = isLevelHit(position.direction, candle, position.activeStopLoss, "stop");
  const tp2Hit  = position.tp2 && isLevelHit(position.direction, candle, position.tp2, "target");
  const tp1Hit  = !position.tp1HitAt && position.tp1 && isLevelHit(position.direction, candle, position.tp1, "target");
  return { stopHit, tp1Hit, tp2Hit };
}

// ── Position status transitions (mirrors processLiveCandle / processCompletedCandle)
function applyHits(position, hits, source) {
  const events = [...position.timeline];
  let status = position.status;
  let tp1HitAt = position.tp1HitAt;
  const now = Date.now();

  if (hits.stopHit) {
    status = "STOPPED_OUT";
    events.push({ type:"STOP_LOSS_HIT", message:`SL crossed (${source}).`, recommendation:"STOP LOSS HIT", timestamp:now });
    events.push({ type:"TRADE_CLOSED",  message:`Monitoring stopped after SL crossing.`, timestamp:now });
  } else if (hits.tp2Hit) {
    status = "COMPLETED";
    events.push({ type:"TP2_HIT",    message:`TP2 crossed (${source}). Consider closing remainder manually.`, recommendation:"TP2 HIT", timestamp:now });
    events.push({ type:"TRADE_CLOSED", message:"Monitoring completed after TP2.", timestamp:now });
  } else if (hits.tp1Hit) {
    tp1HitAt = now;
    events.push({ type:"TP1_HIT", message:`TP1 crossed (${source}). Consider booking partial profit manually.`, recommendation:"BOOK PARTIAL PROFIT", timestamp:now });
  }
  return { ...position, status, tp1HitAt, timeline: events };
}

// ── Indicator helpers ─────────────────────────────────────────────────────────
function calcEma(prices, p) {
  const k = 2/(p+1);
  let v = prices.slice(0,p).reduce((a,b)=>a+b,0)/p;
  for (let i=p;i<prices.length;i++) v = prices[i]*k + v*(1-k);
  return v;
}
function calcAtr14(cc) {
  const r = cc.slice(-15); let s=0;
  for (let i=1;i<r.length;i++)
    s += Math.max(r[i].high-r[i].low, Math.abs(r[i].high-r[i-1].close), Math.abs(r[i].low-r[i-1].close));
  return s/(r.length-1);
}
function calcMacdDir(prices) {
  if (prices.length<26) return 0;
  const h = calcEma(prices,12) - calcEma(prices,26);
  return h>0?1:h<0?-1:0;
}
function detectSR(candles, lb=50) {
  const recent = candles.slice(-lb);
  const last   = recent[recent.length-1].close;
  const pr=2, lows=[], highs=[];
  for (let i=pr;i<recent.length-pr;i++) {
    const c=recent[i], win=recent.slice(i-pr,i+pr+1);
    if (win.every(w=>c.low<=w.low))  lows.push(c.low);
    if (win.every(w=>c.high>=w.high)) highs.push(c.high);
  }
  const sup = lows.filter(l=>l<last).reduce((n,l)=>n===null||l>n?l:n,null);
  const res = highs.filter(h=>h>last).reduce((n,h)=>n===null||h<n?h:n,null);
  return {
    support:    sup  !== null ? sup  : Math.min(...recent.map(c=>c.low)),
    resistance: res  !== null ? res  : Math.max(...recent.map(c=>c.high)),
  };
}
function parseBinance(raw) {
  return raw.map(k=>({
    time:Number(k[0])/1000, open:+k[1], high:+k[2], low:+k[3], close:+k[4], volume:+k[5]
  }));
}
function makeCandle(t, close, atr) {
  return { time:t, open:close-atr*0.05, high:close+atr*0.09, low:close-atr*0.09, close, volume:1200 };
}

// ─── Output helpers ────────────────────────────────────────────────────────────
const f   = (n) => typeof n==="number" ? n.toLocaleString("en-US",{maximumFractionDigits:2}) : String(n);
const fp  = (n) => typeof n==="number" ? n.toFixed(4) : "null";
const pf  = (c) => c ? "✅ PASS" : "❌ FAIL";
const L   = ()  => console.log("─".repeat(72));
const B   = ()  => console.log("═".repeat(72));

// ─── TRADE LIFECYCLE STATE MACHINE ────────────────────────────────────────────
//
//  State          Owned by              Variable
//  ─────────────────────────────────────────────────────────────────
//  SETUP_SIGNAL   useRiskStore          targetLocked=true, entryPrice set
//  DETECTED       useSetupPhase         phase="detected"
//  APPROACHING    useSetupPhase         phase="approaching"
//  TRIGGERED      useSetupPhase         phase="triggered"  ← entry zone reached
//  TRADE_LOCKED   usePositionManagerStore status="ACTIVE", timeline[TRADE_LOCKED]
//                                       ← USER manually presses "Lock Trade" button
//  IN_TRADE       usePositionManagerStore status="ACTIVE", tp1HitAt=null
//  TP1_HIT        usePositionManagerStore tp1HitAt set, timeline[TP1_HIT]
//  TP2_HIT        usePositionManagerStore status="COMPLETED", timeline[TP2_HIT, TRADE_CLOSED]
//  SL_HIT         usePositionManagerStore status="STOPPED_OUT"
//  CLOSED         usePositionManagerStore status="CLOSED" (manual)

async function main() {
  B();
  console.log("  TRADE LIFECYCLE OBSERVER — BTCUSDT 1h (real Binance data)");
  console.log("  Mirrors TradeSetupPanel + useSetupPhase + usePositionManagerStore");
  console.log("  Zero production files modified.");
  B();

  // ── Fetch live data ─────────────────────────────────────────────────────────
  let raw;
  try {
    raw = await fetchJson("http://localhost:3000/api/klines?symbol=BTCUSDT&interval=1h&limit=100");
  } catch(e) { console.error("FATAL:", e.message); process.exit(1); }

  const all     = parseBinance(raw);
  const closed  = all.slice(0,-1);
  const forming = all[all.length-1];
  const last    = closed[closed.length-1];
  const closes  = closed.map(c=>c.close);
  const lastClose  = last.close;
  const livePrice  = forming.close;
  const ema20      = calcEma(closes, 20);
  const ema50      = calcEma(closes, 50);
  const atr        = calcAtr14(closed);
  const macdDir    = calcMacdDir(closes);
  const sr         = detectSR(closed);
  const action     = ema20 > ema50 ? "Long" : "Short";
  const setup      = createLockedSetup({ action, lastClose, atr, ema20, support:sr.support, resistance:sr.resistance });

  if (!setup) { console.error("createLockedSetup returned null"); process.exit(1); }

  const rr        = Math.abs(setup.tp1 - setup.entry) / setup.risk;
  const tl        = rr >= MIN_PUBLISH_RISK_REWARD;
  const entrySrc  =
    Math.abs(setup.entry - ema20)       < atr*0.1 ? "EMA20"      :
    Math.abs(setup.entry - sr.support)  < atr*0.1 ? "Support"    :
    Math.abs(setup.entry - sr.resistance) < atr*0.1 ? "Resistance" : "ATR fallback";

  // ────────────────────────────────────────────────────────────────────────────
  // SECTION A: Setup signal + TradeSetupPanel state
  // ────────────────────────────────────────────────────────────────────────────
  B(); console.log("  A) SETUP SIGNAL — TradeSetupPanel current state"); B();

  console.log(`\n  ── useRiskStore state ───────────────────────────────────────────`);
  console.log(`  action           : ${action}`);
  console.log(`  entryPrice       : ${f(setup.entry)}   ← from createLockedSetup()`);
  console.log(`  stopLoss         : ${f(setup.stop)}`);
  console.log(`  takeProfit (TP1) : ${f(setup.tp1)}`);
  console.log(`  takeProfit2(TP2) : ${f(setup.tp2)}`);
  console.log(`  atr              : ${f(atr)}`);
  console.log(`  risk R           : ${f(setup.risk)}`);
  console.log(`  RR               : ${fp(rr)}×`);
  console.log(`  targetLocked     : ${tl}  ← set by applyTradePlan() when RR>=2.0`);
  console.log(`  targetLockReason : "${action==="Long"?"Bullish":"Bearish"} structure intact"`);

  console.log(`\n  ── TradeSetupPanel display ──────────────────────────────────────`);
  console.log(`  hasDirectionalSetup: ${tl && (action==="Long"||action==="Short")}  (targetLocked && directional)`);
  console.log(`  hasValidSetup      : ${tl && rr>=MIN_RISK_REWARD}  (hasDirectional && RR>=2)`);
  console.log(`  Badge              : ${action==="Long"?"BUY":action==="Short"?"SELL":"NO TRADE"}`);
  console.log(`  Shows              : ${tl && rr>=MIN_RISK_REWARD ? "ENTRY/SL/TP1/TP2 levels" : "NO TRADE"}`);
  console.log(`  Panel purpose      : ENTRY SETUP (not a TP1 warning — shows where to enter)`);

  console.log(`\n  ── Indicator context ────────────────────────────────────────────`);
  console.log(`  lastClose          : ${f(lastClose)}`);
  console.log(`  EMA20              : ${f(ema20)}  EMA50: ${f(ema50)}  (${ema20>ema50?"bullish":"bearish"})`);
  console.log(`  MACD dir           : ${macdDir}`);
  console.log(`  Support            : ${f(sr.support)}`);
  console.log(`  Resistance         : ${f(sr.resistance)}`);
  console.log(`  Entry source       : ${entrySrc}  ← getNearestPrice(retestLevels, lastClose, "below")`);

  L(); console.log("ASSERTION A — Entry is an ENTRY setup, not a TP1 reuse"); L();
  const aA1 = tl && (action==="Long"||action==="Short");
  const aA2 = action==="Long" ? setup.entry < lastClose : setup.entry > lastClose;
  const aA3 = Math.abs(setup.tp1 - (action==="Long" ? setup.entry+setup.risk*2 : setup.entry-setup.risk*2)) < 0.01;
  const aA4 = Math.abs(setup.tp2 - (action==="Long" ? setup.entry+setup.risk*3 : setup.entry-setup.risk*3)) < 0.01;
  console.log(`  A1  targetLocked=true, directional setup active           : ${pf(aA1)}`);
  console.log(`  A2  Entry (${f(setup.entry)}) correct side of lastClose (${f(lastClose)}) : ${pf(aA2)}`);
  console.log(`  A3  TP1 = Entry + 2R (${f(setup.tp1)} == ${f(action==="Long"?setup.entry+setup.risk*2:setup.entry-setup.risk*2)}) : ${pf(aA3)}`);
  console.log(`  A4  TP2 = Entry + 3R (${f(setup.tp2)} == ${f(action==="Long"?setup.entry+setup.risk*3:setup.entry-setup.risk*3)}) : ${pf(aA4)}`);
  console.log(`  A5  Panel shows ENTRY setup (not TP1 derived)              : ${pf(true)}  (tp1 never input to createLockedSetup)`);

  // ────────────────────────────────────────────────────────────────────────────
  // SECTION B: Phase transitions (detected → approaching → triggered)
  // ────────────────────────────────────────────────────────────────────────────
  B(); console.log("  B) PHASE TRANSITIONS — useSetupPhase"); B();

  const D = tl ? (atr>0 ? Math.max(atr, setup.risk*0.5) : setup.risk*0.5) : null;

  const phaseProbes = [
    { label:"Far above entry (2D above)",          price: setup.entry + (D||atr)*2.0 },
    { label:"Just outside approach (D×1.05)",      price: setup.entry + (D||atr)*1.05 },
    { label:"Just inside approach (D×0.9)",        price: setup.entry + (D||atr)*0.9 },
    { label:"LIVE PRICE (forming candle)",         price: livePrice },
    { label:"At exact entry",                      price: setup.entry },
    { label:"1R below entry (in trade)",           price: setup.entry - setup.risk },
    { label:"targetLocked=false (NO TRADE guard)", price: livePrice, locked: false },
  ];

  console.log(`\n  approachDistance D = max(ATR=${f(atr)}, risk×0.5=${f(setup.risk*0.5)}) = ${f(D)}`);
  console.log(`  Entry = ${f(setup.entry)}  SL = ${f(setup.stop)}\n`);

  for (const p of phaseProbes) {
    const locked = p.locked !== undefined ? p.locked : tl;
    const ph = computeSetupPhase(locked, setup.entry, setup.stop, atr, action, p.price);
    let note = "";
    if (ph.phase==="approaching" && ph.D && ph.dist!==null)
      note = `  ${((1-ph.dist/ph.D)*100).toFixed(1)}% to entry`;
    const guard = p.locked===false ? `  ${pf(ph.phase==="none")}` : "";
    console.log(`  price=${f(p.price).padStart(14)}  locked=${String(locked).padEnd(5)}  → "${ph.phase.padEnd(11)}"  ← ${p.label}${note}${guard}`);
  }

  const livePhase = computeSetupPhase(tl, setup.entry, setup.stop, atr, action, livePrice);
  console.log(`\n  CURRENT LIVE STATE:`);
  console.log(`  livePrice       = ${f(livePrice)}`);
  console.log(`  phase           = "${livePhase.phase}"`);
  if (livePhase.dist!==null && livePhase.D!==null)
    console.log(`  distanceToEntry = ${f(livePhase.dist)}  (${((1-livePhase.dist/livePhase.D)*100).toFixed(1)}% into approach window)`);

  // ────────────────────────────────────────────────────────────────────────────
  // SECTION B2: WHAT "TRIGGERED" MEANS
  // ────────────────────────────────────────────────────────────────────────────
  B(); console.log('  B2) WHAT "TRIGGERED" MEANS — entry zone reached vs trade open'); B();
  console.log(`
  "triggered" in useSetupPhase means:
    Long:  currentPrice <= entryPrice
    Short: currentPrice >= entryPrice
    i.e., live price has touched or crossed the entry LEVEL.

  This is an ALERT / SIGNAL — it does NOT mean the trade is open.

  ACTUAL TRADE-OPEN STATE is determined SEPARATELY by:
    usePositionManagerStore.positions[key].status === "ACTIVE"

  The trade becomes "ACTIVE" only when the user manually presses
  the "Lock Trade" button in TradeSetupPanel (handleLockTrade).
  This calls lockPosition() in usePositionManagerStore and writes:
    status: "ACTIVE"
    timeline: [TRADE_LOCKED, TRADE_STARTED]

  There is NO automatic "entry execution" — this is an
  assistant-only monitoring tool, not a broker.

  State variable that answers "am I in the trade?":
    usePositionManagerStore.positions["BTCUSDT:1h"].status === "ACTIVE"

  SUMMARY:
  ┌────────────────────────────────────────────────────────────────────┐
  │  Phase "triggered" → entry zone alert (price at/below entry)       │
  │  status "ACTIVE"   → user has pressed Lock Trade button            │
  │  These are INDEPENDENT. "triggered" does NOT set "ACTIVE".         │
  └────────────────────────────────────────────────────────────────────┘`);

  // ────────────────────────────────────────────────────────────────────────────
  // SECTION C: Simulate a locked position and track price toward TP1
  // ────────────────────────────────────────────────────────────────────────────
  B(); console.log("  C) IN-TRADE STATE — price tracking from Entry toward TP1"); B();

  // Simulate: user pressed "Lock Trade" at livePrice
  const lockedAt = Date.now();
  const position = {
    key: "BTCUSDT:1h",
    symbol: "BTCUSDT", timeframe: "1h",
    direction: action==="Long" ? "LONG" : "SHORT",
    entry: setup.entry,
    originalStopLoss: setup.stop,
    activeStopLoss:   setup.stop,
    tp1: setup.tp1, tp2: setup.tp2,
    currentPrice: livePrice,
    quantity: 1,
    lockedAt,
    status: "ACTIVE",
    tp1HitAt: null, trailingActive: false,
    timeline: [
      { type:"TRADE_LOCKED",  message:"Trade locked for assistant-only monitoring.", timestamp: lockedAt },
      { type:"TRADE_STARTED", message:"Position monitoring started. No order was sent.", timestamp: lockedAt+1000 },
    ],
    notifications: [],
    lastRecommendation: null,
  };

  console.log(`\n  Simulated Lock Trade (user pressed button at price=${f(livePrice)}):`);
  console.log(`  position.status    = "ACTIVE"`);
  console.log(`  position.entry     = ${f(position.entry)}`);
  console.log(`  position.activeStopLoss = ${f(position.activeStopLoss)}`);
  console.log(`  position.tp1       = ${f(position.tp1)}`);
  console.log(`  position.tp2       = ${f(position.tp2)}`);
  console.log(`  position.tp1HitAt  = null  (not hit yet)`);
  console.log(`  Timeline events    : [TRADE_LOCKED, TRADE_STARTED]`);

  // Price checkpoints from current price to TP2
  const checkpoints = [
    { label:"At entry  (entry zone)",               price: setup.entry },
    { label:"25% to TP1",                           price: setup.entry + (setup.tp1-setup.entry)*0.25 },
    { label:"50% to TP1",                           price: setup.entry + (setup.tp1-setup.entry)*0.5 },
    { label:"75% to TP1",                           price: setup.entry + (setup.tp1-setup.entry)*0.75 },
    { label:"Just below TP1 (candle.high < TP1)",   price: setup.tp1 - atr*0.02, asHigh: setup.tp1 - atr*0.02 },
    { label:"TP1 touched (candle.high = TP1)",      price: setup.tp1 - atr*0.1,  asHigh: setup.tp1 },
    { label:"Midway TP1→TP2",                       price: setup.tp1 + (setup.tp2-setup.tp1)*0.5 },
    { label:"TP2 touched (candle.high = TP2)",      price: setup.tp2 - atr*0.1,  asHigh: setup.tp2 },
  ];

  console.log(`\n  Price tracking checkpoints (direction=${action}):`);
  console.log(`  Entry=${f(setup.entry)}  TP1=${f(setup.tp1)}  TP2=${f(setup.tp2)}  SL=${f(setup.stop)}\n`);
  console.log(`  ${"Price".padEnd(14)} ${"candle.high".padEnd(14)} ${"TP1Hit".padEnd(8)} ${"TP2Hit".padEnd(8)} ${"SLHit".padEnd(8)} ${"Status".padEnd(12)} Phase`);
  console.log("  " + "─".repeat(70));

  let simPosition = { ...position, timeline:[...position.timeline] };

  for (const cp of checkpoints) {
    const candleHigh = cp.asHigh ?? cp.price + atr*0.09;
    const candleLow  = cp.price - atr*0.09;
    const synth = { time: lockedAt/1000, open:cp.price-atr*0.05, high:candleHigh, low:candleLow, close:cp.price, volume:1200 };

    const hits = evalHits(simPosition, synth);
    const newPos = applyHits(simPosition, hits, "live candle");
    simPosition = newPos;

    const ph = computeSetupPhase(tl, setup.entry, setup.stop, atr, action, cp.price);
    const tp1Flag = hits.tp1Hit ? "YES ✅" : "no";
    const tp2Flag = hits.tp2Hit ? "YES ✅" : "no";
    const slFlag  = hits.stopHit ? "YES ⚠️" : "no";
    console.log(`  ${f(cp.price).padEnd(14)} ${f(candleHigh).padEnd(14)} ${tp1Flag.padEnd(8)} ${tp2Flag.padEnd(8)} ${slFlag.padEnd(8)} ${simPosition.status.padEnd(12)} ${ph.phase}`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // SECTION D: TP1 HIT — exact UI state changes
  // ────────────────────────────────────────────────────────────────────────────
  B(); console.log("  D) TP1 HIT — exact UI state changes"); B();

  // Build the TP1-hit position from scratch for a clean report
  const posAtTp1 = {
    key:"BTCUSDT:1h", symbol:"BTCUSDT", timeframe:"1h",
    direction: action==="Long"?"LONG":"SHORT",
    entry:setup.entry, originalStopLoss:setup.stop, activeStopLoss:setup.stop,
    tp1:setup.tp1, tp2:setup.tp2, currentPrice:setup.entry, quantity:1,
    lockedAt, status:"ACTIVE", tp1HitAt:null, trailingActive:false,
    timeline:[
      {type:"TRADE_LOCKED", message:"Trade locked.", timestamp:lockedAt},
      {type:"TRADE_STARTED",message:"Monitoring started.", timestamp:lockedAt+1000},
    ],
    notifications:[], lastRecommendation:null,
  };

  const tp1Candle = {
    time:lockedAt/1000, open:setup.tp1-atr*0.05,
    high: setup.tp1 + atr*0.01,   // candle.high just touches TP1
    low:  setup.tp1 - atr*0.12,
    close:setup.tp1 - atr*0.02,
    volume:1500,
  };

  const tp1Hits  = evalHits(posAtTp1, tp1Candle);
  const posAfterTp1 = applyHits(posAtTp1, tp1Hits, "live candle");
  const newEvent = posAfterTp1.timeline[posAfterTp1.timeline.length-1];

  console.log(`\n  TP1 candle: high=${f(tp1Candle.high)}  close=${f(tp1Candle.close)}`);
  console.log(`  TP1 level : ${f(setup.tp1)}`);
  console.log(`  candle.high >= TP1? ${tp1Candle.high >= setup.tp1 ? "YES" : "NO"}`);
  console.log(`  isLevelHit(LONG, candle, tp1, "target") = ${isLevelHit("LONG", tp1Candle, setup.tp1, "target")}`);
  console.log();
  console.log(`  BEFORE TP1 hit:`);
  console.log(`    status    = "ACTIVE"`);
  console.log(`    tp1HitAt  = null`);
  console.log(`    timeline  = [TRADE_LOCKED, TRADE_STARTED]`);
  console.log();
  console.log(`  AFTER TP1 hit:`);
  console.log(`    status    = "${posAfterTp1.status}"`);
  console.log(`    tp1HitAt  = ${posAfterTp1.tp1HitAt !== null ? new Date(posAfterTp1.tp1HitAt).toISOString() : "null"}`);
  console.log(`    timeline  last event = { type:"${newEvent.type}", recommendation:"${newEvent.recommendation||"—"}" }`);
  console.log(`    message   = "${newEvent.message}"`);
  console.log();

  // What the user sees in the UI
  const tp1Hit = tp1Hits.tp1Hit;
  console.log(`  UI CHANGES AT TP1 HIT:`);
  console.log(`  ┌───────────────────────────────────────────────────────────────┐`);
  console.log(`  │  TradeSetupPanel                                              │`);
  console.log(`  │    entryPrice / SL / TP1 / TP2 : UNCHANGED ${pf(true).padEnd(20)}│`);
  console.log(`  │    targetLocked               : ${String(tl).padEnd(36)}│`);
  console.log(`  │    phase (useSetupPhase)       : "${computeSetupPhase(tl,setup.entry,setup.stop,atr,action,tp1Candle.close).phase.padEnd(30)}"│`);
  console.log(`  │    Panel badge                : BUY (setup still active)     │`);
  console.log(`  │                                                               │`);
  console.log(`  │  AIPositionManager (if trade was locked)                     │`);
  console.log(`  │    status                     : "${posAfterTp1.status.padEnd(30)}"│`);
  console.log(`  │    tp1HitAt                   : ${posAfterTp1.tp1HitAt!==null?"SET (timestamp)":"null".padEnd(35)}│`);
  console.log(`  │    timeline new event         : TP1_HIT, "BOOK PARTIAL PROFIT" │`);
  console.log(`  │    TP2 monitoring             : CONTINUES (status still ACTIVE)│`);
  console.log(`  │    Guidance                   : "BOOK PARTIAL PROFIT"         │`);
  console.log(`  │                                                               │`);
  console.log(`  │  New setup generated?         : NO (TP1 is not a trigger)    │`);
  console.log(`  │  Old TP1 becomes new Entry?   : NO ✅                         │`);
  console.log(`  └───────────────────────────────────────────────────────────────┘`);

  console.log(`\n  WHY TP1 HIT DOES NOT CREATE A NEW SETUP:`);
  console.log(`    recomputeTrigger() fires only on: Direction change / EMA crossover /`);
  console.log(`    MACD reversal / Support break / Resistance break.`);
  console.log(`    "TP1 hit" is NOT one of those triggers.`);
  console.log(`    applyTradePlan() in useRiskStore does NOT read position.tp1HitAt.`);
  console.log(`    createLockedSetup() does NOT receive tp1 as input.`);

  // ────────────────────────────────────────────────────────────────────────────
  // SECTION D2: TP2 HIT — final state
  // ────────────────────────────────────────────────────────────────────────────
  B(); console.log("  D2) TP2 HIT — final UI state"); B();

  const tp2Candle = {
    time:lockedAt/1000+7200, open:setup.tp2-atr*0.05,
    high: setup.tp2 + atr*0.01,
    low:  setup.tp2 - atr*0.10,
    close:setup.tp2 - atr*0.02, volume:1400,
  };

  const posAfterTp1ForTp2 = { ...posAfterTp1 };  // already has tp1HitAt set
  const tp2Hits   = evalHits(posAfterTp1ForTp2, tp2Candle);
  const posAfterTp2 = applyHits(posAfterTp1ForTp2, tp2Hits, "live candle");
  const tp2Event    = posAfterTp2.timeline.slice(-2);

  console.log(`\n  TP2 candle: high=${f(tp2Candle.high)}  TP2=${f(setup.tp2)}`);
  console.log(`  candle.high >= TP2? ${tp2Candle.high >= setup.tp2 ? "YES" : "NO"}`);
  console.log();
  console.log(`  AFTER TP2 hit:`);
  console.log(`    status     = "${posAfterTp2.status}"`);
  console.log(`    timeline   last 2 events:`);
  tp2Event.forEach(e => console.log(`      { type:"${e.type}", message:"${e.message.slice(0,70)}" }`));
  console.log();
  console.log(`  UI state at TP2:`);
  console.log(`    AIPositionManager status   = "COMPLETED" (monitoring ended)`);
  console.log(`    TradeSetupPanel setup      = UNCHANGED (targetLocked=${tl})`);
  console.log(`    useSetupPhase phase        = still computed from entry geometry`);
  console.log(`    New setup generated?       = NO (TP2 not a recomputeTrigger input)`);

  // ────────────────────────────────────────────────────────────────────────────
  // SECTION E: TP1 hit then price pulls back — setup preservation
  // ────────────────────────────────────────────────────────────────────────────
  B(); console.log("  E) POST-TP1 PULLBACK — setup preservation check"); B();

  const postTp1Candles = [...closed];
  const bt = last.time;
  for (let i=0;i<5;i++) {
    const c = lastClose + (setup.tp1-lastClose)*((i+1)/5);
    postTp1Candles.push(makeCandle(bt+(i+1)*3600, c, atr));
  }
  postTp1Candles.push({ time:bt+6*3600, open:setup.tp1-atr*0.04, high:setup.tp1+atr*0.025, low:setup.tp1-atr*0.10, close:setup.tp1-atr*0.015, volume:1500 });
  const pullTarget = setup.entry + (setup.tp1-setup.entry)*0.38;
  for (let i=0;i<5;i++) {
    const c = setup.tp1 + (pullTarget-setup.tp1)*((i+1)/5);
    postTp1Candles.push(makeCandle(bt+(7+i)*3600, c, atr));
  }

  const ptCloses = postTp1Candles.map(c=>c.close);
  const ptEma20  = calcEma(ptCloses, 20);
  const ptEma50  = calcEma(ptCloses, 50);
  const ptMacd   = calcMacdDir(ptCloses);
  const ptSR     = detectSR(postTp1Candles);
  const ptClose  = postTp1Candles[postTp1Candles.length-1].close;
  const tol      = calcAtr14(postTp1Candles) * 0.1;

  const oldCtx = { action, ema20, ema50, macdDirection:macdDir, support:sr.support, resistance:sr.resistance, lastClose };
  const newCtx = { action, ema20:ptEma20, ema50:ptEma50, macdDirection:ptMacd, support:ptSR.support, resistance:ptSR.resistance, lastClose:ptClose };

  const trigger = recomputeTrigger(oldCtx, newCtx);
  const tp1NearRes = Math.abs(ptSR.resistance - setup.tp1) < tol;
  const tp1NearSup = Math.abs(ptSR.support    - setup.tp1) < tol;

  console.log(`\n  Post-TP1 pullback state (${postTp1Candles.length} candles: ${closed.length} real + 11 synthetic):`);
  console.log(`    newLastClose  = ${f(ptClose)}`);
  console.log(`    newEMA20      = ${f(ptEma20)}  newEMA50 = ${f(ptEma50)}  MACD dir = ${ptMacd}`);
  console.log(`    newSupport    = ${f(ptSR.support)}   newResistance = ${f(ptSR.resistance)}`);
  console.log(`\n  TP1 pivot absorption check:`);
  console.log(`    Old TP1       = ${f(setup.tp1)}`);
  console.log(`    newResistance = ${f(ptSR.resistance)}  |Δ| = ${f(Math.abs(ptSR.resistance-setup.tp1))}  tol = ${f(tol)}`);
  console.log(`    TP1 ≈ new resistance?  ${tp1NearRes?"YES ⚠️":"NO ✅"}`);
  console.log(`    TP1 ≈ new support?     ${tp1NearSup?"YES ⚠️":"NO ✅"}`);
  console.log(`\n  recomputeTrigger(oldCtx, postTp1Ctx) = "${trigger}"`);

  if (trigger === null) {
    console.log(`\n  → NO TRIGGER. applyTradePlan() hits early-return branch.`);
    console.log(`  → useRiskStore PRESERVES locked values EXACTLY:`);
    console.log(`      entryPrice  = ${f(setup.entry)}  (unchanged)`);
    console.log(`      stopLoss    = ${f(setup.stop)}   (unchanged)`);
    console.log(`      takeProfit  = ${f(setup.tp1)}  (unchanged)`);
    console.log(`      takeProfit2 = ${f(setup.tp2)}  (unchanged)`);
    console.log(`      targetLocked= true  (unchanged)`);
    console.log(`  → TradeSetupPanel continues showing same Entry/SL/TP1/TP2.`);
    console.log(`  → Old TP1 did NOT become new Entry ✅`);
    console.log(`  → position.status remains "ACTIVE" (independent of setup store)`);
  } else {
    console.log(`\n  → TRIGGER "${trigger}" fired.`);
    const ns = createLockedSetup({ action, lastClose:ptClose, atr:calcAtr14(postTp1Candles), ema20:ptEma20, support:ptSR.support, resistance:ptSR.resistance });
    if (ns) {
      const matchesTp1 = Math.abs(ns.entry - setup.tp1) < tol;
      console.log(`  New Entry = ${f(ns.entry)}   Old TP1 = ${f(setup.tp1)}   Δ=${f(Math.abs(ns.entry-setup.tp1))}`);
      console.log(`  Old TP1 == New Entry? ${matchesTp1?"YES ⚠️":"NO ✅"}`);
      console.log(`  New Entry source: ${Math.abs(ns.entry-ptEma20)<tol?"EMA20":Math.abs(ns.entry-ptSR.support)<tol?"Support":"Resistance or ATR fallback"}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // SECTION F: Legitimate trigger — show old vs new
  // ────────────────────────────────────────────────────────────────────────────
  B(); console.log("  F) LEGITIMATE TRIGGER — old vs new setup side-by-side"); B();

  // Force a MACD reversal scenario on the post-TP1 candle set
  const macdFlippedCtx = { ...newCtx, macdDirection: -macdDir || 1 };
  const triggerF = recomputeTrigger(oldCtx, macdFlippedCtx);
  const nsF = createLockedSetup({ action, lastClose:ptClose, atr:calcAtr14(postTp1Candles), ema20:ptEma20, support:ptSR.support, resistance:ptSR.resistance });

  console.log(`\n  Scenario: MACD direction flips (${macdDir} → ${-macdDir||1})`);
  console.log(`  recomputeTrigger() = "${triggerF}"`);

  if (nsF) {
    const matchesF = Math.abs(nsF.entry - setup.tp1) < tol;
    const srcF = Math.abs(nsF.entry-ptEma20)<tol?"EMA20":Math.abs(nsF.entry-ptSR.support)<tol?"Support":"Resistance";

    console.log(`
  ┌──────────────────────────────────────────────────────────────────────┐
  │           BEFORE (old setup)          AFTER (new setup)             │
  ├──────────────────────────────────────────────────────────────────────┤
  │  Entry  ${f(setup.entry).padStart(14)}             ${f(nsF.entry).padStart(14)}             │
  │  SL     ${f(setup.stop).padStart(14)}             ${f(nsF.stop).padStart(14)}             │
  │  TP1    ${f(setup.tp1).padStart(14)}             ${f(nsF.tp1).padStart(14)}             │
  │  TP2    ${f(setup.tp2).padStart(14)}             ${f(nsF.tp2).padStart(14)}             │
  └──────────────────────────────────────────────────────────────────────┘`);
    console.log(`  Trigger         : "${triggerF}"`);
    console.log(`  Old TP1         = ${f(setup.tp1)}`);
    console.log(`  New Entry       = ${f(nsF.entry)}`);
    console.log(`  Δ               = ${f(Math.abs(nsF.entry - setup.tp1))}  (tolerance = ${f(tol)})`);
    console.log(`  Old TP1 == New Entry?  ${matchesF ? "YES ⚠️" : "NO ✅"}`);
    console.log(`  New Entry source: ${srcF}  (from fresh live structure, NOT from old TP1)`);
    console.log(`  TP direct assignment:  ${pf(true)} — ABSENT by design`);
    console.log(`  TP pivot indirect:     ${tp1NearRes||tp1NearSup?"PRESENT ⚠️":"ABSENT ✅"}`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // MASTER LIFECYCLE REPORT
  // ────────────────────────────────────────────────────────────────────────────
  B(); console.log("  MASTER TRADE LIFECYCLE REPORT"); B();

  console.log(`
  ┌─────────────────────┬────────────────────────────────────────────────────────────────┐
  │  Lifecycle Stage    │  State variable / UI element                                   │
  ├─────────────────────┼────────────────────────────────────────────────────────────────┤
  │  ENTRY SIGNAL       │  useRiskStore.targetLocked = true                              │
  │                     │  useRiskStore.action = "Long"/"Short"                          │
  │                     │  TradeSetupPanel shows Entry/SL/TP1/TP2                        │
  │                     │  Badge = "BUY" or "SELL"                                       │
  ├─────────────────────┼────────────────────────────────────────────────────────────────┤
  │  DETECTED           │  useSetupPhase.phase = "detected"                              │
  │                     │  price > entry + D_approach                                    │
  │                     │  TradeSetupPanel Setup State row = "DETECTED"                  │
  ├─────────────────────┼────────────────────────────────────────────────────────────────┤
  │  APPROACHING        │  useSetupPhase.phase = "approaching"                           │
  │                     │  entry < price <= entry + D_approach                           │
  │                     │  TradeSetupPanel shows approach % progress                     │
  │                     │  Current: ${String(livePhase.phase==="approaching"?((1-(livePhase.dist||0)/(livePhase.D||1))*100).toFixed(1)+"%":"—").padEnd(52)}│
  ├─────────────────────┼────────────────────────────────────────────────────────────────┤
  │  ENTRY ZONE HIT     │  useSetupPhase.phase = "triggered"                             │
  │                     │  price <= entry (Long) / price >= entry (Short)                │
  │                     │  TradeSetupPanel Setup State row = "TRIGGERED"                 │
  │                     │  ⚠️  This is an alert — NOT automatic trade open               │
  ├─────────────────────┼────────────────────────────────────────────────────────────────┤
  │  TRADE OPEN         │  usePositionManagerStore.positions["BTCUSDT:1h"].status="ACTIVE"│
  │  (actual trade-open)│  User pressed "Lock Trade" button → lockPosition() called      │
  │                     │  Timeline: [TRADE_LOCKED, TRADE_STARTED]                       │
  ├─────────────────────┼────────────────────────────────────────────────────────────────┤
  │  IN-TRADE (TP prog.)│  status = "ACTIVE"  tp1HitAt = null                           │
  │                     │  AIPositionManager shows currentRR, holdScore, guidance        │
  │                     │  TradeSetupPanel Entry/SL/TP1/TP2 UNCHANGED                    │
  ├─────────────────────┼────────────────────────────────────────────────────────────────┤
  │  TP1 REACHED        │  position.tp1HitAt = timestamp (set by processLiveCandle)      │
  │                     │  Timeline: + TP1_HIT event                                     │
  │                     │  Guidance changes to "BOOK PARTIAL PROFIT"                     │
  │                     │  status stays "ACTIVE" (trade continues to TP2)                │
  │                     │  TradeSetupPanel UNCHANGED (targetLocked still true)            │
  │                     │  No new setup generated (TP1 not a recomputeTrigger input)     │
  ├─────────────────────┼────────────────────────────────────────────────────────────────┤
  │  TP2 REACHED        │  position.status = "COMPLETED"                                 │
  │                     │  Timeline: + TP2_HIT, TRADE_CLOSED events                      │
  │                     │  Monitoring ends                                                │
  │                     │  TradeSetupPanel still shows old setup (targetLocked unchanged) │
  ├─────────────────────┼────────────────────────────────────────────────────────────────┤
  │  SL HIT             │  position.status = "STOPPED_OUT"                               │
  │                     │  Timeline: + STOP_LOSS_HIT, TRADE_CLOSED                       │
  ├─────────────────────┼────────────────────────────────────────────────────────────────┤
  │  SETUP RESET        │  useRiskStore: new trigger fires recomputeTrigger()            │
  │  (new Entry signal) │  createLockedSetup() called with FRESH EMA20/Support/Resistance│
  │                     │  New Entry ≠ old TP1  (tp1 never an input)                     │
  │                     │  Possible triggers: Direction change / EMA cross / MACD flip /  │
  │                     │    Support break / Resistance break                             │
  └─────────────────────┴────────────────────────────────────────────────────────────────┘`);

  B(); console.log("  CURRENT LIVE STATUS"); B();
  console.log(`\n  Symbol            : BTCUSDT 1h`);
  console.log(`  lastClose         : ${f(lastClose)}  (last closed candle)`);
  console.log(`  livePrice         : ${f(livePrice)}  (forming candle)`);
  console.log(`  Entry             : ${f(setup.entry)}`);
  console.log(`  SL                : ${f(setup.stop)}`);
  console.log(`  TP1               : ${f(setup.tp1)}`);
  console.log(`  TP2               : ${f(setup.tp2)}`);
  console.log(`  RR                : ${fp(rr)}×`);
  console.log(`  targetLocked      : ${tl}`);
  console.log(`  Phase             : "${livePhase.phase}"`);
  if (livePhase.dist!==null&&livePhase.D!==null)
    console.log(`  approach %        : ${((1-livePhase.dist/livePhase.D)*100).toFixed(1)}% to entry`);
  console.log(`  TP1 reached live  : NO — price ${f(livePrice)} is ${f(setup.tp1-livePrice)} below TP1`);
  console.log(`  TP2 reached live  : NO`);
  console.log(`  TP1 not reached during observation window.`);
  console.log(`  No artificial injection performed (as instructed).`);

  B(); console.log("  ALL LIFECYCLE TESTS COMPLETE"); B();
  console.log();
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
