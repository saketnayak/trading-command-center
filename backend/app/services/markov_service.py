"""Market regime detection via discrete-time Markov chain on yfinance daily price data."""
import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# In-process cache: ticker -> (result_dict, expiry_unix_ts)
_regime_cache: dict[str, tuple[dict, float]] = {}
_CACHE_TTL = 14400  # 4 hours

# Semaphore: cap concurrent yfinance fetches to avoid Yahoo Finance rate limits
_fetch_sem = asyncio.Semaphore(10)

_STATES = ["Bear", "Sideways", "Bull"]
_STATE_IDX = {s: i for i, s in enumerate(_STATES)}


# ── Pure helper functions (synchronous, unit-testable) ────────────────────────

def _label_regimes(close: pd.Series, window: int = 20, threshold: float = 0.05) -> pd.Series:
    """Label each day as Bear (0), Sideways (1), or Bull (2) by rolling N-day return."""
    rolling_return = close.pct_change(window)
    labels = pd.Series(1, index=close.index, dtype=int)  # default Sideways
    labels[rolling_return > threshold] = 2   # Bull
    labels[rolling_return < -threshold] = 0  # Bear
    return labels


def _build_transition_matrix(labels: pd.Series) -> np.ndarray:
    """Build a 3x3 row-normalized transition matrix from consecutive state pairs."""
    counts = np.zeros((3, 3), dtype=float)
    arr = labels.values
    for i in range(len(arr) - 1):
        counts[arr[i], arr[i + 1]] += 1
    row_sums = counts.sum(axis=1, keepdims=True)
    zero_rows = (row_sums == 0).flatten()
    row_sums[row_sums == 0] = 1.0
    P = counts / row_sums
    # Unseen states get uniform distribution so every row sums to 1
    P[zero_rows] = 1.0 / 3.0
    return P


def _compute_signal(bull_prob: float, bear_prob: float) -> float:
    return round(bull_prob - bear_prob, 4)


def _compute_stationary(P: np.ndarray) -> dict[str, float]:
    """Compute stationary distribution as left eigenvector of P for eigenvalue 1."""
    eigenvalues, eigenvectors = np.linalg.eig(P.T)
    idx = np.argmin(np.abs(eigenvalues - 1.0))
    stat_vec = np.abs(eigenvectors[:, idx])
    stat_vec /= stat_vec.sum()
    return {
        "bear": round(float(stat_vec[0]), 4),
        "sideways": round(float(stat_vec[1]), 4),
        "bull": round(float(stat_vec[2]), 4),
    }


def _walk_forward_stats(close: pd.Series, labels: pd.Series, min_train: int = 252) -> dict:
    """Incremental O(n) walk-forward backtest. No lookahead."""
    arr = labels.values
    ret = close.pct_change().fillna(0).values
    n = len(arr)

    counts = np.zeros((3, 3), dtype=float)
    for i in range(min_train - 1):
        counts[arr[i], arr[i + 1]] += 1

    daily_returns = []
    for t in range(min_train, n - 1):
        counts[arr[t - 1], arr[t]] += 1
        row_sums = counts.sum(axis=1, keepdims=True)
        row_sums[row_sums == 0] = 1.0
        P = counts / row_sums

        current = arr[t]
        bull_p = P[current, 2]
        bear_p = P[current, 0]
        signal = bull_p - bear_p
        position = 1.0 if signal > 0 else (-1.0 if signal < 0 else 0.0)
        daily_returns.append(position * ret[t + 1])

    if not daily_returns:
        return {"sharpe": None, "max_drawdown": None}

    r = np.array(daily_returns)
    sharpe = float(r.mean() / (r.std() + 1e-9) * np.sqrt(252)) if r.std() > 0 else 0.0
    cum = np.concatenate(([1.0], np.cumprod(np.maximum(0.0, 1 + r))))
    running_max = np.maximum.accumulate(cum)
    max_dd = float(np.min((cum - running_max) / running_max))
    return {"sharpe": round(sharpe, 4), "max_drawdown": round(max_dd, 4)}


def _compute_regime(ticker: str) -> Optional[dict]:
    """Synchronous computation — run via asyncio.to_thread."""
    try:
        import yfinance as yf
        df = yf.download(ticker, period="10y", interval="1d", auto_adjust=True, progress=False)
        if df.empty or len(df) < 260:
            logger.warning("markov: insufficient data for %s (%d rows)", ticker, len(df))
            return None

        # Handle MultiIndex columns from yfinance (common when downloading single ticker)
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)

        close = df["Close"].dropna()
        if len(close) < 260:
            return None

        labels = _label_regimes(close)
        labels = labels.dropna().astype(int)

        P = _build_transition_matrix(labels)
        current_idx = int(labels.iloc[-1])
        current_regime = _STATES[current_idx]

        next_probs = P[current_idx]
        persistence = round(float(P[current_idx, current_idx]), 4)
        signal = _compute_signal(float(next_probs[2]), float(next_probs[0]))
        stationary = _compute_stationary(P)
        wf = _walk_forward_stats(close, labels)

        # Optional HMM
        hmm_result = None
        try:
            from hmmlearn.hmm import GaussianHMM
            daily_ret = close.pct_change().dropna().values.reshape(-1, 1)
            model = GaussianHMM(n_components=3, covariance_type="diag", n_iter=200, random_state=42)
            model.fit(daily_ret)
            means = model.means_.flatten()
            order = np.argsort(means)  # Bear=lowest mean, Bull=highest
            hmm_labels = ["Bear", "Sideways", "Bull"]
            hmm_result = {
                "available": True,
                "regimes": [
                    {"label": hmm_labels[i], "mean_return": round(float(means[order[i]]), 6)}
                    for i in range(3)
                ],
            }
        except Exception:
            hmm_result = {"available": False}

        return {
            "ticker": ticker,
            "current_regime": current_regime,
            "signal": signal,
            "persistence": persistence,
            "next_state_probs": {
                "bear": round(float(next_probs[0]), 4),
                "sideways": round(float(next_probs[1]), 4),
                "bull": round(float(next_probs[2]), 4),
            },
            "stationary": stationary,
            "transition_matrix": [[round(float(P[i, j]), 4) for j in range(3)] for i in range(3)],
            "walk_forward": wf,
            "hmm": hmm_result,
            "computed_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception:
        logger.exception("markov: computation failed for %s", ticker)
        return None


# ── Public async API ──────────────────────────────────────────────────────────

async def get_regime(ticker: str) -> Optional[dict]:
    """Return regime analysis for a single ticker, from cache or freshly computed."""
    now = time.time()
    if ticker in _regime_cache:
        result, expiry = _regime_cache[ticker]
        if now < expiry:
            return result

    async with _fetch_sem:
        result = await asyncio.to_thread(_compute_regime, ticker)

    ttl = _CACHE_TTL if result is not None else 300  # short TTL on failure
    _regime_cache[ticker] = (result, now + ttl)
    return result


async def get_regime_for_portfolio(tickers: list[str]) -> dict[str, dict]:
    """Return regime analysis for all tickers concurrently, dropping failures."""
    results = await asyncio.gather(*[get_regime(t) for t in tickers])
    return {t: r for t, r in zip(tickers, results) if r is not None}
