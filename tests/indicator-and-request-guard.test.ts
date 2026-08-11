import assert from "node:assert/strict";
import test from "node:test";
import { calculateRsi, isValidOhlcvCandle } from "../services/indicators.ts";
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
