"""ETF look-through (roadmap 3.4): pure maths, no I/O.

Turns position weights and fund holdings into true exposure per company and
sector, an overlap matrix between funds and concentration before and after
looking through. A fund's known holdings can cover only part of it (Yahoo gives
the top 10), so what isn't known is reported as uncovered and never spread over
the known names: exposures are floors, and the output says how much is covered.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import date, datetime

from app.services.risk_calc import concentration

MAX_STORED_HOLDINGS = 600
MIN_STORED_WEIGHT = 0.0001  # 0.01% of the fund

# Yahoo's fund sector keys → the labels Yahoo uses for a single stock's sector.
_SECTOR_LABELS = {
    "realestate": "Real Estate",
    "consumer_cyclical": "Consumer Cyclical",
    "basic_materials": "Basic Materials",
    "consumer_defensive": "Consumer Defensive",
    "technology": "Technology",
    "communication_services": "Communication Services",
    "financial_services": "Financial Services",
    "utilities": "Utilities",
    "industrials": "Industrials",
    "energy": "Energy",
    "healthcare": "Healthcare",
}
_NAME_SUFFIXES = {"inc", "incorporated", "corp", "corporation", "co", "company", "companies", "cos", "ltd", "limited", "plc",
                  "sa", "nv", "ag", "se", "lp", "llc", "the", "de", "class", "cl", "a", "b", "c", "common",
                  "stock", "shares", "ordinary", "new"}


def sector_label(key: str) -> str:
    return _SECTOR_LABELS.get(key, key.replace("_", " ").title())


def normalize_name(name: str) -> str:
    """'NVIDIA Corp' and 'NVIDIA CORP /DE/' → 'nvidia'; used to match a fund's holding to an SEC registrant."""
    words = re.sub(r"[^a-z0-9& ]+", " ", name.lower().replace(".", "")).split()
    kept = [w for w in words if w not in _NAME_SUFFIXES]
    return " ".join(kept or words)


def name_key(name: str) -> str:
    """Matching key for one company's names across sources: 'Amazon.com Inc' and 'AMAZON COM INC', or
    'Corning Inc' and 'CORNING INC /NY'. The SEC appends a state after a slash, so that part is dropped."""
    return normalize_name(name.split("/", 1)[0]).replace(" ", "")


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _child(el: ET.Element, name: str) -> ET.Element | None:
    return next((c for c in el if _local(c.tag) == name), None)


def _text(el: ET.Element, name: str) -> str:
    c = _child(el, name)
    return (c.text or "").strip() if c is not None else ""


def parse_nport(xml_text: str) -> dict:
    """An NPORT-P primary document → series, report date, equity rows and the weight in everything else."""
    root = ET.fromstring(xml_text.encode("utf-8"))
    series_id, as_of = "", None
    for el in root.iter():
        tag = _local(el.tag)
        if tag == "seriesId" and not series_id:
            series_id = (el.text or "").strip()
        elif tag == "repPdDate" and as_of is None:
            try:
                as_of = datetime.strptime((el.text or "").strip(), "%Y-%m-%d").date()
            except ValueError:
                as_of = None
    equities: list[dict] = []
    other = 0.0
    for el in root.iter():
        if _local(el.tag) != "invstOrSec":
            continue
        try:
            weight = float(_text(el, "pctVal") or 0) / 100
        except ValueError:
            continue
        if _text(el, "assetCat") != "EC" or weight <= 0:
            other += max(weight, 0.0)
            continue
        ticker = ""
        ids = _child(el, "identifiers")
        if ids is not None and (t := _child(ids, "ticker")) is not None:
            ticker = (t.get("value") or "").strip().upper()
        if ticker in ("N/A", "NA", "000000000"):
            ticker = ""
        equities.append({"name": _text(el, "name"), "ticker": ticker, "weight": weight})
    return {"series_id": series_id, "as_of": as_of, "equities": equities, "other_weight": other}


def resolve_holdings(rows: list[dict], by_ticker: dict[str, int], by_name: dict[str, tuple[str, int]]) -> list[dict]:
    """Give each row a `key`, so a company's share classes add up: its SEC CIK when known, else the
    ticker, else the name. by_ticker: ticker → CIK; by_name: name_key → (ticker, CIK)."""
    merged: dict[str, dict] = {}
    for r in rows:
        ticker, cik = (r.get("ticker") or "").upper().replace(".", "-"), None
        norm = name_key(r.get("name") or "")
        if ticker in by_ticker:
            cik = by_ticker[ticker]
        elif not ticker and norm in by_name:
            ticker, cik = by_name[norm]
        key = f"cik:{cik}" if cik else f"t:{ticker}" if ticker else f"n:{norm}"
        if key in merged:
            merged[key]["weight"] += r["weight"]
        else:
            merged[key] = {"key": key, "ticker": ticker or None, "name": r.get("name") or ticker, "weight": r["weight"]}
    return sorted(merged.values(), key=lambda x: -x["weight"])


def trim_holdings(holdings: list[dict]) -> list[dict]:
    """Keep what matters for storage: the largest names, dropping dust."""
    kept = [h for h in holdings if h["weight"] >= MIN_STORED_WEIGHT][:MAX_STORED_HOLDINGS]
    return [{**h, "weight": round(h["weight"], 6)} for h in kept]


def overlap(a: list[dict], b: list[dict]) -> float:
    """Share of a fund's weight also held by the other: the sum over shared names of the smaller weight."""
    bw = {h["key"]: h["weight"] for h in b}
    return sum(min(h["weight"], bw[h["key"]]) for h in a if h["key"] in bw)


