export interface IndicatorCandle {
  time: number;
  close: number;
}

export interface OhlcvCandle extends IndicatorCandle {
  open: number;
  high: number;
  low: number;
  volume: number;
}

export function isValidOhlcvCandle(candle: OhlcvCandle) {
  return (
    Number.isFinite(candle.time) &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close) &&
    Number.isFinite(candle.volume) &&
    candle.high >= candle.low &&
    candle.high >= candle.open &&
    candle.high >= candle.close &&
    candle.low <= candle.open &&
    candle.low <= candle.close &&
    candle.volume >= 0
  );
}

export interface IndicatorPoint {
  time: number;
  value: number;
}

export interface MacdPoint {
  time: number;
  macd: number;
  signal: number | null;
  histogram: number | null;
}

export interface SupportResistanceLevels {
  support: number | null;
  resistance: number | null;
}

export interface IndicatorSnapshot {
  rsi: number | null;
  ema12: number | null;
  ema20: number | null;
  ema26: number | null;
  ema50: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  volume: number;
  averageVolume: number;
  volumeSpike: number;
  atr: number | null;
  adx: number | null;
  vwap: number | null;
  support: number | null;
  resistance: number | null;
  momentum: number;
}

export function calculateSma(candles: IndicatorCandle[], period: number): IndicatorPoint[] {
  if (period <= 0 || candles.length < period) {
    return [];
  }

  const points: IndicatorPoint[] = [];
  let rollingTotal = 0;

  candles.forEach((candle, index) => {
    rollingTotal += candle.close;

    if (index >= period) {
      rollingTotal -= candles[index - period].close;
    }

    if (index >= period - 1) {
      points.push({
        time: candle.time,
        value: rollingTotal / period,
      });
    }
  });

  return points;
}

export function calculateEma(candles: IndicatorCandle[], period: number): IndicatorPoint[] {
  if (period <= 0 || candles.length < period) {
    return [];
  }

  const multiplier = 2 / (period + 1);
  let ema = candles.slice(0, period).reduce((sum, candle) => sum + candle.close, 0) / period;
  const points: IndicatorPoint[] = [{ time: candles[period - 1].time, value: ema }];

  for (let index = period; index < candles.length; index += 1) {
    ema = (candles[index].close - ema) * multiplier + ema;
    points.push({ time: candles[index].time, value: ema });
  }

  return points;
}

export function calculateRsi(candles: IndicatorCandle[], period = 14): IndicatorPoint[] {
  if (period <= 0 || candles.length <= period) {
    return [];
  }

  const points: IndicatorPoint[] = [];
  let averageGain = 0;
  let averageLoss = 0;

  for (let index = 1; index <= period; index += 1) {
    const change = candles[index].close - candles[index - 1].close;

    if (change >= 0) {
      averageGain += change;
    } else {
      averageLoss += Math.abs(change);
    }
  }

  averageGain /= period;
  averageLoss /= period;

  points.push({
    time: candles[period].time,
    value: calculateRsiValue(averageGain, averageLoss),
  });

  for (let index = period + 1; index < candles.length; index += 1) {
    const change = candles[index].close - candles[index - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;

    points.push({
      time: candles[index].time,
      value: calculateRsiValue(averageGain, averageLoss),
    });
  }

  return points;
}

function calculateRsiValue(averageGain: number, averageLoss: number) {
  if (averageGain === 0 && averageLoss === 0) {
    return 50;
  }

  if (averageLoss === 0) {
    return 100;
  }

  if (averageGain === 0) {
    return 0;
  }

  const relativeStrength = averageGain / averageLoss;

  return 100 - 100 / (1 + relativeStrength);
}

export function calculateMacd(candles: IndicatorCandle[], shortPeriod = 12, longPeriod = 26, signalPeriod = 9): MacdPoint[] {
  const short = calculateEma(candles, shortPeriod);
  const long = calculateEma(candles, longPeriod);

  if (short.length === 0 || long.length === 0) {
    return [];
  }

  const longByTime = new Map(long.map((point) => [point.time, point.value]));
  const macdLine = short
    .map((point) => {
      const longValue = longByTime.get(point.time);
      return longValue === undefined ? null : { time: point.time, value: point.value - longValue };
    })
    .filter((point): point is IndicatorPoint => point !== null);
  const signalLine = calculateEma(
    macdLine.map((point) => ({ time: point.time, close: point.value })),
    signalPeriod
  );
  const signalByTime = new Map(signalLine.map((point) => [point.time, point.value]));

  return macdLine.map((point) => {
    const signal = signalByTime.get(point.time) ?? null;

    return {
      time: point.time,
      macd: point.value,
      signal,
      histogram: signal === null ? null : point.value - signal,
    };
  });
}

export function calculateAtr(candles: OhlcvCandle[], period = 14): IndicatorPoint[] {
  if (period <= 0 || candles.length <= period) {
    return [];
  }

  const trueRanges = candles.map((candle, index) => {
    if (index === 0) {
      return candle.high - candle.low;
    }

    const previousClose = candles[index - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose)
    );
  });
  const points: IndicatorPoint[] = [];
  let atr = trueRanges.slice(1, period + 1).reduce((sum, value) => sum + value, 0) / period;

  points.push({ time: candles[period].time, value: atr });

  for (let index = period + 1; index < candles.length; index += 1) {
    atr = (atr * (period - 1) + trueRanges[index]) / period;
    points.push({ time: candles[index].time, value: atr });
  }

  return points;
}

