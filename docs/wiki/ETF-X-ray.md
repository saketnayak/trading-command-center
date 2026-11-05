# ETF X-ray

**Portfolio → ⋯ → ETF X-ray** shows what you really own once your ETFs and funds are opened up. It is free, needs no API key, and is hidden for portfolios that hold only crypto.

## What it shows

- **Exposure by company**: "You hold 21.3% NVDA: 16.7% directly and 4.7% through 3 funds", with the amount through each fund.
- **Exposure by sector**: split into what you hold directly and what you hold through funds.
- **Overlap between funds**: how much of two funds is the same companies.
- **Concentration**: your largest company and top 5 companies, next to the largest tickers you hold.

## Where the numbers come from

| Source | What it gives | When it's used |
|---|---|---|
| **SEC N-PORT filings** | A fund's full holdings as of its last public filing, which can be a few months old | Funds that file them, when `SEC_USER_AGENT` is set ([Configuration](Configuration.md)) |
| **Yahoo Finance** | The top 10 holdings and the sector split | Every other fund, and sector splits for all of them |

Unit trusts such as SPY and commodity trusts such as GLD don't file N-PORT, so SPY shows its top 10 holdings and GLD shows no companies.

## Reading it honestly

**Company figures are minimums.** Only the itemised part of each fund is counted, and the rest is never spread over the names shown. **Not itemised** says how much of your portfolio that is, and **Your funds** shows each fund's source, date and how much of it is itemised. Sector figures cover the whole fund, because the sector split does.

Share classes of one company, such as GOOG and GOOGL, add up only when `SEC_USER_AGENT` is set, because that's what links them to one company.

Holdings are looked up when you first open the tab, then refreshed weekly (Sundays at 22:30 UTC). **Refresh** asks for them now. If a lookup fails, the last known data stays and it tries again the next day.

The AI briefing uses these figures for concentration risk, and MCP clients can read them with the `get_xray` tool ([MCP server](MCP-Server.md)).

Not yet covered: rebalancing against true exposure, funds held inside other funds, and issuer holdings files, which would give SPY its full holdings.
