"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";

import { getPortfolioIncome, setIncomeTarget } from "@/lib/api";
import { fmtMoney } from "@/lib/currency";
import {
  FREQUENCY_LABEL,
  fillMonths,
  goalText,
  incomeHeadline,
  monthLabel,
  projectionSummary,
  type IncomeMonth,
  type IncomeReport,
} from "@/lib/income";
import { INCOME_COLORS, buildProjectionFigure } from "@/lib/incomeChart";
import { fmtPct, fmtSignedPct } from "@/lib/performance";
import { PORTFOLIO_STALE_TIMES, portfolioQueryKeys, samePortfolioPlaceholder } from "@/lib/portfolioQueries";
import { ALERT_BANNER_CLASS, BTN_PRIMARY_SM_CLASS, BTN_SECONDARY_CLASS, FIELD_INPUT_SM_CLASS } from "@/lib/uiClasses";
import { useDisplayCurrency } from "@/lib/useDisplayCurrency";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

const CARD = "rounded-lg border border-border bg-surface p-3";
const BAR = "bg-[#2a78d6] dark:bg-[#3987e5]"; // categorical slot 1, as on the other tabs

export function IncomePanel({ portfolioId }: { portfolioId: string }) {
  const { currency: ccy } = useDisplayCurrency();
  const query = useQuery({
    queryKey: portfolioQueryKeys.income(portfolioId, ccy),
    queryFn: () => getPortfolioIncome(portfolioId, ccy),
    placeholderData: samePortfolioPlaceholder(portfolioId),
    staleTime: PORTFOLIO_STALE_TIMES.income,
  });

  if (query.isPending) {
    return <div className={`${CARD} py-10 text-center text-sm text-muted`}>Loading dividend history…</div>;
  }
  if (query.isError) {
    return <div className={ALERT_BANNER_CLASS} role="alert">{(query.error as Error).message}</div>;
  }
  return <IncomeReportView report={query.data} portfolioId={portfolioId} refreshing={query.isFetching} />;
}

