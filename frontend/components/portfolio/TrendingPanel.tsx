"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMarketTrending, getMarketMovers, getMarketSectors } from "@/lib/api";
import type { MarketTicker, SectorData, PortfolioHolding } from "@/lib/types";
import { TickerDrawer } from "@/components/portfolio/TickerDrawer";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPrice(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n: number | null): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function fmtMarketCap(n: number | null): string {
  if (n == null) return "—";
  // Finnhub returns market cap in millions
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}T`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}B`;
  return `$${n.toFixed(0)}M`;
}

function pctColor(n: number | null): string {
  if (n == null) return "text-slate-400";
  return n >= 0 ? "text-green-400" : "text-red-400";
}

function pctBg(n: number | null): string {
  if (n == null) return "bg-slate-800";
  return n >= 0 ? "bg-green-500/10" : "bg-red-500/10";
}

function makeFakeHolding(ticker: string): PortfolioHolding {
  return {
    id: `market-${ticker}`,
    ticker,
    shares: 0,
    avg_cost: null,
    currency: "USD",
    current_price: null,
    market_value: null,
    unrealized_pnl: null,
    unrealized_pnl_pct: null,
    last_run: null,
  };
}

// ── Stock card ────────────────────────────────────────────────────────────────

function TickerCard({
  item,
  onClick,
}: {
  item: MarketTicker;
  onClick: (ticker: string) => void;
}) {
  const up = (item.change_pct ?? 0) >= 0;

  return (
    <button
      onClick={() => onClick(item.ticker)}
      className="w-full text-left bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-slate-600 rounded-xl p-4 transition-all group"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {item.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.logo}
              alt={item.ticker}
              className="w-8 h-8 rounded object-contain bg-slate-700 p-0.5 shrink-0"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="w-8 h-8 rounded bg-slate-700 flex items-center justify-center shrink-0">
              <span className="text-[9px] font-bold text-slate-400">{item.ticker.slice(0, 2)}</span>
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-bold text-white font-mono leading-tight">{item.ticker}</p>
            {item.name && (
              <p className="text-[11px] text-slate-400 truncate leading-tight mt-0.5">{item.name}</p>
            )}
          </div>
        </div>
        <span
          className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums ${
            up ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
          }`}
        >
          {fmtPct(item.change_pct)}
        </span>
      </div>

      <div className="flex items-end justify-between">
        <div>
          <p className="text-base font-semibold text-white font-mono tabular-nums">
            ${fmtPrice(item.price)}
          </p>
          <p className={`text-xs tabular-nums ${up ? "text-green-400" : "text-red-400"}`}>
            {item.change != null ? `${item.change >= 0 ? "+" : ""}${item.change.toFixed(2)}` : ""}
          </p>
        </div>
        <div className="text-right">
          {item.market_cap != null && (
            <p className="text-[11px] text-slate-500">Mkt cap {fmtMarketCap(item.market_cap)}</p>
          )}
          {item.sector && (
            <p className="text-[10px] text-slate-600 truncate max-w-[100px]">{item.sector}</p>
          )}
        </div>
      </div>

      {/* Day range bar */}
      {item.high != null && item.low != null && item.price != null && item.high > item.low && (
        <div className="mt-3">
          <div className="flex justify-between text-[10px] text-slate-600 mb-1">
            <span>L ${fmtPrice(item.low)}</span>
            <span>H ${fmtPrice(item.high)}</span>
          </div>
          <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${up ? "bg-green-500" : "bg-red-500"}`}
              style={{
                width: `${Math.min(100, Math.max(0, ((item.price - item.low) / (item.high - item.low)) * 100))}%`,
              }}
            />
          </div>
        </div>
      )}
    </button>
  );
}

// ── Mover row (compact) ───────────────────────────────────────────────────────

function MoverRow({
  item,
  onClick,
}: {
  item: MarketTicker;
  onClick: (ticker: string) => void;
}) {
  const up = (item.change_pct ?? 0) >= 0;

  return (
    <button
      onClick={() => onClick(item.ticker)}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-800/80 transition-colors group text-left"
    >
      {item.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.logo}
          alt={item.ticker}
          className="w-7 h-7 rounded object-contain bg-slate-700 p-0.5 shrink-0"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        <div className="w-7 h-7 rounded bg-slate-700 flex items-center justify-center shrink-0">
          <span className="text-[9px] font-bold text-slate-400">{item.ticker.slice(0, 2)}</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-white font-mono leading-tight">{item.ticker}</p>
        {item.name && (
          <p className="text-[10px] text-slate-500 truncate">{item.name}</p>
        )}
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold text-white font-mono tabular-nums">
          ${fmtPrice(item.price)}
        </p>
        <p className={`text-xs font-semibold tabular-nums ${up ? "text-green-400" : "text-red-400"}`}>
          {fmtPct(item.change_pct)}
        </p>
      </div>
    </button>
  );
}

// ── Sector heatmap ────────────────────────────────────────────────────────────

