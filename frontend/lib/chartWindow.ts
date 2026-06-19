import type { TickerChart } from "@/lib/types";

/** Close prices within the last `days` calendar days (falls back to trailing bars). */
export function getClosesForDays(chart: TickerChart, days: number): number[] {
  const { t, c } = chart;
  if (!c?.length) return [];

  if (!t?.length || t.length !== c.length) {
    return c.slice(-days);
  }

  const cutoff = Math.floor(Date.now() / 1000) - days * 86_400;
  let startIdx = t.findIndex((ts) => ts >= cutoff);
  if (startIdx === -1) {
    startIdx = Math.max(0, c.length - days);
  }
  return c.slice(startIdx);
}
