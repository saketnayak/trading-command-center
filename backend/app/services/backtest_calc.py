"""Backtest and leaderboard maths. Pure, no I/O.

Contamination: an LLM may have read what happened after a decision date if
that date is before its training cutoff, so its "prediction" can be memory.
Each decision is labelled out-of-sample (decision date after the cutoff),
in-sample (on or before it) or unknown (no cutoff known). Headline metrics use
out-of-sample decisions only, as the lookahead-bias papers recommend.

Metrics treat each decision date as one period of an equal-weight sleeve: the
period return is the average realised return of that date's decisions, which
compound into an equity curve for total return and drawdown. Sharpe is
annualised by decisions per year (52 weekly, 252 daily).
"""

from __future__ import annotations

import math
import re
import statistics
from collections import defaultdict
from datetime import date, timedelta

# Published (approximate) training-data cutoffs, matched by model-name prefix,
# longest prefix first. Users can override the cutoff per backtest.
MODEL_CUTOFFS: dict[str, str] = {
    "gpt-4o-mini": "2023-10-01",
    "gpt-4o": "2023-10-01",
    "gpt-4.1": "2024-06-01",
    "o3": "2024-06-01",
    "o4-mini": "2024-06-01",
    "gpt-5-mini": "2024-05-31",
    "gpt-5-nano": "2024-05-31",
    "gpt-5": "2024-09-30",
    "claude-3-5-haiku": "2024-07-01",
    "claude-3-5-sonnet": "2024-04-01",
    "claude-3-7-sonnet": "2024-11-01",
    "claude-haiku-4-5": "2025-02-01",
    "claude-sonnet-4-5": "2025-07-01",
    "claude-sonnet-4": "2025-03-01",
    "claude-opus-4-1": "2025-03-01",
    "claude-opus-4": "2025-03-01",
    "gemini-2.0-flash": "2024-08-01",
    "gemini-2.5": "2025-01-01",
    "llama3.1": "2023-12-01",
    "llama3.2": "2023-12-01",
    "llama3.3": "2023-12-01",
    "deepseek-r1": "2024-07-01",
    "deepseek-v3": "2024-07-01",
    "qwen2.5": "2024-09-01",
}
DECISIONS_PER_YEAR = {"weekly": 52, "daily": 252}
BENCHMARKS = ("buy_and_hold", "always_hold", "sma_crossover", "random_baseline")


# What may follow a known name: nothing, an Ollama tag (":8b"), a dated snapshot
# ("-2024-08-06") or a word suffix ("-mini", "-latest"). Never another version
# number: "gpt-5.5" or "claude-sonnet-4-6" are newer models, and borrowing an older
# cutoff would wrongly call their decisions out-of-sample.
_SUFFIX = re.compile(r"^($|:|[-_@](\d{4}|[a-z]))")


def cutoff_for(model: str) -> str | None:
    """The known training cutoff for a model name (provider prefixes like "openai/" ignored)."""
    name = (model or "").lower().split("/")[-1]
    for prefix in sorted(MODEL_CUTOFFS, key=len, reverse=True):
        if name.startswith(prefix) and _SUFFIX.match(name[len(prefix):]):
            return MODEL_CUTOFFS[prefix]
    return None


def sample_label(decision_date: str, cutoff: str | None) -> str:
    if not cutoff:
        return "unknown"
    return "out_of_sample" if decision_date > cutoff else "in_sample"


def _scored(trades: list[dict]) -> list[dict]:
    """Trades that produced a usable score (errors and missing prices are left out)."""
    return [t for t in trades if t.get("entry_price") is not None and t.get("exit_price") is not None
            and "error" not in (t.get("notes") or "")]


def _curve_stats(period_returns: list[float], per_year: int) -> dict:
    equity, peak, worst = 1.0, 1.0, 0.0
    for r in period_returns:
        equity *= 1 + r
        peak = max(peak, equity)
        worst = min(worst, equity / peak - 1)
    sharpe = None
    if len(period_returns) >= 2:
        sd = statistics.stdev(period_returns)
        if sd > 0:
            sharpe = statistics.fmean(period_returns) / sd * math.sqrt(per_year)
    return {"total_return": round(equity - 1, 6), "max_drawdown": round(worst, 6),
            "sharpe": round(sharpe, 4) if sharpe is not None else None}


def summarize(trades: list[dict], frequency: str = "weekly") -> dict | None:
    """Strategy and benchmark metrics over a set of scored trades, or None when there are none."""
    scored = _scored(trades)
    if not scored:
        return None
    per_year = DECISIONS_PER_YEAR.get(frequency, 52)
    by_date: dict[str, list[dict]] = defaultdict(list)
    for t in scored:
        by_date[t["decision_date"]].append(t)
    dates = sorted(by_date)

    def period_returns(key) -> list[float]:
        return [statistics.fmean(key(t) for t in by_date[d]) for d in dates]

    active = [t for t in scored if t["signal"] in ("BUY", "SELL")]
    strategy = {
        "decisions": len(scored),
        "periods": len(dates),
        "signals": {s: sum(1 for t in scored if t["signal"] == s) for s in ("BUY", "SELL", "HOLD")},
        "hit_rate": round(sum(1 for t in active if t["realised_return"] > 0) / len(active), 4) if active else None,
        "expectancy": round(statistics.fmean(t["realised_return"] for t in active), 6) if active else None,
        "avg_return": round(statistics.fmean(t["realised_return"] for t in scored), 6),
        **_curve_stats(period_returns(lambda t: t["realised_return"]), per_year),
    }
    benchmarks = {}
    for b in BENCHMARKS:
        if all(b in (t.get("benchmark_returns") or {}) for t in scored):
            benchmarks[b] = _curve_stats(period_returns(lambda t, b=b: t["benchmark_returns"][b]), per_year)
    excess = None
    if "buy_and_hold" in benchmarks:
        excess = round(strategy["total_return"] - benchmarks["buy_and_hold"]["total_return"], 6)
    return {**strategy, "benchmarks": benchmarks, "excess_vs_buy_and_hold": excess}


