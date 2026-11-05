# SEC filings

**Portfolio → ⋯ → SEC filings** shows what changed in your holdings' official US filings, straight from SEC EDGAR. It is free, needs no API key, and is hidden for portfolios that hold only crypto.

## What's covered

| Filing | What you see |
|---|---|
| **10-K** (annual) and **10-Q** (quarterly) | The **Risk Factors** section compared with the previous filing of the same type: how many paragraphs are new, removed or reworded, and the biggest changes |
| **8-K** (current report) | What happened, in plain words: results, a new agreement, new debt, a director or officer leaving, an auditor change, a restatement… Important items (such as restatements, officer changes or cyber incidents) are highlighted |
| **Form 4** (insider trades) | Open-market **buys and sells** by officers, directors and 10% owners: who, when, how many shares, at what price, the net value, and whether the trade was under a pre-arranged **10b5-1 plan**. Grants, option exercises, tax withholding and gifts are counted but not listed, since they say little about conviction |

It covers 10-K, 10-Q and 8-K filings from the last 120 days and insider trades from the last 90, filtered by 30, 90 or 120 days and by form. Funds, crypto and companies listed outside the US don't file these reports and are named at the bottom.

## AI summaries you can check

With an LLM key, each filing gets a short summary: a headline and up to five points. **Every point quotes the filing word for word**, and AgentFloor checks the quote against the text it gave the model:

- a point whose quote isn't in the filing is dropped;
- a summary with no verifiable point is not shown at all.

Each quote has an **"in the filing"** link that opens the document on sec.gov scrolled to that passage (in Chrome, Edge and Safari). A *removed* passage links to the previous filing, where it still exists.

One summary is written per filing and shared by everyone on your AgentFloor who holds that stock, using the first LLM key configured in Settings.

**No LLM key?** Each filing still shows a plain summary, for example *"Risk factors vs the 10-Q filed 2026-08-05: 9 new, 4 removed, 21 reworded paragraphs"* or *"Results of operations; Regulation FD disclosure"*, plus links to the filing and the previous one.

## Where else it shows up

- **Holdings tab**: the morning briefing strip adds a "SEC filings this week" line ("NVDA 10-Q · AMD 8-K (director or officer change) · insiders sold $3.0M of NVDA").
- **AI Insights**: the daily briefing is given the last 30 days of filings (verified summaries only) and insider totals.
- **MCP**: the `get_filings` tool ([MCP server](MCP-Server.md)).

## Freshness

Filings refresh every weekday night at 23:40 UTC, when you open the tab and the data is more than a day old (it says "Checking EDGAR…" while it works), and when you press **Refresh**. The first visit takes a few seconds per holding.

**Self-hosting**: set `SEC_USER_AGENT` to your name and email ([Configuration](Configuration.md)). The SEC rejects clients without a contact email, so the tab shows a setup message until this is set.

Not yet covered: 13F fund holdings, earnings-call transcripts, and changes in the MD&A section.
