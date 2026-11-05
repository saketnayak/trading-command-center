# AgentFloor feature roadmap (November 2026)

Research-backed plan for the next round of AgentFloor features, focused on
portfolio management. It compares what the app already does with what
portfolio trackers, AI research tools and brokerages shipped in 2025–26,
and picks the gaps that would help users most for the effort.

Guardrail for every item below: AgentFloor stays **research-only**. Nothing
here adds a live order path. JEV Lab stays shadow/paper as merged in #55.
Broker integrations are read-only.

---

## 1. Summary: the five highest-value moves

| # | Feature | Why it matters | Effort |
|---|---|---|---|
| 1 | **Performance & benchmark engine** (daily valuation, TWR/MWR, vs SPY/QQQ) | Users can't answer "am I beating the market?" today. Every serious tracker answers it (IBKR PortfolioAnalyst, Wealthfolio, Ghostfolio). | M |
| 2 | **Transaction ledger with tax lots** | Holdings are just `ticker/shares/avg_cost` per snapshot. A ledger unlocks realised P&L, dividends, accurate returns, tax tools and broker sync. | L |
| 3 | **Unified alerts engine** (price, valuation, regime flip, wave zone, verdict change, earnings) | AgentFloor computes many signals but only surfaces them when someone opens the page. Delivery (email, Telegram, Slack, webhook) already exists. | M |
| 4 | **Agent Backtest Lab + learning loop** using the `Backtester` and `reflect_and_remember` that ship in the installed `tradingagents 0.7.0` but are unused | Turns "trust the AI" into "here is this config's measured hit-rate and Sharpe vs buy-and-hold". Few retail products can show this. | M |
| 5 | **Risk & rebalancing workspace** (correlation, beta, VaR, stress replay, target weights → trade list) | Moves the portfolio tab from monitoring to managing. It builds on existing price history, Markov and trim signals. | M |

---

## 2. Where AgentFloor stands today

**Strengths:**
- Multi-agent deep research per ticker (TradingAgents), with a live stream, run comparison and +7/14/30/90-day outcome tracking.
- Quant overlays that most retail tools lack: a Markov regime HMM, Elliott Wave and Fibonacci, and a Kalman trend.
- Portfolio AI layer:
  - insights with a health score, actions and risks;
  - chat;
  - thesis cross-reference;
  - trim signals;
  - behavioural alerts (ignored sells, concentration drift, complacency);
  - sector gaps and discovery.
- Investor profile (risk willingness and ability, horizon, rules, anti-portfolio) that personalises the AI.
- Delivery of the morning brief by email, Telegram, Slack and generic webhook.
- Watchlist with cron scheduling; earnings, fundamentals and news per portfolio.
- Self-hosted and bring-your-own-LLM, including local models (Ollama, vLLM, LiteLLM, IONOS).

**Structural gaps (confirmed in code):**

| Area | Today | Gap |
|---|---|---|
| Data model | `PortfolioHolding(ticker, shares, avg_cost, currency)` per uploaded snapshot | No transactions, lots, cash, dividends, fees, splits or accounts |
| Performance | Unrealised P&L at current price | No valuation history, TWR/MWR, period returns or benchmark |
| Risk | Per-ticker Markov Sharpe/drawdown; sector exposure in insights | No portfolio-level correlation, beta, VaR, stress test or Monte Carlo |
| Allocation | Trim signals (sell side only) | No target weights, drift or rebalance plan |
| Alerts | Behavioural alerts computed on request | No price, valuation or signal-change alerts, and no inbox |
| AI trust | Outcome grid per run; `/runs/performance` accuracy | No backtest of an agent config, no excess return vs benchmark, no lookahead-bias guard, no learning from outcomes |
| Ecosystem | REST API for the web app only | No MCP server, no broker sync, no ETF look-through |

---

## 3. What the industry is building (2025–26)

