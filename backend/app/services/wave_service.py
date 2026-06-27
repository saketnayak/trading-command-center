"""Elliott Wave + Fibonacci analysis via vendored elliott_wave package."""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional

import pandas as pd

import app.services.yfinance_service as _yf
from app.services.yfinance_service import fetch_history_period, prepare_ohlcv_frame
from app.utils.asset_type import is_crypto
from app.utils.quote_currency import quote_currency_from_ticker
from elliott_wave.models.chart_payload import AnalyzeResponse
from elliott_wave.models.selection import AnalysisProfile
from elliott_wave.services.analysis_orchestrator import AnalysisOrchestrator
from elliott_wave.services.chart_payload_service import ChartPayloadService

logger = logging.getLogger(__name__)

_CACHE_TTL = 14400  # 4 hours
_analyze_cache: dict[str, tuple[dict[str, Any], float]] = {}

_orchestrator = AnalysisOrchestrator()
_chart_payload_service = ChartPayloadService()

DEFAULT_PERIOD = "2y"
DEFAULT_INTERVAL = "1d"
DEFAULT_PROFILE: AnalysisProfile = "full_confluence"


def _cache_key(
    symbol: str,
    period: str,
    interval: str,
    profile: str,
) -> str:
    return f"{symbol.upper()}:{period}:{interval}:{profile}"


def _run_analyze_sync(
    symbol: str,
    *,
    period: str = DEFAULT_PERIOD,
    interval: str = DEFAULT_INTERVAL,
    profile: AnalysisProfile = DEFAULT_PROFILE,
    ohlcv: pd.DataFrame,
) -> dict[str, Any]:
    df, context, result = _orchestrator.analyze(
        symbol=symbol.upper(),
        period=period,  # type: ignore[arg-type]
        interval=interval,  # type: ignore[arg-type]
        profile=profile,
        ohlcv=ohlcv,
    )
    chart = _chart_payload_service.build(df, context, result)
    response = AnalyzeResponse(
        instrument=result.instrument,
        top_scenarios=result.top_scenarios,
        trade_regions=result.trade_regions,
        overview=result.overview,
        chart=chart,
    )
    payload = response.model_dump(mode="json")
    _attach_projection(payload)
    return payload


def _to_summary(payload: dict[str, Any], ticker: str) -> dict[str, Any]:
    overview = payload.get("overview") or {}
    top_scenarios = payload.get("top_scenarios") or []
    trade_regions = payload.get("trade_regions") or []
    top = top_scenarios[0] if top_scenarios else None
    region = trade_regions[0] if trade_regions else overview.get("trade_region")

    return {
        "ticker": ticker.upper(),
        "top_scenario": overview.get("top_scenario"),
        "top_direction": overview.get("top_direction"),
        "pattern": top.get("pattern") if top else None,
        "trend": top.get("trend") if top else None,
        "scenario_score": top.get("score") if top else None,
        "invalidation_level": top.get("invalidation_level") if top else None,
        "confidence": region.get("confidence") if region else None,
        "zone_low": region.get("zone_low") if region else None,
        "zone_high": region.get("zone_high") if region else None,
        "projection_direction": (payload.get("projection") or {}).get("direction"),
        "projection_target": (payload.get("projection") or {}).get("primary_target"),
        "warnings": overview.get("warnings") or [],
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "currency": (payload.get("instrument") or {}).get("currency"),
    }


async def _attach_quote_currency(ticker: str, payload: dict[str, Any]) -> dict[str, Any]:
    symbol = ticker.upper()
    existing = payload.get("currency")
    if existing:
        return payload
    if is_crypto(symbol):
        payload["currency"] = quote_currency_from_ticker(symbol) or "USD"
        return payload
    quote = await _yf.fetch_price_quote(symbol)
    payload["currency"] = quote.currency_code if quote else "USD"
    return payload


def _attach_projection(payload: dict[str, Any]) -> None:
    projection = _build_projection(payload)
    if projection is None:
        return

    payload["projection"] = projection
    chart = payload.get("chart") or {}
    overlays = chart.setdefault("overlays", [])
    overlays.append(
        {
            "kind": "projection_path",
            "label": "Projected next wave",
            "times": [p["time"] for p in projection["path"]],
            "prices": [p["price"] for p in projection["path"]],
            "direction": projection["direction"],
            "confidence": projection["confidence"],
        }
    )
    for level in projection["levels"]:
        overlays.append(
            {
                "kind": "projection_level",
                "price": level["price"],
                "label": level["label"],
                "style": "dashed",
                "color_hint": "projection",
            }
        )


