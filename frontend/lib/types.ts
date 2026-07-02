import type { ResponseLanguage } from "./responseLanguage";

export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  preferred_currency: string;
  default_llm_provider: string;
  default_llm_model: string | null;
  default_llm_depth: "quick" | "standard" | "deep";
}

export interface Run {
  id: string;
  ticker: string;
  analysis_date: string;
  llm_provider: string;
  llm_model: string;
  depth: "quick" | "standard" | "deep";
  analysts: string[];
  response_language: ResponseLanguage;
  label: string | null;
  notes: string | null;
  status: "pending" | "running" | "completed" | "aborted" | "failed";
  verdict: "buy" | "sell" | "hold" | null;
  archived: boolean;
  created_by: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  suggested_entry: string | null;
  suggested_stop: string | null;
  suggested_target: string | null;
  price_currency: string | null;
}

export interface AgentEventPayload {
  type: "started" | "token" | "completed" | "error" | "run_completed" | "run_aborted";
  agent?: string;
  token?: string;
  summary?: string;
  message?: string;
  sequence?: number;
  run_id?: string;
}

export interface Report {
  id: string;
  run_id: string;
  trader_decision: string;
  verdict: "buy" | "sell" | "hold";
  suggested_entry: string | null;
  suggested_stop: string | null;
  suggested_target: string | null;
  price_currency: string | null;
  risk_assessment: string;
  raw_report: Record<string, unknown>;
}

export interface ApiKeyStatus {
  provider: string;
  is_valid: boolean;
  validated_at: string | null;
  masked_key: string;
  capabilities?: Record<string, FinnhubCapabilityStatus> | null;
  last_error_code?: FinnhubUnavailableReason | null;
  last_error_message?: string | null;
  capabilities_checked_at?: string | null;
}

export type FinnhubUnavailableReason =
  | "no_finnhub_key"
  | "invalid_key"
  | "access_denied"
  | "premium_required"
  | "rate_limited"
  | "provider_unavailable"
  | "malformed_response";

export interface FinnhubCapabilityStatus {
  ok: boolean;
  reason?: FinnhubUnavailableReason | null;
  message?: string | null;
}

export interface ProviderWarning {
  provider: string;
  capability: string;
  reason: FinnhubUnavailableReason;
  message: string;
}

export interface RunStats {
  total: number;
  verdicts: { buy: number; sell: number; hold: number };
  completed: number;
  failed: number;
  avg_duration_secs: number;
}

export interface CreateRunRequest {
  ticker: string;
  analysis_date: string;
  llm_provider: string;
  llm_model: string;
  depth: string;
  analysts: string[];
  response_language?: ResponseLanguage;
  label?: string;
}

export interface RunWithReport {
  run: Run;
  report: Report | null;
}

export interface CompareResult {
  a: RunWithReport;
  b: RunWithReport;
}

export interface RunOutcome {
  id: string;
  run_id: string;
  ticker: string;
  verdict: string;
  analysis_date: string;
  price_at_analysis: number | null;
  price_7d: number | null;
  price_14d: number | null;
  price_30d: number | null;
  price_90d: number | null;
  price_currency: string;
  created_at: string;
  updated_at: string;
}

export interface WatchlistItem {
  id: string;
  watchlist_id: string;
  ticker: string;
  llm_provider: string;
  llm_model: string;
  depth: string;
  analysts: string[];
  response_language: ResponseLanguage;
  schedule_cron: string | null;
  enabled: boolean;
  last_run_at: string | null;
  last_run_id: string | null;
  next_run_at: string | null;
  added_at: string;
}

export interface Watchlist {
  id: string;
  created_by: string;
  name: string;
  items: WatchlistItem[];
  created_at: string;
}

export interface AddWatchlistItemRequest {
  ticker: string;
  llm_provider: string;
  llm_model: string;
  depth: string;
  analysts: string[];
  response_language?: ResponseLanguage;
  schedule_cron?: string | null;
}

export interface SchedulerJobsResponse {
  running: boolean;
  state?: string;
  jobs: Array<{ id: string; next_fire_time: string | null }>;
}