function SectorHeatmap({ sectors }: { sectors: SectorData[] }) {
  if (!sectors.length) return null;

  const maxAbs = Math.max(...sectors.map((s) => Math.abs(s.change_pct ?? 0)), 0.01);

  return (
    <div className="space-y-1.5">
      {sectors.map((s) => {
        const pct = s.change_pct ?? 0;
        const up = pct >= 0;
        const width = `${Math.min(100, (Math.abs(pct) / maxAbs) * 100)}%`;

        return (
          <div key={s.sector} className="flex items-center gap-3">
            <span className="text-[11px] text-slate-400 w-36 shrink-0 truncate">{s.sector}</span>
            <div className="flex-1 h-5 bg-slate-800 rounded overflow-hidden relative">
              <div
                className={`h-full rounded transition-all ${up ? "bg-green-500/30" : "bg-red-500/30"}`}
                style={{ width }}
              />
              <span
                className={`absolute inset-0 flex items-center px-2 text-[10px] font-semibold tabular-nums ${
                  up ? "text-green-400" : "text-red-400"
                }`}
              >
                {fmtPct(s.change_pct)}
              </span>
            </div>
            <span className="text-[10px] text-slate-600 w-12 text-right font-mono tabular-nums shrink-0">
              {s.ticker}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4 space-y-3 animate-pulse">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded bg-slate-700" />
        <div className="space-y-1.5 flex-1">
          <div className="h-3 w-16 bg-slate-700 rounded" />
          <div className="h-2.5 w-28 bg-slate-700/60 rounded" />
        </div>
        <div className="h-5 w-14 bg-slate-700 rounded-full" />
      </div>
      <div className="h-4 w-24 bg-slate-700 rounded" />
      <div className="h-1 bg-slate-700 rounded-full" />
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-4">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      {subtitle && <span className="text-[11px] text-slate-500">{subtitle}</span>}
    </div>
  );
}

const NO_KEY_MSG = (
  <div className="text-slate-400 text-sm py-10 text-center space-y-1">
    <p>Market data requires a Finnhub API key.</p>
    <p>
      <a href="/settings" className="text-blue-400 hover:underline">
        Add your key in Settings →
      </a>
    </p>
  </div>
);

// ── Main panel ────────────────────────────────────────────────────────────────

export function TrendingPanel() {
  const [drawerTicker, setDrawerTicker] = useState<string | null>(null);

  const { data: trending = [], isLoading: loadingTrending, isError: errTrending } = useQuery({
    queryKey: ["market-trending"],
    queryFn: getMarketTrending,
    staleTime: 1000 * 60 * 30,
    retry: 1,
  });

  const { data: movers, isLoading: loadingMovers } = useQuery({
    queryKey: ["market-movers"],
    queryFn: getMarketMovers,
    staleTime: 1000 * 60 * 30,
    retry: 1,
  });

  const { data: sectors = [], isLoading: loadingSectors } = useQuery({
    queryKey: ["market-sectors"],
    queryFn: getMarketSectors,
    staleTime: 1000 * 60 * 30,
    retry: 1,
  });

  // Detect missing Finnhub key — all three return empty arrays when key is absent
  const allEmpty = !loadingTrending && !loadingMovers && !loadingSectors
    && trending.length === 0
    && (!movers || (movers.gainers.length === 0 && movers.losers.length === 0))
    && sectors.length === 0;

  if (allEmpty) return NO_KEY_MSG;

  return (
    <div className="space-y-8">

      {/* ── Market Movers ──────────────────────────────────────────────────── */}
      <div>
        <SectionHeader title="Market Movers" subtitle="Top gainers & losers from major US stocks" />
        {loadingMovers ? (
          <div className="grid grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-40 bg-slate-800/40 border border-slate-700/40 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : movers && (movers.gainers.length > 0 || movers.losers.length > 0) ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Gainers */}
            <div className="bg-slate-800/40 border border-green-500/20 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-700/60 flex items-center gap-1.5">
                <span className="text-green-400 text-sm">▲</span>
                <span className="text-xs font-semibold text-green-400">Top Gainers</span>
              </div>
              <div className="p-2">
                {movers.gainers.map((item) => (
                  <MoverRow key={item.ticker} item={item} onClick={setDrawerTicker} />
                ))}
              </div>
            </div>

            {/* Losers */}
            <div className="bg-slate-800/40 border border-red-500/20 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-700/60 flex items-center gap-1.5">
                <span className="text-red-400 text-sm">▼</span>
                <span className="text-xs font-semibold text-red-400">Top Losers</span>
              </div>
              <div className="p-2">
                {movers.losers.map((item) => (
                  <MoverRow key={item.ticker} item={item} onClick={setDrawerTicker} />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-slate-500 text-sm">Market data unavailable during off-hours or on weekends.</p>
        )}
      </div>

      {/* ── Trending Now ───────────────────────────────────────────────────── */}
      <div>
        <SectionHeader title="Trending Now" subtitle="Most-watched US tickers today" />
        {loadingTrending ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {[...Array(8)].map((_, i) => <CardSkeleton key={i} />)}
          </div>
        ) : trending.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {trending.map((item) => (
              <TickerCard key={item.ticker} item={item} onClick={setDrawerTicker} />
            ))}
          </div>
        ) : (
          <p className="text-slate-500 text-sm">No trending tickers available right now.</p>
        )}
      </div>

      {/* ── Sector Performance ─────────────────────────────────────────────── */}
      <div>
        <SectionHeader title="Sector Performance" subtitle="Daily % change · SPDR ETFs" />
        {loadingSectors ? (
          <div className="space-y-1.5">
            {[...Array(11)].map((_, i) => (
              <div key={i} className="h-5 bg-slate-800/40 rounded animate-pulse" />
            ))}
          </div>
        ) : sectors.length > 0 ? (
          <SectorHeatmap sectors={sectors} />
        ) : (
          <p className="text-slate-500 text-sm">Sector data unavailable.</p>
        )}
      </div>

      {/* ── Ticker Drawer ──────────────────────────────────────────────────── */}
      <TickerDrawer
        holding={drawerTicker ? makeFakeHolding(drawerTicker) : null}
        displayCurrency="USD"
        hidePosition
        onClose={() => setDrawerTicker(null)}
      />
    </div>
  );
}