def _build_projection(payload: dict[str, Any]) -> Optional[dict[str, Any]]:
    chart = payload.get("chart") or {}
    bars = chart.get("ohlcv") or []
    scenarios = payload.get("top_scenarios") or []
    trade_regions = payload.get("trade_regions") or []
    if len(bars) < 2 or not scenarios:
        return None

    scenario = scenarios[0]
    legs = scenario.get("legs") or []
    if not legs:
        return None

    last_leg = legs[-1]
    latest = bars[-1]
    last_time = _parse_dt(latest.get("time"))
    prev_time = _parse_dt(bars[-2].get("time"))
    if last_time is None or prev_time is None:
        return None

    latest_close = _safe_float(latest.get("close"))
    start_price = _safe_float(last_leg.get("start_price"))
    end_price = _safe_float(last_leg.get("end_price"))
    if latest_close is None or start_price is None or end_price is None:
        return None

    leg_size = abs(end_price - start_price)
    if leg_size <= 0:
        return None

    direction = _projection_direction(scenario, last_leg)
    step = max(last_time - prev_time, timedelta(days=1))
    leg_bars = max(8, min(80, abs(int(last_leg.get("end_idx", 0)) - int(last_leg.get("start_idx", 0))) or 20))
    ratios = [0.618, 1.0, 1.618]
    labels = ["0.618 extension", "1.000 extension", "1.618 extension"]

    levels: list[dict[str, Any]] = []
    path = [{"time": last_time.isoformat(), "price": round(latest_close, 4)}]
    for idx, (ratio, label) in enumerate(zip(ratios, labels), start=1):
        price = latest_close + (direction * leg_size * ratio)
        future_time = last_time + step * max(1, round(leg_bars * (idx / 2)))
        level = {
            "label": label,
            "ratio": ratio,
            "price": round(price, 4),
            "time": future_time.isoformat(),
        }
        levels.append(level)
        path.append({"time": level["time"], "price": level["price"]})

    confidence = _projection_confidence(scenario, trade_regions[0] if trade_regions else None)
    direction_label = "up" if direction > 0 else "down"
    return {
        "direction": direction_label,
        "basis": f"{scenario.get('pattern', 'wave')} / {scenario.get('trend', 'trend')}",
        "confidence": confidence,
        "primary_target": levels[1]["price"],
        "levels": levels,
        "path": path,
        "invalidation_level": scenario.get("invalidation_level"),
        "note": (
            "Forward projection uses the active Elliott count and Fibonacci extension ratios. "
            "Treat it as a scenario path, not a price prediction."
        ),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def _projection_direction(scenario: dict[str, Any], last_leg: dict[str, Any]) -> int:
    trend = str(scenario.get("trend") or "").lower()
    if trend in {"bullish", "long", "up"}:
        return 1
    if trend in {"bearish", "short", "down"}:
        return -1

    start = _safe_float(last_leg.get("start_price")) or 0.0
    end = _safe_float(last_leg.get("end_price")) or start
    return 1 if end >= start else -1


def _projection_confidence(scenario: dict[str, Any], region: Optional[dict[str, Any]]) -> float:
    scenario_score = _safe_float(scenario.get("score")) or 0.0
    region_confidence = _safe_float(region.get("confidence")) if region else None
    if region_confidence is None:
        return round(min(95.0, scenario_score), 1)
    return round(min(95.0, scenario_score * 0.65 + region_confidence * 0.35), 1)


def _parse_dt(value: Any) -> Optional[datetime]:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _safe_float(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


async def analyze_wave(
    ticker: str,
    *,
    period: str = DEFAULT_PERIOD,
    interval: str = DEFAULT_INTERVAL,
    profile: AnalysisProfile = DEFAULT_PROFILE,
    use_cache: bool = True,
) -> Optional[dict[str, Any]]:
    """Full analysis payload (chart, scenarios, trade regions). Returns None on failure."""
    symbol = ticker.upper()
    key = _cache_key(symbol, period, interval, profile)

    if use_cache:
        cached = _analyze_cache.get(key)
        if cached and cached[1] > time.time():
            return cached[0]

    if use_cache:
        cached = _analyze_cache.get(key)
        if cached and cached[1] > time.time():
            return cached[0]

    try:
        history = await fetch_history_period(
            symbol,
            period=period,
            interval=interval,
            auto_adjust=True,
        )
        ohlcv = prepare_ohlcv_frame(history, symbol)
    except Exception as exc:
        logger.warning("wave history fetch failed for %s: %s", symbol, exc)
        return None

    try:
        payload = await asyncio.to_thread(
            _run_analyze_sync,
            symbol,
            period=period,
            interval=interval,
            profile=profile,
            ohlcv=ohlcv,
        )
    except Exception as exc:
        logger.warning("wave analysis failed for %s: %s", symbol, exc)
        return None

    payload = await _attach_quote_currency(symbol, payload)
    if use_cache:
        _analyze_cache[key] = (payload, time.time() + _CACHE_TTL)
    return payload


async def get_wave_summary(
    ticker: str,
    *,
    period: str = DEFAULT_PERIOD,
    interval: str = DEFAULT_INTERVAL,
    profile: AnalysisProfile = DEFAULT_PROFILE,
) -> Optional[dict[str, Any]]:
    payload = await analyze_wave(
        ticker,
        period=period,
        interval=interval,
        profile=profile,
    )
    if payload is None:
        return None
    summary = _to_summary(payload, ticker.upper())
    return await _attach_quote_currency(ticker.upper(), summary)


async def get_wave_summaries_for_portfolio(
    tickers: list[str],
    *,
    period: str = DEFAULT_PERIOD,
    interval: str = DEFAULT_INTERVAL,
    profile: AnalysisProfile = DEFAULT_PROFILE,
) -> dict[str, dict[str, Any]]:
    results = await asyncio.gather(
        *[
            get_wave_summary(t, period=period, interval=interval, profile=profile)
            for t in tickers
        ]
    )
    return {
        t.upper(): r
        for t, r in zip(tickers, results)
        if r is not None
    }