function IncomeReportView({ report: r, portfolioId, refreshing }: { report: IncomeReport; portfolioId: string; refreshing: boolean }) {
  const t = r.totals;
  const ccy = r.display_currency;
  const headline = incomeHeadline(r);

  return (
    <div className={`space-y-4 transition-opacity ${refreshing ? "opacity-70" : ""}`} aria-busy={refreshing}>
      {headline && <p className="text-sm font-medium text-fg">{headline}</p>}

      {r.warnings.length > 0 && (
        <ul className={`${ALERT_BANNER_CLASS} list-disc space-y-0.5 pl-6`}>
          {r.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
      {r.message && <div className={`${CARD} text-sm text-fg-secondary`}>{r.message}</div>}

      {t && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <StatTile label="Annual income" value={fmtMoney(t.annual_income, ccy)} sub="forward estimate" />
          <StatTile label="Monthly average" value={fmtMoney(t.monthly_income, ccy)} sub="annual ÷ 12" />
          <StatTile label="Yield" value={fmtPct(t.yield, 2)} sub={`on ${fmtMoney(t.portfolio_value, ccy)}`} />
          <StatTile label="Yield on cost" value={fmtPct(t.yield_on_cost, 2)} sub="on what you paid" />
          <StatTile label="5-year growth" value={fmtSignedPct(t.growth_5y, 1)} sub="a year, income-weighted" />
        </div>
      )}

      {t && <GoalCard report={r} portfolioId={portfolioId} />}

      {r.calendar.length > 0 && t && t.annual_income > 0 && <CalendarChart months={r.calendar} currency={ccy} />}

      {r.holdings.length > 0 && <HoldingsTable report={r} />}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        {r.received && <ReceivedChart received={r.received} currency={ccy} />}
        {r.projection && <ProjectionChart report={r} />}
      </div>

      <p className="text-[11px] leading-relaxed text-muted">{r.methodology}</p>
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface px-3 py-2">
      <div className="truncate text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-fg">{value}</div>
      {sub && <div className="truncate text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

function GoalCard({ report: r, portfolioId }: { report: IncomeReport; portfolioId: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const goal = goalText(r);
  const save = useMutation({
    mutationFn: (monthly: number | null) => setIncomeTarget(portfolioId, monthly),
    onSuccess: () => {
      setEditing(false);
      qc.invalidateQueries({ queryKey: portfolioQueryKeys.income(portfolioId) });
    },
  });
  const value = Number(text);
  const valid = text.trim() !== "" && Number.isFinite(value) && value > 0;

  return (
    <section className={CARD} aria-labelledby="income-goal-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="income-goal-heading" className="text-sm font-medium text-fg">Monthly income goal</h3>
        {!editing && (
          <div className="flex gap-2">
            <button type="button" className={BTN_SECONDARY_CLASS}
              onClick={() => { setText(r.target_monthly ? String(r.target_monthly) : ""); setEditing(true); }}>
              {r.target_monthly ? "Change goal" : "Set a goal"}
            </button>
            {r.target_monthly && (
              <button type="button" className={BTN_SECONDARY_CLASS} disabled={save.isPending} onClick={() => save.mutate(null)}>
                Remove
              </button>
            )}
          </div>
        )}
      </div>

      {editing && (
        <form className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(value); }}>
          <label htmlFor="income-goal-input" className="text-xs text-fg-secondary">{r.display_currency} a month</label>
          <input id="income-goal-input" type="number" inputMode="decimal" min="0" step="any" autoFocus value={text}
            onChange={(e) => setText(e.target.value)} className={`${FIELD_INPUT_SM_CLASS} w-32`} />
          <button type="submit" className={BTN_PRIMARY_SM_CLASS} disabled={!valid || save.isPending}>Save</button>
          <button type="button" className={BTN_SECONDARY_CLASS} onClick={() => setEditing(false)}>Cancel</button>
        </form>
      )}
      {save.isError && <p className="mt-2 text-xs text-red-500" role="alert">{(save.error as Error).message}</p>}

      {goal ? (
        <div className="mt-2">
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted-surface" role="progressbar"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(goal.pct * 100)} aria-label="Progress toward the income goal">
            <div className={`h-full rounded-full ${BAR}`} style={{ width: `${goal.pct * 100}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-fg-secondary">{goal.text}</p>
        </div>
      ) : (
        !editing && (
          <p className="mt-1 text-xs text-muted">
            Set how much monthly income you want from this portfolio to track progress toward it.
          </p>
        )
      )}
      {r.income_goal === "growth_only" && (
        <p className="mt-1.5 text-[11px] text-muted">Your investor profile says growth only, so income is a side effect here, not the aim.</p>
      )}
    </section>
  );
}

function CalendarChart({ months, currency }: { months: IncomeMonth[]; currency: string }) {
  const max = Math.max(...months.map((m) => m.amount), 0);
  const [active, setActive] = useState<string | null>(null);
  const shown = months.find((m) => m.month === active) ?? null;
  const yearChange = (i: number) => i > 0 && months[i].month.slice(0, 4) !== months[i - 1].month.slice(0, 4);

  return (
    <section className={CARD} aria-labelledby="income-calendar-heading">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="income-calendar-heading" className="text-sm font-medium text-fg">Next 12 months</h3>
        <span className="text-[11px] text-muted">By expected ex-dividend month; payment usually follows within weeks.</span>
      </div>
      <div className="flex h-36 items-end gap-1 sm:gap-2" onMouseLeave={() => setActive(null)}>
        {months.map((m, i) => (
          <button key={m.month} type="button"
            className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1 focus:outline-hidden"
            onMouseEnter={() => setActive(m.month)} onFocus={() => setActive(m.month)}
            onClick={() => setActive(active === m.month ? null : m.month)}
            aria-label={`${monthLabel(m.month, true)}: ${fmtMoney(m.amount, currency)} from ${m.payments.length} payments`}>
            <span className="hidden text-[10px] tabular-nums text-muted sm:block">
              {m.amount > 0 ? fmtMoney(m.amount, currency).replace(/\.\d+$/, "") : ""}
            </span>
            <span
              className={`w-full max-w-10 rounded-t ${BAR} ${active && active !== m.month ? "opacity-50" : ""} group-focus-visible:ring-2 group-focus-visible:ring-blue-500/50`}
              style={{ height: max > 0 ? `${Math.max(m.amount > 0 ? 3 : 0, (m.amount / max) * 100)}%` : 0 }} />
            <span className="text-[10px] text-muted">{yearChange(i) ? monthLabel(m.month, true).replace(" 20", " '") : monthLabel(m.month)}</span>
          </button>
        ))}
      </div>
      <div className="mt-2 min-h-10 text-xs text-fg-secondary" aria-live="polite">
        {shown ? (
          shown.payments.length ? (
            <>
              <span className="font-medium text-fg">{monthLabel(shown.month, true)} · {fmtMoney(shown.amount, currency)}</span>
              <span className="text-muted"> — </span>
              {shown.payments.map((p) => `${p.ticker} ${fmtMoney(p.amount, currency)} (ex ${p.ex_date.slice(5)})`).join(" · ")}
            </>
          ) : (
            <span className="text-muted">{monthLabel(shown.month, true)}: no payments expected.</span>
          )
        ) : (
          <span className="text-muted">Hover or tap a month to see which holdings pay.</span>
        )}
      </div>
    </section>
  );
}

function HoldingsTable({ report: r }: { report: IncomeReport }) {
  const ccy = r.display_currency;
  return (
    <section className={`${CARD} overflow-x-auto`} aria-labelledby="income-holdings-heading">
      <h3 id="income-holdings-heading" className="mb-2 text-sm font-medium text-fg">By holding</h3>
      <table className="w-full min-w-[760px] whitespace-nowrap text-xs">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
            <th className="py-1.5 pr-2 font-medium">Ticker</th>
            <th className="py-1.5 pr-2 font-medium">Pays</th>
            <th className="py-1.5 pr-2 font-medium">Last ex-date</th>
            <th className="py-1.5 pr-2 text-right font-medium">Last payment</th>
            <th className="py-1.5 pr-2 text-right font-medium">Forward / share</th>
            <th className="py-1.5 pr-2 text-right font-medium">Annual income</th>
            <th className="py-1.5 pr-2 text-right font-medium">Yield</th>
            <th className="py-1.5 pr-2 text-right font-medium">Yield on cost</th>
            <th className="py-1.5 pr-2 font-medium">Next ex-date</th>
            <th className="py-1.5 text-right font-medium">5y growth</th>
          </tr>
        </thead>
        <tbody>
          {r.holdings.map((h) => {
            const pays = h.annual_income > 0;
            return (
              <tr key={h.ticker} className={`border-b border-border/60 last:border-0 ${pays ? "" : "text-muted"}`}>
                <td className="py-1.5 pr-2 font-medium text-fg">{h.ticker}</td>
                <td className="py-1.5 pr-2">
                  {h.suspended ? <span className="text-amber-500">Suspended</span> : h.frequency ? FREQUENCY_LABEL[h.frequency] : "—"}
                </td>
                <td className="py-1.5 pr-2 tabular-nums">{h.last_ex_date ?? "—"}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{h.last_amount != null ? fmtPerShare(h.last_amount) : "—"}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{pays ? fmtPerShare(h.forward_per_share) : "—"}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-fg">{pays ? fmtMoney(h.annual_income, ccy) : "—"}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{fmtPct(h.yield, 2)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{fmtPct(h.yield_on_cost, 2)}</td>
                <td className="py-1.5 pr-2 tabular-nums">{h.next_ex_date ?? "—"}</td>
                <td className="py-1.5 text-right tabular-nums">{fmtSignedPct(h.growth_5y, 1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted">Per-share amounts are in each holding&apos;s own currency; income columns are in {ccy}.</p>
    </section>
  );
}

function fmtPerShare(x: number): string {
  return x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function ReceivedChart({ received, currency }: { received: NonNullable<IncomeReport["received"]>; currency: string }) {
  const now = new Date();
  const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const months = useMemo(() => fillMonths(received.by_month, thisMonth, 24), [received.by_month, thisMonth]);
  const max = Math.max(...months.map((m) => m.amount), 0);
  const ledger = received.source === "ledger";

  return (
    <section className={CARD} aria-labelledby="income-received-heading">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="income-received-heading" className="text-sm font-medium text-fg">
          {ledger ? "Dividends received" : "Dividends earned (estimate)"}
        </h3>
        <span className="text-xs tabular-nums text-fg-secondary">Last 12 months {fmtMoney(received.last_12_months, currency)}</span>
      </div>
      <p className="mb-2 text-[11px] text-muted">
        {ledger
          ? "From the DIVIDEND transactions in your ledger, by payment date."
          : "Today's shares × each past dividend, by ex-date. Record dividends in Transactions for actual amounts."}
      </p>
      {max > 0 ? (
        <>
          <div className="flex h-24 items-end gap-px sm:gap-0.5" role="img"
            aria-label={`Dividend income for the last 24 months; ${fmtMoney(received.last_12_months, currency)} in the last 12.`}>
            {months.map((m) => (
              <div key={m.month} className="flex h-full min-w-0 flex-1 items-end" title={`${monthLabel(m.month, true)}: ${fmtMoney(m.amount, currency)}`}>
                <div className={`w-full rounded-t-sm ${BAR}`} style={{ height: `${m.amount > 0 ? Math.max(3, (m.amount / max) * 100) : 0}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-muted">
            <span>{monthLabel(months[0].month, true)}</span>
            <span>{monthLabel(months[12].month, true)}</span>
            <span>{monthLabel(months[23].month, true)}</span>
          </div>
        </>
      ) : (
        <p className="py-6 text-center text-xs text-muted">No dividends in the last 24 months.</p>
      )}
    </section>
  );
}

function ProjectionChart({ report: r }: { report: IncomeReport }) {
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "light" ? "light" : "dark";
  const fig = useMemo(() => buildProjectionFigure(r.projection!, r.display_currency, theme), [r, theme]);
  const c = INCOME_COLORS[theme];

  return (
    <section className={CARD} aria-labelledby="income-projection-heading">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 id="income-projection-heading" className="text-sm font-medium text-fg">Income in 10 years</h3>
        <div className="flex items-center gap-3 text-xs text-fg-secondary" aria-label="Legend">
          <LegendSwatch color={c.drip} label="Reinvested" />
          <LegendSwatch color={c.noDrip} label="Taken as cash" />
        </div>
      </div>
      <Plot data={fig.data} layout={fig.layout} config={{ responsive: true, displayModeBar: false }}
        style={{ width: "100%", height: "260px" }} useResizeHandler />
      <p className="mt-1 text-[11px] leading-relaxed text-muted">{projectionSummary(r)}</p>
    </section>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="inline-block h-0.5 w-4 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
