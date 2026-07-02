"use client";
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getTickerSnapshot } from "@/lib/api";
import { getClosesForDays } from "@/lib/chartWindow";
import { fmtMoney } from "@/lib/currency";
import { useTickerMetadata } from "@/lib/useTickerMetadata";
import { CompanyLogo } from "@/components/ui/CompanyLogo";
import { WavePanel } from "@/components/wave/WavePanel";
import type { PortfolioHolding, TickerChart } from "@/lib/types";

interface TickerDrawerProps {
  holding: PortfolioHolding | null;
  displayCurrency: string;
  onClose: () => void;
  hidePosition?: boolean;
  waveEnabled?: boolean;
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ chart, days, currency }: { chart: TickerChart; days: number; currency: string }) {
  const uid = useId();
  const closes = getClosesForDays(chart, days);
  if (closes.length < 2) {
    return <p className="text-muted text-xs text-center py-6">Chart data unavailable</p>;
  }
  const W = 460, H = 96;
  const pad = { t: 6, r: 4, b: 6, l: 4 };
  const minV = Math.min(...closes);
  const maxV = Math.max(...closes);
  const range = maxV - minV || 1;
  const toX = (i: number) => pad.l + (i / (closes.length - 1)) * (W - pad.l - pad.r);
  const toY = (v: number) => pad.t + (1 - (v - minV) / range) * (H - pad.t - pad.b);
  const pts = closes.map((c, i) => `${toX(i).toFixed(1)},${toY(c).toFixed(1)}`).join(" ");
  const fillPts = `${pad.l},${H - pad.b} ${pts} ${W - pad.r},${H - pad.b}`;
  const isUp = closes[closes.length - 1] >= closes[0];
  const color = isUp ? "#22c55e" : "#ef4444";

  return (
    <div className="space-y-1">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
        <defs>
          <linearGradient id={`grad-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={fillPts} fill={`url(#grad-${uid})`} />
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
          strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="flex justify-between text-[10px] text-muted font-mono">
        <span>{fmtMoney(minV, currency)}</span>
        <span className="text-subtle">{currency} · {days}D</span>
        <span>{fmtMoney(maxV, currency)}</span>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PctBadge({ value, label }: { value: number | null; label: string }) {
  if (value == null) return null;
  const pos = value >= 0;
  return (
    <div className="flex flex-col items-center">
      <span className={`text-xs font-semibold tabular-nums ${pos ? "text-green-400" : "text-red-400"}`}>
        {pos ? "+" : ""}{value.toFixed(2)}%
      </span>
      <span className="text-[10px] text-muted">{label}</span>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted uppercase tracking-wide">{label}</span>
      <span className="text-xs text-fg font-mono">{value ?? "—"}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] text-muted uppercase tracking-widest font-medium">{title}</p>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="border-t border-border" />;
}

// ── Drawer content ────────────────────────────────────────────────────────────

function DrawerContent({
  holding,
  displayCurrency,
  hidePosition,
  waveEnabled = true,
}: {
  holding: PortfolioHolding;
  displayCurrency: string;
  hidePosition?: boolean;
  waveEnabled?: boolean;
}) {
  const [chartDays, setChartDays] = useState<7 | 30 | 90>(30);
  const ticker = holding.ticker.toUpperCase();

  const { data: metadataByTicker = {} } = useTickerMetadata([ticker]);
  const metadata = metadataByTicker[ticker];

  const { data: snap, isLoading, isError } = useQuery({
    queryKey: ["ticker-snapshot", ticker],
    queryFn: () => getTickerSnapshot(ticker),
    staleTime: 1000 * 60 * 5,
  });

  const chartCurrency = holding.quote_currency ?? metadata?.currency ?? displayCurrency;

  const verdictColors: Record<string, string> = {
    buy:  "bg-green-500/20 text-green-300 border border-green-500/30",
    sell: "bg-red-500/20 text-red-300 border border-red-500/30",
    hold: "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30",
  };

  // ── Header ─────────────────────────────────────────────────────────────────
  const name = metadata?.company_name ?? metadata?.display_name ?? snap?.name ?? ticker;
  const sector = metadata?.sector ?? snap?.sector;
  const website = metadata?.website ?? snap?.website;
  const exchange = metadata?.exchange ?? snap?.exchange;
  const country = metadata?.country ?? snap?.country;
  const hasChart = (snap?.chart?.c?.length ?? 0) >= 2;

  return (
    <div className="flex flex-col gap-5 pb-6">

      {/* Ticker + name */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xl font-bold text-fg font-mono">{ticker}</p>
          {name !== ticker && (
            <p className="text-sm text-muted mt-0.5">{name}</p>
          )}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {exchange && <span className="text-[10px] text-muted bg-input rounded-sm px-1.5 py-0.5">{exchange}</span>}
            {sector && <span className="text-[10px] text-muted bg-input rounded-sm px-1.5 py-0.5">{sector}</span>}
            {country && <span className="text-[10px] text-muted bg-input rounded-sm px-1.5 py-0.5">{country}</span>}
          </div>
        </div>
        <CompanyLogo ticker={ticker} size="lg" className="bg-input p-1" />
      </div>

      {/* Price change badges */}
      {snap && (snap.change_1d_pct != null || snap.change_1w_pct != null || snap.change_1m_pct != null) && (
        <div className="flex gap-5">
          <PctBadge value={snap.change_1d_pct} label="1D" />
          <PctBadge value={snap.change_1w_pct} label="1W" />
          <PctBadge value={snap.change_1m_pct} label="1M" />
        </div>
      )}

      {!hidePosition && (
        <>
          <Divider />

          {/* Your position */}
          <Section title="Your Position">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <StatCell label="Shares" value={holding.shares.toLocaleString("en-US")} />
              <StatCell
                label={`Avg Cost (${holding.cost_basis_currency ?? holding.currency ?? displayCurrency})`}
                value={holding.avg_cost != null ? fmtMoney(holding.avg_cost, holding.cost_basis_currency ?? holding.currency ?? displayCurrency) : null}
              />
              <StatCell
                label={`Market Value (${holding.quote_currency ?? displayCurrency})`}
                value={holding.market_value != null ? fmtMoney(holding.market_value, holding.quote_currency ?? displayCurrency) : null}
              />
              <StatCell
                label={`Unrealized P&L (${holding.quote_currency ?? displayCurrency})`}
                value={
                  holding.pnl_unavailable_reason === "currency_mismatch"
                    ? "— (currency mismatch)"
                    : holding.unrealized_pnl != null
                    ? `${holding.unrealized_pnl >= 0 ? "+" : ""}${fmtMoney(holding.unrealized_pnl, holding.quote_currency ?? displayCurrency)}${holding.unrealized_pnl_pct != null ? ` (${holding.unrealized_pnl >= 0 ? "+" : ""}${holding.unrealized_pnl_pct.toFixed(2)}%)` : ""}`
                    : null
                }
              />
            </div>
          </Section>
        </>
      )}

      <Divider />

      {/* Chart */}
      <Section title="Price History">
        {isLoading && <div className="h-24 bg-input/50 rounded-sm animate-pulse" />}
        {!isLoading && hasChart && (
          <>
            <div className="flex gap-1 mb-2">
              {([7, 30, 90] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setChartDays(d)}
                  className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                    chartDays === d
                      ? "bg-purple-600 text-fg"
                      : "text-muted hover:text-fg hover:bg-input"
                  }`}
                >
                  {d === 7 ? "1W" : d === 30 ? "1M" : "3M"}
                </button>
              ))}
            </div>
            <Sparkline chart={snap!.chart} days={chartDays} currency={chartCurrency} />
          </>
        )}
        {!isLoading && !hasChart && !isError && (
          <p className="text-muted text-xs">Chart data unavailable for this ticker.</p>
        )}
      </Section>

      {/* Key stats */}
      {snap && Object.keys(snap.fundamentals).length > 0 && (
        <>
          <Divider />
          <Section title="Key Stats">
            {snap.asset_type === "crypto" ? (
              <div className="grid grid-cols-3 gap-x-4 gap-y-2">
                <StatCell label="Mkt Cap" value={fmtLarge(snap.fundamentals.market_cap as number | null)} />
                <StatCell label="24h Vol" value={fmtLarge(snap.fundamentals.volume_24h as number | null)} />
                <StatCell label="Circ Supply" value={fmtLarge(snap.fundamentals.circulating_supply as number | null)} />
                <StatCell label="ATH" value={snap.fundamentals.all_time_high != null ? `$${(snap.fundamentals.all_time_high as number).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : null} />
                <StatCell label="ATH Date" value={snap.fundamentals.ath_date ? String(snap.fundamentals.ath_date).slice(0, 10) : null} />
                <StatCell label="Max Supply" value={fmtLarge(snap.fundamentals.max_supply as number | null)} />
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-x-4 gap-y-2">
                <StatCell label="P/E" value={fmtNum(snap.fundamentals.pe_ratio as number | null)} />
                <StatCell label="Beta" value={fmtNum(snap.fundamentals.beta as number | null)} />
                <StatCell label="Mkt Cap" value={fmtLarge((snap.fundamentals.market_cap as number | null) != null ? (snap.fundamentals.market_cap as number) * 1e6 : null)} />
                <StatCell label="52w High" value={snap.fundamentals.week52_high != null ? `$${(snap.fundamentals.week52_high as number).toFixed(2)}` : null} />
                <StatCell label="52w Low" value={snap.fundamentals.week52_low != null ? `$${(snap.fundamentals.week52_low as number).toFixed(2)}` : null} />
                <StatCell label="Div Yield" value={snap.fundamentals.dividend_yield != null ? `${(snap.fundamentals.dividend_yield as number).toFixed(2)}%` : null} />
                <StatCell label="EPS (TTM)" value={snap.fundamentals.eps_ttm != null ? `$${(snap.fundamentals.eps_ttm as number).toFixed(2)}` : null} />
              </div>
            )}
          </Section>
        </>
      )}

      {/* Description */}
      {snap?.description && (
        <>
          <Divider />
          <Section title="About">
            <p className="text-xs text-muted leading-relaxed">{snap.description}</p>
            {website && (
              <a href={website} target="_blank" rel="noreferrer"
                className="text-xs text-blue-400 hover:underline mt-1 inline-block">
                {website.replace(/^https?:\/\//, "")} ↗
              </a>
            )}
          </Section>
        </>
      )}

      {waveEnabled && (
        <>
          <Divider />
          <WavePanel ticker={ticker} />
        </>
      )}

      {/* Last analysis */}
      {holding.last_run && (
        <>
          <Divider />
          <Section title="Last Analysis">
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`rounded-sm px-2 py-0.5 text-xs font-medium ${verdictColors[holding.last_run.verdict?.toLowerCase()] ?? "bg-muted-surface text-fg-secondary border border-input-border"}`}>
                {holding.last_run.verdict?.toUpperCase()}
              </span>
              <span className="text-xs text-muted">{holding.last_run.analysis_date}</span>
              <Link href={`/runs/${holding.last_run.run_id}`}
                className="text-xs text-purple-400 hover:underline ml-auto">
                View Report →
              </Link>
            </div>
            {(holding.last_run.suggested_entry || holding.last_run.suggested_stop || holding.last_run.suggested_target) && (
              <div className="grid grid-cols-3 gap-x-4 gap-y-1 mt-2">
                <StatCell label="Entry" value={holding.last_run.suggested_entry} />
                <StatCell label="Stop" value={holding.last_run.suggested_stop} />
                <StatCell label="Target" value={holding.last_run.suggested_target} />
              </div>
            )}
          </Section>
        </>
      )}

      {/* Next earnings */}
      {snap?.next_earnings?.date && (
        <>
          <Divider />
          <Section title="Next Earnings">
            <div className="flex items-center gap-4">
              <div className="flex flex-col">
                <span className="text-sm text-fg font-medium">{snap.next_earnings.date}</span>
                {snap.next_earnings.hour && (
                  <span className="text-[10px] text-muted">{snap.next_earnings.hour === "bmo" ? "Before market open" : snap.next_earnings.hour === "amc" ? "After market close" : snap.next_earnings.hour}</span>
                )}
              </div>
              {snap.next_earnings.eps_estimate != null && (
                <StatCell label="EPS Estimate" value={`$${snap.next_earnings.eps_estimate.toFixed(2)}`} />
              )}
            </div>
          </Section>
        </>
      )}

      {/* News */}
      {snap?.news && snap.news.length > 0 && (
        <>
          <Divider />
          <Section title="Recent News">
            <div className="space-y-3">
              {snap.news.map((article, i) => (
                <a key={i} href={article.url} target="_blank" rel="noreferrer"
                  className="block group">
                  <div className="flex gap-3">
                    {article.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={article.image} alt="" className="w-14 h-10 object-cover rounded-sm shrink-0 opacity-80 group-hover:opacity-100 transition-opacity" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs text-fg-secondary group-hover:text-fg transition-colors leading-snug line-clamp-2">
                        {article.headline}
                      </p>
                      <p className="text-[10px] text-muted mt-0.5">
                        {article.source}{article.datetime ? ` · ${timeAgo(article.datetime)}` : ""}
                      </p>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </Section>
        </>
      )}

      {snap?.provider_warnings && snap.provider_warnings.length > 0 && (
        <div className="space-y-1">
          {snap.provider_warnings.map((warning) => (
            <div
              key={`${warning.capability}-${warning.reason}`}
              className="text-xs text-amber-400/90 bg-amber-900/20 border border-amber-700/40 rounded-sm px-3 py-2"
            >
              {warning.message}
            </div>
          ))}
        </div>
      )}

      {isError && (
        <p className="text-xs text-muted text-center py-2">
          Could not load ticker details.
        </p>
      )}
    </div>
  );
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtLarge(n: number | null | undefined): string | null {
  if (n == null) return null;
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toFixed(0)}`;
}

function fmtNum(n: number | null | undefined): string | null {
  if (n == null) return null;
  return n.toFixed(2);
}

function timeAgo(unixSecs: number): string {
  const diff = Math.floor((Date.now() / 1000) - unixSecs);
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── Drawer shell ──────────────────────────────────────────────────────────────

export function TickerDrawer({ holding, displayCurrency, onClose, hidePosition, waveEnabled = true }: TickerDrawerProps) {
  // Close on Esc
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isOpen = holding != null;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 ${isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 z-50 h-full w-full max-w-md bg-elevated border-l border-input-border shadow-2xl flex flex-col transition-transform duration-200 ${isOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header bar */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <span className="text-sm font-semibold text-fg">Ticker Detail</span>
          <button
            onClick={onClose}
            className="text-muted hover:text-fg transition-colors text-lg leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {holding && (
            <DrawerContent
              holding={holding}
              displayCurrency={displayCurrency}
              hidePosition={hidePosition}
              waveEnabled={waveEnabled}
            />
          )}
        </div>
      </div>
    </>
  );
}
