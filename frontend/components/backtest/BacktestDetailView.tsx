"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import type { Data, Layout } from "plotly.js";

import { StatusBadge } from "@/components/backtest/BacktestList";
import { PageHeader, PageTitle } from "@/components/layout/PageHeader";
import { abortBacktest, deleteBacktest, getBacktest } from "@/lib/api";
import {
  ACTIVE_STATUSES,
  BENCHMARK_LABELS,
  equityCurve,
  type BacktestDetail,
  type BacktestSummaryStats,
} from "@/lib/backtest";
import { fmtPct, fmtRatio, fmtSignedPct, returnTone } from "@/lib/performance";
import { PERFORMANCE_COLORS } from "@/lib/performanceChart";
import { ALERT_BANNER_CLASS, BTN_SECONDARY_CLASS } from "@/lib/uiClasses";
import { THEMES } from "@/lib/wave/chartTheme";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });
const CARD = "rounded-lg border border-border bg-surface p-3";

export function BacktestDetailView({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ["backtest", id],
    queryFn: () => getBacktest(id),
    refetchInterval: (query) => (query.state.data && ACTIVE_STATUSES.includes(query.state.data.status) ? 3000 : false),
  });
  if (q.isPending) return <div className={`${CARD} py-10 text-center text-sm text-muted`}>Loading backtest…</div>;
  if (q.isError) return <div className={ALERT_BANNER_CLASS} role="alert">{(q.error as Error).message}</div>;
  return <Detail bt={q.data} />;
}

