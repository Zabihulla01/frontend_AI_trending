export type AlertType =
  | "above-price"
  | "below-price"
  | "percentage-move"
  | "rsi-overbought"
  | "rsi-oversold";

export type AlertStatus = "active" | "triggered" | "disabled";

export interface TradingAlert {
  id: string;
  symbol: string;
  type: AlertType;
  status: AlertStatus;
  target: number;
  referencePrice?: number;
  soundEnabled: boolean;
  createdAt: number;
  triggeredAt?: number;
  triggeredValue?: number;
  message?: string;
}

export interface AlertHistoryItem {
  id: string;
  alertId: string;
  symbol: string;
  type: AlertType;
  target: number;
  value: number;
  message: string;
  triggeredAt: number;
}

export interface AlertEvaluationContext {
  price: number | null;
  rsi: number | null;
}

export interface AlertTriggerResult {
  value: number;
  message: string;
}

const ALERT_LABELS: Record<AlertType, string> = {
  "above-price": "Above price",
  "below-price": "Below price",
  "percentage-move": "Percentage move",
  "rsi-overbought": "RSI overbought",
  "rsi-oversold": "RSI oversold",
};

export function getAlertTypeLabel(type: AlertType) {
  return ALERT_LABELS[type];
}

export function normalizeAlertSymbol(symbol: string) {
  return symbol.trim().toUpperCase().replace(/\s+/g, "");
}

export function createAlertId() {
  return `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isDuplicateAlert(alerts: TradingAlert[], nextAlert: Omit<TradingAlert, "id" | "createdAt">) {
  return alerts.some((alert) => {
    const sameTarget = Math.abs(alert.target - nextAlert.target) < 0.00000001;
    const sameReference =
      alert.type !== "percentage-move" ||
      Math.abs((alert.referencePrice ?? 0) - (nextAlert.referencePrice ?? 0)) < 0.00000001;

    return (
      alert.status === "active" &&
      alert.symbol === nextAlert.symbol &&
      alert.type === nextAlert.type &&
      sameTarget &&
      sameReference
    );
  });
}

export function evaluateAlert(
  alert: TradingAlert,
  context: AlertEvaluationContext
): AlertTriggerResult | null {
  if (alert.status !== "active") {
    return null;
  }

  if (alert.type === "above-price") {
    return context.price !== null && context.price >= alert.target
      ? {
          value: context.price,
          message: `${alert.symbol} crossed above ${formatAlertValue(alert.target)}`,
        }
      : null;
  }

  if (alert.type === "below-price") {
    return context.price !== null && context.price <= alert.target
      ? {
          value: context.price,
          message: `${alert.symbol} dropped below ${formatAlertValue(alert.target)}`,
        }
      : null;
  }

  if (alert.type === "percentage-move") {
    const referencePrice = alert.referencePrice;

    if (context.price === null || !referencePrice || referencePrice <= 0) {
      return null;
    }

    const move = ((context.price - referencePrice) / referencePrice) * 100;

    return Math.abs(move) >= alert.target
      ? {
          value: move,
          message: `${alert.symbol} moved ${formatAlertValue(move)}% from ${formatAlertValue(
            referencePrice
          )}`,
        }
      : null;
  }

  if (alert.type === "rsi-overbought") {
    return context.rsi !== null && context.rsi >= alert.target
      ? {
          value: context.rsi,
          message: `${alert.symbol} RSI reached overbought at ${formatAlertValue(context.rsi)}`,
        }
      : null;
  }

  if (alert.type === "rsi-oversold") {
    return context.rsi !== null && context.rsi <= alert.target
      ? {
          value: context.rsi,
          message: `${alert.symbol} RSI reached oversold at ${formatAlertValue(context.rsi)}`,
        }
      : null;
  }

  return null;
}

export function getDefaultAlertTarget(type: AlertType, currentPrice: number | null) {
  if (type === "above-price") {
    return currentPrice ? currentPrice * 1.01 : 0;
  }

  if (type === "below-price") {
    return currentPrice ? currentPrice * 0.99 : 0;
  }

  if (type === "percentage-move") {
    return 3;
  }

  if (type === "rsi-overbought") {
    return 70;
  }

  return 30;
}

export function formatAlertValue(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.abs(value) >= 100 ? 2 : 4,
  }).format(value);
}
