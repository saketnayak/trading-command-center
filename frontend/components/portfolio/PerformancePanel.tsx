"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";

import { getPortfolioPerformance } from "@/lib/api";
import {
  BENCHMARK_PRESETS,
  PERFORMANCE_RANGES,
  PERIOD_KEYS,
  fmtPct,
  fmtRatio,
  fmtSignedPct,
  isValidBenchmark,
  performanceHeadline,
  returnTone,
  type PerformanceMode,
  type PerformanceRange,
  type PortfolioPerformance,
} from "@/lib/performance";
import { PERFORMANCE_COLORS, buildDrawdownFigure, buildGrowthFigure } from "@/lib/performanceChart";
import { PORTFOLIO_STALE_TIMES, portfolioQueryKeys } from "@/lib/portfolioQueries";
import { fmtMoney } from "@/lib/currency";
import { ALERT_BANNER_CLASS, FIELD_INPUT_SM_CLASS, selectionPillClass } from "@/lib/uiClasses";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

const MODES: { id: PerformanceMode; label: string; hint: string }[] = [
  { id: "auto", label: "Auto", hint: "Actual history when there is at least a month of uploads, otherwise what-if" },
  { id: "actual", label: "Actual", hint: "Follows your uploaded snapshots over time" },
  { id: "current", label: "What-if", hint: "Today's holdings held unchanged over the whole range" },
];

interface Props {
  portfolioId: string;
}

