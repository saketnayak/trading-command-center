---
name: Market Trending Panel
description: Portfolio page "Market" tab showing trending stocks, top movers, and sector performance for investment decisions
type: project
---

# Market Trending Panel — Design Spec

**Date:** 2026-05-12  
**Status:** Implemented

## Overview

Adds a new "Market ↑" tab to the Portfolio screen that shows live US market data to help users discover investment opportunities and gauge market sentiment — without leaving the app.

## What It Shows

### 1. Market Movers
Top 5 gainers and top 5 losers from a curated universe of ~55 major US stocks (mega-cap tech, finance, healthcare, energy, consumer, industrials, communication). Each row shows logo, ticker, company name, current price, and % change (color-coded green/red). Clicking any row opens the full TickerDrawer with chart, fundamentals, news, and upcoming earnings.

### 2. Trending Now
20 currently trending US tickers from Yahoo Finance's `/v1/finance/trending/US` endpoint, displayed as a responsive grid of cards. Each card shows: company logo/badge, ticker, company name, current price, % change badge, intraday high/low range bar, and market cap. Clicking opens the TickerDrawer.

### 3. Sector Performance
Daily % change for all 11 SPDR sector ETFs (XLK, XLF, XLV, XLE, XLI, XLB, XLRE, XLP, XLY, XLU, XLC) rendered as a horizontal heatmap — green bars for positive, red bars for negative. Widths are scaled relative to the maximum absolute move.

## Data Sources

| Data | Source | Cache TTL |
|------|--------|-----------|
| Trending ticker list | Yahoo Finance `/v1/finance/trending/US` (no auth) | 30 min |
| Stock quotes (price, % change, high/low) | Finnhub `/quote` | 30 min |
| Company profile (name, sector, logo, market cap) | Finnhub `/stock/profile2` | 24 h |

Falls back gracefully when:
- Yahoo Finance is unreachable → uses a 10-ticker curated fallback list
- No Finnhub key configured → all sections return empty; UI shows a link to Settings

## Backend

**New router:** `backend/app/routers/market.py`  
**Mounted at:** `app.include_router(market.router, tags=["market"])`

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/market/trending` | Trending tickers (Yahoo → Finnhub-enriched) |
| GET | `/market/movers` | Top 5 gainers + losers from MARKET_UNIVERSE |
| GET | `/market/sectors` | SPDR sector ETF daily % change |

All three require a valid session (Bearer JWT). Return empty lists when no Finnhub key is configured.

### Caching Strategy
Two in-process dicts: `_quote_cache` (30-min TTL) and `_profile_cache` (24-h TTL). All Finnhub calls are concurrent via `asyncio.gather`. The Yahoo trending list is cached separately at 30 min.

## Frontend

### New Files
- `frontend/components/portfolio/TrendingPanel.tsx` — main panel component with all three sections

### Modified Files
- `frontend/lib/types.ts` — added `MarketTicker`, `MoversResponse`, `SectorData` types
- `frontend/lib/api.ts` — added `getMarketTrending`, `getMarketMovers`, `getMarketSectors`
- `frontend/components/portfolio/TickerDrawer.tsx` — added optional `hidePosition?: boolean` prop to skip "Your Position" section for market tickers
- `frontend/app/portfolio/page.tsx` — added "Market ↑" tab; renders `<TrendingPanel />`

### Query Keys & Stale Times
- `["market-trending"]` — 30 min staleTime
- `["market-movers"]` — 30 min staleTime
- `["market-sectors"]` — 30 min staleTime

## UX Notes
- Market data is only available on US trading days during/around market hours; off-hours the movers section shows an informational message rather than an error.
- Clicking any stock in any section opens the existing `TickerDrawer` with full detail (90-day chart, key stats, news, earnings). The `hidePosition` prop prevents the "Your Position" section from appearing for stocks not in the user's portfolio.
- The tab badge "↑" signals live market data at a glance.
