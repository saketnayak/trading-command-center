/** Transaction ledger: types, per-type form fields, and CSV import helpers. Pure. */

export type TxType = "BUY" | "SELL" | "SPLIT" | "DIVIDEND" | "INTEREST" | "FEE" | "DEPOSIT" | "WITHDRAWAL";
export type CostBasisMethod = "fifo" | "hifo" | "average";

export interface LedgerTx {
  id: string;
  trade_date: string;
  type: TxType;
  symbol: string | null;
  quantity: number;
  price: number;
  amount: number;
  fees: number;
  account: string;
  currency: string;
  note: string | null;
  source: "manual" | "csv" | "opening";
  seq: number;
  /** SELL only: the lots it closes, by the BUY that opened each. */
  lots: LotPick[] | null;
}

export interface LotPick {
  buy_id: string;
  quantity: number;
}

/** A lot still open on a date, from GET /portfolio/{id}/lots. */
export interface OpenLot {
  buy_id: string;
  open_date: string;
  quantity: number;
  cost_per_share: number;
  term: "short" | "long";
}

export interface TxInput {
  trade_date: string;
  type: TxType;
  symbol?: string | null;
  quantity?: number;
  price?: number;
  amount?: number;
  fees?: number;
  account?: string;
  currency?: string;
  note?: string | null;
  lots?: LotPick[] | null;
}

export interface LedgerLot {
  account: string;
  open_date: string;
  quantity: number;
  cost_per_share: number;
}

export interface LedgerPosition {
  symbol: string;
  currency: string;
  quantity: number;
  cost: number;
  avg_cost: number;
  lots: LedgerLot[];
}

export interface LedgerSummary {
  holdings_source: "snapshot" | "ledger";
  cost_basis_method: CostBasisMethod;
  transactions: number;
  first_date: string | null;
  positions: LedgerPosition[];
  realised: { year: number; currency: string; term: "short" | "long"; proceeds: number; cost: number; gain: number }[];
  realised_lots: {
    date: string; account: string; symbol: string; currency: string; quantity: number;
    proceeds: number; cost: number; gain: number; term: "short" | "long"; open_date: string;
  }[];
  income: { year: number; currency: string; type: "DIVIDEND" | "INTEREST"; amount: number }[];
  fees: Record<string, number>;
  cash: { account: string; currency: string; balance: number }[];
  contributions: { account: string; currency: string; net: number }[];
  cash_tracked: boolean;
  warnings: string[];
}

export interface ImportResult {
  valid: number;
  errors: { row: number; error: string }[];
  warnings: string[];
  imported: number;
}

export const TX_TYPES: { type: TxType; label: string; fields: ("symbol" | "quantity" | "price" | "amount" | "fees")[]; quantityLabel?: string }[] = [
  { type: "BUY", label: "Buy", fields: ["symbol", "quantity", "price", "fees"] },
  { type: "SELL", label: "Sell", fields: ["symbol", "quantity", "price", "fees"] },
  { type: "DIVIDEND", label: "Dividend", fields: ["symbol", "amount"] },
  { type: "INTEREST", label: "Interest", fields: ["amount"] },
  { type: "FEE", label: "Fee", fields: ["amount"] },
  { type: "DEPOSIT", label: "Deposit", fields: ["amount"] },
  { type: "WITHDRAWAL", label: "Withdrawal", fields: ["amount"] },
  { type: "SPLIT", label: "Split", fields: ["symbol", "quantity"], quantityLabel: "Ratio (2 = 2-for-1)" },
];

export const COST_BASIS_METHODS: { id: CostBasisMethod; label: string; hint: string }[] = [
  { id: "fifo", label: "FIFO", hint: "Sell the oldest shares first (the usual default)." },
  { id: "hifo", label: "HIFO", hint: "Sell the most expensive shares first (smallest taxable gain)." },
  { id: "average", label: "Average cost", hint: "One pooled cost per share (common for funds; UK/CA style)." },
];

