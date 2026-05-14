import { create } from "zustand";
import {
  createAlertId,
  type AlertHistoryItem,
  type AlertStatus,
  type AlertType,
  type TradingAlert,
  isDuplicateAlert,
  normalizeAlertSymbol,
} from "@/services/alerts";

interface CreateAlertInput {
  symbol: string;
  type: AlertType;
  target: number;
  referencePrice?: number;
  soundEnabled: boolean;
}

interface TriggerAlertInput {
  id: string;
  value: number;
  message: string;
}

interface AlertState {
  alerts: TradingAlert[];
  history: AlertHistoryItem[];
  addAlert: (input: CreateAlertInput) => { ok: true; alert: TradingAlert } | { ok: false; error: string };
  setAlertStatus: (id: string, status: AlertStatus) => void;
  removeAlert: (id: string) => void;
  triggerAlert: (input: TriggerAlertInput) => TradingAlert | null;
  clearHistory: () => void;
}

export const useAlertStore = create<AlertState>((set, get) => ({
  alerts: [],
  history: [],
  addAlert: (input) => {
    const symbol = normalizeAlertSymbol(input.symbol);
    const target = Number(input.target);
    const referencePrice =
      typeof input.referencePrice === "number" && Number.isFinite(input.referencePrice)
        ? input.referencePrice
        : undefined;

    if (!/^[A-Z0-9]{3,20}$/.test(symbol)) {
      return { ok: false, error: "Enter a valid symbol." };
    }

    if (!Number.isFinite(target) || target <= 0) {
      return { ok: false, error: "Enter a positive alert value." };
    }

    if (input.type === "percentage-move" && (!referencePrice || referencePrice <= 0)) {
      return { ok: false, error: "Wait for a live price before creating a percentage alert." };
    }

    const nextAlert: TradingAlert = {
      id: createAlertId(),
      symbol,
      type: input.type,
      status: "active",
      target,
      referencePrice,
      soundEnabled: input.soundEnabled,
      createdAt: Date.now(),
    };

    if (isDuplicateAlert(get().alerts, nextAlert)) {
      return { ok: false, error: "That active alert already exists." };
    }

    set((state) => ({
      alerts: [nextAlert, ...state.alerts],
    }));

    return { ok: true, alert: nextAlert };
  },
  setAlertStatus: (id, status) => {
    set((state) => ({
      alerts: state.alerts.map((alert) => (alert.id === id ? { ...alert, status } : alert)),
    }));
  },
  removeAlert: (id) => {
    set((state) => ({
      alerts: state.alerts.filter((alert) => alert.id !== id),
    }));
  },
  triggerAlert: ({ id, value, message }) => {
    const alert = get().alerts.find((item) => item.id === id);

    if (!alert || alert.status !== "active") {
      return null;
    }

    const triggeredAt = Date.now();
    const triggeredAlert: TradingAlert = {
      ...alert,
      status: "triggered",
      triggeredAt,
      triggeredValue: value,
      message,
    };
    const historyItem: AlertHistoryItem = {
      id: createAlertId(),
      alertId: id,
      symbol: alert.symbol,
      type: alert.type,
      target: alert.target,
      value,
      message,
      triggeredAt,
    };

    set((state) => ({
      alerts: state.alerts.map((item) => (item.id === id ? triggeredAlert : item)),
      history: [historyItem, ...state.history].slice(0, 50),
    }));

    return triggeredAlert;
  },
  clearHistory: () => set({ history: [] }),
}));
