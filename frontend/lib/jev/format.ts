import type { JevSession } from "./types";

export function fmtUsd(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function fmtPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: v >= 1 ? 2 : 6 });
}

export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtQty(v: number): string {
  return v === 0 ? "0" : v.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

export function pnlClass(v: number | null | undefined): string {
  if (v == null || v === 0) return "text-fg";
  return v > 0 ? "text-green-500 dark:text-green-400" : "text-red-500 dark:text-red-400";
}

export const STATUS_STYLES: Record<string, string> = {
  running: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  stopping: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
  completed: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
  stopped: "bg-elevated text-fg-secondary",
  killed: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
  interrupted: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
};

/** Colour for an action in charts and feeds. */
export function actionTone(action: string): "quote" | "wide" | "hold" | "kill" | "idle" {
  if (action === "KILL") return "kill";
  if (action === "QUOTE_BOTH_SIDES") return "quote";
  if (action === "QUOTE_WIDE" || action === "WIDEN") return "wide";
  if (action === "HOLD_LATE" || action === "DATA_ERROR" || action === "MARKET_CLOSED") return "hold";
  return "idle"; // PULL_QUOTES, STAND_DOWN
}

/** True when the risk engine vetoed this tick, so nothing was quoted or sent. */
export function isVetoed(t: { action_reason: string | null }): boolean {
  return t.action_reason?.startsWith("vetoed") ?? false;
}

/** Tone for a tick: a vetoed tick reads as a hold, whatever action was proposed. */
export function tickTone(t: { action: string; action_reason: string | null }): ReturnType<typeof actionTone> {
  return isVetoed(t) ? "hold" : actionTone(t.action);
}

export const TONE_FILL: Record<ReturnType<typeof actionTone>, string> = {
  quote: "#3b82f6",
  wide: "#8b5cf6",
  hold: "#f59e0b",
  kill: "#ef4444",
  idle: "#9ca3af",
};

export function isFinished(s: Pick<JevSession, "status">): boolean {
  return s.status !== "running" && s.status !== "stopping";
}

export function effectiveValues(defaults: Record<string, number>, overrides: Record<string, number>): Record<string, number> {
  return { ...defaults, ...overrides };
}
