# Configuration

## Where settings live

- **One-command install**: `~/.agentfloor/.env` (Windows: `%USERPROFILE%\.agentfloor\.env`). After editing it, run `agentfloor restart`.
- **From source**: `.env` in the repository root (copy `.env.example`), read by `docker-compose.dev.yml` / `docker-compose.prod.yml`.

API keys for LLM providers, Finnhub and the JEV Lab are **not** environment variables: add them in **Settings → API Keys**, where they are stored encrypted. The address of a local model server (Ollama, vLLM, LiteLLM) is entered there too.

## Environment variables

| Variable | Required | What it does |
|---|---|---|
| `JWT_SECRET` | Yes | Signs login tokens (the installer generates one) |
| `ENCRYPTION_KEY` | Yes | 64 hex characters; encrypts stored API keys. Changing it makes stored keys unreadable |
| `NEXTAUTH_SECRET` | Yes | Signs browser sessions |
| `NEXTAUTH_URL` | Yes | Public address of your install, e.g. `http://localhost` or `https://agentfloor.example.com`. Also used for links in emails and alerts |
| `SEC_USER_AGENT` | Recommended | Your name and email, e.g. `"Jane Doe jane@example.com"`. The SEC asks every client to identify itself; used for the SEC filings tab. Defaults to a generic AgentFloor identifier |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | | Email for invites, alert emails and briefing delivery. Without SMTP, invite links are shown on screen and alert emails are skipped |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | | Adds "Sign in with Google" |
| `OPENAI_API_KEY` | | Pre-seeds an OpenAI key for everyone (optional) |
| `TRADINGAGENTS_RESULTS_DIR` | | Where agent memories for the learning loop are kept (default `./results`, one folder per user) |
| `DATABASE_URL` | | Postgres connection; set by the compose files |

> **Installed before November 2026?** `agentfloor update` pulls new images but keeps the compose file from your install, which doesn't pass `SEC_USER_AGENT` to the backend. SEC filings still work with the default identifier. To use your own, re-run the installer: it keeps your existing `.env` and your data.

## Admin toggles (Settings, admin only)

Markov regime, Elliott Wave, Kalman filter and **JEV Lab** can be switched on or off for the whole install. JEV Lab is experimental and off by default. In *shadow* mode it reads live market data but never trades; in *paper* mode, which is admin-only and needs an Alpaca **paper** key, it places simulated orders. There is no live-trading path.

## Scheduled jobs

The backend runs these on its own; no cron setup is needed. Times are UTC.

| Job | When | What it does |
|---|---|---|
| Alert evaluation | Every 15 minutes | Checks every enabled alert rule |
| Daily portfolio briefing | Weekdays, hourly at :15 | Generates the AI briefing for each portfolio at 9 AM in its delivery timezone (skipped if one was made in the last 12 h) |
| Watchlist runs | Your schedules | Re-runs analyses for watchlist items |
| Price history refresh | Weekdays 22:30 | Daily closes for every held ticker plus SPY and QQQ |
| Dividend refresh | Weekdays 23:05 | Dividend history for every held ticker |
| Wallet sync | Daily 23:20 | Balances of BTC/ETH wallets on the Net worth page |
| SEC filings refresh | Weekdays 23:40 | New filings, insider trades and summaries for held tickers |
| Learning loop | Daily 01:10 | Reflections for users who turned the learning loop on |
| JEV Lab tick retention | Daily 03:30 | Deletes JEV Lab tick data older than 14 days |

## Data sources

| Data | Source | Key? |
|---|---|---|
| Live prices, earnings, fundamentals, news | Finnhub, with a Yahoo Finance fallback for prices | Free Finnhub key |
| Daily price history (Performance, Risk, Rebalance, alerts on moving averages) and dividends | Yahoo Finance | No |
| Crypto prices | CoinGecko | No |
| Exchange rates | ECB rates via Frankfurter | No |
| SEC filings and insider trades | SEC EDGAR | No (send `SEC_USER_AGENT`) |
| Wallet balances | mempool.space (BTC), a public Ethereum node (ETH) | No |
| AI analysis, briefings, summaries | The LLM provider you choose | Your key |