export function calculateAdx(candles: OhlcvCandle[], period = 14): IndicatorPoint[] {
  if (period <= 0 || candles.length <= period * 2) {
    return [];
  }

  const trueRanges: number[] = [];
  const plusDm: number[] = [];
  const minusDm: number[] = [];

  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    const upMove = current.high - previous.high;
    const downMove = previous.low - current.low;

    trueRanges.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close)
      )
    );
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  let smoothedTr = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0);
  let smoothedPlus = plusDm.slice(0, period).reduce((sum, value) => sum + value, 0);
  let smoothedMinus = minusDm.slice(0, period).reduce((sum, value) => sum + value, 0);
  const dxValues: IndicatorPoint[] = [];

  for (let index = period; index < trueRanges.length; index += 1) {
    smoothedTr = smoothedTr - smoothedTr / period + trueRanges[index];
    smoothedPlus = smoothedPlus - smoothedPlus / period + plusDm[index];
    smoothedMinus = smoothedMinus - smoothedMinus / period + minusDm[index];

    const plusDi = smoothedTr === 0 ? 0 : (smoothedPlus / smoothedTr) * 100;
    const minusDi = smoothedTr === 0 ? 0 : (smoothedMinus / smoothedTr) * 100;
    const dx = plusDi + minusDi === 0 ? 0 : (Math.abs(plusDi - minusDi) / (plusDi + minusDi)) * 100;

    dxValues.push({ time: candles[index + 1].time, value: dx });
  }

  if (dxValues.length < period) {
    return [];
  }

  const adxPoints: IndicatorPoint[] = [];
  let adx = dxValues.slice(0, period).reduce((sum, point) => sum + point.value, 0) / period;
  adxPoints.push({ time: dxValues[period - 1].time, value: adx });

  for (let index = period; index < dxValues.length; index += 1) {
    adx = (adx * (period - 1) + dxValues[index].value) / period;
    adxPoints.push({ time: dxValues[index].time, value: adx });
  }

  return adxPoints;
}

export function calculateVwap(candles: OhlcvCandle[]): IndicatorPoint[] {
  let cumulativeTypicalVolume = 0;
  let cumulativeVolume = 0;

  return candles
    .map((candle) => {
      const typicalPrice = (candle.high + candle.low + candle.close) / 3;
      cumulativeTypicalVolume += typicalPrice * candle.volume;
      cumulativeVolume += candle.volume;

      return cumulativeVolume > 0
        ? { time: candle.time, value: cumulativeTypicalVolume / cumulativeVolume }
        : null;
    })
    .filter((point): point is IndicatorPoint => point !== null);
}

export function calculateMomentum(candles: IndicatorCandle[], lookback = 10) {
  if (candles.length <= lookback) {
    return 0;
  }

  const last = candles[candles.length - 1].close;
  const previous = candles[candles.length - 1 - lookback].close;

  return previous === 0 ? 0 : ((last - previous) / previous) * 100;
}

export function calculateAverageVolume(candles: OhlcvCandle[], lookback = 20) {
  const recent = candles.slice(-lookback);

  if (recent.length === 0) {
    return 0;
  }

  return recent.reduce((sum, candle) => sum + candle.volume, 0) / recent.length;
}

export function detectSupportResistance(candles: OhlcvCandle[], lookback = 50): SupportResistanceLevels {
  const recent = candles.slice(-lookback);

  if (recent.length === 0) {
    return { support: null, resistance: null };
  }

  return {
    support: Math.min(...recent.map((candle) => candle.low)),
    resistance: Math.max(...recent.map((candle) => candle.high)),
  };
}

export function getLatestValue(points: IndicatorPoint[]) {
  return points.length > 0 ? points[points.length - 1].value : null;
}

export function getLatestMacd(points: MacdPoint[]) {
  return points.length > 0 ? points[points.length - 1] : null;
}

export function calculateIndicatorSnapshot(candles: OhlcvCandle[]): IndicatorSnapshot {
  const indicatorCandles = candles.map((candle) => ({ time: candle.time, close: candle.close }));
  const macd = getLatestMacd(calculateMacd(indicatorCandles));
  const averageVolume = calculateAverageVolume(candles);
  const currentVolume = candles.length > 0 ? candles[candles.length - 1].volume : 0;
  const levels = detectSupportResistance(candles);

  return {
    rsi: getLatestValue(calculateRsi(indicatorCandles, 14)),
    ema12: getLatestValue(calculateEma(indicatorCandles, 12)),
    ema20: getLatestValue(calculateEma(indicatorCandles, 20)),
    ema26: getLatestValue(calculateEma(indicatorCandles, 26)),
    ema50: getLatestValue(calculateEma(indicatorCandles, 50)),
    macd: macd?.macd ?? null,
    macdSignal: macd?.signal ?? null,
    macdHistogram: macd?.histogram ?? null,
    volume: currentVolume,
    averageVolume,
    volumeSpike: averageVolume > 0 ? currentVolume / averageVolume : 1,
    atr: getLatestValue(calculateAtr(candles, 14)),
    adx: getLatestValue(calculateAdx(candles, 14)),
    vwap: getLatestValue(calculateVwap(candles)),
    support: levels.support,
    resistance: levels.resistance,
    momentum: calculateMomentum(indicatorCandles, 10),
  };
}
