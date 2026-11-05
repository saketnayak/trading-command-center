/** Alerts (/alerts API): types, rule-kind catalogue and pure helpers. */

export type AlertKind =
  | "price_above"
  | "price_below"
  | "daily_move"
  | "ma_cross"
  | "regime_change"
  | "verdict_change"
  | "portfolio_drawdown"
  | "position_weight"
  | "compound";

/** Params as stored: flat numbers/strings for single kinds, nested for compound. */
export type AlertParams = Record<string, unknown>;

export type CompoundCondition =
  | { type: "price_above" | "price_below"; price: number }
  | { type: "daily_move"; pct: number; direction: "any" | "up" | "down" }
  | { type: "ma"; window: 50 | 200; direction: "above" | "below" }
  | { type: "regime"; regime: "Bull" | "Sideways" | "Bear" }
  | { type: "verdict"; verdict: "buy" | "hold" | "sell" }
  | { type: "weight_above"; pct: number };

export interface CompoundParams {
  op: "and" | "or";
  scope: "ticker" | "holdings";
  sectors: string[];
  conditions: CompoundCondition[];
}

export const ALERT_UNREAD_QUERY_KEY = ["alerts-unread"] as const;
export const ALERT_RULES_QUERY_KEY = ["alert-rules"] as const;
export const ALERT_EVENTS_QUERY_KEY = ["alert-events"] as const;

export type AlertChannel = "inbox" | "email" | "webhook";

export interface AlertRule {
  id: string;
  kind: AlertKind;
  kind_label: string;
  ticker: string | null;
  portfolio_id: string | null;
  portfolio_name: string | null;
  params: AlertParams;
  channels: AlertChannel[];
  cooldown_hours: number;
  enabled: boolean;
  rerun_analysis: boolean;
  state: Record<string, unknown> | null;
  last_checked_at: string | null;
  last_triggered_at: string | null;
  last_error: string | null;
  created_at: string | null;
}

export interface AlertEvent {
  id: string;
  rule_id: string | null;
  kind: AlertKind;
  ticker: string | null;
  portfolio_id: string | null;
  title: string;
  message: string;
  data: Record<string, unknown> | null;
  delivery: Record<string, string> | null;
  /** Analyses the rule's "re-run" action started (or linked), with their current status. */
  analyses: AlertAnalysis[];
  triggered_at: string | null;
  read_at: string | null;
}

export interface AlertAnalysis {
  ticker: string;
  run_id: string;
  source: "started" | "recent";
  status: "pending" | "running" | "completed" | "failed" | "aborted" | "deleted";
  verdict: "buy" | "hold" | "sell" | null;
}

export interface AlertCheck {
  condition: boolean | null;
  observed: string;
  would_fire: boolean;
  note: string;
}

export interface CreateAlertRuleRequest {
  kind: AlertKind;
  ticker?: string | null;
  portfolio_id?: string | null;
  params: AlertParams;
  channels: AlertChannel[];
  cooldown_hours: number;
  rerun_analysis?: boolean;
}

/** POST /alerts/compile: a proposed rule (never saved by the server). */
export interface CompiledRule extends CreateAlertRuleRequest {
  ticker: string | null;
  portfolio_id: string | null;
  portfolio_name: string | null;
  enabled: boolean;
  rerun_analysis: boolean;
}

export interface CompileResult {
  ok: boolean;
  rule: CompiledRule | null;
  /** Parts of the sentence the rule format can't express (left out of the rule). */
  unsupported: string[];
  /** Why the sentence couldn't become a valid rule. */
  problems: string[];
  /** The rule watches a portfolio and the user has several: they must choose one. */
  needs_portfolio: boolean;
  llm: string;
}

export type ParamField =
  | { name: string; label: string; type: "number"; min?: number; max?: number; step?: number; suffix?: string; default?: number }
  | { name: string; label: string; type: "select"; options: { value: string; label: string }[]; default: string };

export interface KindOption {
  kind: AlertKind;
  label: string;
  scope: "ticker" | "portfolio";
  group: "Price" | "Signals" | "Portfolio";
  fields: ParamField[];
  hint: string;
}

