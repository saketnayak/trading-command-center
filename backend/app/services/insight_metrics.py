"""Measured performance and risk for the AI portfolio brief.

The brief's numbers should come from code, not from the LLM. This module
turns the Performance and Risk reports into (1) a compact dict stored with
the insight and (2) a prompt block that the model is told to quote rather
than invent. Pure: no I/O.
"""

from __future__ import annotations


def _pct(x: float | None, digits: int = 1, signed: bool = True) -> str:
    if x is None:
        return "n/a"
    return f"{x * 100:+.{digits}f}%" if signed else f"{x * 100:.{digits}f}%"


def summarize(perf: dict | None, risk: dict | None) -> dict | None:
    """Compact, JSON-safe summary of the two reports (None when neither has data)."""
    out: dict = {}
    if perf and perf.get("stats"):
        s = perf["stats"]
        b = perf.get("benchmark_stats") or {}
        out["performance"] = {
            "mode": perf.get("mode"),
            "range": perf.get("range"),
            "start": perf.get("start"),
            "end": perf.get("end"),
            "benchmark": perf.get("benchmark"),
            "total_return": s.get("total_return"),
            "benchmark_return": b.get("total_return"),
            "excess_return": s.get("excess_return"),
            "max_drawdown": s.get("max_drawdown"),
            "period_returns": {k: v for k, v in (perf.get("period_returns") or {}).items() if v is not None},
            "top_contributors": [
                {"ticker": h["ticker"], "contribution": h["contribution"]}
                for h in (perf.get("holdings") or [])
                if h.get("contribution") is not None and h["contribution"] > 0
            ][:3],
            "bottom_contributors": [
                {"ticker": h["ticker"], "contribution": h["contribution"]}
                for h in reversed(perf.get("holdings") or [])
                if h.get("contribution") is not None and h["contribution"] < 0
            ][:3],
        }
    r = (risk or {}).get("risk")
    if r:
        st = r["stats"]
        out["risk"] = {
            "lookback": risk.get("lookback"),
            "benchmark": risk.get("benchmark"),
            "volatility": st.get("volatility"),
            "beta": st.get("beta"),
            "var_95": st.get("var_95"),
            "var_95_value": st.get("var_95_value"),
            "max_drawdown": st.get("max_drawdown"),
            "effective_holdings": r["concentration"].get("effective_holdings"),
            "top1_weight": r["concentration"].get("top1_weight"),
            "risk_outliers": [
                {"ticker": h["ticker"], "weight": h["weight"], "risk_share": h["risk_share"]}
                for h in r.get("holdings", [])
                if h.get("risk_share") is not None and h.get("weight") is not None
                and h["risk_share"] - h["weight"] >= 0.05
            ][:3],
            "clusters": r.get("clusters", [])[:3],
            "worst_stress": min(
                (s for s in (risk.get("stress") or []) if s.get("portfolio_return") is not None),
                key=lambda s: s["portfolio_return"],
                default=None,
            ),
            "warnings": risk.get("warnings") or [],
        }
        if out["risk"]["worst_stress"]:
            ws = out["risk"]["worst_stress"]
            out["risk"]["worst_stress"] = {
                "name": ws["name"], "portfolio_return": ws["portfolio_return"], "market_return": ws["market_return"],
            }
    return out or None


def prompt_block(measured: dict | None, currency: str) -> str:
    """Prompt section the model must quote from. Empty string when there is nothing measured."""
    if not measured:
        return ""
    lines = ["MEASURED PERFORMANCE & RISK (computed from daily prices by AgentFloor; quote these, never invent other statistics):"]
    p = measured.get("performance")
    if p:
        basis = "actual upload history" if p.get("mode") == "actual" else "what-if: today's holdings held over the period"
        lines.append(
            f"  Return {p.get('start')} → {p.get('end')} ({basis}): {_pct(p.get('total_return'))} "
            f"vs {p.get('benchmark')} {_pct(p.get('benchmark_return'))} (difference {_pct(p.get('excess_return'))})"
        )
        if p.get("period_returns"):
            lines.append("  Trailing returns: " + ", ".join(f"{k} {_pct(v)}" for k, v in p["period_returns"].items()))
        if p.get("top_contributors"):
            lines.append("  Biggest contributors: " + ", ".join(
                f"{c['ticker']} {_pct(c['contribution'], 2)} pts" for c in p["top_contributors"]))
        if p.get("bottom_contributors"):
            lines.append("  Biggest detractors: " + ", ".join(
                f"{c['ticker']} {_pct(c['contribution'], 2)} pts" for c in p["bottom_contributors"]))
    r = measured.get("risk")
    if r:
        var_money = f" (about {r['var_95_value']:,.0f} {currency})" if r.get("var_95_value") is not None else ""
        lines.append(
            f"  Risk ({r.get('lookback')} lookback, today's holdings): volatility {_pct(r.get('volatility'), signed=False)}/yr, "
            f"beta {r['beta']:.2f} vs {r.get('benchmark')}" if r.get("beta") is not None else
            f"  Risk ({r.get('lookback')} lookback, today's holdings): volatility {_pct(r.get('volatility'), signed=False)}/yr"
        )
        lines.append(
            f"  1-day 95% VaR {_pct(r.get('var_95'), signed=False)}{var_money}; max drawdown at today's weights "
            f"{_pct(r.get('max_drawdown'))}; effective number of holdings {r.get('effective_holdings')}"
        )
        for o in r.get("risk_outliers", []):
            lines.append(
                f"  {o['ticker']} is {_pct(o['weight'], 0, False)} of value but {_pct(o['risk_share'], 0, False)} of portfolio risk"
            )
        for c in r.get("clusters", []):
            lines.append(
                f"  Correlated cluster: {', '.join(c['tickers'])} (average correlation {c['average_correlation']}, "
                f"{_pct(c['combined_weight'], 0, False)} of value) behave like one position"
            )
        ws = r.get("worst_stress")
        if ws:
            lines.append(
                f"  Worst stress replay: {ws['name']} → portfolio {_pct(ws['portfolio_return'])} (S&P 500 {_pct(ws['market_return'])})"
            )
    return "\n" + "\n".join(lines) + "\n"
