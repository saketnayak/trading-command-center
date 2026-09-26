/**
 * Plain-English read-outs for the JEV Lab session page: what the loop is doing,
 * why it isn't trading, and how healthy the Jev decider is. Pure functions over ticks.
 */
import { fmtPct, fmtPrice, isVetoed } from "./format";
import type { JevTick } from "./types";

const CALL_STATUSES = new Set(["answered", "rate_limited", "late", "error", "mock"]);

export interface JevWindowStats {
  calls: number;
  answered: number;
  rateLimited: number;
  late: number;
  errors: number;
  paced: number;
  answerRate: number | null;
  avgMs: number | null;
  lastMs: number | null;
  providers: Record<string, number>;
}

/** Jev call outcomes over the most recent `windowTicks` ticks. */
export function jevWindowStats(ticks: JevTick[], windowTicks = 90): JevWindowStats {
  const w = ticks.slice(-windowTicks);
  const calls = w.filter((t) => CALL_STATUSES.has(t.jev_status ?? ""));
  const count = (s: string) => w.filter((t) => t.jev_status === s).length;
  const answered = count("answered") + count("mock");
  const fresh = w.filter((t) => (t.jev_status === "answered" || t.jev_status === "mock") && t.latency_ms != null);
  const providers: Record<string, number> = {};
  for (const t of w) if (t.jev_provider) providers[t.jev_provider] = (providers[t.jev_provider] ?? 0) + 1;
  return {
    calls: calls.length,
    answered,
    rateLimited: count("rate_limited"),
    late: count("late"),
    errors: count("error"),
    paced: count("paced"),
    answerRate: calls.length ? answered / calls.length : null,
    avgMs: fresh.length ? fresh.reduce((a, t) => a + (t.latency_ms ?? 0), 0) / fresh.length : null,
    lastMs: fresh.length ? fresh[fresh.length - 1].latency_ms : null,
    providers,
  };
}

export interface JevHealth {
  level: "ok" | "degraded" | "down";
  message: string;
}

/** A banner-worthy summary, or null while Jev is healthy (or there is too little data). */
export function jevHealth(stats: JevWindowStats): JevHealth | null {
  if (stats.calls < 4 || stats.answerRate == null || stats.answerRate >= 0.8) return null;
  const pct = fmtPct(stats.answerRate, 0);
  const cause =
    stats.rateLimited >= Math.max(stats.late, stats.errors)
      ? `rate limited by its provider (${stats.rateLimited} of ${stats.calls} calls got HTTP 429)`
      : stats.late >= stats.errors
        ? `too slow to answer within a tick (${stats.late} of ${stats.calls} calls)`
        : `returning errors (${stats.errors} of ${stats.calls} calls)`;
  if (stats.answerRate < 0.3) {
    return {
      level: "down",
      message: `Jev answered only ${pct} of recent calls: it is ${cause}. The loop slows its calls down and falls back to rules-only quoting; directional trades wait until Jev answers again.`,
    };
  }
  return {
    level: "degraded",
    message: `Jev answered ${pct} of recent calls: it is ${cause}. The loop is pacing its calls and deciding on the latest answer in between.`,
  };
}

export type DecisionTone = "buy" | "sell" | "quote" | "hold" | "idle" | "kill";

/** The headline word for what a tick did. */
export function decisionWord(t: JevTick): { word: string; tone: DecisionTone } {
  const leg = t.orders.find((o) => o.purpose === "leg" && o.status !== "rejected");
  if (t.action === "KILL") return { word: "KILLED", tone: "kill" };
  if (t.action === "MARKET_CLOSED") return { word: "CLOSED", tone: "hold" };
  if (t.action === "DATA_ERROR") return { word: "NO DATA", tone: "hold" };
  if (t.action === "HOLD_LATE") return { word: "HOLDING", tone: "hold" };
  if (isVetoed(t)) return { word: "VETOED", tone: "hold" };
  if (leg) return leg.side === "buy" ? { word: "BUYING", tone: "buy" } : { word: "SELLING", tone: "sell" };
  if (t.action === "PULL_QUOTES" || t.action === "STAND_DOWN") return { word: "STANDING BY", tone: "idle" };
  return { word: "QUOTING", tone: "quote" };
}

export const DECISION_TONE_CLASS: Record<DecisionTone, string> = {
  buy: "text-green-500 dark:text-green-400",
  sell: "text-red-500 dark:text-red-400",
  quote: "text-blue-500 dark:text-blue-400",
  hold: "text-amber-500 dark:text-amber-300",
  idle: "text-fg-secondary",
  kill: "text-red-600 dark:text-red-400",
};