export const ALERT_KINDS: KindOption[] = [
  {
    kind: "price_above", label: "Price rises above", scope: "ticker", group: "Price",
    fields: [{ name: "price", label: "Price", type: "number", min: 0, step: 0.01 }],
    hint: "Fires when the price moves above the level, then re-arms once it drops back below.",
  },
  {
    kind: "price_below", label: "Price falls below", scope: "ticker", group: "Price",
    fields: [{ name: "price", label: "Price", type: "number", min: 0, step: 0.01 }],
    hint: "Fires when the price moves below the level, then re-arms once it recovers.",
  },
  {
    kind: "daily_move", label: "Big daily move", scope: "ticker", group: "Price",
    fields: [{ name: "pct", label: "Move of at least", type: "number", min: 0.1, max: 100, suffix: "%", default: 5 }],
    hint: "Up or down versus the previous close. At most once per day.",
  },
  {
    kind: "ma_cross", label: "Crosses its moving average", scope: "ticker", group: "Price",
    fields: [
      { name: "direction", label: "Closes", type: "select", default: "below",
        options: [{ value: "below", label: "below" }, { value: "above", label: "above" }] },
      { name: "window", label: "its", type: "select", default: "200",
        options: [{ value: "200", label: "200-day average" }, { value: "50", label: "50-day average" }] },
    ],
    hint: "Checked on daily closes.",
  },
  {
    kind: "regime_change", label: "Markov regime changes", scope: "ticker", group: "Signals",
    fields: [{ name: "to", label: "Into", type: "select", default: "any",
      options: [{ value: "any", label: "any regime" }, { value: "Bear", label: "Bear" },
        { value: "Sideways", label: "Sideways" }, { value: "Bull", label: "Bull" }] }],
    hint: "Records today's regime first, then fires when it changes.",
  },
  {
    kind: "verdict_change", label: "AI verdict changes", scope: "ticker", group: "Signals", fields: [],
    hint: "Fires when a new completed analysis changes BUY / HOLD / SELL.",
  },
  {
    kind: "portfolio_drawdown", label: "Portfolio falls from its peak", scope: "portfolio", group: "Portfolio",
    fields: [{ name: "pct", label: "Down at least", type: "number", min: 1, max: 100, step: 1, suffix: "%", default: 10 }],
    hint: "Measured on the Performance tab's 1-year series.",
  },
  {
    kind: "position_weight", label: "A holding gets too big", scope: "portfolio", group: "Portfolio",
    fields: [{ name: "pct", label: "Above", type: "number", min: 1, max: 100, step: 1, suffix: "% of the portfolio", default: 25 }],
    hint: "Fires for each holding that newly crosses the limit.",
  },
];

export function kindOption(kind: AlertKind): KindOption {
  return ALERT_KINDS.find((k) => k.kind === kind) ?? ALERT_KINDS[0];
}

export function defaultParams(kind: AlertKind): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const f of kindOption(kind).fields) {
    if (f.default !== undefined) out[f.name] = f.default;
  }
  return out;
}

/** Turn form values into the API's params (numbers stay numbers, the MA window is an int). */
export function toApiParams(kind: AlertKind, values: Record<string, number | string>): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const f of kindOption(kind).fields) {
    const v = values[f.name];
    if (v === undefined || v === "") continue;
    out[f.name] = f.type === "number" || (kind === "ma_cross" && f.name === "window") ? Number(v) : v;
  }
  return out;
}

function fmtLevel(n: unknown): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n);
  return Math.abs(x) >= 1 ? x.toLocaleString(undefined, { maximumFractionDigits: 2 }) : x.toPrecision(3);
}

function joinList(parts: string[], word: "and" | "or"): string {
  if (parts.length <= 2) return parts.join(` ${word} `);
  return `${parts.slice(0, -1).join(", ")}, ${word} ${parts[parts.length - 1]}`;
}

/** A condition as a verb phrase for its subject ("NVDA …", "Any holding …"). */
export function describeCondition(c: CompoundCondition, portfolioName?: string | null): string {
  switch (c.type) {
    case "price_above":
      return `trades above ${fmtLevel(c.price)}`;
    case "price_below":
      return `trades below ${fmtLevel(c.price)}`;
    case "daily_move":
      return `${c.direction === "up" ? "rises" : c.direction === "down" ? "falls" : "moves"} ${c.pct}% or more in a day`;
    case "ma":
      return `closes ${c.direction} its ${c.window}-day average`;
    case "regime":
      return `is in a ${c.regime} Markov regime`;
    case "verdict":
      return `has a ${c.verdict.toUpperCase()} AI verdict`;
    case "weight_above":
      return `is over ${c.pct}% of ${portfolioName ?? "the portfolio"}`;
    default:
      return "matches an unknown condition";
  }
}

export function asCompound(params: AlertParams): CompoundParams {
  const p = params as Partial<CompoundParams>;
  return {
    op: p.op === "or" ? "or" : "and",
    scope: p.scope === "holdings" ? "holdings" : "ticker",
    sectors: Array.isArray(p.sectors) ? p.sectors : [],
    conditions: Array.isArray(p.conditions) ? p.conditions : [],
  };
}

/** Who a compound rule is about: "NVDA", "Any holding in Core", "Any Semiconductors holding in Core". */
export function compoundSubject(params: CompoundParams, ticker: string | null, portfolioName: string | null): string {
  if (params.scope !== "holdings") return ticker ?? "";
  const where = portfolioName ?? "the portfolio";
  return params.sectors.length ? `Any ${joinList(params.sectors, "or")} holding in ${where}` : `Any holding in ${where}`;
}

