"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";

import { getPortfolioRisk } from "@/lib/api";
import { fmtMoney } from "@/lib/currency";
import { BENCHMARK_PRESETS, fmtPct, fmtRatio, fmtSignedPct, returnTone } from "@/lib/performance";
import { PORTFOLIO_STALE_TIMES, portfolioQueryKeys } from "@/lib/portfolioQueries";
import {
  RISK_LOOKBACKS,
  clusterSentence,
  riskOutlier,
  stressMethod,
  varHeadline,
  type PortfolioRisk,
  type RiskLookback,
} from "@/lib/risk";
import { RISK_COLORS, buildCorrelationFigure, buildFanFigure } from "@/lib/riskChart";
import { ALERT_BANNER_CLASS, FIELD_INPUT_SM_CLASS, selectionPillClass } from "@/lib/uiClasses";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

const CARD = "rounded-lg border border-border bg-surface p-3";

export function PortfolioRiskPanel({ portfolioId }: { portfolioId: string }) {
  const [lookback, setLookback] = useState<RiskLookback>("1y");
  const [benchmark, setBenchmark] = useState("SPY");

  const query = useQuery({
    queryKey: portfolioQueryKeys.risk(portfolioId, lookback, benchmark),
    queryFn: () => getPortfolioRisk(portfolioId, lookback, benchmark),
    staleTime: PORTFOLIO_STALE_TIMES.risk,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === portfolioId ? keepPreviousData(previous) : undefined,
  });

  return (
    <div className="space-y-4" aria-busy={query.isFetching}>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <fieldset className="min-w-0">
          <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Lookback</legend>
          <div className="flex flex-wrap gap-1">
            {RISK_LOOKBACKS.map((l) => (
              <button
                key={l.id}
                type="button"
                aria-pressed={lookback === l.id}
                onClick={() => setLookback(l.id)}
                className={`${selectionPillClass(lookback === l.id, true)} !normal-case`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="min-w-0">
          <label htmlFor="risk-benchmark" className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
            Beta against
          </label>
          <select
            id="risk-benchmark"
            value={benchmark}
            onChange={(e) => setBenchmark(e.target.value)}
            className={`${FIELD_INPUT_SM_CLASS} !w-auto`}
          >
            {BENCHMARK_PRESETS.map((b) => (
              <option key={b.symbol} value={b.symbol}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {query.isPending && (
        <div className={`${CARD} py-10 text-center text-sm text-muted`}>
          Measuring risk… the first load can take a few seconds while prices are downloaded.
        </div>
      )}
      {query.isError && !query.data && (
        <div className={ALERT_BANNER_CLASS} role="alert">
          {query.error instanceof Error ? query.error.message : "Risk could not be loaded."}{" "}
          <button type="button" className="underline" onClick={() => query.refetch()}>
            Retry
          </button>
        </div>
      )}
      {query.data && <RiskBody data={query.data} refreshing={query.isFetching} />}
    </div>
  );
}

function RiskBody({ data, refreshing }: { data: PortfolioRisk; refreshing: boolean }) {
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "light" ? "light" : "dark";
  const risk = data.risk;
  const corrFig = useMemo(
    () => (risk && risk.correlation.tickers.length > 1 ? buildCorrelationFigure(risk.correlation.tickers, risk.correlation.matrix, theme) : null),
    [risk, theme],
  );
  const fanFig = useMemo(
    () => (risk?.monte_carlo ? buildFanFigure(risk.monte_carlo.fan, theme) : null),
    [risk, theme],
  );

  if (!risk) {
    return (
      <div className="space-y-3">
        {data.warnings.length > 0 && <Warnings items={data.warnings} />}
        <div className={`${CARD} py-10 text-center text-sm text-muted`}>{data.message ?? "No risk data."}</div>
      </div>
    );
  }

  const s = risk.stats;
  const conc = risk.concentration;
  const ccy = data.display_currency;
  const headline = varHeadline(data);
  const outlier = riskOutlier(risk.holdings);
  const mc = risk.monte_carlo;

  return (
    <div className={`space-y-4 transition-opacity ${refreshing ? "opacity-70" : ""}`}>
      <div className="space-y-1">
        {headline && <p className="text-sm font-medium text-fg">{headline}</p>}
        <p className="text-xs text-muted">
          Today&apos;s holdings, measured over {risk.observations} trading days{data.as_of ? ` to ${data.as_of}` : ""}.
        </p>
      </div>

      {data.warnings.length > 0 && <Warnings items={data.warnings} />}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Tile label="Volatility" value={fmtPct(s.volatility)} sub="annualised" />
        <Tile label={`Beta vs ${data.benchmark}`} value={fmtRatio(s.beta)} sub={s.correlation != null ? `correlation ${fmtRatio(s.correlation)}` : undefined} />
        <Tile label="1-day VaR 95%" value={fmtPct(s.var_95)} sub={s.var_95_value != null ? fmtMoney(s.var_95_value, ccy) : undefined} />
        <Tile label="1-day CVaR 95%" value={fmtPct(s.cvar_95)} sub={s.cvar_95_value != null ? `avg of worst 5%: ${fmtMoney(s.cvar_95_value, ccy)}` : undefined} />
        <Tile label="Max drawdown" value={fmtSignedPct(s.max_drawdown, 1)} tone={returnTone(s.max_drawdown)} sub="today's weights" />
        <Tile label="Effective holdings" value={conc.effective_holdings != null ? conc.effective_holdings.toFixed(1) : "—"} sub={`of ${conc.holdings} positions`} />
        <Tile label="Top 5 weight" value={fmtPct(conc.top5_weight, 0)} sub={`largest ${fmtPct(conc.top1_weight, 0)}`} />
      </div>

      {(risk.clusters.length > 0 || outlier) && (
        <ul className="space-y-1 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-fg-secondary">
          {outlier && (
            <li>
              <span className="font-medium text-fg">{outlier.ticker}</span> is {fmtPct(outlier.weight, 0)} of your value but{" "}
              {fmtPct(outlier.risk_share, 0)} of your risk.
            </li>
          )}
          {risk.clusters.slice(0, 3).map((c) => (
            <li key={c.tickers.join("-")}>{clusterSentence(c)}</li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <RiskShares data={data} theme={theme} />
        <section className={CARD}>
          <h3 className="text-sm font-medium text-fg">How your holdings move together</h3>
          <p className="mb-1 text-[11px] text-muted">
            Correlation of daily returns: red moves together, blue moves opposite.
            {risk.correlation.truncated ? ` Largest ${risk.correlation.tickers.length} holdings shown.` : ""}
          </p>
          {corrFig ? (
            <Plot data={corrFig.data} layout={corrFig.layout} config={{ responsive: true, displayModeBar: false }}
              style={{ width: "100%", height: `${corrFig.layout.height}px` }} useResizeHandler />
          ) : (
            <p className="text-xs text-muted">Needs at least two holdings.</p>
          )}
        </section>
      </div>

      <StressTable data={data} />

      {mc && fanFig && (
        <section className={CARD}>
          <h3 className="text-sm font-medium text-fg">Range of outcomes over the next year</h3>
          <p className="mb-1 text-[11px] text-muted">
            {mc.paths.toLocaleString()} simulated years built from 5-day slices of this portfolio&apos;s last {mc.observations} trading days.
            Not a forecast: it assumes the future looks like the lookback.
          </p>
          <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-secondary">
            <span>
              Middle 90%: <b className="text-fg">{fmtSignedPct(mc.terminal.p5, 0)}</b> to <b className="text-fg">{fmtSignedPct(mc.terminal.p95, 0)}</b>
            </span>
            <span>Median {fmtSignedPct(mc.terminal.p50, 0)}</span>
            <span>Chance of any loss {fmtPct(mc.prob_loss, 0)}</span>
            <span>Of losing 20%+ {fmtPct(mc.prob_loss_20, 0)}</span>
          </div>
          <FanLegend theme={theme} />
          <Plot data={fanFig.data} layout={fanFig.layout} config={{ responsive: true, displayModeBar: false }}
            style={{ width: "100%", height: "240px" }} useResizeHandler />
        </section>
      )}

      <p className="text-[11px] leading-relaxed text-muted">{data.methodology}</p>
    </div>
  );
}

function Warnings({ items }: { items: string[] }) {
  return (
    <ul className={`${ALERT_BANNER_CLASS} list-disc space-y-0.5 pl-6`}>
      {items.map((w) => (
        <li key={w}>{w}</li>
      ))}
    </ul>
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

function RiskShares({ data, theme }: { data: PortfolioRisk; theme: "light" | "dark" }) {
  const c = RISK_COLORS[theme];
  const rows = data.risk?.holdings ?? [];
  const max = Math.max(0.01, ...rows.flatMap((h) => [h.weight ?? 0, h.risk_share ?? 0]));
  return (
    <section className={CARD}>
      <h3 className="text-sm font-medium text-fg">Where your risk comes from</h3>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] text-fg-secondary" aria-label="Legend">
        <Swatch color={c.weight} label="Share of value" />
        <Swatch color={c.risk} label="Share of risk (variance)" />
      </div>
      <ul className="space-y-2">
        {rows.map((h) => (
          <li
            key={h.ticker}
            className="grid grid-cols-[4.5rem_1fr_6.5rem] items-center gap-2 text-xs"
            title={`${h.ticker}: ${fmtPct(h.weight)} of value, ${fmtPct(h.risk_share)} of risk · volatility ${fmtPct(h.volatility)} · beta ${fmtRatio(h.beta)}`}
          >
            <span className="truncate font-medium text-fg">{h.ticker}</span>
            <span className="space-y-0.5" aria-hidden>
              <span className="block h-1.5 rounded-r" style={{ width: `${((h.weight ?? 0) / max) * 100}%`, backgroundColor: c.weight }} />
              <span className="block h-1.5 rounded-r" style={{ width: `${(Math.max(h.risk_share ?? 0, 0) / max) * 100}%`, backgroundColor: c.risk }} />
            </span>
            <span className="text-right tabular-nums text-fg-secondary">
              {fmtPct(h.weight, 0)} · {fmtPct(h.risk_share, 0)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="inline-block h-2 w-3 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function FanLegend({ theme }: { theme: "light" | "dark" }) {
  const c = RISK_COLORS[theme];
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-fg-secondary" aria-label="Legend">
      <Swatch color={c.outer} label="5–95% of outcomes" />
      <Swatch color={c.inner} label="25–75%" />
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-0.5 w-4 rounded-full" style={{ backgroundColor: c.median }} />
        Median
      </span>
    </div>
  );
}

function StressTable({ data }: { data: PortfolioRisk }) {
  const ccy = data.display_currency;
  return (
    <section className={CARD}>
      <h3 className="text-sm font-medium text-fg">If a past sell-off happened again</h3>
      <p className="mb-2 text-[11px] text-muted">Today&apos;s holdings run through historical market falls.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs tabular-nums">
          <thead className="text-muted">
            <tr>
              <th className="py-1 text-left font-medium">Scenario</th>
              <th className="py-1 text-right font-medium">S&amp;P 500</th>
              <th className="py-1 text-right font-medium">Your portfolio</th>
              <th className="py-1 text-right font-medium">Impact</th>
              <th className="py-1 pl-3 text-left font-medium">Hit hardest</th>
              <th className="py-1 pl-3 text-left font-medium">How</th>
            </tr>
          </thead>
          <tbody>
            {data.stress.map((s) => (
              <tr key={s.id} className="border-t border-border/60 align-top">
                <td className="py-1.5 pr-2">
                  <div className="font-medium text-fg" title={s.note}>{s.name}</div>
                  <div className="text-[11px] text-muted">{s.start} → {s.end}</div>
                </td>
                <td className="py-1.5 text-right text-fg-secondary">{fmtSignedPct(s.market_return, 1)}</td>
                <td className={`py-1.5 text-right font-medium ${returnTone(s.portfolio_return)}`}>{fmtSignedPct(s.portfolio_return, 1)}</td>
                <td className={`py-1.5 text-right ${returnTone(s.portfolio_impact)}`}>{s.portfolio_impact != null ? fmtMoney(s.portfolio_impact, ccy) : "—"}</td>
                <td className="py-1.5 pl-3 text-fg-secondary">
                  {s.worst.map((l) => `${l.ticker} ${fmtSignedPct(l.return, 0)}`).join(", ")}
                </td>
                <td className="py-1.5 pl-3 text-[11px] text-muted">{stressMethod(s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