const bpsFromMid = (price: number, mid: number | null) => (mid ? Math.abs(mid - price) / mid * 10_000 : null);

/** Why the latest tick did (or didn't) trade, one plain sentence per reason. */
export function explainTick(t: JevTick, thresholds: Record<string, number>): string[] {
  const out: string[] = [];
  if (t.action === "KILL") return [`A hard risk limit tripped: ${t.action_reason ?? "see the tick log"}. Session stopped.`];
  if (t.action === "MARKET_CLOSED") return ["The market is closed, so nothing is quoted or traded."];
  if (t.action === "DATA_ERROR") return [`Market data could not be read: ${t.action_reason ?? "unknown error"}.`];
  if (isVetoed(t)) out.push(`The risk engine vetoed this tick (${(t.action_reason ?? "").replace(/^vetoed:\s*/, "")}); resting quotes were pulled.`);

  const age = t.answer_age_s;
  if (t.jev_status === "paced" && age != null) out.push(`Deciding on Jev's answer from ${age.toFixed(0)} s ago; Jev is called on its own slower schedule.`);
  if (t.jev_status === "rate_limited")
    out.push(age != null ? `Jev was rate limited; using its answer from ${age.toFixed(0)} s ago.` : "Jev was rate limited and there is no recent answer to use.");
  if (t.action === "HOLD_LATE") out.push("Jev did not answer in time and there was no recent answer, so the loop holds with quotes pulled.");
  if (t.rung === "rules_only") out.push("No usable Jev answer: rules-only quoting. Directional trades need a fresh Jev answer.");

  if (!isVetoed(t) && t.action !== "HOLD_LATE") {
    const leg = t.orders.find((o) => o.purpose === "leg");
    const need = thresholds.direction_confidence_threshold;
    if (leg) {
      out.push(`${leg.status === "shadow" ? "Would take" : "Took"} a directional ${leg.side} of ${leg.qty} at market${leg.status === "rejected" ? " (rejected by the broker)" : ""}.`);
    } else if (t.jev_status === "answered" || t.jev_status === "mock") {
      if (!t.direction || t.direction === "neutral") out.push("No directional trade: Jev sees no clear direction.");
      else if (t.direction_conf != null && need != null && t.direction_conf <= need)
        out.push(`No directional trade: Jev leans ${t.direction} at ${fmtPct(t.direction_conf, 0)} confidence; ${fmtPct(need, 0)} is needed.`);
      else if (t.direction === "down" && t.inventory <= 0) out.push("Jev leans down, but there is nothing to sell (cash account, no shorting).");
    } else if (t.answer_age_s) {
      out.push("No directional trade: each Jev answer is traded once; the next one decides.");
    }

    const bid = t.orders.find((o) => o.purpose === "quote_bid");
    const ask = t.orders.find((o) => o.purpose === "quote_ask");
    if (bid?.limit_price) {
      const bps = bpsFromMid(bid.limit_price, t.mid);
      out.push(`${bid.status === "shadow" ? "Would rest" : "Resting"} a bid of ${bid.qty} at ${fmtPrice(bid.limit_price)}${bps != null ? ` (${bps.toFixed(1)} bps below mid)` : ""}; it fills only if a seller comes down to it.`);
    }
    if (bid && !ask && t.inventory <= 0) out.push("No ask quote: there is nothing held to sell.");
    if (!bid && (t.action === "QUOTE_BOTH_SIDES" || t.action === "QUOTE_WIDE" || t.action === "WIDEN"))
      out.push("Quotes are unchanged this tick (they are re-placed every few ticks).");
    if (t.action === "PULL_QUOTES" || t.action === "STAND_DOWN") out.push(`Not quoting: ${t.action_reason ?? t.action.toLowerCase()}.`);
  }
  return out;
}

/** Tone of one cell in the tick strip. */
export function stripTone(t: JevTick): "trade" | "quote" | "hold" | "idle" | "kill" | "error" {
  if (t.action === "KILL") return "kill";
  if (t.orders.some((o) => o.purpose === "leg" && o.status !== "rejected")) return "trade";
  if (t.jev_status === "rate_limited" || t.jev_status === "error" || t.action === "DATA_ERROR") return "error";
  if (isVetoed(t) || t.action === "HOLD_LATE" || t.action === "MARKET_CLOSED") return "hold";
  if (t.action === "PULL_QUOTES" || t.action === "STAND_DOWN") return "idle";
  return "quote";
}

export function uptime(startedAt: string | null, endedAt: string | null, nowMs: number): string {
  if (!startedAt) return "—";
  const end = endedAt ? Date.parse(endedAt) : nowMs;
  const s = Math.max(0, Math.floor((end - Date.parse(startedAt)) / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
