export interface IndicatorCandle {
  time: number;
  close: number;
}

export interface IndicatorPoint {
  time: number;
  value: number;
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
  if (averageLoss === 0) {
    return 100;
  }

  if (averageGain === 0) {
    return 0;
  }

  const relativeStrength = averageGain / averageLoss;

  return 100 - 100 / (1 + relativeStrength);
}

export function getLatestValue(points: IndicatorPoint[]) {
  return points.length > 0 ? points[points.length - 1].value : null;
}