function Detail({ bt }: { bt: BacktestDetail }) {
  const router = useRouter();
  const qc = useQueryClient();
  const active = ACTIVE_STATUSES.includes(bt.status);
  const stop = useMutation({ mutationFn: () => abortBacktest(bt.id), onSuccess: () => qc.invalidateQueries({ queryKey: ["backtest", bt.id] }) });
  const remove = useMutation({
    mutationFn: () => deleteBacktest(bt.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["backtests"] }); router.push("/runs/backtest"); },
  });
  const c = bt.config;
  const r = bt.report;
  const pct = bt.total_decisions ? bt.done / bt.total_decisions : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        back={{ href: "/runs/backtest", label: "← Backtest Lab" }}
        title={<PageTitle>{bt.name}</PageTitle>}
        description={`${c.tickers.join(", ")} · ${c.start_date} → ${c.end_date} · decide ${c.frequency === "weekly" ? "each Friday" : "each trading day"}, hold ${c.horizon_days} trading days · ${c.llm_provider} · ${c.llm_model} · ${c.depth} · ${c.analysts.join(", ")}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={bt.status} />
            {active ? (
              <button type="button" className={BTN_SECONDARY_CLASS} disabled={stop.isPending} onClick={() => stop.mutate()}>
                {stop.isPending || stop.isSuccess ? "Stopping…" : "Stop"}
              </button>
            ) : (
              <button type="button" className={BTN_SECONDARY_CLASS} disabled={remove.isPending}
                onClick={() => { if (window.confirm("Delete this backtest?")) remove.mutate(); }}>Delete</button>
            )}
          </div>
        }
      />

      {c.dry_run && (
        <p className="rounded-md border border-border bg-muted-surface px-3 py-2 text-xs text-fg-secondary">
          <span className="font-medium text-fg">Dry run.</span> A stub model answered BUY every time, so these numbers check the harness
          (dates, prices, scoring), not the agents. Run it for real to judge {c.llm_model}.
        </p>
      )}

      <section className={CARD} aria-label="Progress">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-secondary">
          <span>{bt.done} of {bt.total_decisions} decisions{active ? (bt.status === "pending" ? " · waiting for another backtest to finish" : " · each takes a full analysis") : ""}</span>
          <span>{c.dry_run ? "Free (stub model)" : `Estimated cost $${bt.cost_usd.toFixed(2)}${c.budget_usd ? ` of $${c.budget_usd} cap` : ""}`}</span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted-surface" role="progressbar"
          aria-valuemin={0} aria-valuemax={bt.total_decisions} aria-valuenow={bt.done} aria-label="Decisions done">
          <div className="h-full rounded-full bg-[#2a78d6] transition-all dark:bg-[#3987e5]" style={{ width: `${pct * 100}%` }} />
        </div>
        {bt.error && <p className={`mt-2 text-xs ${bt.status === "failed" ? "text-red-500" : "text-amber-700 dark:text-amber-400"}`}>{bt.error}</p>}
      </section>

      {r && (
        <>
          <p className={`rounded-md border px-3 py-2 text-xs leading-relaxed ${r.headline_basis === "out_of_sample"
            ? "border-border bg-surface text-fg-secondary" : "border-amber-700/40 bg-amber-900/10 text-amber-700 dark:text-amber-300"}`}>
            {r.note}
            {c.training_cutoff && ` Cutoff from ${c.cutoff_source === "you" ? "you" : "the published model card (approximate)"}.`}
          </p>
          {r.headline && <Headline stats={r.headline} basis={r.headline_basis} />}
          {r.in_sample && r.out_of_sample && (
            <p className="text-xs text-fg-secondary">
              Before the cutoff (in sample, {r.counts.in_sample} decisions): {fmtSignedPct(r.in_sample.total_return, 1)} total,
              hit rate {fmtPct(r.in_sample.hit_rate, 0)}, against {fmtSignedPct(r.out_of_sample.total_return, 1)} and{" "}
              {fmtPct(r.out_of_sample.hit_rate, 0)} after it. A big gap is a sign of hindsight.
            </p>
          )}
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <CurveChart bt={bt} />
            {r.headline && <Benchmarks stats={r.headline} />}
          </div>
        </>
      )}

      {bt.trades.length > 0 && <Trades bt={bt} />}
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

function Headline({ stats: s, basis }: { stats: BacktestSummaryStats; basis: string }) {
  const bh = s.benchmarks.buy_and_hold;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <Tile label="Total return" value={fmtSignedPct(s.total_return, 1)} tone={returnTone(s.total_return)}
        sub={basis === "out_of_sample" ? `${s.decisions} out-of-sample decisions` : `${s.decisions} decisions`} />
      <Tile label="vs buy and hold" value={fmtSignedPct(s.excess_vs_buy_and_hold, 1)} tone={returnTone(s.excess_vs_buy_and_hold)}
        sub={bh ? `buy and hold ${fmtSignedPct(bh.total_return, 1)}` : undefined} />
      <Tile label="Hit rate" value={fmtPct(s.hit_rate, 0)} sub={`of ${s.signals.BUY + s.signals.SELL} BUY/SELL calls`} />
      <Tile label="Expectancy" value={fmtSignedPct(s.expectancy, 2)} sub="average BUY/SELL return" />
      <Tile label="Sharpe" value={fmtRatio(s.sharpe)} sub="annualised by decisions" />
      <Tile label="Max drawdown" value={fmtSignedPct(s.max_drawdown, 1)} tone={returnTone(s.max_drawdown)}
        sub={`${s.signals.BUY} buy · ${s.signals.SELL} sell · ${s.signals.HOLD} hold`} />
    </div>
  );
}

function Benchmarks({ stats: s }: { stats: BacktestSummaryStats }) {
  const rows = [{ key: "strategy", label: "The agents", ...s }, ...Object.entries(s.benchmarks).map(([key, b]) => ({ key, label: BENCHMARK_LABELS[key] ?? key, ...b }))];
  return (
    <section className={`${CARD} overflow-x-auto`} aria-labelledby="bt-bench-heading">
      <h2 id="bt-bench-heading" className="mb-2 text-sm font-medium text-fg">Against simple rules</h2>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
            <th className="py-1.5 pr-2 font-medium">Strategy</th>
            <th className="py-1.5 pr-2 text-right font-medium">Total</th>
            <th className="py-1.5 pr-2 text-right font-medium">Sharpe</th>
            <th className="py-1.5 text-right font-medium">Max DD</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={`border-b border-border/60 last:border-0 ${row.key === "strategy" ? "font-medium text-fg" : "text-fg-secondary"}`}>
              <td className="py-1.5 pr-2">{row.label}</td>
              <td className={`py-1.5 pr-2 text-right tabular-nums ${returnTone(row.total_return)}`}>{fmtSignedPct(row.total_return, 1)}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{fmtRatio(row.sharpe)}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtSignedPct(row.max_drawdown, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted">Each rule trades the same tickers, dates and holding period, with the same costs.</p>
    </section>
  );
}

function CurveChart({ bt }: { bt: BacktestDetail }) {
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "light" ? "light" : "dark";
  const cutoff = bt.report?.cutoff ?? null;
  const fig = useMemo(() => {
    const t = THEMES[theme];
    const colors = PERFORMANCE_COLORS[theme];
    const agents = equityCurve(bt.trades, (x) => x.realised_return);
    const bh = equityCurve(bt.trades, (x) => x.benchmark_returns.buy_and_hold);
    const data: Data[] = [
      { type: "scatter", mode: "lines", name: "Agents", x: agents.dates, y: agents.values, line: { color: colors.portfolio, width: 2 },
        hovertemplate: "Agents %{y:.3f}<extra></extra>" },
      { type: "scatter", mode: "lines", name: "Buy and hold", x: bh.dates, y: bh.values, line: { color: colors.benchmark, width: 1.5, dash: "dot" },
        hovertemplate: "Buy and hold %{y:.3f}<extra></extra>" },
    ];
    const first = agents.dates[0];
    const last = agents.dates[agents.dates.length - 1];
    const showCutoff = cutoff && first && last && cutoff > first && cutoff < last;
    const layout: Partial<Layout> = {
      height: 260, margin: { l: 44, r: 12, t: 8, b: 30 }, paper_bgcolor: t.paper, plot_bgcolor: t.bg,
      font: { color: t.font, size: 11 }, hovermode: "x unified", showlegend: false,
      hoverlabel: { bgcolor: t.legendBg, bordercolor: t.legendBorder, font: { color: t.font } },
      xaxis: { type: "date", gridcolor: "rgba(0,0,0,0)", linecolor: t.axis, fixedrange: true },
      yaxis: { gridcolor: t.grid, fixedrange: true, tickformat: ".3f" },
      shapes: showCutoff ? [{ type: "line", x0: cutoff, x1: cutoff, yref: "paper", y0: 0, y1: 1, line: { color: t.axis, width: 1, dash: "dot" } }] : [],
      annotations: showCutoff ? [{ x: cutoff, yref: "paper", y: 1, text: "training cutoff", showarrow: false, xanchor: "left", font: { size: 10, color: t.font } }] : [],
    };
    return { data, layout };
  }, [bt.trades, cutoff, theme]);
  const colors = PERFORMANCE_COLORS[theme];
  return (
    <section className={CARD} aria-labelledby="bt-curve-heading">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 id="bt-curve-heading" className="text-sm font-medium text-fg">Growth of 1, every decision</h2>
        <div className="flex items-center gap-3 text-xs text-fg-secondary" aria-label="Legend">
          <Swatch color={colors.portfolio} label="Agents" />
          <Swatch color={colors.benchmark} label="Buy and hold" dotted />
        </div>
      </div>
      <Plot data={fig.data} layout={fig.layout} config={{ responsive: true, displayModeBar: false }}
        style={{ width: "100%", height: "260px" }} useResizeHandler />
      <p className="mt-1 text-[11px] text-muted">Each date is an equal-weight average of that date&apos;s decisions; the line includes in-sample dates.</p>
    </section>
  );
}

function Swatch({ color, label, dotted = false }: { color: string; label: string; dotted?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="inline-block w-4" style={dotted ? { borderTop: `2px dotted ${color}` } : { height: 2, borderRadius: 9999, backgroundColor: color }} />
      {label}
    </span>
  );
}

function Trades({ bt }: { bt: BacktestDetail }) {
  const cutoff = bt.report?.cutoff ?? bt.config.training_cutoff;
  const rows = [...bt.trades].sort((a, b) => (a.decision_date === b.decision_date ? a.ticker.localeCompare(b.ticker) : a.decision_date < b.decision_date ? 1 : -1));
  return (
    <section className={`${CARD} overflow-x-auto`} aria-labelledby="bt-trades-heading">
      <h2 id="bt-trades-heading" className="mb-2 text-sm font-medium text-fg">Decisions</h2>
      <table className="w-full min-w-[760px] whitespace-nowrap text-xs">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
            <th className="py-1.5 pr-2 font-medium">Date</th>
            <th className="py-1.5 pr-2 font-medium">Ticker</th>
            <th className="py-1.5 pr-2 font-medium">Call</th>
            <th className="py-1.5 pr-2 text-right font-medium">Size asked</th>
            <th className="py-1.5 pr-2 text-right font-medium">Entry → exit</th>
            <th className="py-1.5 pr-2 text-right font-medium">Return</th>
            <th className="py-1.5 pr-2 text-right font-medium">Buy and hold</th>
            <th className="py-1.5 pr-2 font-medium">Sample</th>
            <th className="py-1.5 font-medium">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const sample = !cutoff ? "unknown" : t.decision_date > cutoff ? "out" : "in";
            return (
              <tr key={`${t.decision_date}-${t.ticker}`} className="border-b border-border/60 last:border-0" title={t.rationale || undefined}>
                <td className="py-1.5 pr-2 tabular-nums">{t.decision_date}</td>
                <td className="py-1.5 pr-2 font-medium text-fg">{t.ticker}</td>
                <td className={`py-1.5 pr-2 font-medium ${t.signal === "BUY" ? "text-emerald-600 dark:text-emerald-400" : t.signal === "SELL" ? "text-red-600 dark:text-red-400" : "text-fg-secondary"}`}>{t.signal}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{t.size_fraction != null ? fmtPct(t.size_fraction, 0) : "—"}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-fg-secondary">
                  {t.entry_price != null && t.exit_price != null ? `${t.entry_price.toFixed(2)} → ${t.exit_price.toFixed(2)}` : "—"}
                </td>
                <td className={`py-1.5 pr-2 text-right tabular-nums ${returnTone(t.realised_return)}`}>{fmtSignedPct(t.realised_return, 2)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-fg-secondary">{fmtSignedPct(t.benchmark_returns.buy_and_hold, 2)}</td>
                <td className="py-1.5 pr-2">
                  <span className={sample === "out" ? "text-fg-secondary" : "text-amber-700 dark:text-amber-400"}>
                    {sample === "out" ? "out" : sample === "in" ? "in (hindsight)" : "unknown"}
                  </span>
                </td>
                <td className="max-w-[16rem] truncate py-1.5 text-muted">{t.notes}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted">
        Returns are scaled by the position size the agents asked for, capped at 20%, after costs, so they are smaller than the stock&apos;s move.
        Hover a row for the rationale.
      </p>
    </section>
  );
}
