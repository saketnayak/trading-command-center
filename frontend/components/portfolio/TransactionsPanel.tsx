"use client";

import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListChecks, Trash2 } from "lucide-react";

import {
  addTransaction,
  bootstrapLedger,
  clearLedger,
  deleteTransaction,
  getLedgerSummary,
  listTransactions,
  setCostBasisMethod,
  updateTransaction,
} from "@/lib/api";
import { fmtMoney } from "@/lib/currency";
import {
  COST_BASIS_METHODS,
  TX_TYPES,
  inputsFromPicks,
  picksFromInputs,
  type LedgerSummary,
  type LedgerTx,
  type TxInput,
  type TxType,
} from "@/lib/ledger";
import { portfolioQueryKeys } from "@/lib/portfolioQueries";
import { IconButton } from "@/components/ui/IconButton";
import { ImportTransactions } from "@/components/portfolio/ImportTransactions";
import { LotPicker } from "@/components/portfolio/LotPicker";
import {
  ALERT_BANNER_CLASS,
  BTN_DANGER_CLASS,
  BTN_PRIMARY_SM_CLASS,
  BTN_SECONDARY_CLASS,
  FIELD_INPUT_SM_CLASS,
  FIELD_LABEL_CLASS,
  selectionPillClass,
} from "@/lib/uiClasses";

const CARD = "rounded-lg border border-border bg-surface p-3";
const today = () => new Date().toISOString().slice(0, 10);
const REPLACE_HOLDINGS_WARNING =
  "This replaces your holdings with only what your transactions add up to, so anything without a recorded buy disappears.\n\n" +
  "To keep your holdings, cancel and use \"Start from current holdings\" first. You can undo this by deleting these transactions from the list.";

interface Props {
  portfolioId: string;
  /** Holdings exist on the portfolio (enables "start from current holdings"). */
  hasHoldings: boolean;
}