/** How the rule fires, in one sentence (mirrors the engine's semantics). */
export function firingNote(r: Pick<AlertRule, "kind" | "params">): string {
  if (r.kind === "compound") {
    const p = asCompound(r.params);
    if (p.scope === "holdings") return "Fires for each holding that starts matching, then re-arms once it stops.";
    return p.op === "and" && p.conditions.length > 1
      ? "Fires when all of these become true together, then re-arms once any is false."
      : "Fires when this becomes true, then re-arms once it is false again.";
  }
  if (r.kind === "regime_change" || r.kind === "verdict_change") {
    return "Records the current value first, then fires when it changes.";
  }
  return "Fires when this becomes true, then re-arms once it is false again.";
}

/** One plain sentence describing what a rule watches. */
export function describeRule(r: Pick<AlertRule, "kind" | "ticker" | "params" | "portfolio_name">): string {
  const t = r.ticker ?? "";
  const p = r.params as Record<string, string | number>;
  const name = r.portfolio_name ?? "the portfolio";
  switch (r.kind) {
    case "price_above":
      return `${t} rises above ${fmtLevel(p.price)}`;
    case "price_below":
      return `${t} falls below ${fmtLevel(p.price)}`;
    case "daily_move":
      return `${t} moves ${p.pct}% or more in a day`;
    case "ma_cross":
      return `${t} closes ${p.direction} its ${p.window}-day average`;
    case "regime_change":
      return p.to === "any" ? `${t}'s Markov regime changes` : `${t}'s Markov regime turns ${p.to}`;
    case "verdict_change":
      return `${t}'s AI verdict changes`;
    case "portfolio_drawdown":
      return `${name} falls ${p.pct}% from its peak`;
    case "position_weight":
      return `A holding in ${name} grows past ${p.pct}%`;
    case "compound": {
      const c = asCompound(p);
      const parts = c.conditions.map((x) => describeCondition(x, r.portfolio_name));
      return `${compoundSubject(c, r.ticker, r.portfolio_name)} ${joinList(parts, c.op)}`;
    }
    default:
      return r.kind;
  }
}

/** Whether the "re-run the analysis" action applies (it needs tickers to analyse). */
export function canRerun(kind: AlertKind): boolean {
  return kind !== "portfolio_drawdown";
}

/** Does this (proposed) rule need a portfolio before it can be saved? */
export function needsPortfolio(r: Pick<CreateAlertRuleRequest, "kind" | "params">): boolean {
  if (r.kind === "portfolio_drawdown" || r.kind === "position_weight") return true;
  if (r.kind !== "compound") return false;
  const p = asCompound(r.params);
  return p.scope === "holdings" || p.conditions.some((c) => c.type === "weight_above");
}

/** The approved proposal as the body for POST /alerts/rules. */
export function compiledToRequest(r: CompiledRule): CreateAlertRuleRequest {
  return {
    kind: r.kind, ticker: r.ticker, portfolio_id: r.portfolio_id, params: r.params,
    channels: r.channels, cooldown_hours: r.cooldown_hours, rerun_analysis: r.rerun_analysis,
  };
}

/** Text for an analysis link on an inbox event. */
export function analysisLabel(a: AlertAnalysis): string {
  if (a.status === "completed") return `${a.ticker} analysis: ${a.verdict ? a.verdict.toUpperCase() : "done"}`;
  if (a.status === "pending" || a.status === "running") return `${a.ticker} analysis running…`;
  return `${a.ticker} analysis ${a.status}`;
}

/** A part of the sentence the compiler couldn't express, for the "couldn't" list. */
export function unsupportedLabel(u: string): string {
  const m = /^missing:\s*(.*)$/i.exec(u.trim());
  return m ? `Missing: ${m[1]}` : `Not understood: ${u}`;
}

export const CHANNEL_LABELS: Record<AlertChannel, string> = {
  inbox: "In-app",
  email: "Email",
  webhook: "Portfolio webhook",
};

/** Delivery problems worth surfacing on an event (anything not sent/delivered).
 * The re-run action's outcome counts only when something was skipped or failed. */
export function deliveryIssues(delivery: Record<string, string> | null): string[] {
  return Object.entries(delivery ?? {})
    .filter(([k, v]) => (k === "analysis" ? /skipped|failed|over the limit/.test(v) : v !== "sent" && v !== "delivered"))
    .map(([k, v]) => `${k === "analysis" ? "Analysis re-run" : (CHANNEL_LABELS[k as AlertChannel] ?? k)}: ${v}`);
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", else the date. */
export function timeAgo(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "never";
  const then = new Date(iso);
  const s = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return then.toISOString().slice(0, 10);
}
