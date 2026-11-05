# AgentFloor wiki

AgentFloor is a self-hosted research workspace for individual investors: a team of AI analysts that researches any stock or crypto ticker, plus portfolio tools (performance, risk, rebalancing, a transaction ledger, income, tax lots, net worth, alerts and SEC filings) that run on your own machine with your own API keys.

> **Research and educational use only.** AgentFloor does not place real trades and is not financial advice. The one fenced exception is the opt-in **JEV Lab**, which can place orders on an Alpaca *paper* (simulated) account only.

## Start here

- [Getting started](Getting-Started.md): install, API keys, your first portfolio and analysis
- [What's new](Whats-New.md): everything added in the 2026 roadmap, most recent first

## Using AgentFloor

| Page | What it covers |
|---|---|
| [Portfolio analytics](Portfolio-Analytics.md) | Performance vs a benchmark, Risk (VaR, stress tests, Monte Carlo), Rebalance plans |
| [Transactions, income and tax](Transactions-Income-and-Tax.md) | The transaction ledger and tax lots, dividend income, realised gains, wash sales, loss harvesting |
| [Net worth](Net-Worth.md) | Portfolios plus property, cash, loans and crypto wallets in one number |
| [Alerts](Alerts.md) | Price, signal and portfolio alerts, alerts described in plain English, re-running the analysis when one fires |
| [SEC filings](SEC-Filings.md) | What changed in your holdings' 10-K, 10-Q and 8-K filings, and insider trades |
| [Backtest Lab and learning loop](Backtest-Lab-and-Learning.md) | Replaying the agents on past dates, the model leaderboard, letting the agents learn from outcomes |
| [MCP server](MCP-Server.md) | Asking Claude, Cursor or another MCP client about your own portfolio |

## Running it

| Page | What it covers |
|---|---|
| [Configuration](Configuration.md) | Environment variables, scheduled jobs and their times, data sources |
| [Troubleshooting](Troubleshooting.md) | Missing prices, empty tabs, rate limits, AI features without a key |

Developer documentation (architecture, one section per feature) is in [`CLAUDE.md`](https://github.com/saketnayak/trading-command-center/blob/main/CLAUDE.md) in the repository, and the plan is in [`docs/feature-roadmap-2026.md`](https://github.com/saketnayak/trading-command-center/blob/main/docs/feature-roadmap-2026.md).