export interface PerformanceStats {
  total: number;
  accuracy_7d: number | null;
  accuracy_14d: number | null;
  accuracy_30d: number | null;
  accuracy_90d: number | null;
  outcomes: Array<{
    run_id: string;
    ticker: string;
    verdict: string;
    analysis_date: string;
    price_at_analysis: number | null;
    price_7d: number | null;
    price_14d: number | null;
    price_30d: number | null;
    price_90d: number | null;
  }>;
}

export interface Portfolio {
  id: string;
  name: string;
  created_at: string;
  last_snapshot_at: string | null;
  holding_count: number;
}

export interface PortfolioSnapshot {
  id: string;
  portfolio_id: string;
  uploaded_at: string;
  broker: string | null;
  row_count: number;
}

export interface PortfolioHoldingLastRun {
  run_id: string;
  verdict: string;
  analysis_date: string;
  suggested_entry: string | null;
  suggested_stop: string | null;
  suggested_target: string | null;
  previous_run_id?: string | null;
  previous_verdict?: string | null;
  previous_analysis_date?: string | null;
}

export type TrimLevel = "none" | "watch" | "consider_trim" | "strong_trim";

export interface TrimSignalEntry {
  holding_id: string;
  ticker: string;
  level: TrimLevel;
  score: number;
  reasons: string[];
  unrealized_pnl_pct: number | null;
  current_verdict: string | null;
  regime: "Bull" | "Sideways" | "Bear" | null;
  regime_signal: number | null;
}

export interface TrimSignalsResponse {
  entries: TrimSignalEntry[];
  computed_at: string;
}

export interface TickerChart {
  t: number[];
  c: number[];
  h?: number[];
  l?: number[];
}

export interface TickerSnapshot {
  ticker: string;
  asset_type: "stock" | "crypto";
  name: string | null;
  description: string | null;
  sector: string | null;
  website: string | null;
  logo: string | null;
  exchange: string | null;
  country: string | null;
  change_1d_pct: number | null;
  change_1w_pct: number | null;
  change_1m_pct: number | null;
  fundamentals: Record<string, number | string | null>;
  chart: TickerChart;
  news: Array<{
    headline: string;
    url: string;
    datetime: number | null;
    source: string;
    image: string;
  }>;
  next_earnings: {
    date: string | null;
    eps_estimate: number | null;
    eps_actual: number | null;
    hour: string | null;
  } | null;
  provider_warnings?: ProviderWarning[];
}

export interface TickerMetadata {
  ticker: string;
  asset_type: "stock" | "crypto" | string;
  company_name: string | null;
  display_name: string | null;
  sector: string | null;
  industry: string | null;
  logo_url: string | null;
  website: string | null;
  exchange: string | null;
  country: string | null;
  currency: string | null;
  market_cap: number | null;
  ipo_date: string | null;
  source: string;
  fetched_at: string;
  expires_at: string;
}

export interface TickerMetadataResponse {
  items: Record<string, TickerMetadata>;
}

export interface PortfolioHolding {
  id: string;
  ticker: string;
  shares: number;
  avg_cost: number | null;
  cost_basis_currency: string;
  quote_currency: string | null;
  /** @deprecated use cost_basis_currency */
  currency: string;
  current_price: number | null;
  market_value: number | null;
  unrealized_pnl: number | null;
  unrealized_pnl_pct: number | null;
  pnl_unavailable_reason: string | null;
  last_run: PortfolioHoldingLastRun | null;
}

export interface PortfolioTotals {
  market_value: number | null;
  unrealized_pnl: number | null;
  unrealized_pnl_pct: number | null;
}

export interface PortfolioCurrentResponse {
  snapshot: PortfolioSnapshot | null;
  price_unavailable_reason: string | null;
  display_currency: string;
  portfolio_currencies: string[];
  totals_currency: string | null;
  totals: PortfolioTotals;
  holdings: PortfolioHolding[];
}

export type InsightStatus = "pending" | "running" | "completed" | "failed";
export type InsightTrigger = "scheduled" | "manual";
export type InsightStance = "bullish" | "bearish" | "neutral" | "mixed";

