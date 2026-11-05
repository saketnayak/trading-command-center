# Troubleshooting

**Holdings show no price.**
Add a free Finnhub key (Settings → API Keys). Settings also tells you if the key is invalid, rate-limited or missing a plan permission. Without Finnhub, prices fall back to Yahoo Finance where possible.

**Performance, Risk or Rebalance warn about unpriced holdings.**
These tabs use daily history from Yahoo Finance, which sometimes rate-limits bursts. A symbol that fails is retried after 5 minutes, and the whole store refreshes every weekday night. Symbols Yahoo doesn't know (some foreign listings, delisted tickers) stay unpriced and are named rather than counted as zero.

**AI features say no LLM key is configured.**
Analyses, briefings, chat, "Describe an alert", SEC filing summaries and the learning loop need one LLM provider key (Settings → API Keys). Everything else works without one, including alert evaluation and the plain SEC filing summaries.

**"Describe an alert" says it couldn't understand.**
It lists what was missing (for example "missing: how big a move") or what it left out. Add the number or condition and try again, or build the rule with the form under it. The form and the described rules use the same engine.

**An alert never fires.**
Press **Check now** on the rule: it shows what the rule sees right now and whether it would fire. Remember that rules fire when a condition *becomes* true. If it was already true when you saved it, it fires once on the first check and not again until it has been false. A cooldown also suppresses repeats.

**The SEC filings tab is empty or says "Checking EDGAR…".**
The first visit fetches filings in the background (a few seconds per holding) and the page updates by itself. Funds, ETFs, crypto and companies listed outside the US don't file 10-K/10-Q/8-K reports and are listed at the bottom. If EDGAR could not be read for a ticker, the tab says so and the next refresh retries. Set `SEC_USER_AGENT` ([Configuration](Configuration.md)) if requests are being refused.

**A filing has no AI summary.**
- *"AI summary on the next refresh"*: it hasn't been summarised yet.
- *"didn't quote the filing"*: the model's summary couldn't be verified, so it is hidden on purpose.
- Without an LLM key you get the plain summary only.

**"The quote link opens the filing but doesn't jump to the passage."**
Jumping to a quote uses text fragments, supported by Chrome, Edge and Safari. Firefox opens the filing at the top.

**The Tax tab is empty.**
Tax tools need a ledger-backed portfolio: add or import transactions on the Transactions tab first.

**Net worth wallet shows an error.**
The last known balance is kept and the error is shown. Press **Sync** to retry. Only public BTC addresses and native ETH balances are read; tokens and xpubs aren't supported yet.

**An MCP client can't connect.**
Check the URL ends in `/api/mcp` behind the bundled nginx (or `/mcp` when talking to the backend directly), that the header is `Authorization: Bearer af_…`, and that the token isn't revoked or expired (Settings → MCP access).

**Updating.**
`agentfloor update` pulls the latest images and restarts the app; database changes apply automatically on startup and your data is kept. `docker compose down -v` is the only command that deletes data.