1. **Agents on top of your real portfolio.**
   - Public.com launched "Agents" (March 2026): plain-English rules that watch the market and act on your account. The user approves each agent before it goes live.
   - Robinhood's Cortex adds Portfolio Digests, which are AI summaries of the news and events affecting your holdings.
   - Perplexity Finance links real brokerage accounts through Plaid so you can ask questions about your holdings.

   *Takeaway:* AI value is moving from "analyse this ticker" to "watch my portfolio and tell me what changed". AgentFloor already has the parts (scheduler, insights, delivery); it lacks the rules and digest layer.

2. **Rigorous performance reporting is table stakes.**
   - IBKR PortfolioAnalyst: TWR and MWR toggles, 300+ benchmarks, attribution, and VaR.
   - Wealthfolio: TWR and MWR, benchmark comparison, a choice of FIFO/LIFO/HIFO/average cost basis, and a rebalancing plan.
   - Ghostfolio: return on average investment including dividends, over 1D…Max.

3. **Look-through and concentration analysis.**
   - Sharesight, Mezzi and Morningstar all sell an "X-ray": expand ETFs into their underlying holdings, compute overlap, and show the real exposure to each stock and sector.

4. **Tax-aware tooling.**
   - Sharesight's main differentiator is tax reporting.
   - Tax-loss harvesting with wash-sale monitoring has come down to retail apps.
   - Wash-sale rules apply per taxpayer, across all accounts, so a tracker that sees every portfolio is the right place for the check.

5. **MCP as the integration surface.**
   - Ghostfolio and Wealthfolio both ship MCP servers so Claude, ChatGPT or Cursor can read the portfolio.
   - Fiscal.ai exposes its financial data over MCP.
   - Anthropic's financial-services plugins bundle data connectors over MCP.

   *Takeaway:* being reachable by external agents is now expected of self-hosted finance tools.

6. **Alerts on fundamentals and narratives, not just price.**
   - Koyfin: price, technical, valuation and news alerts.
   - Simply Wall St: alerts when a fair value or community narrative changes.

7. **Read-only broker aggregation is a commodity.**
   - Plaid Investments: read-only holdings and transactions.
   - SnapTrade: retail brokerages, read and trade.
   - Wealthfolio Connect: 30+ brokers, read-only.

8. **LLM backtests need contamination controls.**
   - Recent papers (a test for lookahead bias in LLM forecasts, arXiv 2512.23847; parametric look-ahead bias, 2026) show LLM backtests inflate on dates inside the model's training window.
   - The cleanest check is to score only dates after the model's training cutoff.

   *Takeaway:* if AgentFloor adds backtesting it should label in-sample versus out-of-sample by model cutoff. Doing that would also set it apart.

---

## 4. Feature plan

Effort: **S** ≈ ≤1 week, **M** ≈ 1–3 weeks, **L** ≈ 3–6 weeks for one developer.

### Phase 1: "Am I winning, and am I safe?" (works on today's data model)

#### 1.1 Price-history store (foundation, S) ✅ shipped
- New `price_bars(symbol, date, close, adj_close, currency)` table, filled by a nightly scheduler job through the existing `yfinance_service.fetch_history`. Finnhub is the fallback.
- One source for 1.2, 1.3, 2.x and 3.x, replacing the scattered in-process caches. It also survives restarts.

#### 1.2 Performance & benchmark engine (M) ✅ shipped (holdings-based TWR, benchmark, risk stats, contribution; MWR waits for the ledger in 2.1; figures now feed the AI brief)
- Nightly `portfolio_valuations(portfolio_id, date, market_value, cost_basis, net_flow)`.
- Until the ledger (2.1) lands, net flows are inferred from snapshot-to-snapshot changes in shares × price. The UI marks those figures as estimated.
- Metrics:
  - TWR, plus MWR via XIRR once flows are exact;
  - period returns for 1D, 1W, MTD, YTD, 1Y and Max;
  - excess return against a chosen benchmark (SPY by default; QQQ, VT or any ticker);
  - contribution to return by holding and by sector.