/** Minimal RFC-4180 CSV parser: quoted fields, escaped quotes, CRLF, blank lines skipped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export type MappedField = "trade_date" | "type" | "symbol" | "quantity" | "price" | "amount" | "fees" | "account" | "currency";

export const MAPPED_FIELDS: { field: MappedField; label: string; required: boolean }[] = [
  { field: "trade_date", label: "Date", required: true },
  { field: "type", label: "Type / action", required: true },
  { field: "symbol", label: "Symbol", required: false },
  { field: "quantity", label: "Quantity", required: false },
  { field: "price", label: "Price", required: false },
  { field: "amount", label: "Amount", required: false },
  { field: "fees", label: "Fees", required: false },
  { field: "account", label: "Account", required: false },
  { field: "currency", label: "Currency", required: false },
];

const SYNONYMS: Record<MappedField, string[]> = {
  trade_date: ["trade date", "date", "transaction date", "run date", "settlement date", "activity date"],
  type: ["type", "action", "transaction type", "activity", "transaction", "activity type"],
  symbol: ["symbol", "ticker", "security", "instrument"],
  quantity: ["quantity", "qty", "shares", "units", "ratio"],
  price: ["price", "price per share", "unit price", "execution price", "trade price"],
  amount: ["amount", "net amount", "value", "total", "cash amount"],
  fees: ["fees", "fee", "commission", "commissions", "fees & comm"],
  account: ["account", "account name", "portfolio"],
  currency: ["currency", "ccy"],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/[_\s]+/g, " ").replace(/\s*\(.*\)$/, "");

/** Guess which column feeds each field from the header row (exact synonym first, then prefix). */
export function guessMapping(header: string[]): Partial<Record<MappedField, number>> {
  const cols = header.map(norm);
  const out: Partial<Record<MappedField, number>> = {};
  const used = new Set<number>();
  for (const pass of ["exact", "prefix"] as const) {
    for (const f of Object.keys(SYNONYMS) as MappedField[]) {
      if (out[f] !== undefined) continue;
      for (const syn of SYNONYMS[f]) {
        const i = cols.findIndex((c, j) => !used.has(j) && (pass === "exact" ? c === syn : c.startsWith(syn)));
        if (i >= 0) {
          out[f] = i;
          used.add(i);
          break;
        }
      }
    }
  }
  return out;
}

const TYPE_WORDS: [RegExp, TxType][] = [
  [/^(buy|bought|purchase|reinvest|you bought)/, "BUY"],
  [/^(sell|sold|sale|you sold)/, "SELL"],
  [/(dividend|div\b|distribution)/, "DIVIDEND"],
  [/interest/, "INTEREST"],
  [/^(fee|commission|charge)/, "FEE"],
  [/^(deposit|contribution|transfer in|cash in|funding)/, "DEPOSIT"],
  [/^(withdraw|withdrawal|transfer out|cash out)/, "WITHDRAWAL"],
  [/split/, "SPLIT"],
];

/** Broker wording → a ledger type ("Bought" → BUY, "Qualified Dividend" → DIVIDEND). */
export function normaliseType(raw: string): TxType | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const upper = s.toUpperCase();
  if (TX_TYPES.some((t) => t.type === upper)) return upper as TxType;
  for (const [re, t] of TYPE_WORDS) if (re.test(s)) return t;
  return null;
}

/** "$1,234.50" → 1234.5, "(12.30)" → -12.3, "" → undefined. */
export function parseNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  let s = raw.trim();
  if (!s) return undefined;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$€£¥,\s]/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return negative ? -n : n;
}

/** Common date spellings → YYYY-MM-DD (ISO, US M/D/Y, and D.M.Y). */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

/**
 * Turn CSV rows into TxInput rows using a column mapping. Brokers often sign
 * quantities and amounts (sells and fees negative); the ledger wants positive
 * numbers with the type carrying the direction, so absolute values are used.
 * Returns the rows plus per-row problems found before the server sees them.
 */
