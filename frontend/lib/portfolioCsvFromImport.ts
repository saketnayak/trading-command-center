/**
 * Build a generic portfolio CSV compatible with backend `parse_portfolio_csv`
 * (headers: ticker, shares, avg_cost). Duplicate tickers: last row wins.
 */

export type MappedImportRow = Record<string, unknown>;

function normalizeNumericString(value: string): string {
  const cleaned = value.replace(/[$%\s']/g, "").trim();
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  if (lastComma !== -1 && lastDot !== -1) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    return cleaned
      .replaceAll(thousandsSeparator, "")
      .replace(decimalSeparator, ".");
  }

  if (lastComma !== -1) {
    if (/^[+-]?\d{1,3}(,\d{3})+$/.test(cleaned)) {
      return cleaned.replace(/,/g, "");
    }
    return cleaned.replace(/,/g, ".");
  }

  return cleaned;
}

export function parseNumericCell(value: unknown): number | null {
  if (value == null) return null;
  const s = normalizeNumericString(String(value));
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export interface NormalizedHoldingRow {
  ticker: string;
  shares: number;
  avg_cost: number | null;
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Normalize mapped importer rows; skips invalid / empty / cash-style tickers. */
export function normalizeMappedRows(raw: MappedImportRow[]): NormalizedHoldingRow[] {
  const byTicker = new Map<string, NormalizedHoldingRow>();

  for (const row of raw) {
    const tickerRaw = row.ticker;
    if (tickerRaw == null || tickerRaw === "") continue;
    const ticker = String(tickerRaw).trim().toUpperCase();
    if (!ticker || ticker.startsWith("$")) continue;

    const shares = parseNumericCell(row.shares);
    if (shares == null) continue;

    const avgRaw = row.avg_cost;
    const avg_cost =
      avgRaw == null || avgRaw === "" ? null : parseNumericCell(avgRaw);

    byTicker.set(ticker, { ticker, shares, avg_cost });
  }

  return Array.from(byTicker.values());
}

export function buildGenericPortfolioCsv(rows: NormalizedHoldingRow[]): string {
  const lines = ["ticker,shares,avg_cost"];
  for (const r of rows) {
    const avg =
      r.avg_cost == null ? "" : Number.isInteger(r.avg_cost) ? String(r.avg_cost) : String(r.avg_cost);
    lines.push(
      `${escapeCsvCell(r.ticker)},${r.shares},${avg}`,
    );
  }
  return lines.join("\n");
}

export function mappedRowsToPortfolioCsvFile(
  raw: MappedImportRow[],
  filename = "portfolio-import.csv",
): { file: File; rows: NormalizedHoldingRow[] } | { error: string } {
  const rows = normalizeMappedRows(raw);
  if (rows.length === 0) {
    return {
      error:
        "No valid holdings found. Map Ticker and Shares, and ensure rows have a valid symbol and quantity.",
    };
  }
  const csv = buildGenericPortfolioCsv(rows);
  const file = new File([csv], filename, { type: "text/csv" });
  return { file, rows };
}
