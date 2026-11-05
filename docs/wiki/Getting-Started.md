# Getting started

## 1. Install

Docker Desktop is the only prerequisite.

**Windows** (PowerShell):

```powershell
irm https://raw.githubusercontent.com/saketnayak/trading-command-center/main/install.ps1 | iex
```

**macOS / Linux**:

```bash
curl -fsSL https://raw.githubusercontent.com/saketnayak/trading-command-center/main/install.sh | bash
```

Open **http://localhost** and register. The first account becomes the admin; everyone after that needs an invite (Settings → Team).

Already installed? `agentfloor update` pulls the latest version and runs the database migrations; your data is kept.

## 2. Add keys (Settings → API Keys)

| Key | Needed for | Cost |
|---|---|---|
| **One LLM provider** (OpenAI, Anthropic, Google, Groq, …, or a local Ollama/vLLM server) | AI analyses, the morning briefing, chat, alerts described in words, SEC filing summaries, the learning loop | Pay per use (Groq has a free tier; local models are free) |
| **Finnhub** | Live prices, earnings calendar, fundamentals, news, outcome tracking | Free tier is enough |

Everything else needs no key: daily price history and dividends come from Yahoo Finance, SEC filings from SEC EDGAR, exchange rates from the ECB, and wallet balances from public blockchain APIs.

For the SEC filings tab, set `SEC_USER_AGENT` in your `.env` to your name and email (see [Configuration](Configuration.md)); the SEC rejects clients without a contact email.

## 3. Load a portfolio

**Portfolio → + New Portfolio**, then either:

- **Upload CSV**: most broker exports work (`Symbol`, `Shares`/`Quantity`, `Average Cost`/`Cost Basis`);
- **+ Add row** to type holdings in; or
- **Transactions → Import CSV** to load your trade history instead. This turns on the [ledger](Transactions-Income-and-Tax.md), which unlocks realised gains, money-weighted returns, actual dividends received and the Tax tab.

## 4. Look around

| Where | What you'll see |
|---|---|
| **Holdings** | Prices, P&L, Markov regime per holding, trim signals, the morning briefing strip and this week's SEC filings |
| **Performance / Risk / Rebalance** | How the portfolio did vs SPY, how risky it is today, and a trade plan back to your targets ([Portfolio analytics](Portfolio-Analytics.md)) |
| **Transactions / Income / Tax** | Trades, lots, dividends and tax views ([Transactions, income and tax](Transactions-Income-and-Tax.md)) |
| **⋯ → SEC filings** | What changed in each holding's filings, with insider trades ([SEC filings](SEC-Filings.md)) |
| **AI Insights** | The daily briefing: health score, action items, risk alerts |
| **Net worth** (top nav) | Everything you own and owe ([Net worth](Net-Worth.md)) |
| **Alerts** (top nav) | Rules, the inbox, and "Describe an alert" ([Alerts](Alerts.md)) |

## 5. Run an analysis

**Research → New Run**: pick a ticker, a date (today, or a past date), a model and a depth (Quick 2–5 min, Standard 5–10, Deep 10–20), then watch the analyst team, the bull/bear debate and the risk desk work live. Completed runs are scored at +7, +14, +30 and +90 days on **Research → Performance**.

## 6. Optional extras

- **Watchlist**: re-run analyses on a schedule.
- **Settings → Investor Profile**: tailors the AI to your horizon, risk and rules.
- **Settings → MCP access**: use AgentFloor from Claude or Cursor ([MCP server](MCP-Server.md)).
- **Settings → Learning loop**: let the agents learn from how their calls turned out ([Backtest Lab and learning](Backtest-Lab-and-Learning.md)).
