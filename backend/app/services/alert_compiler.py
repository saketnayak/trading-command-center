"""Natural-language alert compiler: one sentence → a proposed alert rule.

`POST /alerts/compile` asks the user's default LLM to translate the sentence
into the alert-rule format (the same kinds and params as manual rules, plus
`compound`). The reply is only a *proposal*: the router validates it with the
same code as `POST /alerts/rules` and returns it for the user to approve. The
compiler never saves anything, and the LLM is never involved in evaluating a
rule; the deterministic engine does that.

The pure parts (prompt, reply parsing, portfolio matching) are unit-tested;
`ask_llm` is the I/O seam tests replace.
"""

from __future__ import annotations

import json
from datetime import date

MAX_TEXT = 500
MAX_UNSUPPORTED = 5

DSL = """\
Rule kinds and their params:

Single ticker (set "ticker"):
- price_above {"price": number}            price rises above a level
- price_below {"price": number}            price falls below a level
- daily_move {"pct": number}               moves at least pct% (up or down) vs the previous close
- ma_cross {"window": 50|200, "direction": "above"|"below"}   closes above/below its moving average
- regime_change {"to": "any"|"Bull"|"Sideways"|"Bear"}        Markov regime changes (into "to")
- verdict_change {}                        the AI analysis verdict (BUY/HOLD/SELL) changes

Portfolio (set "portfolio"):
- portfolio_drawdown {"pct": number}       the portfolio falls pct% from its peak
- position_weight {"pct": number}          a holding grows past pct% of the portfolio

compound: several conditions combined with AND/OR, over one ticker or over a portfolio's holdings.
params: {"op": "and"|"or", "scope": "ticker"|"holdings", "sectors": [names], "conditions": [ ... up to 5 ... ]}
conditions:
- {"type": "price_above"|"price_below", "price": number}      (only with scope "ticker")
- {"type": "daily_move", "pct": number, "direction": "any"|"up"|"down"}
- {"type": "ma", "window": 50|200, "direction": "above"|"below"}   latest close vs its moving average
- {"type": "regime", "regime": "Bull"|"Sideways"|"Bear"}           current Markov regime
- {"type": "verdict", "verdict": "buy"|"hold"|"sell"}              latest AI analysis verdict
- {"type": "weight_above", "pct": number}                          the holding's share of the portfolio
"sectors" (scope "holdings" only, optional) narrows holdings by sector or industry name,
e.g. "Technology", "Semiconductors", "Healthcare", "Banks", "Energy".

How rules fire: a rule fires when its condition becomes true and re-arms once it is false,
so "goes Bear" is {"type": "regime", "regime": "Bear"} and "drops below its 200-day" is
{"type": "ma", "window": 200, "direction": "below"}. A compound rule over holdings fires for
each holding that starts matching.

Choose the simplest form: one condition on one ticker → a single-ticker kind (a change of
regime or verdict with no other condition → regime_change / verdict_change). Several
conditions, or anything about "holdings", "any of my stocks" or a sector → compound.
"""

REPLY = """\
Reply with one JSON object and nothing else:
{"rule": {"kind": "...", "ticker": "NVDA" or null, "portfolio": "<portfolio name>" or null,
          "params": {...}, "channels": ["inbox"], "rerun_analysis": false} or null,
 "unsupported": ["short quote of each part of the request this format cannot express"]}

- Tickers are upper-case symbols (Nvidia → NVDA, Bitcoin → BTC-USD).
- "portfolio": one of the user's portfolio names exactly, or null if they did not name one.
- channels: always "inbox"; add "email" only if they ask to be emailed; add "webhook" only if
  they ask for Slack, Telegram or a webhook.
- rerun_analysis: true only if they ask to re-run, refresh or redo the analysis when it fires.
- Never invent a number they did not give. If a needed number is missing, set "rule" to null
  and add "missing: <what>" to "unsupported".
- If part of the request cannot be expressed, express the rest and list that part in
  "unsupported". If nothing can be expressed, "rule" is null.
"""


def build_prompt(text: str, portfolios: list[str], today: date) -> str:
    names = json.dumps(portfolios) if portfolios else "[] (the user has no portfolios)"
    return (
        "You translate a user's request into an alert rule for AgentFloor, a research app. "
        "Alerts only notify; nothing ever trades.\n\n"
        f"{DSL}\n{REPLY}\n"
        f"Today is {today.isoformat()}. The user's portfolios: {names}.\n\n"
        f"Request: {json.dumps(text)}\n"
    )


class CompileError(ValueError):
    pass


def parse_reply(raw: str) -> dict:
    """The model's JSON object (code fences and preamble tolerated)."""
    text = (raw or "").strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise CompileError("The model did not reply with a rule.")
    try:
        obj = json.loads(text[start:end + 1])
    except json.JSONDecodeError as exc:
        raise CompileError("The model's reply was not valid JSON.") from exc
    if not isinstance(obj, dict):
        raise CompileError("The model did not reply with a rule.")
    rule = obj.get("rule")
    if rule is not None and not isinstance(rule, dict):
        raise CompileError("The model did not reply with a rule.")
    unsupported = obj.get("unsupported") or []
    if not isinstance(unsupported, list):
        unsupported = [unsupported]
    unsupported = [str(u).strip()[:200] for u in unsupported if str(u).strip()][:MAX_UNSUPPORTED]
    return {"rule": rule, "unsupported": unsupported}


_NUMBER_KEYS = ("price", "pct", "window")
_LOWER_KEYS = ("op", "scope", "direction", "type", "verdict")


def _tidy(d: dict) -> dict:
    out = dict(d)
    for k in _NUMBER_KEYS:
        v = out.get(k)
        if isinstance(v, str):
            try:
                num = float(v.strip().rstrip("%").replace(",", ""))
                out[k] = int(num) if k == "window" else num
            except ValueError:
                pass
        elif k == "window" and isinstance(v, float) and v.is_integer():
            out[k] = int(v)
    for k in _LOWER_KEYS:
        if isinstance(out.get(k), str):
            out[k] = out[k].strip().lower()
    for k in ("regime", "to"):
        if isinstance(out.get(k), str):
            v = out[k].strip()
            out[k] = v.lower() if v.lower() == "any" else v.capitalize()
    return out


def tidy_params(params: object) -> dict:
    """Forgive harmless formatting slips (numbers as strings, case) before strict validation."""
    if not isinstance(params, dict):
        return {}
    out = _tidy(params)
    if isinstance(out.get("conditions"), list):
        out["conditions"] = [_tidy(c) if isinstance(c, dict) else c for c in out["conditions"]]
    return out


def match_portfolio(name: object, portfolios: list[tuple[str, str]]) -> tuple[str | None, str | None]:
    """(id, problem) for the model's portfolio reference, by id or case-insensitive name."""
    if name in (None, ""):
        return None, None
    ref = str(name).strip()
    for pid, pname in portfolios:
        if ref == pid or ref.lower() == pname.lower():
            return pid, None
    return None, f"You have no portfolio called '{ref}'."


async def ask_llm(provider: str, model: str, api_key: str | None, prompt: str) -> str:
    """The single LLM call (JSON mode where the provider supports it)."""
    from app.services.portfolio_insight_runner import _call_llm

    return await _call_llm(provider, model, api_key, prompt)