- UI: a new **Performance** tab with an equity curve against the benchmark (Plotly is already a dependency) and a returns heat-map by month.
- AI hook: feed period return and excess return into `portfolio_insight_runner` and the morning brief, so the brief can say "you trail SPY by 3.1% YTD, mostly NVDA → TSLA rotation".

#### 1.3 Portfolio risk workspace (M) ✅ shipped (as a Risk tab; figures feed the AI brief)
Computed from 1.1, using pure functions like `trim_signal_service`:
- correlation matrix and clusters ("these four holdings move as one bet");
- portfolio beta, annualised volatility, max drawdown, and historical VaR/CVaR at 95%;
- concentration (HHI and top-5 weight) and a regime mix, reusing `/portfolio/{id}/regime`;
- **stress replay**: apply the actual daily returns from named windows (2008 GFC, Mar 2020, 2022 rate shock, Aug 2024 unwind) to today's weights;
- **Monte Carlo** (bootstrapped returns, fat tails) giving a 1-year P5/P50/P95 band.

Show the results as a **Risk** card in Holdings plus a full tab. Feed the numbers into the insight prompt so risk alerts quote measured values rather than LLM guesses.

#### 1.4 Target allocation & rebalancing planner (M) ✅ shipped (ticker-level targets; sector/asset-class targets, profile-seeded targets and tax-aware mode still open)
- `portfolio_targets(portfolio_id, kind: ticker|sector|asset_class, key, target_weight, band)`.
- Drift table with tolerance bands. **Rebalance plan**: the minimum set of buys and sells to get back inside the bands, with:
  - a "new money only" mode (put the cash contribution toward underweights and never sell);
  - a tax-aware mode (later, once 2.3 exists).
- Combine with trim signals: when a holding is overweight *and* the trim signal is high, rank it first.
- Output is a **plan**, exportable as CSV. No orders, in line with research-only.
- Seed suggested targets from the investor profile (risk ability, preferred sectors, target portfolio size).

#### 1.5 Unified alerts engine (M) ✅ shipped (price, daily move, MA cross, regime, verdict, drawdown, position weight; Elliott-zone and earnings rules still open)
- `alert_rules(user_id, scope: ticker|portfolio, kind, params, channels, cooldown)` and `alert_events`.
- Rule kinds, all backed by data AgentFloor already computes:
  - price or % move, and crossing the 50/200-day moving average;
  - valuation: PEG or P/E crossing a threshold;
  - **Markov regime flip**, e.g. Bull→Bear;
  - **Elliott trade-zone entry**;
  - **AI verdict changed** on a scheduled re-run;
  - earnings in N days;
  - drift past the rebalance band (1.4);
  - drawdown past X% (1.2).
- Evaluated by an APScheduler job (every 15 min in market hours, plus after each nightly job). Delivered through the existing `delivery_service` (email, Telegram, Slack, webhook) and an **in-app inbox** with a nav badge.
- This is the base for the natural-language rules in 3.2.

#### 1.6 MCP server (S–M) ✅ shipped (12 tools at launch, 13 with `get_income`: 11 read, 2 research; personal access tokens with scopes and expiry)
- Expose AgentFloor as an MCP server (Streamable HTTP, mounted on the FastAPI app or as a sidecar).
- **Read tools by default**: `list_portfolios`, `get_holdings`, `get_performance`, `get_risk`, `get_regime`, `get_wave`, `get_latest_insight`, `list_runs`, `get_report`.
- An **opt-in "research" scope** adds `start_run` and `generate_insight`.
- Per-user personal access tokens with scopes, created in Settings and stored hashed. There is never any order tool, and JEV Lab is excluded.
- Users can then ask Claude Desktop or Cursor "how did my AI-flagged sells do last quarter?" against their own self-hosted data, in line with Ghostfolio and Wealthfolio.