export function PerformancePanel({ portfolioId }: Props) {
  const [mode, setMode] = useState<PerformanceMode>("auto");
  const [range, setRange] = useState<PerformanceRange>("1y");
  const [benchmark, setBenchmark] = useState("SPY");
  const [customBenchmark, setCustomBenchmark] = useState("");

  const query = useQuery({
    queryKey: portfolioQueryKeys.performance(portfolioId, mode, range, benchmark),
    queryFn: () => getPortfolioPerformance(portfolioId, mode, range, benchmark),
    staleTime: PORTFOLIO_STALE_TIMES.performance,
    // Keep the old chart while range/mode/benchmark change, but never show
    // another portfolio's numbers while this one loads.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === portfolioId ? keepPreviousData(previous) : undefined,
  });

  const isPreset = BENCHMARK_PRESETS.some((b) => b.symbol === benchmark);
  const customValid = customBenchmark.trim() !== "" && isValidBenchmark(customBenchmark);

  return (
    <div className="space-y-4" aria-busy={query.isFetching}>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <fieldset className="min-w-0">
          <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Range</legend>
          <div className="flex flex-wrap gap-1">
            {PERFORMANCE_RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={range === r.id}
                onClick={() => setRange(r.id)}
                className={`${selectionPillClass(range === r.id, true)} !normal-case`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="min-w-0">
          <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Holdings</legend>
          <div className="flex flex-wrap gap-1">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                title={m.hint}
                aria-pressed={mode === m.id}
                onClick={() => setMode(m.id)}
                className={`${selectionPillClass(mode === m.id, true)} !normal-case`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="min-w-0">
          <label htmlFor="perf-benchmark" className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
            Benchmark
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              id="perf-benchmark"
              value={isPreset ? benchmark : "custom"}
              onChange={(e) => {
                if (e.target.value !== "custom") setBenchmark(e.target.value);
              }}
              className={`${FIELD_INPUT_SM_CLASS} !w-auto`}
            >
              {BENCHMARK_PRESETS.map((b) => (
                <option key={b.symbol} value={b.symbol}>
                  {b.label}
                </option>
              ))}
              <option value="custom">{isPreset ? "Other ticker…" : `Other: ${benchmark}`}</option>
            </select>
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (customValid) setBenchmark(customBenchmark.trim().toUpperCase());
              }}
            >
              <input
                aria-label="Custom benchmark ticker"
                placeholder="e.g. VTI"
                value={customBenchmark}
                onChange={(e) => setCustomBenchmark(e.target.value)}
                className={`${FIELD_INPUT_SM_CLASS} !w-24 uppercase placeholder:normal-case`}
                maxLength={16}
              />
              <button
                type="submit"
                disabled={!customValid}
                className="rounded-md px-2 py-1.5 text-xs text-blue-500 hover:text-blue-400 disabled:opacity-40"
              >
                Use
              </button>
            </form>
          </div>
        </div>
      </div>

      {query.isPending && (
        <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted">
          Loading price history… the first load for a portfolio can take a few seconds.
        </div>
      )}

      {query.isError && !query.data && (
        <div className={ALERT_BANNER_CLASS} role="alert">
          {query.error instanceof Error ? query.error.message : "Performance could not be loaded."}{" "}
          <button type="button" className="underline" onClick={() => query.refetch()}>
            Retry
          </button>
        </div>
      )}

      {query.data && <PerformanceBody data={query.data} refreshing={query.isFetching} />}
    </div>
  );
}

function PerformanceBody({ data, refreshing }: { data: PortfolioPerformance; refreshing: boolean }) {
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "light" ? "light" : "dark";
  const growth = useMemo(() => buildGrowthFigure(data.series, data.benchmark, theme), [data, theme]);
  const drawdown = useMemo(() => buildDrawdownFigure(data.series, theme), [data, theme]);

  if (data.message && data.series.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted">
        {data.message}
      </div>
    );
  }

  const s = data.stats;
  const b = data.benchmark_stats;
  const headline = performanceHeadline(data);
  const lastValue = data.series[data.series.length - 1]?.value;

  return (
    <div className={`space-y-4 transition-opacity ${refreshing ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {headline && <p className="text-sm font-medium text-fg">{headline}</p>}
        <span className="rounded-md border border-input-border px-2 py-0.5 text-[11px] text-muted">
          {data.mode === "actual" ? "Actual history" : "What-if: today's holdings"} · {data.start} → {data.end}
        </span>
      </div>

      {data.warnings.length > 0 && (
        <ul className={`${ALERT_BANNER_CLASS} list-disc space-y-0.5 pl-6`}>
          {data.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <StatTile label="Total return" value={fmtSignedPct(s?.total_return)} tone={returnTone(s?.total_return)}
          sub={b ? `${data.benchmark} ${fmtSignedPct(b.total_return)}` : undefined} />
        <StatTile label={`vs ${data.benchmark}`} value={fmtSignedPct(s?.excess_return)} tone={returnTone(s?.excess_return)}
          sub="difference in total return" />
        <StatTile label="Annualised" value={fmtSignedPct(s?.annualised_return)} tone={returnTone(s?.annualised_return)}
          sub={s?.annualised_return == null ? "needs 1 year" : b ? `${data.benchmark} ${fmtSignedPct(b.annualised_return)}` : undefined} />
        <StatTile label="Volatility" value={fmtPct(s?.volatility)} sub={b ? `${data.benchmark} ${fmtPct(b.volatility)}` : "annualised"} />
        <StatTile label="Sharpe" value={fmtRatio(s?.sharpe)} sub={b ? `${data.benchmark} ${fmtRatio(b.sharpe)} · rf 0%` : "risk-free 0%"} />
        <StatTile label="Max drawdown" value={fmtSignedPct(s?.max_drawdown, 1)} tone={returnTone(s?.max_drawdown)}
          sub={s?.max_drawdown_trough ? `trough ${s.max_drawdown_trough}` : undefined} />
        <StatTile label="Beta" value={fmtRatio(s?.beta)} sub={s?.correlation != null ? `correlation ${fmtRatio(s.correlation)}` : `vs ${data.benchmark}`} />
      </div>

      <section className="rounded-lg border border-border bg-surface p-3">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-fg">Growth of 100</h3>
          <div className="flex items-center gap-3 text-xs text-fg-secondary" aria-label="Legend">
            <LegendSwatch color={PERFORMANCE_COLORS[theme].portfolio} label="Portfolio" />
            {data.series.some((p) => p.benchmark_index != null) && (
              <LegendSwatch color={PERFORMANCE_COLORS[theme].benchmark} label={data.benchmark} />
            )}
            {lastValue != null && (
              <span className="text-muted">Value now {fmtMoney(lastValue, data.display_currency)}</span>
            )}
          </div>
        </div>
        <Plot data={growth.data} layout={growth.layout} config={{ responsive: true, displayModeBar: false }}
          style={{ width: "100%", height: "300px" }} useResizeHandler />
      </section>

      <section className="rounded-lg border border-border bg-surface p-3">
        <h3 className="mb-1 text-sm font-medium text-fg">Drawdown from peak</h3>
        <Plot data={drawdown.data} layout={drawdown.layout} config={{ responsive: true, displayModeBar: false }}
          style={{ width: "100%", height: "140px" }} useResizeHandler />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <PeriodTable data={data} />
        <ContributionList data={data} theme={theme} />
      </div>

      <details className="rounded-lg border border-border bg-surface px-3 py-2 text-xs">
        <summary className="cursor-pointer text-fg-secondary">Chart data (month ends)</summary>
        <MonthlyTable data={data} />
      </details>

      <p className="text-[11px] leading-relaxed text-muted">{data.methodology}</p>
    </div>
  );
}

function StatTile({ label, value, sub, tone = "text-fg" }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface px-3 py-2">
      <div className="truncate text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
      {sub && <div className="truncate text-[11px] text-muted">{sub}</div>}
    </div>
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

function PeriodTable({ data }: { data: PortfolioPerformance }) {
  const rows = PERIOD_KEYS.filter((k) => data.period_returns?.[k] != null);
  return (
    <section className="rounded-lg border border-border bg-surface p-3">
      <h3 className="mb-2 text-sm font-medium text-fg">Trailing returns</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted">Not enough history for trailing periods yet.</p>
      ) : (
        <table className="w-full text-xs tabular-nums">
          <thead className="text-muted">
            <tr>
              <th className="py-1 text-left font-medium">Period</th>
              <th className="py-1 text-right font-medium">Portfolio</th>
              <th className="py-1 text-right font-medium">{data.benchmark}</th>
              <th className="py-1 text-right font-medium">Difference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((k) => {
              const p = data.period_returns?.[k] ?? null;
              const bm = data.benchmark_period_returns?.[k] ?? null;
              const diff = p != null && bm != null ? p - bm : null;
              return (
                <tr key={k} className="border-t border-border/60">
                  <td className="py-1 text-fg-secondary">{k}</td>
                  <td className={`py-1 text-right ${returnTone(p)}`}>{fmtSignedPct(p)}</td>
                  <td className="py-1 text-right text-fg-secondary">{fmtSignedPct(bm)}</td>
                  <td className={`py-1 text-right ${returnTone(diff)}`}>{fmtSignedPct(diff)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ContributionList({ data, theme }: { data: PortfolioPerformance; theme: "light" | "dark" }) {
  const c = PERFORMANCE_COLORS[theme];
  const rows = data.holdings.filter((h) => h.contribution != null);
  const maxAbs = Math.max(0.0001, ...rows.map((h) => Math.abs(h.contribution ?? 0)));
  return (
    <section className="rounded-lg border border-border bg-surface p-3">
      <h3 className="text-sm font-medium text-fg">Contribution to return</h3>
      <p className="mb-2 text-[11px] text-muted">Percentage points each holding added or removed (sum of daily contributions).</p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted">No contributions in this window.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((h) => {
            const v = h.contribution ?? 0;
            const width = `${(Math.abs(v) / maxAbs) * 50}%`;
            return (
              <li
                key={h.ticker}
                className="grid grid-cols-[4.5rem_1fr_4.5rem] items-center gap-2 text-xs"
                title={`${h.ticker}: ${fmtSignedPct(v)} contribution · price ${fmtSignedPct(h.price_return)} · weight now ${fmtPct(h.weight)}`}
              >
                <span className="truncate font-medium text-fg">{h.ticker}</span>
                <span className="relative h-3" aria-hidden>
                  <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
                  <span
                    className={`absolute inset-y-0 ${v >= 0 ? "left-1/2 rounded-r" : "right-1/2 rounded-l"}`}
                    style={{ width, backgroundColor: v >= 0 ? c.gain : c.loss }}
                  />
                </span>
                <span className={`text-right tabular-nums ${returnTone(v)}`}>{fmtSignedPct(v)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function MonthlyTable({ data }: { data: PortfolioPerformance }) {
  const rows = useMemo(() => {
    const byMonth = new Map<string, (typeof data.series)[number]>();
    for (const p of data.series) byMonth.set(p.date.slice(0, 7), p);
    return [...byMonth.values()];
  }, [data]);
  return (
    <div className="mt-2 max-h-64 overflow-auto">
      <table className="w-full tabular-nums">
        <thead className="sticky top-0 bg-surface text-muted">
          <tr>
            <th className="py-1 text-left font-medium">Date</th>
            <th className="py-1 text-right font-medium">Value</th>
            <th className="py-1 text-right font-medium">Portfolio index</th>
            <th className="py-1 text-right font-medium">{data.benchmark} index</th>
            <th className="py-1 text-right font-medium">Drawdown</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.date} className="border-t border-border/60 text-fg-secondary">
              <td className="py-1">{p.date}</td>
              <td className="py-1 text-right">{fmtMoney(p.value, data.display_currency)}</td>
              <td className="py-1 text-right">{p.index.toFixed(1)}</td>
              <td className="py-1 text-right">{p.benchmark_index != null ? p.benchmark_index.toFixed(1) : "—"}</td>
              <td className="py-1 text-right">{fmtPct(p.drawdown)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