def build_report(trades: list[dict], frequency: str, cutoff: str | None) -> dict:
    """Headline (out-of-sample, or everything when the cutoff is unknown) plus each subset."""
    labelled = [{**t, "sample": sample_label(t["decision_date"], cutoff)} for t in trades]
    oos = [t for t in labelled if t["sample"] == "out_of_sample"]
    ins = [t for t in labelled if t["sample"] == "in_sample"]
    if not cutoff:
        headline_basis, headline = "all", summarize(labelled, frequency)
        note = "The model's training cutoff is unknown, so every decision may be contaminated by hindsight."
    elif oos:
        headline_basis, headline = "out_of_sample", summarize(oos, frequency)
        note = f"Headline uses the {len(oos)} decisions after the model's training cutoff ({cutoff})."
        if ins:
            note += (f" {len(ins)} earlier decision{'s are' if len(ins) != 1 else ' is'} shown separately: "
                     "the model may already know what happened then.")
    else:
        headline_basis, headline = "none", None
        note = (f"Every decision is on or before the model's training cutoff ({cutoff}), so none is a fair test. "
                "Pick dates after the cutoff for an honest score.")
    errors = sum(1 for t in trades if "error" in (t.get("notes") or ""))
    return {
        "cutoff": cutoff,
        "headline_basis": headline_basis,
        "headline": headline,
        "out_of_sample": summarize(oos, frequency) if cutoff else None,
        "in_sample": summarize(ins, frequency) if cutoff else None,
        "counts": {"out_of_sample": len(oos), "in_sample": len(ins), "errors": errors, "total": len(trades)},
        "note": note,
    }


def decision_grid(start: date, end: date, frequency: str) -> list[date]:
    """Mirror of the harness's grid for sizing a request up front: business days, or the
    Fridays in the window (all business days when the window holds no Friday)."""
    days, d = [], start
    while d <= end:
        if d.weekday() < 5:
            days.append(d)
        d += timedelta(days=1)
    if frequency == "weekly":
        fridays = [x for x in days if x.weekday() == 4]
        return fridays or days
    return days


# ── Model leaderboard over live runs ──────────────────────────────────────────

LEADERBOARD_HORIZONS = (("7d", 7, "price_7d"), ("30d", 30, "price_30d"))


def _closest_close(closes: dict[date, float], d: date, max_gap: int = 5) -> float | None:
    for back in range(max_gap + 1):
        v = closes.get(d - timedelta(days=back))
        if v is not None:
            return v
    return None


def leaderboard(rows: list[dict], spy: dict[date, float], group_by: str, min_runs: int = 1) -> list[dict]:
    """Accuracy, direction-signed return and excess return vs SPY per group of runs.

    rows: run outcomes joined with their run (provider, model, depth, analysts, verdict,
    analysis_date, price_at_analysis, price_7d, price_30d). HOLD verdicts count as runs
    but are not scored. Excess = sign × (stock return − SPY return) over the same window."""
    def key(r: dict) -> str:
        if group_by == "depth":
            return r["depth"] or "?"
        if group_by == "analysts":
            return ", ".join(sorted(r["analysts"] or [])) or "?"
        return f"{r['provider']} · {r['model']}"

    groups: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        groups[key(r)].append(r)
    out = []
    for name, items in groups.items():
        entry = {"group": name, "runs": len(items)}
        for label, days, field in LEADERBOARD_HORIZONS:
            hits, rets, excess = [], [], []
            for r in items:
                verdict = (r["verdict"] or "").lower()
                p0, p1 = r.get("price_at_analysis"), r.get(field)
                if verdict not in ("buy", "sell") or not p0 or not p1:
                    continue
                sign = 1 if verdict == "buy" else -1
                raw = p1 / p0 - 1
                hits.append(sign * raw > 0)
                rets.append(sign * raw)
                d0 = r["analysis_date"]
                s0, s1 = _closest_close(spy, d0), _closest_close(spy, d0 + timedelta(days=days))
                if s0 and s1:
                    excess.append(sign * (raw - (s1 / s0 - 1)))
            entry[label] = {
                "scored": len(hits),
                "accuracy": round(sum(hits) / len(hits), 4) if hits else None,
                "avg_return": round(statistics.fmean(rets), 6) if rets else None,
                "avg_excess": round(statistics.fmean(excess), 6) if excess else None,
            }
        if entry["runs"] >= min_runs:
            out.append(entry)
    out.sort(key=lambda e: (-(e["30d"]["scored"] + e["7d"]["scored"]), e["group"]))
    return out