export function TransactionsPanel({ portfolioId, hasHoldings }: Props) {
  const qc = useQueryClient();
  const txs = useQuery({ queryKey: portfolioQueryKeys.transactions(portfolioId), queryFn: () => listTransactions(portfolioId) });
  const summary = useQuery({ queryKey: portfolioQueryKeys.ledger(portfolioId), queryFn: () => getLedgerSummary(portfolioId) });
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string[]>([]);
  const [replaceHoldings, setReplaceHoldings] = useState(false);

  /** Every ledger change re-derives holdings, so refresh everything that reads them. */
  function refreshAll() {
    setReplaceHoldings(false);  // a confirmation only covers the change it was given for
    for (const prefix of ["portfolio-transactions", "portfolio-ledger", "portfolio-lots", "portfolio-current", "portfolios", "portfolio-performance",
      "portfolio-risk", "portfolio-rebalance", "portfolio-income", "portfolio-tax", "portfolio-trim-signals", "portfolio-regime", "portfolio-wave", "portfolio-fundamentals"]) {
      qc.invalidateQueries({ queryKey: [prefix] });
    }
  }

  const remove = useMutation({ mutationFn: (id: string) => deleteTransaction(portfolioId, id), onSuccess: refreshAll });
  const clear = useMutation({ mutationFn: () => clearLedger(portfolioId), onSuccess: refreshAll });

  if (txs.isPending || summary.isPending) return <div className={`${CARD} py-10 text-center text-sm text-muted`}>Loading transactions…</div>;
  if (txs.isError || summary.isError) {
    return <div className={ALERT_BANNER_CLASS} role="alert">{((txs.error || summary.error) as Error).message}</div>;
  }
  const rows = txs.data;
  const s = summary.data;

  if (rows.length === 0 && !importing) {
    return (
      <EmptyLedger portfolioId={portfolioId} hasHoldings={hasHoldings} replaceHoldings={replaceHoldings}
        onReplaceConfirmed={() => setReplaceHoldings(true)} onImport={() => setImporting(true)}
        onChanged={(w) => { setNotice(w); refreshAll(); }} />
    );
  }

  return (
    <div className="space-y-4">
      <p className="rounded-md border border-blue-500/30 bg-blue-500/5 px-3 py-2 text-xs text-fg-secondary">
        Holdings for this portfolio now come from these transactions; every change updates the Holdings, Performance,
        Risk and Rebalance tabs. Performance follows your real trade dates and adds a money-weighted return.
      </p>
      {notice.length > 0 && (
        <ul className={`${ALERT_BANNER_CLASS} list-disc pl-6`}>{notice.map((w) => <li key={w}>{w}</li>)}</ul>
      )}
      {s.warnings.length > 0 && (
        <ul className={`${ALERT_BANNER_CLASS} list-disc pl-6`}>{s.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      )}

      <SummaryTiles s={s} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <CostBasis portfolioId={portfolioId} method={s.cost_basis_method} onChanged={refreshAll} />
        {!importing && <button type="button" className={BTN_SECONDARY_CLASS} onClick={() => setImporting(true)}>Import CSV</button>}
      </div>

      {importing && (
        <ImportTransactions portfolioId={portfolioId} replaceHoldings={replaceHoldings} onCancel={() => setImporting(false)}
          onDone={() => { setImporting(false); refreshAll(); }} />
      )}

      <AddTransactionForm portfolioId={portfolioId} replaceHoldings={replaceHoldings} onAdded={(w) => { setNotice(w); refreshAll(); }} />

      <section className={CARD}>
        <h3 className="mb-2 text-sm font-medium text-fg">Transactions <span className="font-normal text-muted">({rows.length})</span></h3>
        <TransactionsTable portfolioId={portfolioId} rows={rows} onDelete={(id) => remove.mutate(id)} deleting={remove.isPending}
          onChanged={(w) => { setNotice(w); refreshAll(); }} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Positions s={s} />
        <RealisedTable s={s} />
      </div>

      <section className={`${CARD} flex flex-wrap items-center justify-between gap-3`}>
        <p className="text-xs text-muted">
          Stop using the ledger: deletes every transaction. Holdings stay as they are now and become editable again.
        </p>
        <button type="button" className={BTN_DANGER_CLASS} disabled={clear.isPending}
          onClick={() => { if (window.confirm(`Delete all ${rows.length} transactions? This cannot be undone.`)) clear.mutate(); }}>
          Stop using the ledger
        </button>
      </section>
    </div>
  );
}

function EmptyLedger({ portfolioId, hasHoldings, replaceHoldings, onReplaceConfirmed, onImport, onChanged }: {
  portfolioId: string; hasHoldings: boolean; replaceHoldings: boolean; onReplaceConfirmed: () => void;
  onImport: () => void; onChanged: (warnings: string[]) => void;
}) {
  const [date, setDate] = useState(() => new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10));
  const [adding, setAdding] = useState(false);
  const boot = useMutation({ mutationFn: () => bootstrapLedger(portfolioId, date), onSuccess: (r) => onChanged(r.warnings) });
  /** Starting without opening buys drops the existing holdings, so that has to be a choice. */
  function startWithoutHoldings(start: () => void) {
    if (hasHoldings) {
      if (!window.confirm(REPLACE_HOLDINGS_WARNING)) return;
      onReplaceConfirmed();
    }
    start();
  }
  return (
    <div className="space-y-4">
      <section className={`${CARD} space-y-3`}>
        <h3 className="text-sm font-medium text-fg">Track transactions</h3>
        <p className="text-xs text-fg-secondary">
          Record buys, sells, dividends and deposits to get realised gains (short / long term), income, cash, tax lots, and
          performance that follows your real trade dates, including a money-weighted return. Once you start, this
          portfolio&apos;s holdings are derived from the ledger.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          {hasHoldings && (
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label htmlFor="boot-date" className={FIELD_LABEL_CLASS}>Opening date</label>
                <input id="boot-date" type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} className={`${FIELD_INPUT_SM_CLASS} !w-40`} />
              </div>
              <button type="button" className={BTN_PRIMARY_SM_CLASS} disabled={boot.isPending || !date} onClick={() => boot.mutate()}>
                {boot.isPending ? "Starting…" : "Start from current holdings"}
              </button>
            </div>
          )}
          <button type="button" className={BTN_SECONDARY_CLASS} onClick={() => startWithoutHoldings(onImport)}>Import CSV</button>
          <button type="button" className={BTN_SECONDARY_CLASS} onClick={() => startWithoutHoldings(() => setAdding(true))}>Add a transaction</button>
        </div>
        {hasHoldings && (
          <p className="text-[11px] text-muted">
            &ldquo;Start from current holdings&rdquo; records one opening buy per holding at its average cost on the opening date.
            Importing or adding a transaction instead replaces your holdings with only what those transactions add up to.
          </p>
        )}
        {boot.isError && <div className={ALERT_BANNER_CLASS} role="alert">{(boot.error as Error).message}</div>}
      </section>
      {adding && <AddTransactionForm portfolioId={portfolioId} replaceHoldings={replaceHoldings} onAdded={onChanged} />}
    </div>
  );
}