def age_days(as_of: date | None, today: date) -> int | None:
    return (today - as_of).days if as_of else None


def xray(positions: dict[str, float], profiles: dict[str, dict], keys: dict[str, str],
         names: dict[str, str] | None = None, *, limit: int = 50) -> dict:
    """positions: held ticker → weight of the portfolio (summing to 1).
    profiles: held ticker → {kind, name, sector, holdings, sectors, source, as_of, covered_weight}; missing
    means not looked up yet. keys: held ticker → its company key, so a direct holding meets the same
    company inside a fund. names: held ticker → display name."""
    names = names or {}
    exposures: dict[str, dict] = {}
    sectors: dict[str, dict[str, float]] = {}
    funds: list[dict] = []
    uncovered = 0.0

    def entry(key: str, ticker: str | None, name: str) -> dict:
        e = exposures.get(key)
        if e is None:
            e = exposures[key] = {"key": key, "ticker": ticker, "name": name, "direct": 0.0, "via": []}
        return e

    def add_sector(label: str, kind: str, weight: float) -> None:
        s = sectors.setdefault(label, {"direct": 0.0, "via_funds": 0.0})
        s[kind] += weight

    # Direct positions first, so a company is shown under the ticker the user holds.
    fund_tickers = [t for t in positions if (profiles.get(t) or {}).get("kind") == "fund"]
    for ticker, weight in positions.items():
        if ticker in fund_tickers:
            continue
        p = profiles.get(ticker) or {}
        key = keys.get(ticker) or f"t:{ticker}"
        e = entry(key, ticker, names.get(ticker) or p.get("name") or ticker)
        e["direct"] += weight
        add_sector(p.get("sector") or "Unclassified", "direct", weight)

    for ticker in sorted(fund_tickers, key=lambda t: -positions[t]):
        weight, p = positions[ticker], profiles[ticker]
        holdings = p.get("holdings") or []
        known = 0.0
        for h in holdings:
            e = entry(h["key"], h.get("ticker"), h.get("name") or h.get("ticker") or h["key"])
            e["via"].append({"fund": ticker, "weight": weight * h["weight"]})
            known += h["weight"]
        known = min(known, 1.0)
        uncovered += weight * (1 - known)
        fund_sectors = p.get("sectors") or {}
        total = sum(fund_sectors.values())
        for key, w in fund_sectors.items():
            if w > 0:
                add_sector(sector_label(key), "via_funds", weight * w)
        if total < 0.995:  # bonds, cash, gold: a fund's weight no sector explains
            add_sector("Not in a sector", "via_funds", weight * (1 - total))
        funds.append({
            "ticker": ticker,
            "name": p.get("name") or ticker,
            "weight": weight,
            "source": p.get("source"),
            "as_of": p.get("as_of"),
            "holdings_known": len(holdings),
            "covered_weight": known,
        })

    rows = []
    for e in exposures.values():
        via = sorted(e["via"], key=lambda v: -v["weight"])
        total = e["direct"] + sum(v["weight"] for v in via)
        rows.append({**e, "via": via, "total": total})
    rows.sort(key=lambda r: -r["total"])

    matrix = [[1.0 if a == b else overlap(profiles[a].get("holdings") or [], profiles[b].get("holdings") or [])
               for b in fund_tickers] for a in fund_tickers]
    fund_weight = sum(positions[t] for t in fund_tickers)
    return {
        "funds": funds,
        "fund_weight": fund_weight,
        "uncovered_weight": uncovered,
        "exposures": rows[:limit],
        "sectors": sorted(
            ({"sector": k, **v, "total": v["direct"] + v["via_funds"]} for k, v in sectors.items()),
            key=lambda s: -s["total"],
        ),
        "overlap": {"tickers": fund_tickers, "matrix": matrix},
        "concentration": {
            "as_held": concentration(positions),
            "look_through": concentration({r["key"]: r["total"] for r in rows}),
        },
    }


def exposure_sentence(row: dict) -> str:
    """'You hold 9.4% NVDA: 2.0% directly and 7.4% through 3 funds.'"""
    label = row.get("ticker") or row.get("name")
    n = len(row["via"])
    via = sum(v["weight"] for v in row["via"])
    funds = f"{n} fund" if n == 1 else f"{n} funds"
    if row["direct"] > 0 and n:
        how = f"{row['direct']:.1%} directly and {via:.1%} through {funds}"
    elif n:
        how = f"through {funds}"
    else:
        how = "directly"
    sep = ":" if row["direct"] > 0 and n else ""
    return f"You hold {row['total']:.1%} {label}{sep} {how}."


def prompt_block(report: dict, top: int = 5) -> str:
    """Measured look-through lines for the AI briefing, or "" with no funds."""
    if not report.get("funds"):
        return ""
    conc = report["concentration"]
    lines = ["", "ETF LOOK-THROUGH (measured; holdings known for part of each fund, so these are minimums):"]
    lines += [f"- {exposure_sentence(r)}" for r in report["exposures"][:top]]
    lines.append(
        f"- Largest company: {conc['as_held']['top1_weight']:.1%} as held, "
        f"{conc['look_through']['top1_weight']:.1%} looking through funds. "
        f"{report['uncovered_weight']:.1%} of the portfolio is in fund holdings not itemised."
    )
    return "\n".join(lines) + "\n"