export function mapRows(
  rows: string[][],
  mapping: Partial<Record<MappedField, number>>,
  defaults: { account: string; currency: string },
): { rows: TxInput[]; problems: { row: number; error: string }[] } {
  const out: TxInput[] = [];
  const problems: { row: number; error: string }[] = [];
  const cell = (r: string[], f: MappedField) => (mapping[f] !== undefined ? r[mapping[f]!] ?? "" : "");
  rows.forEach((r, i) => {
    const date = parseDate(cell(r, "trade_date"));
    const type = normaliseType(cell(r, "type"));
    if (!date) return problems.push({ row: i + 1, error: `unreadable date "${cell(r, "trade_date")}"` });
    if (!type) return problems.push({ row: i + 1, error: `unknown type "${cell(r, "type")}"` });
    const qty = parseNumber(cell(r, "quantity"));
    const price = parseNumber(cell(r, "price"));
    const amount = parseNumber(cell(r, "amount"));
    const fees = parseNumber(cell(r, "fees"));
    const tx: TxInput = {
      trade_date: date,
      type,
      symbol: cell(r, "symbol").trim().toUpperCase() || null,
      quantity: qty !== undefined ? Math.abs(qty) : 0,
      price: price !== undefined ? Math.abs(price) : 0,
      amount: amount !== undefined ? Math.abs(amount) : 0,
      fees: fees !== undefined ? Math.abs(fees) : 0,
      account: cell(r, "account").trim() || defaults.account,
      currency: cell(r, "currency").trim().toUpperCase() || defaults.currency,
    };
    // A buy/sell with an amount but no price: derive the price from amount / quantity.
    if ((type === "BUY" || type === "SELL") && !tx.price && tx.amount && tx.quantity) {
      tx.price = Math.round(((tx.amount - (type === "BUY" ? tx.fees ?? 0 : -(tx.fees ?? 0))) / tx.quantity) * 1e6) / 1e6;
    }
    out.push(tx);
  });
  return { rows: out, problems };
}

/** Picker inputs (buy id → typed shares) → the lots to send; blanks and zeros are left out. */
export function picksFromInputs(inputs: Record<string, string>): LotPick[] {
  return Object.entries(inputs)
    .map(([buy_id, v]) => ({ buy_id, quantity: Number(v) }))
    .filter((p) => Number.isFinite(p.quantity) && p.quantity > 0);
}

/** The reverse, to start the picker from a sale's saved lots. */
export function inputsFromPicks(picks: LotPick[] | null | undefined): Record<string, string> {
  return Object.fromEntries((picks ?? []).map((p) => [p.buy_id, String(p.quantity)]));
}

/** "28 of 123 chosen; the other 95 follow FIFO", or a problem with the choice. */
export function pickSummary(picks: LotPick[], saleQuantity: number, method: string, lots: OpenLot[]): { text: string; ok: boolean } {
  const chosen = picks.reduce((n, p) => n + p.quantity, 0);
  const over = picks.find((p) => {
    const lot = lots.find((l) => l.buy_id === p.buy_id);
    return !lot || p.quantity > lot.quantity + 1e-9;
  });
  if (over) return { text: "A chosen amount is more than that lot holds.", ok: false };
  if (chosen > saleQuantity + 1e-9) return { text: `${fmtQty(chosen)} chosen, more than the ${fmtQty(saleQuantity)} sold.`, ok: false };
  const rest = saleQuantity - chosen;
  const label = method.toUpperCase();
  if (chosen === 0) return { text: `No lots chosen; the sale follows ${label}.`, ok: true };
  return { text: rest > 1e-9 ? `${fmtQty(chosen)} of ${fmtQty(saleQuantity)} chosen; the other ${fmtQty(rest)} follow ${label}.` : `All ${fmtQty(saleQuantity)} chosen.`, ok: true };
}

function fmtQty(n: number): string {
  return Number(n.toFixed(6)).toLocaleString("en-US");
}
