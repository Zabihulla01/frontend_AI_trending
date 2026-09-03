import assert from "node:assert/strict";
import test from "node:test";
import { calculateRsi, detectSupportResistance, isValidOhlcvCandle } from "../services/indicators.ts";
import { createAdaptiveScenario } from "../services/marketScenario.ts";
import { isActivePosition } from "../services/positionDisplay.ts";
import { parseBoundedInteger } from "../services/requestGuard.ts";

test("RSI stays neutral for a flat market", () => {
  const candles = Array.from({ length: 20 }, (_, index) => ({ time: index, close: 100 }));
  const latest = calculateRsi(candles, 14).at(-1)?.value;

  assert.equal(latest, 50);
});

test("OHLCV validation rejects malformed candles", () => {
  assert.equal(
    isValidOhlcvCandle({ time: 1, open: 10, high: 12, low: 9, close: 11, volume: 100 }),
    true
  );
  assert.equal(
    isValidOhlcvCandle({ time: 1, open: 10, high: 8, low: 9, close: 11, volume: 100 }),
    false
  );
});

test("bounded query parsing rejects invalid and out-of-range values", () => {
  assert.equal(parseBoundedInteger(null, 10, 1, 20), 10);
  assert.equal(parseBoundedInteger("20", 10, 1, 20), 20);
  assert.equal(parseBoundedInteger("0", 10, 1, 20), null);
  assert.equal(parseBoundedInteger("1.5", 10, 1, 20), null);
  assert.equal(parseBoundedInteger("999", 10, 1, 20), null);
});

test("closed positions use the historical display state", () => {
  assert.equal(isActivePosition("ACTIVE"), true);
  assert.equal(isActivePosition("CLOSED"), false);
  assert.equal(isActivePosition("STOPPED_OUT"), false);
  assert.equal(isActivePosition("COMPLETED"), false);
});

test("support and resistance prefer the nearest confirmed swing levels", () => {
  const candles = [
    [100, 102, 99], [101, 103, 100], [100, 102, 98], [102, 104, 101],
    [104, 106, 103], [105, 110, 104], [104, 108, 102], [105, 107, 103],
  ].map(([close, high, low], time) => ({ time, open: close, high, low, close, volume: 10 }));
  const levels = detectSupportResistance(candles);

  assert.equal(levels.support, 98);
  assert.equal(levels.resistance, 110);
});

test("adaptive scenario provides both breakout and breakdown plans while waiting", () => {
  const scenario = createAdaptiveScenario({
    action: "Wait", marketCondition: "Sideways", confidence: 66, currentPrice: 105, support: 100, resistance: 110, atr: 2,
    setupChecks: { emaCrossover: false, macdConfirm: true },
  });

  assert.equal(scenario.bullish.entry, 110);
  assert.equal(scenario.bearish.entry, 100);
  assert.match(scenario.reason, /EMA/);
});