### Phase 2: "Real books" (data-model upgrade)

#### 2.1 Transaction ledger & tax lots (L) ✅ shipped (ledger, FIFO/HIFO/average lots, realised gains, income, cash, CSV import with column mapping, ledger-driven performance + MWR; still open: an accounts table with account types, the LLM-assisted mapper and per-broker presets)
- `accounts(portfolio_id, name, type: taxable|ira|roth|isa|crypto, currency)` and `transactions(account_id, ts, type: BUY|SELL|DIVIDEND|INTEREST|FEE|SPLIT|DEPOSIT|WITHDRAWAL|TRANSFER, symbol, qty, price, fees, currency, fx_rate, source)`.
- Holdings become a **derived view**, with lots chosen by FIFO, average cost or HIFO per account.
- **Backward compatible**: a CSV snapshot upload still works. It is diffed against the derived holdings and turned into synthetic BUY/SELL transactions marked `source=snapshot`, so existing users lose nothing.
- Importers:
  - generic CSV with column mapping;
  - an LLM-assisted mapper for messy broker exports (the LLM proposes a mapping and a deterministic parser applies it);
  - presets for Fidelity, Schwab, IBKR Flex, Robinhood, Vanguard and Zerodha.
- Unlocks realised P&L, exact TWR/MWR (replacing the estimated flows in 1.2), dividends (2.2), tax tools (2.3) and broker sync (4.1).

#### 2.2 Dividend & income tracker (S–M) ✅ shipped (as an Income tab: forward income, yield and yield on cost, 12-month ex-date calendar, income received from the ledger or estimated, per-portfolio monthly goal, DRIP projection; MCP `get_income`; still open: pay dates (yfinance only gives ex-dates) and per-account DRIP settings)
- Dividend history from the ledger; upcoming ex-dividend and pay dates (Finnhub or yfinance).
- Forward 12-month income projection, yield on cost, monthly income calendar, and DRIP modelling.
- Matches the investor profile's `income_goal` ("you're 62% of the way to $1,500/mo").

#### 2.3 Tax tools (M, informational only)
- Realised-gains report by tax year, split short- and long-term per jurisdiction preset (US first), exportable as CSV.
- **Harvest candidates**: lots with unrealised loss above $X, ranked by loss and correlation-matched replacement ideas.
- **Wash-sale guard**: warn when a buy in *any* account or portfolio falls within ±30 days of a loss sale.
- Clear "not tax advice" labelling, as with the existing research-only disclaimers.

#### 2.4 Multi-asset net worth (S–M)
- Manual assets and liabilities (cash, real estate, private holdings, loans), as in Kubera and Wealthfolio.
- Crypto wallets by public address, read-only, through the existing `crypto_data_service` and CoinGecko.
- A net-worth chart on top of 1.2's valuations. Allocation targets (1.4) can then cover the whole household.

### Phase 3: AI that earns trust

#### 3.1 Agent Backtest Lab + learning loop (M)
- New `/runs/backtest`: choose tickers, a date grid, provider and model, analysts, depth, and a **budget cap in USD**. The job wraps `tradingagents.backtest.Backtester` (already installed, unused), inside `job_manager` and `asyncio.to_thread` like live runs.
- Persist the `BacktestReport` and show:
  - Sharpe, hit-rate, expectancy and drawdown;
  - the buy-and-hold, HOLD, SMA and random benchmarks;
  - signal distribution and cost.
- **Contamination labelling**: keep a model→training-cutoff table and tag each scored date in-sample or out-of-sample. Headline only out-of-sample metrics, which is what the lookahead-bias papers recommend. Few retail AI tools do this.
- Start with `dry_run=True` (stub LLM) so users can validate the harness for free.
- **Learning loop**: when `outcome_service` resolves a run's +7d/+30d outcome, optionally call `reflect_and_remember` so the agents' BM25 memories pick up lessons. Gate it behind a setting and keep memories per user.
- **Model leaderboard**: extend `/runs/performance` to group accuracy and excess return vs SPY by provider, model, depth and analyst set. This answers "is Opus worth 10× the cost of a local model *for my tickers*?".

