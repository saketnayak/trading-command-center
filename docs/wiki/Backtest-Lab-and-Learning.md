# Backtest Lab, model leaderboard and learning loop

## Backtest Lab (Research → Backtest)

*Would the agents' calls have made money, and is that real skill or hindsight?*

The Backtest Lab replays the agent team on a grid of past dates and scores each BUY / HOLD / SELL call on the following days, against simple baselines with the same trading costs: **buy-and-hold**, **always hold**, a **moving-average crossover** and **random**.

**Setting one up**: up to 5 tickers, a date range and spacing, provider and model, analysts, depth, the horizon to score over, and a **budget cap in US dollars**. A real run stops when it reaches the budget (status *stopped*).

**Dry run first**: a dry run uses a stub model that always says BUY. It costs nothing and checks the dates, prices and scoring before you spend money.

**Limits**: 120 decisions per backtest (300 for a dry run), a budget of at most $200, the last date at least one horizon before today, and 3 queued or running backtests per user. Backtests run one at a time per server; **Stop** takes effect after the decision in progress.

### Contamination: why the headline only counts some dates

A model can't be fairly tested on dates it may have read about in training. AgentFloor keeps an approximate **training cutoff** for each model and labels every decision **in-sample** (on or before the cutoff), **out-of-sample** or **unknown**. The headline numbers use **out-of-sample decisions only**: if every date is in-sample there is no headline, and if the cutoff is unknown you get all decisions with a warning. You can override the cutoff when creating a backtest. The results page shows the in-sample and out-of-sample results side by side, and a growth-of-1 chart with the cutoff marked.

**Metrics**: total return, max drawdown, Sharpe, hit rate and expectancy over BUY/SELL calls, excess return vs buy-and-hold, and the same curves for each baseline.

Each backtest keeps its own agent memory, which is deleted afterwards, so a backtest never changes how your live analyses behave.

## Model leaderboard (Research → Performance)

"Which setup calls it best?" groups your **live** analyses by provider · model, by depth or by analyst set, and shows 7- and 30-day accuracy (HOLD isn't scored), the direction-signed return, and the excess return vs SPY over the same window. Runs on dates the model may have seen in training are left out and counted separately.

## Hindsight warning on runs

When you analyse a past date that falls before the model's training cutoff, the run page shows a banner: the model may already "know" what happened next.

## Learning loop (Settings → Learning loop)

Off by default. When on, AgentFloor goes back to each of your completed analyses once its horizon (**7 or 30 days**) has passed. It looks up what the price actually did, scores the call (a BUY is scored on the move, a SELL on its inverse, a HOLD as zero) and asks the agents to **reflect** on it. The lessons are stored in **your own** agent memory, which future analyses then draw on.

- Runs every night at 01:10 UTC; **Reflect now** runs a pass immediately.
- Each reflection uses the run's own model and depth: about five LLM calls on your key.
- Memories are per user and never shared. **Clear memories** wipes them.
- The section shows memory counts per agent, how many runs were reflected on, and recent reflections with the move, the score and any error.
