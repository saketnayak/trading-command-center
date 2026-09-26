export type JevMode = "shadow" | "paper";
export type JevSessionStatus = "running" | "completed" | "stopped" | "killed" | "failed" | "interrupted";

export interface JevSession {
  id: string;
  created_by: string;
  symbol: string;
  mode: JevMode;
  status: JevSessionStatus | "stopping";
  force_mock: boolean;
  thresholds: Record<string, number>;
  limits: Record<string, number>;
  max_ticks: number | null;
  max_duration_s: number;
  order_prefix: string;
  decision_route: string | null;
  decision_model: string | null;
  start_equity_usd: number | null;
  tick_count: number;
  inventory: number;
  realised_pnl_usd: number;
  last_mid: number | null;
  fills: number;
  orders_submitted: number;
  orders_rejected: number;
  cost_usd: number;
  stop_reason: string | null;
  started_at: string | null;
  stopped_at: string | null;
  created_at: string | null;
}

export interface JevOrder {
  purpose: "quote_bid" | "quote_ask" | "leg";
  side: "buy" | "sell";
  type: "limit" | "market";
  qty: number;
  limit_price: number | null;
  status: "shadow" | "sent" | "rejected" | "skipped";
  error?: string;
}

interface JevNoulAnswer {
  type: "noul";
  noul: number;
}

interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

interface JevScoreAnswer {
  type: "score";
  score: number;
  probabilities: Record<string, number>;
  confidence: number;
  legend?: Record<string, string>;
}

export interface JevAnswers {
  regime: JevChoiceAnswer;
  direction: JevChoiceAnswer;
  toxic_flow: JevNoulAnswer;
  liquidity_stressed: JevNoulAnswer;
  quote_environment: JevScoreAnswer;
  inventory_pressure: JevScoreAnswer;
  execution_health: JevScoreAnswer;
}

export interface JevTick {
  tick: number;
  ts: number;
  mid: number | null;
  spread_bps: number | null;
  action: string;
  action_reason: string | null;
  rung: string;
  direction_leg: string | null;
  direction: string | null;
  direction_conf: number | null;
  latency_ms: number | null;
  route: string | null;
  model: string | null;
  inventory: number;
  unrealised_pnl_usd: number | null;
  realised_pnl_usd: number | null;
  drawdown_pct: number | null;
  fill: string | null;
  orders: JevOrder[];
  answers?: JevAnswers | null;
  snapshot?: Record<string, unknown> | null;
}

export interface JevSessionSummary {
  tick_count: number;
  inventory: number;
  realised_pnl_usd: number;
  last_mid: number | null;
  fills: number;
  orders_submitted: number;
  orders_rejected: number;
  decision_route: string | null;
  decision_model: string | null;
  cost_usd: number;
  start_equity_usd: number;
}

export type JevStreamMessage =
  | { type: "tick"; tick: JevTick; summary: JevSessionSummary }
  | { type: "status"; status: JevSessionStatus; reason: string | null; summary: JevSessionSummary };

export interface JevMeta {
  split: { deterministic: [string, string][]; probabilistic: [string, string][] };
  limits: Record<string, number>;
  lowerable_limits: string[];
  thresholds: Record<string, number>;
  threshold_names: string[];
  max_active_sessions: number;
}

export interface JevSymbolSpec {
  symbol: string;
  asset_class: "crypto" | "us_equity";
  is_24_7: boolean;
  has_depth: boolean;
  min_notional_usd: number;
  qty_precision: number;
}

export interface JevCalibration {
  horizon: number;
  n: number;
  brier: number | null;
  bins: { bin: string; n: number; mean_predicted: number | null; empirical: number | null }[];
}

export interface CreateJevSessionRequest {
  symbol: string;
  mode: JevMode;
  max_ticks?: number | null;
  max_duration_minutes: number;
  thresholds: Record<string, number>;
  limits: Record<string, number>;
  force_mock: boolean;
}
