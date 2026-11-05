# What's new

Everything below arrived in **November 2026** as part of the [2026 feature roadmap](https://github.com/saketnayak/trading-command-center/blob/main/docs/feature-roadmap-2026.md). Run `agentfloor update` to get it; database changes are applied automatically when the backend starts.

## SEC filings, with summaries you can check ([#66](https://github.com/saketnayak/trading-command-center/pull/66))
A new **SEC filings** tab (Portfolio → ⋯) shows:
- **10-K and 10-Q**: risk-factor changes vs the previous report.
- **8-K**: current reports, with important events highlighted.
- **Form 4**: insider buys and sells, with 10b5-1 plan flags.

AI summaries must quote the filing word for word, and each quote links to the passage on sec.gov. Without an LLM key you still get plain summaries. The morning brief shows this week's filings. → [SEC filings](SEC-Filings.md)

**Self-hosters:** this tab needs `SEC_USER_AGENT` in `.env` ([Configuration](Configuration.md)).

## Alerts you can describe in plain English ([#65](https://github.com/saketnayak/trading-command-center/pull/65))
"Tell me if any semiconductor holding goes Bear on Markov and drops below its 200-day" becomes a rule that you check and save.
- **Combined rules**: AND/OR across several conditions, over one ticker or any holding (optionally by sector).
- **Optional re-run**: start a fresh AI analysis when an alert fires.

The AI only writes the rule; checking it is deterministic. → [Alerts](Alerts.md)

## Learning loop and hindsight flags ([#64](https://github.com/saketnayak/trading-command-center/pull/64))
- **Opt-in learning**: the agents reflect on how their calls turned out after 7 or 30 days and remember the lessons (per user).
- **Hindsight banner**: past-dated analyses that fall inside the model's training data are flagged. → [Backtest Lab and learning](Backtest-Lab-and-Learning.md)

## Backtest Lab and model leaderboard ([#62](https://github.com/saketnayak/trading-command-center/pull/62))
- **Backtest Lab**: replay the agents on past dates with a budget cap, scored against buy-and-hold, always-hold, moving-average and random baselines. Headline results count only dates after the model's training cutoff.
- **Free dry runs** check dates, prices and scoring without spending anything.
- **"Which setup calls it best?"** compares models, depths and analyst sets on your live runs. → [Backtest Lab and learning](Backtest-Lab-and-Learning.md)

## Net worth ([#61](https://github.com/saketnayak/trading-command-center/pull/61))
- **One number**: portfolios, property, cash, loans and read-only BTC/ETH wallets.
- **History**: a chart over 6M–5Y, the split by category, and dated values for each item.
- **Exchange-rate fix**: currency conversion works again (the rate provider had moved). → [Net worth](Net-Worth.md)

## Tax tools ([#60](https://github.com/saketnayak/trading-command-center/pull/60))
- **Realised gains by tax year** in Form 8949 layout, with wash sales checked across all your portfolios.
- **Loss-harvest candidates**, with similar funds to stay invested.

Informational, simplified US rules. → [Transactions, income and tax](Transactions-Income-and-Tax.md)

## Dividend income ([#59](https://github.com/saketnayak/trading-command-center/pull/59))
- **Forward income**, yield and yield on cost.
- **12-month calendar** and **income received**.
- **Monthly goal** and a 10-year reinvestment projection. → [Transactions, income and tax](Transactions-Income-and-Tax.md)

## Transaction ledger ([#58](https://github.com/saketnayak/trading-command-center/pull/58), [#63](https://github.com/saketnayak/trading-command-center/pull/63))
- **Holdings from trades**: import or enter your trades and AgentFloor derives the holdings.
- **Tax lots** (FIFO, HIFO or average), realised gains, dividends, fees, cash.
- **Money-weighted return.**
- **Undo**: you can switch back to plain holdings without losing them. → [Transactions, income and tax](Transactions-Income-and-Tax.md)

## Performance, Risk, Rebalance, Alerts and MCP ([#56](https://github.com/saketnayak/trading-command-center/pull/56))
- **Performance**: time-weighted return vs SPY, drawdown, contribution.
- **Risk**: VaR, stress tests, correlation clusters, Monte Carlo.
- **Rebalance**: targets, bands and a trade plan.
- **Alerts**: an inbox, with email and Slack/Telegram webhooks.
- **MCP server**: Claude, Cursor and other assistants can query your portfolio.
- **Measured numbers in the briefing**: the AI briefing now quotes these figures instead of guessing. → [Portfolio analytics](Portfolio-Analytics.md), [Alerts](Alerts.md), [MCP server](MCP-Server.md)
