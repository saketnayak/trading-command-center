"""Portfolio risk maths: pure functions, no I/O.

Everything here describes the portfolio as it is *today*: current value
weights applied to each holding's historical daily returns. That answers
"how risky is what I hold now", which is what risk tools report, rather
than "how risky was what I held then" (the Performance tab's job).

Inputs are aligned daily returns on one trading calendar (the router builds
them from the price_bars store). A holding missing a day's price gets a 0
return for that day; holdings with too little history are excluded and
reported by the caller.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date

import numpy as np

TRADING_DAYS = 252
VAR_LEVEL = 0.95
CLUSTER_CORRELATION = 0.8
MONTE_CARLO_PATHS = 2000
MONTE_CARLO_BLOCK = 5  # days per bootstrap block; keeps short-run autocorrelation
MONTE_CARLO_SEED = 7  # fixed so the numbers do not jump between page loads
MAX_MATRIX_SYMBOLS = 20


@dataclass(frozen=True)
class StressScenario:
    """A market sell-off. Replayed from stored prices when they cover the
    window; otherwise estimated as beta × the S&P 500's move."""

    id: str
    name: str
    start: date
    end: date
    sp500_move: float  # S&P 500 price-index move over the window (fallback driver)
    note: str


# S&P 500 closing levels: 2007-10-09 1565.15 → 2009-03-09 676.53; 2020-02-19 3386.15 → 2020-03-23 2237.40;
# 2022-01-03 4796.56 → 2022-10-12 3577.03; 2024-07-16 5667.20 → 2024-08-05 5186.33; 2025-02-19 6144.15 → 2025-04-08 4982.77.
STRESS_SCENARIOS: tuple[StressScenario, ...] = (
    StressScenario("gfc", "Global financial crisis", date(2007, 10, 9), date(2009, 3, 9), -0.5678,
                   "Peak-to-trough of the 2007–09 bear market."),
    StressScenario("covid", "COVID crash", date(2020, 2, 19), date(2020, 3, 23), -0.3392,
                   "The fastest 30% fall in S&P 500 history."),
    StressScenario("rates_2022", "2022 rate shock", date(2022, 1, 3), date(2022, 10, 12), -0.2543,
                   "Inflation and the fastest Fed hiking cycle in decades."),
    StressScenario("carry_2024", "Aug 2024 carry-trade unwind", date(2024, 7, 16), date(2024, 8, 5), -0.0849,
                   "Yen carry-trade unwind and a growth scare."),
    StressScenario("tariffs_2025", "2025 tariff shock", date(2025, 2, 19), date(2025, 4, 8), -0.1890,
                   "Broad US tariff announcements."),
)


def _r(x: float | None, places: int = 6) -> float | None:
    return None if x is None or not math.isfinite(x) else round(float(x), places)


def concentration(weights: dict[str, float]) -> dict:
    w = sorted(weights.values(), reverse=True)
    hhi = sum(x * x for x in w)
    return {
        "hhi": _r(hhi, 4),
        "effective_holdings": _r(1 / hhi, 2) if hhi > 0 else None,
        "top1_weight": _r(w[0] if w else None, 4),
        "top5_weight": _r(sum(w[:5]), 4),
        "holdings": len(w),
    }


def _drawdown(returns: np.ndarray) -> float:
    if returns.size == 0:
        return 0.0
    curve = np.cumprod(1 + returns)
    peak = np.maximum.accumulate(np.concatenate(([1.0], curve)))[1:]
    return float(np.min(curve / peak - 1))


def _beta(r: np.ndarray, b: np.ndarray) -> float | None:
    if r.size < 3 or b.size != r.size:
        return None
    var_b = float(np.var(b, ddof=1))
    if var_b <= 0:
        return None
    return float(np.cov(r, b, ddof=1)[0, 1] / var_b)


