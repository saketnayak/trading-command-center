# Portfolio analytics

Three portfolio tabs measure the portfolio instead of guessing about it. They use daily *adjusted* closes from Yahoo Finance (5 years, stored locally, refreshed nightly), so they need no API key. The AI briefing is given these measured numbers and told to quote them, never invent them.

## Performance

*How did my portfolio do, and did it beat the market?*

- **Growth of 100** vs a benchmark (SPY by default; QQQ or any ticker), a drawdown chart, trailing returns (1M … 5Y), risk stats and each holding's **contribution** to the return.
- **Time-weighted return**: each day uses the holdings you had at the previous close, so adding money or uploading a new snapshot is not counted as a gain.
- **Holdings mode**
  - **Actual**: follows your upload history (or real trade dates if you use the [ledger](Transactions-Income-and-Tax.md)).
  - **What-if**: today's holdings held over the whole range.
  - **Auto** picks Actual once there are 30 days of history.
- With the ledger you also get a **money-weighted return** (IRR), which accounts for when you added or withdrew money.
- Returns are in each holding's own currency; holdings with no price history are named in a warning rather than silently zeroed.

## Risk

*How risky is the portfolio I hold today?*

- **Headline**: 1-day 95% Value-at-Risk ("on a bad day, about 1 in 20, you could lose about $X"), plus CVaR, volatility, beta and correlation vs the benchmark, and max drawdown.
- **Risk vs value share** per holding: a stock that is 10% of the money but 30% of the risk stands out.
- **Concentration**: top holding, top 5, effective number of holdings.
- **Correlation heatmap** and **clusters** of holdings that move together (correlation ≥ 0.8).
- **Stress tests**: the 2008 crisis, COVID crash, 2022 rate shock, August 2024 carry unwind and the 2025 tariff sell-off, replayed with each holding's real move where history covers it, otherwise estimated from its beta. Each row says how it was built.
- **1-year Monte Carlo fan** (2,000 bootstrapped paths, fixed seed so numbers don't jump between visits).
- Choose a 3M, 6M, 1Y or 3Y lookback. Holdings with too little price history are left out and named.

## Rebalance

*What would I trade to get back to my targets?*

1. Set **target weights** (they must add up to 100%; start from "Current weights" or "Equal weight") and a **tolerance band** per ticker (default ±5 points).
2. Pick a mode:
   - **Bands**: only trade positions that drifted outside their band.
   - **Full**: put every position back on target.
   - **Contribute**: invest new cash, buying only what's underweight.
   - **Withdraw**: raise cash, selling only what's overweight.
3. Optionally round to **whole shares** (crypto stays fractional).

You get a drift chart and a trade list (sells first) that flags sells which also carry a trim signal, with CSV download. **It is a plan only: AgentFloor never places the trades.**
