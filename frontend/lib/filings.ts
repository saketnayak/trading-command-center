/** SEC filings (GET /portfolio/{id}/filings): types and pure helpers for the Filings tab and the morning brief. */

export type FilingForm = "10-K" | "10-Q" | "8-K";

export interface FilingItem {
  item: string;
  label: string;
  notable: boolean;
}

export interface DigestPoint {
  id: string;
  text: string;
  quote: string;
  /** added / removed / reworded for 10-K/10-Q risk factors; "document" for 8-Ks. */
  kind: "added" | "removed" | "reworded" | "document";
  /** Opens the filing scrolled to the quote (text fragment). */
  link: string;
}

export interface FilingDigest {
  headline: string;
  points: DigestPoint[];
  model: string | null;
}

export type DigestStatus = "pending" | "prepared" | "done" | "uncited" | "failed" | "not_applicable";

export interface Filing {
  accession: string;
  ticker: string;
  form: FilingForm;
  filed_date: string;
  report_date: string | null;
  url: string;
  items: FilingItem[];
  notable: boolean;
  summary: string | null;
  counts: { added: number; removed: number; reworded: number; unchanged: number } | null;
  prev: { form: string; filed_date: string; url: string } | null;
  digest: FilingDigest | null;
  digest_status: DigestStatus;
}

export interface InsiderTrade {
  date: string | null;
  owner: string | null;
  role: string | null;
  code: string;
  label: string;
  shares: number;
  price: number | null;
  value: number | null;
  planned: boolean;
  url: string;
}

export interface InsiderSummary {
  ticker: string;
  buys: number;
  sells: number;
  buy_value: number;
  sell_value: number;
  net_value: number;
  planned_sells: number;
  planned_sell_value: number;
  buyers: string[];
  sellers: string[];
  other_transactions: number;
  recent: InsiderTrade[];
}

export interface FilingsReport {
  days: number;
  covered: string[];
  no_filer: string[];
  never_synced: string[];
  sync_errors: Record<string, string>;
  last_synced_at: string | null;
  filings: Filing[];
  insiders: InsiderSummary[];
  syncing: boolean;
  llm_available: boolean;
  needs_contact: boolean;
  holdings: number;
}

export const filingsQueryKey = (portfolioId: string, days: number) => ["filings", portfolioId, days] as const;

export type FormFilter = "all" | "periodic" | "current";

export const FORM_FILTERS: { id: FormFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "periodic", label: "10-K & 10-Q" },
  { id: "current", label: "8-K" },
];

export function filterFilings(filings: Filing[], filter: FormFilter): Filing[] {
  if (filter === "periodic") return filings.filter((f) => f.form === "10-K" || f.form === "10-Q");
  if (filter === "current") return filings.filter((f) => f.form === "8-K");
  return filings;
}

export const FORM_NAMES: Record<FilingForm, string> = {
  "10-K": "Annual report",
  "10-Q": "Quarterly report",
  "8-K": "Current report",
};

export const CHANGE_LABELS: Record<DigestPoint["kind"], string> = {
  added: "New",
  removed: "Removed",
  reworded: "Reworded",
  document: "",
};

/** "$80k", "$2.5M", "$950". */
export function compactMoney(x: number): string {
  const a = Math.abs(x);
  if (a >= 1e9) return `$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${Math.round(a / 1e3)}k`;
  return `$${Math.round(a)}`;
}

/** What to say when a filing has no digest to show. Null when there is nothing to add. */
export function digestNote(f: Filing, llmAvailable: boolean): string | null {
  if (f.digest) return null;
  switch (f.digest_status) {
    case "pending":
    case "prepared":
      return llmAvailable ? "AI summary on the next refresh." : null;
    case "uncited":
      return "The AI summary didn't quote the filing, so it isn't shown.";
    case "failed":
      return "The AI summary failed; the filing is still linked.";
    default:
      return null;
  }
}

/** One line on insider activity: "2 buys ($1.2M) · 5 sells ($3.4M), 4 under 10b5-1 plans". */
export function insiderLine(s: InsiderSummary): string {
  const parts: string[] = [];
  if (s.buys) parts.push(`${s.buys} buy${s.buys === 1 ? "" : "s"} (${compactMoney(s.buy_value)})`);
  if (s.sells) {
    const planned = s.planned_sells ? `, ${s.planned_sells === s.sells ? "all" : s.planned_sells} under 10b5-1 plans` : "";
    parts.push(`${s.sells} sell${s.sells === 1 ? "" : "s"} (${compactMoney(s.sell_value)})${planned}`);
  }
  if (!parts.length) return "No open-market trades";
  return parts.join(" · ");
}

/** The morning brief's "what changed" line, or null when nothing did. */
export function briefLine(r: Pick<FilingsReport, "filings" | "insiders">): string | null {
  const parts: string[] = [];
  const notable = r.filings.filter((f) => f.notable || f.form !== "8-K");
  const shown = (notable.length ? notable : r.filings).slice(0, 3);
  for (const f of shown) {
    const what = f.form === "8-K" && f.items.length ? ` (${f.items[0].label.toLowerCase()})` : "";
    parts.push(`${f.ticker} ${f.form}${what}`);
  }
  const more = r.filings.length - shown.length;
  if (more > 0) parts.push(`${more} more filing${more === 1 ? "" : "s"}`);
  const sellers = r.insiders.filter((s) => s.sells > 0).sort((a, b) => b.sell_value - a.sell_value);
  const buyers = r.insiders.filter((s) => s.buys > 0).sort((a, b) => b.buy_value - a.buy_value);
  if (buyers[0]) parts.push(`insiders bought ${compactMoney(buyers[0].buy_value)} of ${buyers[0].ticker}`);
  if (sellers[0]) parts.push(`insiders sold ${compactMoney(sellers[0].sell_value)} of ${sellers[0].ticker}`);
  return parts.length ? parts.join(" · ") : null;
}
