# Transactions, income and tax

## Transactions (the ledger)

By default a portfolio is a list of holdings that you upload or edit. Switch it to a **transaction ledger** and the holdings are worked out from your trades instead, which unlocks realised gains, real cost basis, money-weighted returns, dividends actually received and the Tax tab.

**Getting started** (Portfolio → Transactions):

- **Start from holdings**: creates one opening buy per current holding at its average cost.
- **Import CSV**: drop a broker export. Columns are guessed from common headers and broker wording ("YOU BOUGHT", "Qualified Dividend", …) is understood; you check the mapping and a dry run before anything is saved, and either every row goes in or none does.
- **Add** single transactions by hand.

Supported types: BUY, SELL, SPLIT, DIVIDEND, INTEREST, FEE, DEPOSIT and WITHDRAWAL, with an optional account name.

**What you see**: realised gains this year and all time (short- vs long-term), dividends and interest, fees, cash (once you record deposits), open lots per position and realised gains by year.

**Cost basis**: FIFO, HIFO or average cost, switchable at any time. Buy fees go into the cost, sale fees reduce the proceeds, and splits adjust your lots.

**While the ledger is on**, the Holdings tab is read-only (your trades decide the holdings). **Stop using the ledger** keeps the holdings it last worked out and returns the portfolio to editable holdings. Deleting your only transaction undoes the switch completely.

## Income

*How much will my portfolio pay me?*

- **Forward annual and monthly income**, yield and **yield on cost**, from each holding's last 10 years of dividends (free, no key). Special one-off dividends don't inflate the forecast.
- A **12-month calendar** by ex-dividend month (hover or tap a month to see who pays).
- **Income received** over the last 24 months: actual dividend transactions for ledger portfolios, otherwise estimated from today's shares.
- A **monthly income goal** with a progress bar.
- A **10-year projection** with and without reinvesting dividends, with its assumptions (growth rate, yield) spelled out.

Suspended dividends (no payment for over a year) count as paying nothing.

## Tax (⋯ menu, ledger portfolios)

Informational only, using simplified US rules. **Not tax advice.**

- **Realised gains by tax year** in Form 8949 layout (one row per lot sold, short/long term), with CSV download.
- **Wash sales**: a loss is flagged when you bought the same symbol within 30 days before or after, in *any* of your portfolios. The disallowed amount is shown (code W).
- **Loss-harvest candidates**: open lots with an unrealised loss above your minimum, showing their term, days until long-term, whether selling now would be a wash sale, and the "don't rebuy before" date.
- **Similar funds**: liquid ETFs that moved closely with the holding over the last year (excluding funds tracking the same index), as ideas to stay invested while harvesting a loss.