export interface InsightActionItem {
  ticker: string;
  action: "BUY_MORE" | "TRIM" | "EXIT" | "WATCH" | "REANALYZE";
  priority: "high" | "medium" | "low";
  rationale: string;
}

export interface InsightRiskAlert {
  type: "concentration" | "drawdown" | "stale_analysis" | "no_analysis" | "sector_overweight" | "correlated_positions";
  severity: "critical" | "warning" | "info";
  description: string;
  affected_tickers: string[];
}

export interface PortfolioInsight {
  id: string;
  portfolio_id: string;
  generated_at: string;
  status: InsightStatus;
  trigger: InsightTrigger;
  llm_provider: string;
  llm_model: string;
  health_score: number | null;
  overall_stance: InsightStance | null;
  summary: string | null;
  action_items: InsightActionItem[] | null;
  risk_alerts: InsightRiskAlert[] | null;
  sector_analysis: Record<string, number> | null;
  strengths: string[] | null;
  weaknesses: string[] | null;
  holdings_snapshot: Record<string, unknown> | null;
  error: string | null;
}

export interface GenerateInsightRequest {
  llm_provider: string;
  llm_model: string;
}

export interface PortfolioEarningsResponse {
  events: EarningsEvent[];
  earnings_unavailable_reason: FinnhubUnavailableReason | null;
}

export interface PortfolioFundamentalsResponse {
  data: Record<string, FundamentalsData>;
  fundamentals_unavailable_reason: FinnhubUnavailableReason | null;
}

export interface PortfolioNewsResponse {
  articles: NewsArticle[];
  news_unavailable_reason: FinnhubUnavailableReason | null;
}

export interface EarningsEvent {
  date: string;
  ticker: string;
  eps_estimate: number | null;
  eps_actual: number | null;
  revenue_estimate: number | null;
  revenue_actual: number | null;
  quarter_ending: string | null;
}

export interface FundamentalsData {
  asset_type?: "stock" | "crypto";
  // Stock fields
  pe_ratio?: number | null;
  beta?: number | null;
  week52_high?: number | null;
  week52_low?: number | null;
  dividend_yield?: number | null;
  eps_ttm?: number | null;
  market_cap?: number | null;
  peg_ratio?: number | null;
  eps_growth_3y?: number | null;
  // Crypto fields
  volume_24h?: number | null;
  circulating_supply?: number | null;
  all_time_high?: number | null;
  price_change_24h_pct?: number | null;
  price_change_7d_pct?: number | null;
  category?: string | null;
}

export interface WaveSummary {
  ticker: string;
  top_scenario: string | null;
  top_direction: string | null;
  pattern: string | null;
  trend: string | null;
  scenario_score: number | null;
  invalidation_level: number | null;
  confidence: number | null;
  zone_low: number | null;
  zone_high: number | null;
  /** Recent daily closes for compact sparkline thumbnails (newest last). */
  sparkline?: number[];
  currency: string | null;
  warnings: string[];
  computed_at: string;
}

export interface RegimeData {
  ticker: string;
  current_regime: "Bull" | "Sideways" | "Bear";
  signal: number;           // -1.0 to +1.0
  persistence: number;      // 0.0 to 1.0
  next_state_probs: {
    bear: number;
    sideways: number;
    bull: number;
  };
  stationary: {
    bear: number;
    sideways: number;
    bull: number;
  };
  transition_matrix: number[][];   // 3x3, row order: Bear / Sideways / Bull
  walk_forward: {
    sharpe: number | null;
    max_drawdown: number | null;
  };
  hmm: {
    available: boolean;
    regimes?: Array<{ label: string; mean_return: number }>;
  } | null;
  computed_at: string;
}

export interface KalmanData {
  ticker: string;
  start: string;
  end: string | null;
  interval: string;
  mode: "causal" | "historical";
  real_time: boolean;
  transition_covariance: number[][];
  observation_covariance: number[][];
  latest_price: number;
  kalman_price: number;
  kalman_trend: number;
  filtered_trend: number;
  smoothed_trend: number;
  signal: number;
  trend_direction: "up" | "down" | "flat";
  observations: number;
  chart: {
    dates: string[];
    price: number[];
    kalman_price: number[];
    kalman_trend: number[];
  };
  computed_at: string;
  currency: string;
}

