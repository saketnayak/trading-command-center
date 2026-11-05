/** Dividend income (GET /portfolio/{id}/income): types and pure helpers. */

import { fmtMoney } from "./currency";

export interface IncomeHolding {
  ticker: string;
  shares: number;
  frequency: "monthly" | "quarterly" | "semi-annual" | "annual" | null;
  suspended: boolean;
  last_ex_date: string | null;
  last_amount: number | null;
  ttm_per_share: number;
  forward_per_share: number;
  annual_income: number;
  yield: number | null;
  yield_on_cost: number | null;
  next_ex_date: string | null;
  growth_5y: number | null;
  value: number | null;
}

export interface IncomeMonth {
  month: string; // YYYY-MM
  amount: number;
  payments: { ticker: string; ex_date: string; amount: number }[];
}

export interface IncomeReport {
  portfolio_id: string;
  display_currency: string;
  methodology: string;
  target_monthly: number | null;
  income_goal: "growth_only" | "some_income" | "income_first" | null;
  holdings: IncomeHolding[];
  totals: {
    annual_income: number;
    monthly_income: number;
    portfolio_value: number;
    yield: number | null;
    yield_on_cost: number | null;
    payers: number;
    holdings: number;
    growth_5y: number | null;
    goal_progress?: number;
  } | null;
  calendar: IncomeMonth[];
  received: { source: "ledger" | "estimate"; by_month: { month: string; amount: number }[]; last_12_months: number } | null;
  projection: { growth: number; yield: number; years: { year: number; without_drip: number; with_drip: number }[] } | null;
  warnings: string[];
  message: string | null;
}

/** "2026-11" → "Nov" (or "Nov 2026" with the year). */
export function monthLabel(ym: string, withYear = false): string {
  const [y, m] = ym.split("-").map(Number);
  const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return withYear ? `${name} ${y}` : name;
}

/** One-line summary for the top of the tab. */
export function incomeHeadline(r: IncomeReport): string | null {
  const t = r.totals;
  if (!t || t.annual_income <= 0) return null;
  const ccy = r.display_currency;
  return `About ${fmtMoney(t.annual_income, ccy)} a year (${fmtMoney(t.monthly_income, ccy)} a month) from ${t.payers} of ${t.holdings} holdings.`;
}

/** Goal progress, capped for the bar but reported in full in the text. */
export function goalText(r: IncomeReport): { pct: number; text: string } | null {
  const t = r.totals;
  if (!t || !r.target_monthly) return null;
  const progress = t.goal_progress ?? t.monthly_income / r.target_monthly;
  const ccy = r.display_currency;
  const gap = r.target_monthly - t.monthly_income;
  return {
    pct: Math.max(0, Math.min(1, progress)),
    text:
      gap <= 0
        ? `Goal reached: ${fmtMoney(t.monthly_income, ccy)} a month against a ${fmtMoney(r.target_monthly, ccy)} target.`
        : `${Math.round(progress * 100)}% of your ${fmtMoney(r.target_monthly, ccy)} a month goal; ${fmtMoney(gap, ccy)} a month to go.`,
  };
}

export const FREQUENCY_LABEL: Record<string, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  "semi-annual": "Twice a year",
  annual: "Yearly",
};

/** "2026-11" shifted by n months. */
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** The `count` months ending at `endYm`, oldest first, with 0 for months without income. */
export function fillMonths(byMonth: { month: string; amount: number }[], endYm: string, count: number): { month: string; amount: number }[] {
  const lookup = new Map(byMonth.map((r) => [r.month, r.amount]));
  return Array.from({ length: count }, (_, i) => {
    const month = addMonths(endYm, i - count + 1);
    return { month, amount: lookup.get(month) ?? 0 };
  });
}

/** Plain-language summary of the projection's assumptions and its 10-year end point. */
export function projectionSummary(r: IncomeReport): string | null {
  const p = r.projection;
  const last = p?.years[p.years.length - 1];
  if (!p || !last) return null;
  const ccy = r.display_currency;
  const g = `${(p.growth * 100).toFixed(1)}%`;
  return (
    `Assumes dividends and prices both grow ${g} a year (this portfolio's 5-year dividend growth, capped to −10%…15%) ` +
    `and a constant ${(p.yield * 100).toFixed(2)}% yield. In ${last.year} years: ${fmtMoney(last.without_drip, ccy)} a year taken as cash, ` +
    `or ${fmtMoney(last.with_drip, ccy)} a year with every dividend reinvested.`
  );
}
