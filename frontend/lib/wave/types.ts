export type AnalysisProfile =
  | "full_confluence"
  | "elliott_focused"
  | "fib_only"
  | "swing_only";

export interface ToolSelection {
  swing: boolean;
  elliott: boolean;
  fibonacci: boolean;
  signal: boolean;
  chart: boolean;
}

export interface AnalyzeRequest {
  symbol?: string | null;
  isin?: string | null;
  period: string;
  interval: string;
  zigzag_threshold: number;
  zigzag_price_mode: "close" | "high_low";
  tools?: ToolSelection;
  profile?: AnalysisProfile | null;
}

export interface Instrument {
  symbol: string;
  isin?: string | null;
  exchange?: string | null;
  currency?: string | null;
  asset_type?: string | null;
}

export interface Pivot {
  time: string;
  price: number;
  kind: string;
  index: number;
}

export interface WaveLeg {
  label: string;
  start_idx: number;
  end_idx: number;
  start_time: string;
  end_time: string;
  start_price: number;
  end_price: number;
}

export interface ElliottScenario {
  trend: string;
  degree: string;
  pattern: string;
  legs: WaveLeg[];
  score: number;
  status: string;
  invalidation_level: number | null;
  notes: string[];
}

export interface TradeRegion {
  direction: string;
  zone_low: number;
  zone_high: number;
  stop_level: number;
  target_levels: number[];
  rationale: string[];
  confidence: number;
}

export interface ToolOutcome {
  tool_name: string;
  enabled: boolean;
  status: string;
  headline: string;
  confidence?: number | null;
  details: string[];
}

export interface AnalysisOverview {
  active_tools: string[];
  top_scenario?: string | null;
  top_direction?: string | null;
  trade_region?: TradeRegion | null;
  tool_outcomes: ToolOutcome[];
  warnings: string[];
}

export interface OHLCVBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
}

export interface PivotOverlay {
  kind: "pivot";
  times: string[];
  prices: number[];
  labels: string[];
}

export interface WaveLegOverlay {
  kind: "wave_leg";
  start_time: string;
  end_time: string;
  start_price: number;
  end_price: number;
  label: string;
  scenario_label: string;
  color_hint?: string | null;
}

export interface ZoneOverlay {
  kind: "zone";
  y0: number;
  y1: number;
  direction: string;
  label: string;
}

export interface HorizontalLevelOverlay {
  kind: "level";
  price: number;
  label: string;
  style: "solid" | "dashed" | "dotted";
  color_hint?: string | null;
}

export interface AnnotationOverlay {
  kind: "annotation";
  time: string;
  price: number;
  text: string;
  color_hint?: string | null;
}

export type ChartOverlay =
  | PivotOverlay
  | WaveLegOverlay
  | ZoneOverlay
  | HorizontalLevelOverlay
  | AnnotationOverlay;

export interface ChartPayload {
  ohlcv: OHLCVBar[];
  pivots: Pivot[];
  overlays: ChartOverlay[];
  scenarios: ElliottScenario[];
  trade_regions: TradeRegion[];
}

export interface ChartVisibilityOptions {
  waves: boolean;
  fibonacci: boolean;
  pivots: boolean;
  showAllHistory: boolean;
}

export interface AnalyzeResponse {
  instrument: Instrument;
  top_scenarios: ElliottScenario[];
  trade_regions: TradeRegion[];
  overview?: AnalysisOverview | null;
  chart: ChartPayload;
}