function SummaryTiles({ s }: { s: LedgerSummary }) {
  const year = new Date().getFullYear();
  const byCcy = (pick: (ccy: string) => number) => {
    const ccys = [...new Set([...s.realised.map((r) => r.currency), ...s.income.map((i) => i.currency), ...Object.keys(s.fees)])];
    return ccys.length ? ccys.map((c) => fmtMoney(pick(c), c)).join(" · ") : "—";
  };
  const gain = (c: string, onlyYear: boolean, term?: string) =>
    s.realised.filter((r) => r.currency === c && (!onlyYear || r.year === year) && (!term || r.term === term)).reduce((a, r) => a + r.gain, 0);
  const income = (c: string, onlyYear: boolean) => s.income.filter((i) => i.currency === c && (!onlyYear || i.year === year)).reduce((a, i) => a + i.amount, 0);
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <Tile label={`Realised gain ${year}`} value={byCcy((c) => gain(c, true))}
        sub={`short ${byCcy((c) => gain(c, true, "short"))} · long ${byCcy((c) => gain(c, true, "long"))}`} />
      <Tile label="Realised gain, all time" value={byCcy((c) => gain(c, false))} />
      <Tile label={`Dividends & interest ${year}`} value={byCcy((c) => income(c, true))} sub={`all time ${byCcy((c) => income(c, false))}`} />
      <Tile label="Fees paid" value={byCcy((c) => s.fees[c] ?? 0)}
        sub={s.cash_tracked ? `cash ${s.cash.map((c) => fmtMoney(c.balance, c.currency)).join(" · ")}` : "record deposits to track cash"} />
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface px-3 py-2">
      <div className="truncate text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="truncate text-base font-semibold tabular-nums text-fg">{value}</div>
      {sub && <div className="truncate text-[11px] text-muted" title={sub}>{sub}</div>}
    </div>
  );
}