#### 3.2 Natural-language watch rules (M; needs 1.5)
- "Tell me if any semiconductor holding goes Bear on Markov *and* drops below its 200-day."
- An LLM compiles the sentence to the 1.5 rule DSL. The user reviews the compiled rule (the same approval idea as Public's Agents). A deterministic evaluator runs it, so the LLM is never in the hot path.
- Optional action: **re-run the TradingAgents analysis** when the rule fires, and attach the new verdict to the alert. This stays research-only and never places an order.

#### 3.3 "What changed" digests: filings, insiders, calls (M)
- SEC EDGAR, which is free and keyless:
  - new 10-K, 10-Q and 8-K filings for holdings;
  - Form 4 insider buys and sells;
  - 13F changes for chosen funds.
- An LLM writes a diff summary ("risk-factor section added China export-control language"), which is attached to the holding and fed into the morning brief.
- Matches Robinhood Portfolio Digests, but with citations to the filing.

#### 3.4 ETF look-through X-ray (M; data dependency)
- Expand ETF holdings to their constituents (issuer holdings files; Finnhub ETF holdings if the key's tier has it) and cache them weekly.
- Shows:
  - true exposure per stock and sector;
  - an overlap matrix between funds;
  - "you hold 9.4% NVDA through 3 funds plus directly".
- Feeds concentration (1.3) and targets (1.4).

### Phase 4: Reach and convenience

#### 4.1 Read-only broker sync (L, paid dependency)
- A SnapTrade or Plaid Investments adapter writing into the 2.1 ledger (`source=broker`), with a nightly sync.
- **Read scopes only.** Never enable SnapTrade's trading endpoints, so the research-only boundary holds.
- Optional and admin-configured, like the Finnhub key. CSV stays first-class for self-hosters.

#### 4.2 Goals & planning (M)
- Retirement and FIRE Monte Carlo using the investor profile (horizon, income, liquidity reserve), Phase 1 return and volatility, and a planned contribution schedule.
- Goal progress cards ("house deposit in 2029: 71% on track").

#### 4.3 Screener & idea engine (M)
- Factor screens (value, quality, momentum, low-volatility), plus Markov regime and wave filters across the S&P 500 (the `sp500_sectors` list exists).
- A natural-language screener; results can go straight into the watchlist or a batch analysis.
- Extends today's `/portfolio/{id}/discover` and sector-gap features.

#### 4.4 PWA + push (S)
- Installable PWA with Web Push for alerts (1.5) and the morning brief.
- A mobile-first holdings view; layout #53 already handles 390 px widths.

---

## 5. Suggested sequencing

```text
Phase 1  (~6–8 wks)  1.1 price store → 1.2 performance → 1.3 risk → 1.4 rebalancing
                     1.5 alerts (in parallel)            1.6 MCP (any time; small)
Phase 2  (~6–8 wks)  2.1 ledger → 2.2 dividends, 2.3 tax, 2.4 net worth
Phase 3  (~5–7 wks)  3.1 backtest lab (can start in Phase 1, no dependencies)
                     3.2 NL rules (after 1.5), 3.3 digests, 3.4 X-ray
Phase 4  (as needed) 4.1 broker sync (after 2.1), 4.2 goals, 4.3 screener, 4.4 PWA
```

**Quick wins to start now (each under a week):** 1.1 price store, 1.6 MCP read-only server, the 3.1 model leaderboard (the data already exists in `runs`, `reports` and `run_outcomes`), and alerts for Markov regime flips and verdict changes. Those signals are already computed.

## 6. JEV Lab follow-ups (from the #55 review)

1. **Sub-$1 crypto quotes sit ~8% off-market.** `order_plan.py` rounds limits to 2 dp, and every crypto `AssetSpec` uses `tick_size=0.01`. Use a price-dependent tick and round to it.
2. **Setup failures can leave a row `running`.** In `execute_session`, catch any setup exception (not just `AlpacaConfigError`) and mark the session `failed`, so an orphaned row can't hold a `MAX_ACTIVE_SESSIONS` slot.
3. **Paginate `get_own_orders`.** It reads a single page of 500 orders today, so long paper sessions can undercount fills on flatten.
4. **Decide what a price rise should do.** At present a price rise alone can trip the max-position *kill*. Consider making that a veto on new buys rather than a kill.

## 7. Guardrails

- **No live trading path.** Read-only for every broker integration; MCP has no order tools; JEV Lab stays paper or shadow.
- **Numbers before narratives.** Risk, performance and tax figures come from deterministic code. The LLM explains them and never computes them.
- **Honest AI metrics.** Backtests show out-of-sample results by model cutoff, always next to a buy-and-hold benchmark.
- **Graceful degradation.** Every feature works on free data (yfinance, EDGAR, Frankfurter, CoinGecko) and gets better with Finnhub or a broker key, the same pattern the app uses today.

---

## Sources

- Public.com Agents launch (Mar 2026): https://digital-release.wowktv.com/business/press-releases/cision/20260331NY22354/public-becomes-the-first-brokerage-to-introduce-ai-agents-for-your-portfolio · https://www.financemagnates.com/forex/trim-banks-if-fed-cuts-rates-public-wants-ai-agent-to-trade-for-you
- Robinhood Cortex Digests: https://robinhood.com/us/en/support/articles/cortex-digests · https://robinhood.com/us/en/support/articles/cortex
- Perplexity Finance portfolio via Plaid (secondary): https://nextpj-net.pages.dev/blog/perplexity-finance-portfolio-ai-investing-plaid-2026
- Fiscal.ai MCP and brokerage connections (secondary): https://qveris.ai/guides/investment-research-agent/index.html · https://www.findmymoat.com/top/data-partners/fiscal-ai
- Wealthfolio README: https://github.com/wealthfolio/wealthfolio
- Ghostfolio README: https://github.com/ghostfolio/ghostfolio
- IBKR PortfolioAnalyst: https://investors.interactivebrokers.com/en/portfolioanalyst/features.php
- Sharesight ETF X-ray and overlap: https://sharesight.com/etf-tracker · https://www.sharesight.com/blog/etf-overlap/
- Mezzi Exposure X-ray: https://www.mezzi.com/blog/new-in-mezzi-exposure-x-ray
- Koyfin and Simply Wall St alerts: https://simplywall.st/features/stock-watchlist · https://www.g2.com/compare/koyfin-vs-simply-wall-st
- Tracker comparisons: https://www.allinvestview.com/articles/best-portfolio-tracker/ · https://stockanalysis.com/article/best-stock-portfolio-tracker/
- SnapTrade vs Plaid: https://dev.to/pickuma/snaptrade-vs-plaid-investments-brokerage-aggregation-apis-for-fintech-builders-27mh · https://snaptrade.com/snaptrade-vs-plaid
- Direct indexing and wash sales: https://beancount.io/blog/2026/05/14/direct-indexing-tax-loss-harvesting-2026-sma-personalized-portfolio-wash-sale-rule-tax-alpha-sp500-tracking-guide · https://help.titan.com/en_us/direct-indexing-rJXHovJGGe.md
- Claude for Financial Services / MCP connectors: https://www.techradar.com/pro/anthropic-launches-claude-for-financial-services-to-help-analysts-conduct-research
- Lookahead bias in LLM forecasts: https://arxiv.org/abs/2512.23847 · https://arxiv.org/pdf/2309.17322
- TradingAgents paper: https://arxiv.org/abs/2412.20138. The backtest and reflection features were verified in the installed `tradingagents==0.7.0` package metadata.
