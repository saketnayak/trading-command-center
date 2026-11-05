# Alerts

**Alerts** (top nav) watches prices, signals and portfolios and tells you when something happens. Rules are checked every 15 minutes by AgentFloor itself; no AI is involved in deciding whether an alert fires.

## Kinds of rule

| Rule | Fires when |
|---|---|
| Price rises above / falls below | the price crosses your level |
| Big daily move | the price moves at least X% from the previous close (once per trading session) |
| Crosses its moving average | the daily close moves above or below its 50- or 200-day average |
| Markov regime changes | the regime changes (optionally only into Bull, Sideways or Bear) |
| AI verdict changes | a newer completed analysis changes BUY / HOLD / SELL |
| Portfolio falls from its peak | the portfolio is X% below its high |
| A holding gets too big | a holding grows past X% of the portfolio |
| **Several conditions (AND / OR)** | a combination becomes true, for one ticker or for any holding in a portfolio, optionally only holdings in chosen sectors |

Conditions you can combine: price above/below, daily move (up, down or either), close above/below its 50- or 200-day average, Markov regime is Bull/Sideways/Bear, latest AI verdict is BUY/HOLD/SELL, holding is over X% of the portfolio.

**How firing works**: a rule fires when its condition *becomes* true and stays quiet while it remains true; once it is false again it re-arms. For rules over holdings this works per holding, so each holding fires when it starts matching. If data is missing, nothing fires and nothing re-arms. **At most once every…** (the cooldown) stops repeat notifications.

**Check now** shows what the rule sees right now without firing or changing anything.

## Describe an alert in words

Type what you want, for example:

> Tell me if any semiconductor holding goes Bear on Markov and drops below its 200-day

Your default AI model turns the sentence into a rule. You then see **"Here's what I'll watch for"**, a plain sentence written by AgentFloor from the rule itself (not the model's own words), so you can check exactly what will be watched. You can switch between *all* and *any* of the conditions, remove a condition, choose the portfolio, channels and cooldown, then **Save** or **Discard**. Nothing is saved until you press Save.

If part of your sentence can't be expressed ("when the CEO tweets"), it is listed as left out; if nothing can, you're told what was missing ("how big a move") and can rephrase or use the form. Translating a sentence needs an LLM key (Settings → API Keys) and costs one small LLM call. Checking rules never does.

## Re-run the analysis when it fires

Tick **Re-run the analysis when it fires** (any rule except the portfolio drawdown rule) to start a fresh AI analysis with your default model for each ticker the alert is about. The alert links to each analysis and shows its verdict once it finishes ("NVDA analysis: SELL"). To limit cost, at most 3 analyses start per alert, and a ticker analysed in the last 20 hours is linked instead of analysed again. **It never places an order.**

## Where alerts go

- **In-app inbox** (always), with an unread badge on the Alerts menu item.
- **Email** to your account address (needs SMTP configured on the server).
- **Portfolio webhook**: the Slack, Telegram or JSON webhook set in a portfolio's delivery settings. Choose that portfolio on the rule.

Shortcuts: the ticker drawer has "alert me" links that open the form pre-filled. Up to 100 rules per user.
