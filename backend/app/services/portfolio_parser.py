import csv
import io
import math
from dataclasses import dataclass
from fastapi import HTTPException


@dataclass
class HoldingRow:
    ticker: str
    shares: float
    avg_cost: float | None
    currency: str = "USD"


def _normalize_headers(row: dict) -> dict[str, str]:
    return {k.lower().strip(): v for k, v in row.items() if k is not None}


def _parse_float(value: str) -> float | None:
    if not value:
        return None
    cleaned = value.replace("$", "").replace(",", "").replace("%", "").strip()
    try:
        result = float(cleaned)
        return result if math.isfinite(result) else None
    except ValueError:
        return None


def _detect_broker(headers: list[str]) -> str | None:
    h = {col.lower().strip() for col in headers}
    if "qty." in h and "avg cost" in h and "symbol" in h:
        return "moomoo"
    if "cost basis total" in h and "quantity" in h and "symbol" in h:
        return "fidelity"
    if "cost basis" in h and "quantity" in h and "symbol" in h:
        return "schwab"
    if ("ticker" in h or "symbol" in h) and ("shares" in h or "quantity" in h):
        return "generic"
    return None


def _parse_moomoo(reader: csv.DictReader) -> list[HoldingRow]:
    holdings: dict[str, HoldingRow] = {}
    for raw in reader:
        row = _normalize_headers(raw)
        ticker = row.get("symbol", "").strip().upper()
        if not ticker or ticker.startswith("$"):
            continue
        shares = _parse_float(row.get("qty.", ""))
        avg_cost = _parse_float(row.get("avg cost", ""))
        if shares is None:
            continue
        holdings[ticker] = HoldingRow(ticker=ticker, shares=shares, avg_cost=avg_cost)
    return list(holdings.values())


def _parse_fidelity(reader: csv.DictReader) -> list[HoldingRow]:
    holdings: dict[str, HoldingRow] = {}
    for raw in reader:
        row = _normalize_headers(raw)
        ticker = row.get("symbol", "").strip().upper()
        if not ticker or ticker.startswith("$") or ticker.startswith("--"):
            continue
        shares = _parse_float(row.get("quantity", ""))
        if shares is None:
            continue
        avg_cost = _parse_float(row.get("average cost basis", ""))
        if avg_cost is None:
            cost_total = _parse_float(row.get("cost basis total", ""))
            if cost_total is not None and shares != 0:
                avg_cost = cost_total / shares
        holdings[ticker] = HoldingRow(ticker=ticker, shares=shares, avg_cost=avg_cost)
    return list(holdings.values())


def _parse_schwab(reader: csv.DictReader) -> list[HoldingRow]:
    holdings: dict[str, HoldingRow] = {}
    for raw in reader:
        row = _normalize_headers(raw)
        ticker = row.get("symbol", "").strip().upper()
        if not ticker or ticker.startswith("$") or ticker == "--":
            continue
        shares = _parse_float(row.get("quantity", ""))
        cost_total = _parse_float(row.get("cost basis", ""))
        avg_cost: float | None = None
        if cost_total is not None and shares:
            avg_cost = cost_total / shares
        if shares is None:
            continue
        holdings[ticker] = HoldingRow(ticker=ticker, shares=shares, avg_cost=avg_cost)
    return list(holdings.values())


def _parse_generic(reader: csv.DictReader) -> list[HoldingRow]:
    holdings: dict[str, HoldingRow] = {}
    for raw in reader:
        row = _normalize_headers(raw)
        ticker = (row.get("ticker") or row.get("symbol", "")).strip().upper()
        if not ticker or ticker.startswith("$"):
            continue
        shares_raw = row.get("shares") or row.get("quantity", "")
        shares = _parse_float(shares_raw)
        avg_cost_raw = row.get("avg_cost") or row.get("avg cost") or row.get("average cost", "")
        avg_cost = _parse_float(avg_cost_raw)
        if shares is None:
            continue
        holdings[ticker] = HoldingRow(ticker=ticker, shares=shares, avg_cost=avg_cost)
    return list(holdings.values())


_PARSERS = {
    "moomoo": _parse_moomoo,
    "fidelity": _parse_fidelity,
    "schwab": _parse_schwab,
    "generic": _parse_generic,
}


def parse_portfolio_csv(content: bytes) -> tuple[str, list[HoldingRow]]:
    """Detect broker and parse CSV bytes into HoldingRow list.

    Returns (broker_name, holdings). Raises HTTPException 422 on unknown format
    or 400 on empty file.
    """
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    headers = reader.fieldnames or []
    if not headers:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    broker = _detect_broker(list(headers))
    if broker is None:
        raise HTTPException(
            status_code=422,
            detail=(
                "Could not detect broker format. "
                "Expected columns: ticker (or symbol), shares (or quantity), and optionally avg_cost."
            ),
        )
    holdings = _PARSERS[broker](reader)
    if not holdings:
        raise HTTPException(status_code=400, detail="Uploaded file contains no holdings rows.")
    return broker, holdings
