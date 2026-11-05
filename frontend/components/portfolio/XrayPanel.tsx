"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";

import { getPortfolioXray, refreshPortfolioXray } from "@/lib/api";
import { timeAgo } from "@/lib/alerts";
import { ALERT_BANNER_CLASS, BTN_SECONDARY_CLASS } from "@/lib/uiClasses";
import {
  hiddenExposures,
  overlapOpacity,
  pct,
  sourceLabel,
  viaLine,
  visibleExposures,
  xrayQueryKey,
  type XrayReport,
  type XraySector,
} from "@/lib/xray";

const CARD = "rounded-lg border border-border bg-surface p-3";
const SECTION_TITLE = "mb-2 text-xs font-semibold text-fg";
const DIRECT_BAR = "bg-[#2a78d6] dark:bg-[#3987e5]";
const VIA_BAR = "bg-[#eb6834] dark:bg-[#d95926]";

export function XrayPanel({ portfolioId }: { portfolioId: string }) {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery({
    queryKey: xrayQueryKey(portfolioId),
    queryFn: () => getPortfolioXray(portfolioId),
    refetchInterval: (q) => ((q.state.data as XrayReport | undefined)?.syncing ? 3000 : false),
  });
  const refresh = useMutation({
    mutationFn: () => refreshPortfolioXray(portfolioId),
    onSuccess: () => qc.invalidateQueries({ queryKey: xrayQueryKey(portfolioId) }),
  });

  if (isPending) return <p className="text-sm text-muted">Loading X-ray…</p>;
  if (isError) return <div className={ALERT_BANNER_CLASS}>{(error as Error).message}</div>;

  const hasFunds = data.funds.length > 0;
  const failed = Object.keys(data.failed);
  const partial = data.funds.some((f) => f.source === "yahoo_top10");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">What you really own through your funds</h2>
          <p className="mt-0.5 text-xs text-muted">
            Companies and sectors counted across direct holdings and inside your ETFs and funds.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted" role="status">
            {data.syncing
              ? "Looking up holdings…"
              : data.last_updated_at
                ? `Updated ${timeAgo(data.last_updated_at)}`
                : ""}
          </span>
          <button
            type="button"
            className={`${BTN_SECONDARY_CLASS} gap-1.5`}
            disabled={data.syncing || refresh.isPending || data.holdings === 0}
            onClick={() => refresh.mutate()}
          >
            <RefreshCw size={13} className={data.syncing ? "animate-spin" : ""} aria-hidden />
            Refresh
          </button>
        </div>
      </div>

      {failed.length > 0 && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          {`Could not look up ${failed.join(", ")}; the last known data is shown and it tries again tomorrow.`}
        </p>
      )}
      {data.no_price.length > 0 && (
        <p className="text-[11px] text-muted">{`Left out because they have no price: ${data.no_price.join(", ")}.`}</p>
      )}

      {data.holdings === 0 ? (
        <p className="text-sm text-muted">Add holdings to see what they contain.</p>
      ) : !hasFunds ? (
        <p className={CARD + " text-sm text-muted"}>
          {data.syncing || data.pending.length > 0
            ? "Checking which of your holdings are funds…"
            : "No ETFs or funds in this portfolio, so what you hold is what you own."}
        </p>
      ) : (
        <>
          {partial && !data.full_holdings_available && (
            <div className={ALERT_BANNER_CLASS}>
              Some funds show only their top holdings. Setting <code>SEC_USER_AGENT</code> to a name and email lets
              AgentFloor read full holdings from SEC filings, for funds that file them.
            </div>
          )}

          <section aria-label="Summary" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat label="In funds" value={pct(data.fund_weight)} note="of the portfolio" />
            <Stat
              label="Largest company"
              value={pct(data.concentration.look_through.top1_weight)}
              note={`largest ticker you hold: ${pct(data.concentration.as_held.top1_weight)}`}
            />
            <Stat
              label="Top 5 companies"
              value={pct(data.concentration.look_through.top5_weight)}
              note={`top 5 tickers you hold: ${pct(data.concentration.as_held.top5_weight)}`}
            />
            <Stat
              label="Not itemised"
              value={pct(data.uncovered_weight)}
              note="inside funds, holdings unknown"
            />
          </section>

          {hiddenExposures(data.exposures).length > 0 && (
            <ul className="space-y-1 text-sm text-fg">
              {hiddenExposures(data.exposures).map((r) => (
                <li key={r.key}>{data.sentences?.[r.key]}</li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-muted">
            These are minimums. Only the itemised part of each fund is counted; the rest is never spread over the names
            shown.
          </p>

          <section className={CARD}>
            <h3 className={SECTION_TITLE}>Exposure by company</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-muted">
                    <th className="py-1.5 pr-2 font-medium">Company</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Total</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Directly</th>
                    <th className="py-1.5 font-medium">Through funds</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleExposures(data.exposures).map((r) => (
                    <tr key={r.key} className="border-b border-border/50 last:border-0">
                      <td className="py-1.5 pr-2 text-fg">
                        <span className="font-medium">{r.ticker ?? r.name}</span>
                        {r.ticker && r.name !== r.ticker && <span className="ml-1.5 text-muted">{r.name}</span>}
                      </td>
                      <td className="py-1.5 pr-2 text-right font-medium tabular-nums text-fg">{pct(r.total)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-fg-secondary">
                        {r.direct > 0 ? pct(r.direct) : "—"}
                      </td>
                      <td className="py-1.5 text-fg-secondary">{r.via.length ? viaLine(r.via) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <SectorBars sectors={data.sectors} />

          {data.overlap.tickers.length > 1 && <OverlapMatrix overlap={data.overlap} />}

          <section className={CARD}>
            <h3 className={SECTION_TITLE}>Your funds</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-muted">
                    <th className="py-1.5 pr-2 font-medium">Fund</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Of portfolio</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Itemised</th>
                    <th className="py-1.5 font-medium">Holdings from</th>
                  </tr>
                </thead>
                <tbody>
                  {data.funds.map((f) => (
                    <tr key={f.ticker} className="border-b border-border/50 last:border-0">
                      <td className="py-1.5 pr-2 text-fg">
                        <span className="font-medium">{f.ticker}</span>
                        <span className="ml-1.5 text-muted">{f.name}</span>
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-fg-secondary">{pct(f.weight)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-fg-secondary">{pct(f.covered_weight)}</td>
                      <td className="py-1.5 text-fg-secondary">{sourceLabel(f)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className={CARD}>
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-fg">{value}</p>
      <p className="text-[11px] text-muted">{note}</p>
    </div>
  );
}

function SectorBars({ sectors }: { sectors: XraySector[] }) {
  const max = Math.max(...sectors.map((s) => s.total), 0.0001);
  return (
    <section className={CARD}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-fg">Exposure by sector</h3>
        <div className="flex items-center gap-3 text-[11px] text-muted">
          <span className="flex items-center gap-1">
            <span className={`h-2 w-2 rounded-sm ${DIRECT_BAR}`} aria-hidden /> Directly
          </span>
          <span className="flex items-center gap-1">
            <span className={`h-2 w-2 rounded-sm ${VIA_BAR}`} aria-hidden /> Through funds
          </span>
        </div>
      </div>
      <ul className="space-y-1.5">
        {sectors.map((s) => (
          <li key={s.sector} className="grid grid-cols-[minmax(0,9rem)_1fr_3rem] items-center gap-2 text-xs">
            <span className="truncate text-fg-secondary">{s.sector}</span>
            <span
              className="flex h-2.5 overflow-hidden rounded-sm bg-muted-surface"
              role="img"
              aria-label={`${s.sector}: ${pct(s.direct)} directly, ${pct(s.via_funds)} through funds`}
            >
              <span className={DIRECT_BAR} style={{ width: `${(s.direct / max) * 100}%` }} />
              <span className={VIA_BAR} style={{ width: `${(s.via_funds / max) * 100}%` }} />
            </span>
            <span className="text-right tabular-nums text-fg">{pct(s.total)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OverlapMatrix({ overlap }: { overlap: XrayReport["overlap"] }) {
  return (
    <section className={CARD}>
      <h3 className={SECTION_TITLE}>Overlap between funds</h3>
      <p className="mb-2 text-[11px] text-muted">
        How much of two funds is the same companies, counting only the holdings known for each.
      </p>
      <div className="overflow-x-auto">
        <table className="text-xs">
          <thead>
            <tr>
              <th aria-label="Fund" />
              {overlap.tickers.map((t) => (
                <th key={t} scope="col" className="px-2 py-1 font-medium text-muted">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {overlap.tickers.map((a, i) => (
              <tr key={a}>
                <th scope="row" className="py-1 pr-2 text-left font-medium text-muted">
                  {a}
                </th>
                {overlap.tickers.map((b, j) => (
                  <td key={b} className="relative px-2 py-1 text-center tabular-nums text-fg">
                    {i !== j && (
                      <span
                        className={`absolute inset-0.5 rounded-sm ${DIRECT_BAR}`}
                        style={{ opacity: overlapOpacity(overlap.matrix[i][j]) }}
                        aria-hidden
                      />
                    )}
                    <span className="relative">{i === j ? "—" : pct(overlap.matrix[i][j], 0)}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
