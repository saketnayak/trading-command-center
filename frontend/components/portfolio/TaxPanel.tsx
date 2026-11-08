"use client";

import { Fragment, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { getPortfolioTax, getTaxReplacements } from "@/lib/api";
import { fmtMoney } from "@/lib/currency";
import { fmtSignedPct, returnTone } from "@/lib/performance";
import { portfolioQueryKeys } from "@/lib/portfolioQueries";
import { taxHeadline, taxRowsCsv, washRiskText, type HarvestCandidate, type TaxReport, type TaxRow } from "@/lib/tax";
import { ALERT_BANNER_CLASS, BTN_PRIMARY_SM_CLASS, BTN_SECONDARY_CLASS, selectionPillClass } from "@/lib/uiClasses";
import { useDisplayCurrency } from "@/lib/useDisplayCurrency";

const CARD = "rounded-lg border border-border bg-surface p-3";
const MIN_LOSS_OPTIONS = [0, 100, 500, 1000];

interface Props {
  portfolioId: string;
  onOpenTransactions: () => void;
}

export function TaxPanel({ portfolioId, onOpenTransactions }: Props) {
  const [year, setYear] = useState<number | null>(null);
  const [minLoss, setMinLoss] = useState(100);
  const { currency: ccy } = useDisplayCurrency();
  const query = useQuery({
    queryKey: portfolioQueryKeys.tax(portfolioId, year, minLoss, ccy),
    queryFn: () => getPortfolioTax(portfolioId, year, minLoss, ccy),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === portfolioId ? keepPreviousData(previous) : undefined,
  });

  if (query.isPending) return <div className={`${CARD} py-10 text-center text-sm text-muted`}>Loading lots and sales…</div>;
  if (query.isError) return <div className={ALERT_BANNER_CLASS} role="alert">{(query.error as Error).message}</div>;
  const r = query.data;

  return (
    <div className={`space-y-4 transition-opacity ${query.isFetching ? "opacity-70" : ""}`} aria-busy={query.isFetching}>
      <p className="rounded-md border border-border bg-muted-surface px-3 py-2 text-xs leading-relaxed text-fg-secondary">
        <span className="font-medium text-fg">Not tax advice.</span> {r.disclaimer.replace(/^Informational only, not tax advice\.\s*/, "")}
      </p>

      {!r.available ? (
        <div className={`${CARD} flex flex-wrap items-center justify-between gap-3`}>
          <p className="text-sm text-fg-secondary">{r.message}</p>
          <button type="button" className={BTN_PRIMARY_SM_CLASS} onClick={onOpenTransactions}>Open Transactions</button>
        </div>
      ) : (
        <>
          {r.warnings.length > 0 && (
            <ul className={`${ALERT_BANNER_CLASS} list-disc space-y-0.5 pl-6`}>
              {r.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          <RealisedSection report={r} onYear={setYear} />
          <HarvestSection report={r} portfolioId={portfolioId} minLoss={minLoss} onMinLoss={setMinLoss} />
        </>
      )}
    </div>
  );
}

function RealisedSection({ report: r, onYear }: { report: TaxReport; onYear: (y: number) => void }) {
  const rows = r.report?.rows ?? [];
  const headline = taxHeadline(r);

  function download() {
    const blob = new Blob([taxRowsCsv(rows)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `realised-gains-${r.year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className={`${CARD} space-y-3`} aria-labelledby="tax-realised-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="tax-realised-heading" className="text-sm font-medium text-fg">Realised gains by tax year</h3>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Tax year">
          {r.years.map((y) => (
            <button key={y} type="button" className={selectionPillClass(y === r.year, true)} aria-pressed={y === r.year}
              onClick={() => onYear(y)}>{y}</button>
          ))}
        </div>
      </div>
      {headline ? <p className="text-sm text-fg">{headline}</p> : <p className="text-sm text-muted">No sales in {r.year}.</p>}

      {(r.report?.totals ?? []).map((t) => (
        <div key={t.currency} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile label="Short term" value={fmtSigned(t.short.adjusted_gain, t.currency)} tone={returnTone(t.short.adjusted_gain)}
            sub={`proceeds ${fmtMoney(t.short.proceeds, t.currency)}`} />
          <Tile label="Long term" value={fmtSigned(t.long.adjusted_gain, t.currency)} tone={returnTone(t.long.adjusted_gain)}
            sub={`proceeds ${fmtMoney(t.long.proceeds, t.currency)}`} />
          <Tile label="Net" value={fmtSigned(t.net, t.currency)} tone={returnTone(t.net)} sub={t.currency} />
          <Tile label="Wash-sale adjustment" value={fmtMoney(t.short.adjustment + t.long.adjustment, t.currency)}
            sub="loss disallowed, moves to the new shares" />
        </div>
      ))}

      {rows.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] whitespace-nowrap text-xs">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="py-1.5 pr-2 font-medium">Description</th>
                  <th className="py-1.5 pr-2 font-medium">Acquired</th>
                  <th className="py-1.5 pr-2 font-medium">Sold</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Proceeds</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Cost basis</th>
                  <th className="py-1.5 pr-2 font-medium">Code</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Adjustment</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Gain or loss</th>
                  <th className="py-1.5 pr-2 font-medium">Term</th>
                  <th className="py-1.5 font-medium">Account</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => <RealisedRow key={`${row.date_sold}-${row.symbol}-${row.date_acquired}-${i}`} row={row} />)}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-muted">
              {`One row per lot sold (${r.cost_basis_method.toUpperCase()} lots). Code W: wash sale. Amounts in each trade's currency.`}
            </p>
            <button type="button" className={BTN_SECONDARY_CLASS} onClick={download}>Download {r.year} (CSV)</button>
          </div>
        </>
      )}
    </section>
  );
}

function RealisedRow({ row }: { row: TaxRow }) {
  const c = row.currency;
  return (
    <>
      <tr className={`border-b border-border/60 ${row.code ? "" : "last:border-0"}`}>
        <td className="py-1.5 pr-2 text-fg"><span className="font-medium">{row.symbol}</span> <span className="text-muted">× {fmtQty(row.quantity)}</span></td>
        <td className="py-1.5 pr-2 tabular-nums">{row.date_acquired}</td>
        <td className="py-1.5 pr-2 tabular-nums">{row.date_sold}</td>
        <td className="py-1.5 pr-2 text-right tabular-nums">{fmtMoney(row.proceeds, c)}</td>
        <td className="py-1.5 pr-2 text-right tabular-nums">{fmtMoney(row.cost, c)}</td>
        <td className="py-1.5 pr-2 font-medium text-amber-600 dark:text-amber-400">{row.code}</td>
        <td className="py-1.5 pr-2 text-right tabular-nums">{row.adjustment ? fmtMoney(row.adjustment, c) : ""}</td>
        <td className={`py-1.5 pr-2 text-right tabular-nums ${returnTone(row.adjusted_gain)}`}>{fmtSigned(row.adjusted_gain, c)}</td>
        <td className="py-1.5 pr-2 capitalize">{row.term}</td>
        <td className="py-1.5 text-fg-secondary">{row.account}</td>
      </tr>
      {row.code === "W" && (
        <tr className="border-b border-border/60">
          <td colSpan={10} className="whitespace-normal pb-2 pl-3 text-[11px] text-fg-secondary">
            {fmtMoney(row.adjustment, c)} of the {fmtMoney(-row.gain, c)} loss disallowed: bought again{" "}
            {row.replacements.map((b) => `${fmtQty(b.quantity)} on ${b.date} (${b.portfolio} / ${b.account})`).join(", ")}.
          </td>
        </tr>
      )}
    </>
  );
}

function HarvestSection({ report: r, portfolioId, minLoss, onMinLoss }: {
  report: TaxReport; portfolioId: string; minLoss: number; onMinLoss: (v: number) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const ccy = r.display_currency;
  const total = r.harvest.reduce((s, c) => s + c.loss, 0);

  return (
    <section className={`${CARD} space-y-3`} aria-labelledby="tax-harvest-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="tax-harvest-heading" className="text-sm font-medium text-fg">Loss-harvest candidates</h3>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Minimum loss">
          <span className="text-[11px] text-muted">Loss of at least</span>
          {MIN_LOSS_OPTIONS.map((v) => (
            <button key={v} type="button" className={selectionPillClass(v === minLoss, true)} aria-pressed={v === minLoss}
              onClick={() => onMinLoss(v)}>{v === 0 ? "any" : fmtMoney(v, ccy).replace(/\.00$/, "")}</button>
          ))}
        </div>
      </div>
      {r.harvest.length === 0 ? (
        <p className="text-sm text-muted">No open lot is down by {minLoss ? `${fmtMoney(minLoss, ccy)} or more` : "anything"} today.</p>
      ) : (
        <>
          <p className="text-sm text-fg">
            {`${r.harvest.length} lot${r.harvest.length === 1 ? "" : "s"} with ${fmtMoney(-total, ccy)} of unrealised losses at today's close.`}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] whitespace-nowrap text-xs">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="py-1.5 pr-2 font-medium">Lot</th>
                  <th className="py-1.5 pr-2 font-medium">Acquired</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Cost / share</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Price</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Unrealised loss</th>
                  <th className="py-1.5 pr-2 font-medium">Term</th>
                  <th className="py-1.5 pr-2 font-medium">Wash-sale check</th>
                  <th className="py-1.5 font-medium"><span className="sr-only">Similar funds</span></th>
                </tr>
              </thead>
              <tbody>
                {r.harvest.map((c) => {
                  const key = `${c.account}|${c.symbol}|${c.open_date}|${c.cost_per_share}`;
                  return (
                    <Fragment key={key}>
                      <HarvestRow c={c} ccy={ccy} open={open === key} onToggle={() => setOpen(open === key ? null : key)} />
                      {open === key && (
                        <tr className="border-b border-border/60">
                          <td colSpan={8} className="pb-3 pl-3"><Replacements portfolioId={portfolioId} symbol={c.symbol} /></td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] leading-relaxed text-muted">
            Selling a specific lot needs your broker to allow specific identification; otherwise a sale takes lots by your
            account&apos;s method. A loss is only harvested if you don&apos;t buy the same security back within 30 days.
          </p>
        </>
      )}
    </section>
  );
}

function HarvestRow({ c, ccy, open, onToggle }: { c: HarvestCandidate; ccy: string; open: boolean; onToggle: () => void }) {
  const risk = washRiskText(c);
  return (
    <tr className="border-b border-border/60 align-top">
      <td className="py-1.5 pr-2 text-fg">
        <span className="font-medium">{c.symbol}</span> <span className="text-muted">× {fmtQty(c.quantity)} · {c.account}</span>
      </td>
      <td className="py-1.5 pr-2 tabular-nums">{c.open_date}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{fmtNum(c.cost_per_share)}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{fmtNum(c.price)}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums text-red-600 dark:text-red-400">
        {fmtMoney(c.loss, ccy)} <span className="text-muted">({fmtSignedPct(c.loss_pct, 1)})</span>
      </td>
      <td className="py-1.5 pr-2">
        <span className="capitalize">{c.term}</span>
        {c.term === "short" && c.days_to_long_term <= 60 && (
          <span className="block text-[11px] text-muted">long term in {c.days_to_long_term} days</span>
        )}
      </td>
      <td className="max-w-[18rem] whitespace-normal py-1.5 pr-2">
        {risk ? <span className="text-amber-600 dark:text-amber-400">{risk}</span>
          : <span className="text-fg-secondary">No buy in the last 30 days. Don&apos;t rebuy before {c.avoid_buying_until}.</span>}
      </td>
      <td className="py-1.5 text-right">
        <button type="button" className={BTN_SECONDARY_CLASS} aria-expanded={open} onClick={onToggle}>
          {open ? "Hide" : "Similar funds"}
        </button>
      </td>
    </tr>
  );
}

function Replacements({ portfolioId, symbol }: { portfolioId: string; symbol: string }) {
  const q = useQuery({
    queryKey: portfolioQueryKeys.taxReplacements(portfolioId, symbol),
    queryFn: () => getTaxReplacements(portfolioId, symbol),
    staleTime: 60 * 60_000,
  });
  if (q.isPending) return <p className="text-xs text-muted">Comparing {symbol} with broad and sector funds (first time can take a minute)…</p>;
  if (q.isError) return <p className="text-xs text-red-500" role="alert">{(q.error as Error).message}</p>;
  const d = q.data;
  return (
    <div className="space-y-1.5 text-xs">
      {d.ideas.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {d.ideas.map((i) => (
            <li key={i.symbol} className="rounded-md border border-border px-2 py-1">
              <span className="font-medium text-fg">{i.symbol}</span> <span className="text-fg-secondary">{i.name}</span>{" "}
              <span className="tabular-nums text-muted">corr {i.correlation.toFixed(2)} · {i.strength} match</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-fg-secondary">{d.message}</p>
      )}
      <p className="text-[11px] text-muted">{d.note}</p>
    </div>
  );
}

function Tile({ label, value, sub, tone = "text-fg" }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface px-3 py-2">
      <div className="truncate text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
      {sub && <div className="truncate text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

function fmtSigned(x: number, ccy: string): string {
  return x < 0 ? `−${fmtMoney(-x, ccy)}` : x > 0 ? `+${fmtMoney(x, ccy)}` : fmtMoney(0, ccy);
}

function fmtQty(x: number): string {
  return x.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function fmtNum(x: number): string {
  return x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}
