"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";

import {
  addNetWorthItem,
  deleteNetWorthItem,
  deleteNetWorthValuation,
  getNetWorth,
  syncNetWorthWallet,
  updateNetWorthItem,
} from "@/lib/api";
import { fmtMoney } from "@/lib/currency";
import {
  ITEM_CURRENCIES,
  NET_WORTH_RANGES,
  changeText,
  itemProblem,
  itemsStartingInRange,
  shortAddress,
  walletBalance,
  type CategoryRow,
  type NetWorthItem,
  type NetWorthRange,
  type NetWorthReport,
} from "@/lib/netWorth";
import { NET_WORTH_COLORS, buildNetWorthFigure } from "@/lib/netWorthChart";
import { fmtPct } from "@/lib/performance";
import {
  ALERT_BANNER_CLASS,
  BTN_PRIMARY_SM_CLASS,
  BTN_SECONDARY_CLASS,
  FIELD_INPUT_SM_CLASS,
  FIELD_LABEL_CLASS,
  selectionPillClass,
} from "@/lib/uiClasses";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

const CARD = "rounded-lg border border-border bg-surface p-3";
const BAR = "bg-[#2a78d6] dark:bg-[#3987e5]";
const DEBT_BAR = "bg-[#eb6834] dark:bg-[#d95926]";
const KEY = ["net-worth"] as const;