export interface NewsArticle {
  ticker: string;
  datetime: number;
  headline: string;
  source: string;
  url: string;
  summary: string;
  image: string;
}

export interface BatchRunResult {
  queued: { ticker: string; run_id: string }[];
  skipped: string[];
  message: string;
}

export interface MarketTicker {
  ticker: string;
  name: string | null;
  sector: string | null;
  logo: string | null;
  price: number | null;
  change_pct: number | null;
  change: number | null;
  high: number | null;
  low: number | null;
  prev_close: number | null;
  market_cap: number | null;
}

export interface MoversResponse {
  gainers: MarketTicker[];
  losers: MarketTicker[];
}

export interface SectorData {
  sector: string;
  ticker: string;
  price: number | null;
  change_pct: number | null;
}

export interface InvestorProfile {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string | null;
  income_range: string | null;
  liquidity_reserve: string | null;
  dependents: number | null;
  time_horizon: string | null;
  risk_willingness: number | null;
  risk_ability: string | null;
  investment_style: string | null;
  sizing_approach: string | null;
  preferred_sectors: string[] | null;
  blind_spots: string | null;
  emotional_tendencies: string | null;
  personal_rules: string | null;
  anti_portfolio: string[] | null;
  target_portfolio_size: string | null;
  income_goal: string | null;
  milestones: string | null;
}

export interface InvestorProfileUpsertRequest {
  income_range?: string | null;
  liquidity_reserve?: string | null;
  dependents?: number | null;
  time_horizon?: string | null;
  risk_willingness?: number | null;
  risk_ability?: string | null;
  investment_style?: string | null;
  sizing_approach?: string | null;
  preferred_sectors?: string[] | null;
  blind_spots?: string | null;
  emotional_tendencies?: string | null;
  personal_rules?: string | null;
  anti_portfolio?: string[] | null;
  target_portfolio_size?: string | null;
  income_goal?: string | null;
  milestones?: string | null;
}

export interface ThesisCrossRefPosition {
  ticker: string;
  reason: string;
}

export interface ThesisCrossRefRecommendation {
  action: "TRIM" | "EXIT" | "CONSIDER" | "HOLD";
  ticker: string;
  rationale: string;
}

export interface ThesisCrossRef {
  id: string;
  portfolio_id: string;
  created_at: string;
  llm_provider: string;
  llm_model: string;
  thesis_text_preview: string;
  alignment_score: number | null;
  thesis_summary: string | null;
  aligned_positions: ThesisCrossRefPosition[] | null;
  misaligned_positions: ThesisCrossRefPosition[] | null;
  missing_exposure: string[] | null;
  excess_exposure: string[] | null;
  recommendations: ThesisCrossRefRecommendation[] | null;
  summary: string | null;
  holdings_snapshot: Record<string, unknown> | null;
  error: string | null;
}

export interface BehavioralAlert {
  type: "ignored_sell_signal" | "concentration_drift" | "complacency" | "repeated_action_item";
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  affected_tickers: string[];
  suggested_action: string;
  // optional fields depending on type
  days?: number;
  current_weight_pct?: number;
  threshold_pct?: number;
  days_since_last_run?: number | null;
  unanalyzed_count?: number;
  total_holdings?: number;
  consecutive_count?: number;
  first_seen_date?: string;
}

export interface BehavioralAlertsResponse {
  alerts: BehavioralAlert[];
  alert_count: number;
  critical_count: number;
  warning_count: number;
  info_count: number;
}

export interface DeliverySettings {
  email_enabled: boolean;
  email_address: string | null;
  webhook_enabled: boolean;
  webhook_url: string | null;
  webhook_format: "json" | "slack" | "telegram";
  telegram_chat_id: string | null;
  delivery_timezone: string;
}

export interface UpdateDeliverySettingsRequest {
  email_enabled?: boolean;
  email_address?: string | null;
  webhook_enabled?: boolean;
  webhook_url?: string | null;
  webhook_format?: "json" | "slack" | "telegram";
  telegram_chat_id?: string | null;
  delivery_timezone?: string;
}
