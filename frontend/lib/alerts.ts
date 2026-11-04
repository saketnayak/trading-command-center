/** Alerts (/alerts API): types, rule-kind catalogue and pure helpers. */

export type AlertKind =
  | "price_above"
  | "price_below"
  | "daily_move"
  | "ma_cross"
  | "regime_change"
  | "verdict_change"
  | "portfolio_drawdown"
  | "position_weight";

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
  params: Record<string, number | string>;
  channels: AlertChannel[];
  cooldown_hours: number;
  enabled: boolean;
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
  triggered_at: string | null;
  read_at: string | null;
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
  params: Record<string, number | string>;
  channels: AlertChannel[];
  cooldown_hours: number;
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
    fields: [{ name: "pct", label: "Move of at least", type: "number", min: 0.1, max: 100, step: 0.5, suffix: "%", default: 5 }],
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

/** One plain sentence describing what a rule watches. */
export function describeRule(r: Pick<AlertRule, "kind" | "ticker" | "params" | "portfolio_name">): string {
  const t = r.ticker ?? "";
  const p = r.params;
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
    default:
      return r.kind;
  }
}

export const CHANNEL_LABELS: Record<AlertChannel, string> = {
  inbox: "In-app",
  email: "Email",
  webhook: "Portfolio webhook",
};

/** Delivery problems worth surfacing on an event (anything not sent/delivered). */
export function deliveryIssues(delivery: Record<string, string> | null): string[] {
  return Object.entries(delivery ?? {})
    .filter(([, v]) => v !== "sent" && v !== "delivered")
    .map(([k, v]) => `${CHANNEL_LABELS[k as AlertChannel] ?? k}: ${v}`);
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