function CostBasis({ portfolioId, method, onChanged }: { portfolioId: string; method: string; onChanged: () => void }) {
  const set = useMutation({ mutationFn: (m: (typeof COST_BASIS_METHODS)[number]["id"]) => setCostBasisMethod(portfolioId, m), onSuccess: onChanged });
  return (
    <fieldset>
      <legend className={FIELD_LABEL_CLASS}>Cost basis</legend>
      <div className="flex flex-wrap gap-1">
        {COST_BASIS_METHODS.map((m) => (
          <button key={m.id} type="button" title={m.hint} aria-pressed={method === m.id} disabled={set.isPending}
            onClick={() => set.mutate(m.id)} className={`${selectionPillClass(method === m.id, true)} !normal-case`}>
            {m.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function AddTransactionForm({ portfolioId, replaceHoldings, onAdded }: { portfolioId: string; replaceHoldings: boolean; onAdded: (warnings: string[]) => void }) {
  const [type, setType] = useState<TxType>("BUY");
  const [form, setForm] = useState({ trade_date: today(), symbol: "", quantity: "", price: "", amount: "", fees: "", account: "Main", currency: "USD" });
  const [choosingLots, setChoosingLots] = useState(false);
  const [lotInputs, setLotInputs] = useState<Record<string, string>>({});
  const spec = TX_TYPES.find((t) => t.type === type)!;
  const add = useMutation({
    mutationFn: (tx: TxInput) => addTransaction(portfolioId, tx, replaceHoldings),
    onSuccess: (r) => {
      onAdded(r.warnings);
      setForm((f) => ({ ...f, symbol: type === "DIVIDEND" ? f.symbol : "", quantity: "", price: "", amount: "", fees: "" }));
      setLotInputs({});
      setChoosingLots(false);
    },
  });
  const num = (v: string) => (v.trim() === "" ? 0 : Number(v));
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form className={`${CARD} space-y-3`} onSubmit={(e) => {
      e.preventDefault();
      add.mutate({
        trade_date: form.trade_date, type, symbol: spec.fields.includes("symbol") ? form.symbol.trim().toUpperCase() || null : null,
        quantity: num(form.quantity), price: num(form.price), amount: num(form.amount), fees: num(form.fees),
        account: form.account.trim() || "Main", currency: form.currency.trim().toUpperCase() || "USD",
        lots: type === "SELL" && choosingLots ? picksFromInputs(lotInputs) : null,
      });
    }}>
      <h3 className="text-sm font-medium text-fg">Add a transaction</h3>
      <div className="flex flex-wrap gap-1">
        {TX_TYPES.map((t) => (
          <button key={t.type} type="button" aria-pressed={type === t.type} onClick={() => setType(t.type)}
            className={`${selectionPillClass(type === t.type, true)} !normal-case`}>{t.label}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <Field id="tx-date" label="Date"><input id="tx-date" type="date" max={today()} value={form.trade_date} onChange={set("trade_date")} className={FIELD_INPUT_SM_CLASS} required /></Field>
        {spec.fields.includes("symbol") && (
          <Field id="tx-symbol" label="Symbol"><input id="tx-symbol" value={form.symbol} onChange={set("symbol")} maxLength={16} required={type !== "DIVIDEND"} className={`${FIELD_INPUT_SM_CLASS} uppercase`} /></Field>
        )}
        {spec.fields.includes("quantity") && (
          <Field id="tx-qty" label={spec.quantityLabel ?? "Quantity"}><input id="tx-qty" type="number" inputMode="decimal" step="any" min={0} value={form.quantity} onChange={set("quantity")} required className={FIELD_INPUT_SM_CLASS} /></Field>
        )}
        {spec.fields.includes("price") && (
          <Field id="tx-price" label="Price"><input id="tx-price" type="number" inputMode="decimal" step="any" min={0} value={form.price} onChange={set("price")} required className={FIELD_INPUT_SM_CLASS} /></Field>
        )}
        {spec.fields.includes("amount") && (
          <Field id="tx-amount" label="Amount"><input id="tx-amount" type="number" inputMode="decimal" step="any" min={0} value={form.amount} onChange={set("amount")} required className={FIELD_INPUT_SM_CLASS} /></Field>
        )}
        {spec.fields.includes("fees") && (
          <Field id="tx-fees" label="Fees"><input id="tx-fees" type="number" inputMode="decimal" step="any" min={0} value={form.fees} onChange={set("fees")} className={FIELD_INPUT_SM_CLASS} /></Field>
        )}
        <Field id="tx-account" label="Account"><input id="tx-account" value={form.account} onChange={set("account")} maxLength={64} className={FIELD_INPUT_SM_CLASS} /></Field>
        <Field id="tx-ccy" label="Currency"><input id="tx-ccy" value={form.currency} onChange={set("currency")} maxLength={8} className={`${FIELD_INPUT_SM_CLASS} uppercase`} /></Field>
      </div>
      {type === "SELL" && (
        <div className="space-y-2">
          <button type="button" className="text-xs text-blue-500 hover:text-blue-400" aria-expanded={choosingLots}
            onClick={() => setChoosingLots((v) => !v)}>
            {choosingLots ? "Don't choose lots" : "Choose which lots this sale closes"}
          </button>
          {choosingLots && (
            <LotPicker portfolioId={portfolioId} symbol={form.symbol.trim().toUpperCase()} account={form.account.trim() || "Main"}
              on={form.trade_date} saleQuantity={num(form.quantity)} currency={form.currency.trim().toUpperCase() || "USD"}
              inputs={lotInputs} onChange={setLotInputs} />
          )}
        </div>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" className={BTN_PRIMARY_SM_CLASS} disabled={add.isPending}>{add.isPending ? "Saving…" : `Add ${spec.label.toLowerCase()}`}</button>
        {add.isError && <span className="text-xs text-red-600 dark:text-red-400" role="alert">{(add.error as Error).message}</span>}
      </div>
    </form>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={FIELD_LABEL_CLASS}>{label}</label>
      {children}
    </div>
  );
}

function TransactionsTable({ portfolioId, rows, onDelete, deleting, onChanged }: {
  portfolioId: string; rows: LedgerTx[]; onDelete: (id: string) => void; deleting: boolean; onChanged: (warnings: string[]) => void;
}) {
  const [show, setShow] = useState(50);
  const [lotsFor, setLotsFor] = useState<string | null>(null);
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead className="text-muted">
            <tr>
              <th className="py-1 text-left font-medium">Date</th>
              <th className="py-1 text-left font-medium">Type</th>
              <th className="py-1 text-left font-medium">Symbol</th>
              <th className="py-1 text-right font-medium">Qty</th>
              <th className="hidden py-1 text-right font-medium sm:table-cell">Price</th>
              <th className="py-1 text-right font-medium">Value</th>
              <th className="hidden py-1 pl-3 text-left font-medium md:table-cell">Account</th>
              <th className="hidden py-1 pl-3 text-left font-medium md:table-cell">Source</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, show).map((t) => {
              const value = t.type === "BUY" || t.type === "SELL" ? t.quantity * t.price : t.type === "SPLIT" ? null : t.amount;
              return (
                <Fragment key={t.id}>
                <tr className="border-t border-border/60">
                  <td className="py-1.5 text-fg-secondary">{t.trade_date}</td>
                  <td className="py-1.5 font-medium text-fg">
                    {TX_TYPES.find((x) => x.type === t.type)?.label ?? t.type}
                    {t.lots && t.lots.length > 0 && <span className="ml-1 text-[10px] font-normal text-muted">{`· ${t.lots.length} ${t.lots.length === 1 ? "lot" : "lots"} chosen`}</span>}
                  </td>
                  <td className="py-1.5 text-fg">{t.symbol ?? ""}</td>
                  <td className="py-1.5 text-right text-fg-secondary">{t.type === "SPLIT" ? `×${t.quantity}` : t.quantity ? Number(t.quantity.toFixed(6)).toLocaleString() : ""}</td>
                  <td className="hidden py-1.5 text-right text-fg-secondary sm:table-cell">{t.price ? t.price.toLocaleString(undefined, { maximumFractionDigits: 4 }) : ""}</td>
                  <td className="py-1.5 text-right text-fg">{value !== null ? fmtMoney(value, t.currency) : ""}</td>
                  <td className="hidden py-1.5 pl-3 text-fg-secondary md:table-cell">{t.account}</td>
                  <td className="hidden py-1.5 pl-3 text-[11px] text-muted md:table-cell">{t.source}</td>
                  <td className="whitespace-nowrap py-1.5 text-right">
                    {t.type === "SELL" && (
                      <IconButton icon={ListChecks} label={`Choose the lots this ${t.symbol ?? ""} sale on ${t.trade_date} closes`}
                        onClick={() => setLotsFor(lotsFor === t.id ? null : t.id)} />
                    )}
                    <IconButton icon={Trash2} label={`Delete ${t.type.toLowerCase()} ${t.symbol ?? ""} on ${t.trade_date}`} tone="danger"
                      disabled={deleting} onClick={() => onDelete(t.id)} />
                  </td>
                </tr>
                {lotsFor === t.id && (
                  <tr>
                    <td colSpan={9} className="pb-3 pt-1">
                      <SaleLots portfolioId={portfolioId} sale={t} onDone={(w) => { setLotsFor(null); onChanged(w); }} onCancel={() => setLotsFor(null)} />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > show && (
        <button type="button" className="mt-2 text-xs text-blue-500 hover:text-blue-400" onClick={() => setShow((n) => n + 100)}>
          Show more ({rows.length - show} older)
        </button>
      )}
    </>
  );
}

function SaleLots({ portfolioId, sale, onDone, onCancel }: {
  portfolioId: string; sale: LedgerTx; onDone: (warnings: string[]) => void; onCancel: () => void;
}) {
  const [inputs, setInputs] = useState<Record<string, string>>(() => inputsFromPicks(sale.lots));
  const save = useMutation({
    mutationFn: (lots: TxInput["lots"]) => updateTransaction(portfolioId, sale.id, { lots }),
    onSuccess: (r) => onDone(r.warnings),
  });
  const picks = picksFromInputs(inputs);
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted-surface p-3">
      <p className="text-xs text-fg-secondary">
        {`Which lots did this sale of ${Number(sale.quantity.toFixed(6)).toLocaleString("en-US")} ${sale.symbol ?? ""} close? Shares you don't choose follow the cost-basis method.`}
      </p>
      <LotPicker portfolioId={portfolioId} symbol={sale.symbol ?? ""} account={sale.account} on={sale.trade_date} exclude={sale.id}
        saleQuantity={sale.quantity} currency={sale.currency} inputs={inputs} onChange={setInputs} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BTN_PRIMARY_SM_CLASS} disabled={save.isPending} onClick={() => save.mutate(picks.length ? picks : null)}>
          {save.isPending ? "Saving…" : "Save lots"}
        </button>
        {sale.lots && sale.lots.length > 0 && (
          <button type="button" className={BTN_SECONDARY_CLASS} disabled={save.isPending} onClick={() => save.mutate(null)}>Stop choosing lots</button>
        )}
        <button type="button" className="text-xs text-muted hover:text-fg" onClick={onCancel}>Cancel</button>
        {save.isError && <span className="text-xs text-red-600 dark:text-red-400" role="alert">{(save.error as Error).message}</span>}
      </div>
    </div>
  );
}

function Positions({ s }: { s: LedgerSummary }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className={CARD}>
      <h3 className="mb-2 text-sm font-medium text-fg">Open positions and tax lots</h3>
      {s.positions.length === 0 ? <p className="text-xs text-muted">No open positions.</p> : (
        <ul className="divide-y divide-border/60 text-xs">
          {s.positions.map((p) => (
            <li key={p.symbol} className="py-1.5">
              <button type="button" className="flex w-full items-center justify-between gap-2 text-left" aria-expanded={open === p.symbol}
                onClick={() => setOpen(open === p.symbol ? null : p.symbol)}>
                <span className="font-medium text-fg">{open === p.symbol ? "▾" : "▸"} {p.symbol}</span>
                <span className="tabular-nums text-fg-secondary">
                  {Number(p.quantity.toFixed(6)).toLocaleString()} @ {fmtMoney(p.avg_cost, p.currency)} · {p.lots.length} lot{p.lots.length === 1 ? "" : "s"}
                </span>
              </button>
              {open === p.symbol && (
                <table className="mt-1 w-full text-[11px] tabular-nums text-fg-secondary">
                  <tbody>
                    {p.lots.map((l, i) => (
                      <tr key={i}><td className="py-0.5 pl-4">{l.open_date}</td><td>{l.account}</td>
                        <td className="text-right">{Number(l.quantity.toFixed(6)).toLocaleString()}</td>
                        <td className="text-right">{fmtMoney(l.cost_per_share, p.currency)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RealisedTable({ s }: { s: LedgerSummary }) {
  const rows = useMemo(() => s.realised, [s]);
  return (
    <section className={CARD}>
      <h3 className="text-sm font-medium text-fg">Realised gains by year</h3>
      <p className="mb-2 text-[11px] text-muted">Long term = held more than a year. Informational, not tax advice.</p>
      {rows.length === 0 ? <p className="text-xs text-muted">No sales yet.</p> : (
        <table className="w-full text-xs tabular-nums">
          <thead className="text-muted">
            <tr><th className="py-1 text-left font-medium">Year</th><th className="py-1 text-left font-medium">Term</th>
              <th className="py-1 text-right font-medium">Proceeds</th><th className="py-1 text-right font-medium">Cost</th><th className="py-1 text-right font-medium">Gain</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.year}-${r.currency}-${r.term}`} className="border-t border-border/60">
                <td className="py-1 text-fg-secondary">{r.year}</td><td className="py-1 text-fg-secondary">{r.term}</td>
                <td className="py-1 text-right text-fg-secondary">{fmtMoney(r.proceeds, r.currency)}</td>
                <td className="py-1 text-right text-fg-secondary">{fmtMoney(r.cost, r.currency)}</td>
                <td className={`py-1 text-right font-medium ${r.gain >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{fmtMoney(r.gain, r.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
