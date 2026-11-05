"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { importTransactions } from "@/lib/api";
import {
  MAPPED_FIELDS,
  guessMapping,
  mapRows,
  parseCsv,
  type ImportResult,
  type MappedField,
  type TxInput,
} from "@/lib/ledger";
import {
  ALERT_BANNER_CLASS,
  BTN_PRIMARY_SM_CLASS,
  BTN_SECONDARY_CLASS,
  FIELD_INPUT_SM_CLASS,
  FIELD_LABEL_CLASS,
} from "@/lib/uiClasses";

interface Props {
  portfolioId: string;
  /** The user accepted that these transactions replace the current holdings. */
  replaceHoldings: boolean;
  onDone: () => void;
  onCancel: () => void;
}

/** CSV → column mapping → server dry run → import (all rows or none). */
export function ImportTransactions({ portfolioId, replaceHoldings, onDone, onCancel }: Props) {
  const [fileName, setFileName] = useState("");
  const [header, setHeader] = useState<string[]>([]);
  const [body, setBody] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Partial<Record<MappedField, number>>>({});
  const [account, setAccount] = useState("Main");
  const [currency, setCurrency] = useState("USD");
  const [check, setCheck] = useState<ImportResult | null>(null);

  const mapped = useMemo(
    () => (body.length ? mapRows(body, mapping, { account: account.trim() || "Main", currency: currency.trim().toUpperCase() || "USD" }) : null),
    [body, mapping, account, currency],
  );
  const missing = MAPPED_FIELDS.filter((f) => f.required && mapping[f.field] === undefined).map((f) => f.label);

  const dryRun = useMutation({
    mutationFn: (rows: TxInput[]) => importTransactions(portfolioId, rows, true),
    onSuccess: setCheck,
  });
  const commit = useMutation({
    mutationFn: (rows: TxInput[]) => importTransactions(portfolioId, rows, false, replaceHoldings),
    onSuccess: (r) => {
      if (r.imported) onDone();
      else setCheck(r);
    },
  });

  async function onFile(file: File) {
    const rows = parseCsv(await file.text());
    setFileName(file.name);
    setHeader(rows[0] ?? []);
    setBody(rows.slice(1));
    setMapping(guessMapping(rows[0] ?? []));
    setCheck(null);
  }

  const ready = mapped && missing.length === 0 && mapped.problems.length === 0 && mapped.rows.length > 0;

  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-fg">Import transactions from CSV</h3>
        <button type="button" className={BTN_SECONDARY_CLASS} onClick={onCancel}>Close</button>
      </div>
      <p className="text-[11px] text-muted">
        Any broker export works: pick which column holds each field. Signs don&apos;t matter (the type sets the direction).
        Nothing is saved until every row passes.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        aria-label="Transactions CSV file"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        className="block text-xs text-fg-secondary file:mr-3 file:rounded-md file:border file:border-input-border file:bg-surface file:px-3 file:py-1.5 file:text-xs file:text-fg"
      />

      {header.length > 0 && (
        <>
          <p className="text-xs text-fg-secondary">{fileName}: {body.length} rows</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {MAPPED_FIELDS.map((f) => (
              <div key={f.field}>
                <label htmlFor={`map-${f.field}`} className={FIELD_LABEL_CLASS}>{f.label}{f.required ? " *" : ""}</label>
                <select
                  id={`map-${f.field}`}
                  value={mapping[f.field] ?? ""}
                  onChange={(e) => {
                    setMapping((m) => ({ ...m, [f.field]: e.target.value === "" ? undefined : Number(e.target.value) }));
                    setCheck(null);
                  }}
                  className={FIELD_INPUT_SM_CLASS}
                >
                  <option value="">(none)</option>
                  {header.map((h, i) => (
                    <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                  ))}
                </select>
              </div>
            ))}
            <div>
              <label htmlFor="imp-account" className={FIELD_LABEL_CLASS}>Account when blank</label>
              <input id="imp-account" value={account} maxLength={64} onChange={(e) => { setAccount(e.target.value); setCheck(null); }} className={FIELD_INPUT_SM_CLASS} />
            </div>
            <div>
              <label htmlFor="imp-ccy" className={FIELD_LABEL_CLASS}>Currency when blank</label>
              <input id="imp-ccy" value={currency} maxLength={8} onChange={(e) => { setCurrency(e.target.value); setCheck(null); }} className={`${FIELD_INPUT_SM_CLASS} uppercase`} />
            </div>
          </div>

          {missing.length > 0 && <p className="text-xs text-amber-600 dark:text-amber-400">Choose a column for: {missing.join(", ")}.</p>}

          {mapped && missing.length === 0 && (
            <>
              <div className="max-h-56 overflow-auto rounded-md border border-border">
                <table className="w-full text-[11px] tabular-nums">
                  <thead className="sticky top-0 bg-surface text-muted">
                    <tr>{["Date", "Type", "Symbol", "Qty", "Price", "Amount", "Fees", "Account"].map((h) => <th key={h} className="px-2 py-1 text-left font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {mapped.rows.slice(0, 50).map((r, i) => (
                      <tr key={i} className="border-t border-border/60 text-fg-secondary">
                        <td className="px-2 py-1">{r.trade_date}</td><td className="px-2 py-1">{r.type}</td><td className="px-2 py-1">{r.symbol ?? ""}</td>
                        <td className="px-2 py-1">{r.quantity || ""}</td><td className="px-2 py-1">{r.price || ""}</td><td className="px-2 py-1">{r.amount || ""}</td>
                        <td className="px-2 py-1">{r.fees || ""}</td><td className="px-2 py-1">{r.account}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {mapped.rows.length > 50 && <p className="text-[11px] text-muted">Showing the first 50 of {mapped.rows.length} rows.</p>}
              {mapped.problems.length > 0 && (
                <ul className={`${ALERT_BANNER_CLASS} list-disc pl-6`}>
                  {mapped.problems.slice(0, 10).map((p) => <li key={p.row}>Row {p.row}: {p.error}</li>)}
                  {mapped.problems.length > 10 && <li>…and {mapped.problems.length - 10} more</li>}
                </ul>
              )}
            </>
          )}

          {check && (
            <div className="space-y-1 text-xs" role="status">
              {check.errors.length === 0 ? (
                <p className="text-emerald-600 dark:text-emerald-400">All {check.valid} rows are valid.</p>
              ) : (
                <ul className={`${ALERT_BANNER_CLASS} list-disc pl-6`}>
                  {check.errors.slice(0, 10).map((e) => <li key={e.row}>Row {e.row}: {e.error}</li>)}
                </ul>
              )}
              {check.warnings.map((w) => <p key={w} className="text-amber-600 dark:text-amber-400">{w}</p>)}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN_SECONDARY_CLASS} disabled={!ready || dryRun.isPending} onClick={() => mapped && dryRun.mutate(mapped.rows)}>
              {dryRun.isPending ? "Checking…" : "Check rows"}
            </button>
            <button type="button" className={BTN_PRIMARY_SM_CLASS}
              disabled={!ready || !check || check.errors.length > 0 || commit.isPending}
              onClick={() => mapped && commit.mutate(mapped.rows)}>
              {commit.isPending ? "Importing…" : `Import ${mapped?.rows.length ?? 0} transactions`}
            </button>
          </div>
          {(dryRun.isError || commit.isError) && (
            <div className={ALERT_BANNER_CLASS} role="alert">{((dryRun.error || commit.error) as Error).message}</div>
          )}
        </>
      )}
    </section>
  );
}