export function NetWorthView() {
  const [range, setRange] = useState<NetWorthRange>("1y");
  const query = useQuery({
    queryKey: [...KEY, range],
    queryFn: () => getNetWorth(range),
    placeholderData: keepPreviousData,
  });

  if (query.isPending) return <div className={`${CARD} py-10 text-center text-sm text-muted`}>Adding up portfolios and accounts…</div>;
  if (query.isError) return <div className={ALERT_BANNER_CLASS} role="alert">{(query.error as Error).message}</div>;
  const r = query.data;
  const ccy = r.display_currency;
  const empty = !r.items.length && !r.investments;

  return (
    <div className={`space-y-4 transition-opacity ${query.isFetching ? "opacity-70" : ""}`} aria-busy={query.isFetching}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted">Net worth</div>
          <div className="text-3xl font-semibold tabular-nums text-fg">{fmtMoney(r.net_worth, ccy)}</div>
          {changeText(r) && <div className="text-xs text-fg-secondary">{changeText(r)}</div>}
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Range">
          {NET_WORTH_RANGES.map((x) => (
            <button key={x.id} type="button" className={selectionPillClass(x.id === range, true)} aria-pressed={x.id === range}
              onClick={() => setRange(x.id)}>{x.label}</button>
          ))}
        </div>
      </div>

      {r.warnings.length > 0 && (
        <ul className={`${ALERT_BANNER_CLASS} list-disc space-y-0.5 pl-6`}>
          {r.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Assets" value={fmtMoney(r.assets, ccy)} sub={`${fmtMoney(r.investments, ccy)} in portfolios`} />
        <Tile label="Liabilities" value={fmtMoney(r.liabilities, ccy)} sub={r.debt_ratio != null ? `${fmtPct(r.debt_ratio)} of assets` : "none recorded"} />
        <Tile label="Portfolios" value={String(r.portfolios.length)} sub={fmtMoney(r.investments, ccy)} />
        <Tile label="Other items" value={String(r.items.length)} sub={walletCount(r.items.filter((i) => i.wallet_chain).length)} />
      </div>

      {empty ? (
        <div className={`${CARD} text-sm text-fg-secondary`}>
          Nothing to add up yet. Create a portfolio, or add a bank balance, a property, a loan or a crypto wallet below.
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <NetWorthChart report={r} />
          <Allocation report={r} />
        </div>
      )}

      <AddItemForm report={r} />
      <ItemsSection report={r} kind="asset" />
      <ItemsSection report={r} kind="liability" />
      <PortfoliosSection report={r} />

      <p className="text-[11px] leading-relaxed text-muted">{r.methodology}</p>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface px-3 py-2">
      <div className="truncate text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-fg">{value}</div>
      {sub && <div className="truncate text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

function NetWorthChart({ report: r }: { report: NetWorthReport }) {
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "light" ? "light" : "dark";
  const fig = useMemo(() => buildNetWorthFigure(r.series, r.display_currency, theme), [r, theme]);
  const c = NET_WORTH_COLORS[theme];
  const hasDebt = r.series.some((p) => p.liabilities > 0);
  return (
    <section className={CARD} aria-labelledby="nw-chart-heading">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 id="nw-chart-heading" className="text-sm font-medium text-fg">Over time</h2>
        <div className="flex items-center gap-3 text-xs text-fg-secondary" aria-label="Legend">
          <Swatch color={c.netWorth} label="Net worth" />
          {hasDebt && <Swatch color={c.liabilities} label="Liabilities" />}
        </div>
      </div>
      <Plot data={fig.data} layout={fig.layout} config={{ responsive: true, displayModeBar: false }}
        style={{ width: "100%", height: "300px" }} useResizeHandler />
      {itemsStartingInRange(r) && <p className="mt-1 text-[11px] leading-relaxed text-muted">{itemsStartingInRange(r)}</p>}
    </section>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="inline-block h-0.5 w-4 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function Allocation({ report: r }: { report: NetWorthReport }) {
  return (
    <section className={`${CARD} space-y-3`} aria-labelledby="nw-mix-heading">
      <h2 id="nw-mix-heading" className="text-sm font-medium text-fg">What it&apos;s made of</h2>
      <CategoryBars rows={r.assets_by_category} currency={r.display_currency} bar={BAR} title="Assets" />
      {r.liabilities_by_category.length > 0 && (
        <CategoryBars rows={r.liabilities_by_category} currency={r.display_currency} bar={DEBT_BAR} title="Liabilities" />
      )}
    </section>
  );
}

function CategoryBars({ rows, currency, bar, title }: { rows: CategoryRow[]; currency: string; bar: string; title: string }) {
  return (
    <div>
      <h3 className="mb-1 text-[11px] uppercase tracking-wide text-muted">{title}</h3>
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li key={row.category} className="text-xs">
            <div className="flex justify-between gap-2">
              <span className="text-fg-secondary">{row.label}</span>
              <span className="tabular-nums text-fg">{fmtMoney(row.value, currency)} <span className="text-muted">{fmtPct(row.share)}</span></span>
            </div>
            <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-muted-surface">
              <div className={`h-full rounded-full ${bar}`} style={{ width: `${(row.share ?? 0) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

type FormKind = "asset" | "liability" | "wallet";

function AddItemForm({ report: r }: { report: NetWorthReport }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<FormKind>("asset");
  const [category, setCategory] = useState("cash");
  const [name, setName] = useState("");
  const [valueText, setValueText] = useState("");
  const [currency, setCurrency] = useState(r.display_currency);
  const [asOf, setAsOf] = useState("");
  const [chain, setChain] = useState<"btc" | "eth">("btc");
  const [address, setAddress] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const cats = kind === "liability" ? r.categories.liability : r.categories.asset.filter((c) => c.id !== "crypto_wallet");
  const input = kind === "wallet"
    ? { kind: "asset" as const, category: "crypto_wallet", name, wallet_chain: chain, wallet_address: address.trim() }
    : { kind, category, name, currency, value: Number(valueText), ...(asOf ? { as_of: asOf } : {}) };
  const problem = itemProblem({ ...input, valueText });

  const add = useMutation({
    mutationFn: () => addNetWorthItem({ ...input, name: name.trim() }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: KEY });
      setName(""); setValueText(""); setAsOf(""); setAddress("");
      setNotice(res.sync_error ? `Added, but ${res.sync_error.charAt(0).toLowerCase()}${res.sync_error.slice(1)}` : null);
      if (!res.sync_error) setOpen(false);
    },
  });

  function pickKind(k: FormKind) {
    setKind(k);
    setCategory(k === "liability" ? "mortgage" : "cash");
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BTN_PRIMARY_SM_CLASS} onClick={() => setOpen(true)}>Add an asset, liability or wallet</button>
        {notice && <span className="text-xs text-amber-600 dark:text-amber-400">{notice}</span>}
      </div>
    );
  }

  return (
    <form className={`${CARD} space-y-3`} aria-labelledby="nw-add-heading"
      onSubmit={(e) => { e.preventDefault(); if (!problem) add.mutate(); }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="nw-add-heading" className="text-sm font-medium text-fg">Add to net worth</h2>
        <div className="flex gap-1.5" role="group" aria-label="Type">
          {(["asset", "liability", "wallet"] as FormKind[]).map((k) => (
            <button key={k} type="button" className={selectionPillClass(k === kind, true)} aria-pressed={k === kind} onClick={() => pickKind(k)}>
              {k === "wallet" ? "Crypto wallet" : k === "asset" ? "Asset" : "Liability"}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="nw-name" className={FIELD_LABEL_CLASS}>Name</label>
          <input id="nw-name" className={FIELD_INPUT_SM_CLASS} value={name} onChange={(e) => setName(e.target.value)}
            placeholder={kind === "wallet" ? "Cold storage" : kind === "liability" ? "Home mortgage" : "Savings account"} maxLength={120} />
        </div>
        {kind === "wallet" ? (
          <>
            <div>
              <label htmlFor="nw-chain" className={FIELD_LABEL_CLASS}>Chain</label>
              <select id="nw-chain" className={FIELD_INPUT_SM_CLASS} value={chain} onChange={(e) => setChain(e.target.value as "btc" | "eth")}>
                <option value="btc">Bitcoin (BTC)</option>
                <option value="eth">Ethereum (ETH, native only)</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="nw-address" className={FIELD_LABEL_CLASS}>Public address</label>
              <input id="nw-address" className={`${FIELD_INPUT_SM_CLASS} font-mono`} value={address} spellCheck={false}
                onChange={(e) => setAddress(e.target.value)} placeholder={chain === "btc" ? "bc1q…" : "0x…"} />
            </div>
          </>
        ) : (
          <>
            <div>
              <label htmlFor="nw-category" className={FIELD_LABEL_CLASS}>Category</label>
              <select id="nw-category" className={FIELD_INPUT_SM_CLASS} value={category} onChange={(e) => setCategory(e.target.value)}>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <label htmlFor="nw-value" className={FIELD_LABEL_CLASS}>{kind === "liability" ? "Amount owed" : "Value"}</label>
                <input id="nw-value" type="number" inputMode="decimal" min="0" step="any" className={FIELD_INPUT_SM_CLASS}
                  value={valueText} onChange={(e) => setValueText(e.target.value)} />
              </div>
              <div className="w-24">
                <label htmlFor="nw-currency" className={FIELD_LABEL_CLASS}>Currency</label>
                <select id="nw-currency" className={FIELD_INPUT_SM_CLASS} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {ITEM_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="nw-asof" className={FIELD_LABEL_CLASS}>As of (optional)</label>
              <input id="nw-asof" type="date" className={FIELD_INPUT_SM_CLASS} value={asOf} max={r.end} onChange={(e) => setAsOf(e.target.value)} />
            </div>
          </>
        )}
      </div>
      {kind === "wallet" && (
        <p className="text-[11px] text-muted">Read-only: only the public address is stored, and the balance is re-read daily. Never enter a private key or seed phrase.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={BTN_PRIMARY_SM_CLASS} disabled={!!problem || add.isPending}>{add.isPending ? "Adding…" : "Add"}</button>
        <button type="button" className={BTN_SECONDARY_CLASS} onClick={() => setOpen(false)}>Cancel</button>
        {name && problem && <span className="text-xs text-muted">{problem}</span>}
        {add.isError && <span className="text-xs text-red-500" role="alert">{(add.error as Error).message}</span>}
        {notice && <span className="text-xs text-amber-600 dark:text-amber-400">{notice}</span>}
      </div>
    </form>
  );
}

function ItemsSection({ report: r, kind }: { report: NetWorthReport; kind: "asset" | "liability" }) {
  const rows = r.items.filter((i) => i.kind === kind);
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!rows.length) return null;
  const title = kind === "asset" ? "Assets outside your portfolios" : "Liabilities";
  return (
    <section className={`${CARD} overflow-x-auto`} aria-label={title}>
      <h2 className="mb-2 text-sm font-medium text-fg">{title}</h2>
      <table className="w-full min-w-[720px] text-xs">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
            <th className="py-1.5 pr-2 font-medium">Name</th>
            <th className="py-1.5 pr-2 font-medium">Category</th>
            <th className="py-1.5 pr-2 text-right font-medium">Value</th>
            <th className="py-1.5 pr-2 text-right font-medium">In {r.display_currency}</th>
            <th className="py-1.5 pr-2 font-medium">As of</th>
            <th className="py-1.5 font-medium"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <Fragment key={item.id}>
              <ItemRow item={item} currency={r.display_currency} today={r.end} open={expanded === item.id}
                onToggle={() => setExpanded(expanded === item.id ? null : item.id)} />
              {expanded === item.id && !item.wallet_chain && (
                <tr className="border-b border-border/60"><td colSpan={6} className="pb-3 pl-3"><History item={item} /></td></tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ItemRow({ item, currency, today, open, onToggle }: {
  item: NetWorthItem; currency: string; today: string; open: boolean; onToggle: () => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [date, setDate] = useState(today);
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  const update = useMutation({
    mutationFn: () => updateNetWorthItem(item.id, { value: Number(text), as_of: date }),
    onSuccess: () => { setEditing(false); refresh(); },
  });
  const remove = useMutation({ mutationFn: () => deleteNetWorthItem(item.id), onSuccess: refresh });
  const sync = useMutation({ mutationFn: () => syncNetWorthWallet(item.id), onSuccess: refresh });
  const wallet = walletBalance(item);
  const valid = text.trim() !== "" && Number.isFinite(Number(text)) && Number(text) >= 0;

  return (
    <tr className="border-b border-border/60 align-top last:border-0">
      <td className="py-1.5 pr-2 text-fg">
        <span className="font-medium">{item.name}</span>
        {item.wallet_address && <span className="block font-mono text-[11px] text-muted" title={item.wallet_address}>{shortAddress(item.wallet_address)}</span>}
        {item.sync_error && <span className="block text-[11px] text-amber-600 dark:text-amber-400">{item.sync_error}</span>}
        {item.stale && <span className="block text-[11px] text-amber-600 dark:text-amber-400">Not updated in over 6 months</span>}
      </td>
      <td className="py-1.5 pr-2 text-fg-secondary">{item.category_label}</td>
      <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">
        {wallet ?? (item.value != null ? fmtMoney(item.value, item.currency) : "—")}
      </td>
      <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums text-fg">
        {item.value_display != null ? fmtMoney(item.value_display, currency) : "—"}
      </td>
      <td className="whitespace-nowrap py-1.5 pr-2 tabular-nums text-fg-secondary">{item.as_of ?? "—"}</td>
      <td className="py-1.5 text-right">
        {editing ? (
          <form className="flex flex-wrap justify-end gap-1.5" onSubmit={(e) => { e.preventDefault(); if (valid) update.mutate(); }}>
            <label className="sr-only" htmlFor={`v-${item.id}`}>New value</label>
            <input id={`v-${item.id}`} type="number" inputMode="decimal" min="0" step="any" autoFocus value={text}
              onChange={(e) => setText(e.target.value)} className={`${FIELD_INPUT_SM_CLASS} w-28`} />
            <label className="sr-only" htmlFor={`d-${item.id}`}>Date</label>
            <input id={`d-${item.id}`} type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={`${FIELD_INPUT_SM_CLASS} w-36`} />
            <button type="submit" className={BTN_PRIMARY_SM_CLASS} disabled={!valid || update.isPending}>Save</button>
            <button type="button" className={BTN_SECONDARY_CLASS} onClick={() => setEditing(false)}>Cancel</button>
          </form>
        ) : (
          <div className="flex justify-end gap-1.5 whitespace-nowrap">
            {item.wallet_chain ? (
              <button type="button" className={BTN_SECONDARY_CLASS} disabled={sync.isPending} onClick={() => sync.mutate()}>
                {sync.isPending ? "Syncing…" : "Sync"}
              </button>
            ) : (
              <>
                <button type="button" className={BTN_SECONDARY_CLASS} onClick={() => { setText(item.value != null ? String(item.value) : ""); setDate(today); setEditing(true); }}>
                  Update value
                </button>
                <button type="button" className={BTN_SECONDARY_CLASS} aria-expanded={open} onClick={onToggle}>History</button>
              </>
            )}
            <button type="button" className={BTN_SECONDARY_CLASS} disabled={remove.isPending}
              onClick={() => { if (window.confirm(`Remove ${item.name} and its history?`)) remove.mutate(); }}>Remove</button>
          </div>
        )}
        {(update.isError || remove.isError) && (
          <p className="mt-1 text-[11px] text-red-500" role="alert">{((update.error ?? remove.error) as Error).message}</p>
        )}
      </td>
    </tr>
  );
}

function History({ item }: { item: NetWorthItem }) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (date: string) => deleteNetWorthValuation(item.id, date),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  return (
    <div className="text-xs">
      <ul className="flex flex-wrap gap-2">
        {[...item.valuations].reverse().map((v) => (
          <li key={v.date} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1">
            <span className="tabular-nums text-fg-secondary">{v.date}</span>
            <span className="tabular-nums text-fg">{fmtMoney(v.value, item.currency)}</span>
            {item.valuations.length > 1 && (
              <button type="button" className="text-muted hover:text-red-500" aria-label={`Delete the ${v.date} value`}
                disabled={remove.isPending} onClick={() => remove.mutate(v.date)}>×</button>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-muted">Each value holds until the next one. Use Update value with a past date to fill in history.</p>
      {remove.isError && <p className="text-[11px] text-red-500" role="alert">{(remove.error as Error).message}</p>}
    </div>
  );
}

function PortfoliosSection({ report: r }: { report: NetWorthReport }) {
  if (!r.portfolios.length) return null;
  return (
    <section className={CARD} aria-labelledby="nw-portfolios-heading">
      <h2 id="nw-portfolios-heading" className="mb-2 text-sm font-medium text-fg">Portfolios</h2>
      <ul className="divide-y divide-border/60 text-xs">
        {r.portfolios.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span className="text-fg">
              {p.name}
              <span className="ml-2 text-[11px] text-muted">
                {p.holdings_source === "ledger" ? "from transactions" : "from holdings"}
                {p.mode === "current" ? " · history is today's holdings" : ""}
              </span>
            </span>
            <span className="tabular-nums text-fg">{fmtMoney(p.value, r.display_currency)}</span>
          </li>
        ))}
      </ul>
      <Link href="/portfolio" className="mt-2 inline-block text-xs text-blue-500 hover:underline">Open portfolios</Link>
    </section>
  );
}

function walletCount(n: number): string {
  return n === 1 ? "1 wallet" : `${n} wallets`;
}