def _clusters(symbols: list[str], corr: np.ndarray, weights: dict[str, float]) -> list[dict]:
    """Groups of holdings linked by correlation ≥ CLUSTER_CORRELATION (union-find)."""
    parent = list(range(len(symbols)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(symbols)):
        for j in range(i + 1, len(symbols)):
            if corr[i, j] >= CLUSTER_CORRELATION:
                parent[find(i)] = find(j)
    groups: dict[int, list[str]] = {}
    for i, s in enumerate(symbols):
        groups.setdefault(find(i), []).append(s)
    out = []
    for members in groups.values():
        if len(members) < 2:
            continue
        idx = [symbols.index(m) for m in members]
        pair_corrs = [corr[a, b] for k, a in enumerate(idx) for b in idx[k + 1:]]
        out.append({
            "tickers": sorted(members, key=lambda m: -weights.get(m, 0.0)),
            "combined_weight": _r(sum(weights.get(m, 0.0) for m in members), 4),
            "average_correlation": _r(float(np.mean(pair_corrs)), 3),
        })
    out.sort(key=lambda c: -(c["combined_weight"] or 0))
    return out


def monte_carlo(portfolio_returns: np.ndarray, *, horizon_days: int = TRADING_DAYS,
                paths: int = MONTE_CARLO_PATHS, block: int = MONTE_CARLO_BLOCK,
                seed: int = MONTE_CARLO_SEED) -> dict | None:
    """Block-bootstrap 1-year outcomes from the portfolio's own daily returns.
    Returns a fan (percentiles every ~month) and terminal-outcome odds."""
    n = portfolio_returns.size
    if n < block * 4:
        return None
    rng = np.random.default_rng(seed)
    blocks_needed = math.ceil(horizon_days / block)
    starts = rng.integers(0, n - block + 1, size=(paths, blocks_needed))
    idx = (starts[:, :, None] + np.arange(block)[None, None, :]).reshape(paths, -1)[:, :horizon_days]
    sims = portfolio_returns[idx]
    growth = np.cumprod(1 + sims, axis=1)
    steps = list(range(0, horizon_days + 1, 21))
    if steps[-1] != horizon_days:
        steps.append(horizon_days)
    pct = [5, 25, 50, 75, 95]
    fan = []
    for d in steps:
        values = np.ones(paths) if d == 0 else growth[:, d - 1]
        q = np.percentile(values - 1, pct)
        fan.append({"day": d, **{f"p{p}": _r(v, 4) for p, v in zip(pct, q)}})
    terminal = growth[:, -1] - 1
    return {
        "horizon_days": horizon_days,
        "paths": paths,
        "observations": int(n),
        "fan": fan,
        "terminal": {f"p{p}": _r(v, 4) for p, v in zip(pct, np.percentile(terminal, pct))},
        "prob_loss": _r(float(np.mean(terminal < 0)), 4),
        "prob_loss_10": _r(float(np.mean(terminal < -0.10)), 4),
        "prob_loss_20": _r(float(np.mean(terminal < -0.20)), 4),
    }


def compute_risk(
    *,
    symbols: list[str],
    returns: np.ndarray,  # shape (days, len(symbols)), aligned daily returns
    weights: dict[str, float],  # current value weights over `symbols`, summing to 1
    benchmark_returns: np.ndarray | None,  # shape (days,), same calendar
    portfolio_value: float,
) -> dict:
    w = np.array([weights[s] for s in symbols])
    port = returns @ w
    days = port.size

    sd = float(np.std(port, ddof=1)) if days >= 2 else None
    vol = sd * math.sqrt(TRADING_DAYS) if sd is not None else None
    q = float(np.percentile(port, (1 - VAR_LEVEL) * 100)) if days >= 20 else None
    var = -q if q is not None else None
    tail = port[port <= q] if q is not None else np.array([])
    cvar = -float(np.mean(tail)) if tail.size else None

    beta = _beta(port, benchmark_returns) if benchmark_returns is not None else None
    corr_b = (
        float(np.corrcoef(port, benchmark_returns)[0, 1])
        if benchmark_returns is not None and days >= 3 and np.std(benchmark_returns) > 0 and np.std(port) > 0
        else None
    )

    cov = np.cov(returns, rowvar=False, ddof=1) if days >= 2 and len(symbols) > 1 else (
        np.array([[float(np.var(returns[:, 0], ddof=1))]]) if days >= 2 else np.zeros((len(symbols), len(symbols)))
    )
    port_var = float(w @ cov @ w)
    marginal = cov @ w
    holding_vols = np.sqrt(np.clip(np.diag(cov), 0, None)) * math.sqrt(TRADING_DAYS)
    holdings = []
    for i, s in enumerate(symbols):
        hb = _beta(returns[:, i], benchmark_returns) if benchmark_returns is not None else None
        holdings.append({
            "ticker": s,
            "weight": _r(w[i], 4),
            "risk_share": _r(w[i] * marginal[i] / port_var, 4) if port_var > 0 else None,
            "volatility": _r(holding_vols[i], 4),
            "beta": _r(hb, 3),
        })
    holdings.sort(key=lambda h: -(h["risk_share"] or 0))

    # Correlation matrix for the largest holdings (readability caps it).
    top = sorted(symbols, key=lambda s: -weights[s])[:MAX_MATRIX_SYMBOLS]
    top_idx = [symbols.index(s) for s in top]
    with np.errstate(invalid="ignore", divide="ignore"):
        corr_full = np.corrcoef(returns, rowvar=False) if len(symbols) > 1 and days >= 3 else np.ones((1, 1))
    corr_full = np.nan_to_num(np.atleast_2d(corr_full), nan=0.0)
    matrix = [[_r(corr_full[a, b], 3) for b in top_idx] for a in top_idx]
    pairs = []
    for a in range(len(symbols)):
        for b in range(a + 1, len(symbols)):
            pairs.append((corr_full[a, b], symbols[a], symbols[b]))
    pairs.sort(reverse=True)

    return {
        "observations": int(days),
        "portfolio_value": _r(portfolio_value, 2),
        "stats": {
            "volatility": _r(vol, 4),
            "beta": _r(beta, 3),
            "correlation": _r(corr_b, 3),
            "var_95": _r(var, 4),
            "cvar_95": _r(cvar, 4),
            "var_95_value": _r(var * portfolio_value, 2) if var is not None else None,
            "cvar_95_value": _r(cvar * portfolio_value, 2) if cvar is not None else None,
            "max_drawdown": _r(_drawdown(port), 4),
        },
        "concentration": concentration(weights),
        "holdings": holdings,
        "correlation": {"tickers": top, "matrix": matrix, "truncated": len(symbols) > len(top)},
        "top_pairs": [
            {"a": a, "b": b, "correlation": _r(c, 3)} for c, a, b in pairs[:8] if math.isfinite(c)
        ],
        "clusters": _clusters(symbols, corr_full, weights) if len(symbols) > 1 else [],
        "monte_carlo": monte_carlo(port),
        "_portfolio_returns": port,  # for the caller's own use; stripped before responding
    }


def stress_test(
    *,
    weights: dict[str, float],
    window_returns: dict[str, dict[str, float | None]],  # scenario id → {symbol: actual return or None}
    sp500_window_returns: dict[str, float | None],  # scenario id → SPY return from stored prices, or None
    betas_vs_sp500: dict[str, float | None],
    portfolio_value: float,
    scenarios: tuple[StressScenario, ...] = STRESS_SCENARIOS,
) -> list[dict]:
    """Replay each scenario on today's weights. A holding with prices over the
    window uses its actual move; one without uses beta × the S&P 500 move
    (beta 1 when even that is unknown). Each row says how it was built."""
    out = []
    for sc in scenarios:
        market = sp500_window_returns.get(sc.id)
        market_source = "stored prices" if market is not None else "S&P 500 index levels"
        if market is None:
            market = sc.sp500_move
        total = 0.0
        actual_weight = 0.0
        legs = []
        for sym, wt in weights.items():
            r = window_returns.get(sc.id, {}).get(sym)
            method = "actual"
            if r is None:
                beta = betas_vs_sp500.get(sym)
                # Linear beta scaling can exceed a total loss on a big fall (beta 2 × −57%);
                # a long position cannot lose more than everything.
                r = max((beta if beta is not None else 1.0) * market, -1.0)
                method = "beta" if beta is not None else "market"
            else:
                actual_weight += wt
            total += wt * r
            legs.append({"ticker": sym, "return": _r(r, 4), "method": method})
        legs.sort(key=lambda x: x["return"] if x["return"] is not None else 0)
        out.append({
            "id": sc.id,
            "name": sc.name,
            "start": sc.start.isoformat(),
            "end": sc.end.isoformat(),
            "note": sc.note,
            "market_return": _r(market, 4),
            "market_source": market_source,
            "portfolio_return": _r(total, 4),
            "portfolio_impact": _r(total * portfolio_value, 2),
            "replayed_weight": _r(actual_weight, 4),
            "worst": legs[:3],
        })
    return out
