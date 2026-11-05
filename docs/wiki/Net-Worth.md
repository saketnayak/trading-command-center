# Net worth

**Net worth** (top nav) adds everything outside your portfolios to them: property, cash, private holdings, loans, mortgages and crypto wallets.

## Adding things

- **Asset or liability**: pick a category, give it a name, a currency and a value. Each **Update value** records a value on a date (past dates are fine), so you build a history; the latest value on or before a day is used for that day. **History** lets you delete a wrong value.
- **Crypto wallet**: paste a public **Bitcoin** or **Ethereum** address. Balances are read from public blockchain APIs (mempool.space for BTC, a public node for native ETH): no keys and nothing to sign. They sync when you add the wallet, nightly, and when you press **Sync**. If a sync fails, the last balance is kept and the error is shown.

Up to 200 items per user.

## What you see

- Net worth, total assets, total liabilities and the debt ratio, with the change over the selected range (6M, YTD, 1Y, 3Y, 5Y).
- A chart of net worth and liabilities. Each portfolio uses its [Performance](Portfolio-Analytics.md) series; other items are carried forward between their recorded values. A note names items that start part-way through the range.
- The split by category, with all portfolios grouped as "Portfolios".
- A reminder for manual values older than 180 days.

Everything is converted into your preferred currency at today's exchange rate.

Not yet supported: ERC-20 tokens, Bitcoin xpubs, and allocation targets across the whole household.
