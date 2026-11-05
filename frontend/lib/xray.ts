export interface XrayVia {
  fund: string;
  weight: number;
}

export interface XrayExposure {
  key: string;
  ticker: string | null;
  name: string;
  direct: number;
  via: XrayVia[];
  total: number;
}

export interface XrayFund {
  ticker: string;
  name: string;
  weight: number;
  source: "sec_nport" | "yahoo_top10" | null;
  as_of: string | null;
  holdings_known: number;
  covered_weight: number;
}

export interface XraySector {
  sector: string;
  direct: number;
  via_funds: number;
  total: number;
}

export interface XrayConcentration {
  hhi: number | null;
  effective_holdings: number | null;
  top1_weight: number | null;
  top5_weight: number | null;
  holdings: number;
}

export interface XrayReport {
  display_currency: string;
  holdings: number;
  funds: XrayFund[];
  fund_weight: number;
  uncovered_weight: number;
  exposures: XrayExposure[];
  sentences?: Record<string, string>;
  sectors: XraySector[];
  overlap: { tickers: string[]; matrix: number[][] };
  concentration: { as_held: XrayConcentration; look_through: XrayConcentration };
  no_price: string[];
  pending: string[];
  failed: Record<string, string>;
  last_updated_at: string | null;
  syncing: boolean;
  full_holdings_available: boolean;
}

export const xrayQueryKey = (portfolioId: string) => ["xray", portfolioId] as const;

export function pct(value: number | null | undefined, digits = 1): string {
  return value == null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

export function sourceLabel(fund: Pick<XrayFund, "source" | "as_of" | "holdings_known">): string {
  if (fund.source && fund.holdings_known === 0) return "No company holdings reported";
  if (fund.source === "sec_nport") return fund.as_of ? `SEC filing, ${fund.as_of}` : "SEC filing";
  if (fund.source === "yahoo_top10") return "Yahoo, top holdings only";
  return "No holdings data yet";
}

/** The exposures worth a sentence: those a look at the tickers alone would miss. */
export function hiddenExposures(rows: XrayExposure[], count = 3): XrayExposure[] {
  return rows.filter((r) => r.via.length > 0).slice(0, count);
}

/** Rows that would round to 0.0% add nothing. */
export function visibleExposures(rows: XrayExposure[]): XrayExposure[] {
  return rows.filter((r) => r.total >= 0.0005);
}

export function viaLine(via: XrayVia[]): string {
  return via.map((v) => `${v.fund} ${pct(v.weight)}`).join(", ");
}

/** Background opacity for an overlap cell: 0 for no overlap, up to 0.7 for complete overlap. */
export function overlapOpacity(value: number): number {
  return Math.round(Math.min(Math.max(value, 0), 1) * 70) / 100;
}
