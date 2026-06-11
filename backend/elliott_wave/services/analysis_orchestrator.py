from __future__ import annotations

from typing import Literal

import pandas as pd

from elliott_wave.engines.base import AnalysisContext, AnalysisStage, EngineResult
from elliott_wave.engines.elliott.elliott_engine import ElliottWaveEngine
from elliott_wave.engines.fibonacci.fibonacci_engine import FibonacciLevelEngine
from elliott_wave.engines.signal.signal_engine import SignalGeneratorEngine
from elliott_wave.engines.swing.zigzag_engine import ZigZagEngine
from elliott_wave.models.overview import AnalysisOverview, ToolOutcome
from elliott_wave.models.result import AnalysisResult
from elliott_wave.models.selection import AnalysisProfile, ToolSelection
from elliott_wave.services.data_provider import DataProvider
from elliott_wave.services.instrument_resolver import InstrumentResolver
from elliott_wave.services.registry import EngineRegistry
from elliott_wave.utils.logging import get_logger

logger = get_logger(__name__)

_STAGE_ORDER = [
    AnalysisStage.SWING,
    AnalysisStage.ELLIOTT,
    AnalysisStage.FIBONACCI,
    AnalysisStage.SIGNAL,
]

_TOOL_ENABLED: dict[str, str] = {
    "zigzag": "swing",
    "elliott": "elliott",
    "fibonacci": "fibonacci",
    "signal": "signal",
}


def _default_registry() -> EngineRegistry:
    registry = EngineRegistry()
    registry.register(ZigZagEngine())
    registry.register(ElliottWaveEngine())
    registry.register(FibonacciLevelEngine())
    registry.register(SignalGeneratorEngine())
    return registry


class AnalysisOrchestrator:
    """Coordinates the engine pipeline and assembles the final report."""

    def __init__(self, registry: EngineRegistry | None = None) -> None:
        self._registry = registry or _default_registry()
        self._resolver = InstrumentResolver()
        self._provider = DataProvider()

    def analyze(
        self,
        symbol: str | None = None,
        isin: str | None = None,
        period: str = "2y",
        interval: str = "1d",
        zigzag_threshold: float = 0.06,
        zigzag_price_mode: Literal["close", "high_low"] = "close",
        tools: ToolSelection | None = None,
        profile: AnalysisProfile | None = None,
        ohlcv: pd.DataFrame | None = None,
    ) -> tuple[pd.DataFrame, AnalysisContext, AnalysisResult]:
        selected = (
            ToolSelection.from_profile(profile)
            if profile is not None
            else (tools or ToolSelection())
        )

        instrument = self._resolver.resolve(symbol=symbol, isin=isin)
        if ohlcv is not None:
            df = ohlcv
        else:
            df = self._provider.get_history(instrument.symbol, period=period, interval=interval)

        context = AnalysisContext(
            instrument=instrument,
            ohlcv=df,
            selected_tools=selected,
            zigzag_threshold=zigzag_threshold,
            zigzag_price_mode=zigzag_price_mode,
        )

        tool_outcomes: list[ToolOutcome] = []

        for stage in _STAGE_ORDER:
            for engine in self._registry.get_by_stage(stage):
                attr = _TOOL_ENABLED.get(engine.name, engine.name)
                enabled = getattr(selected, attr, True)

                if not enabled:
                    tool_outcomes.append(
                        ToolOutcome(
                            tool_name=engine.name,
                            enabled=False,
                            status="skipped",
                            headline=f"{engine.name} disabled",
                        )
                    )
                    continue

                try:
                    result: EngineResult = engine.run(context)
                    context.warnings.extend(result.warnings)
                    tool_outcomes.append(
                        ToolOutcome(
                            tool_name=engine.name,
                            enabled=True,
                            status=result.status,
                            headline=(
                                result.summary_items[0]
                                if result.summary_items
                                else f"{engine.name} completed"
                            ),
                            details=result.summary_items[1:],
                            confidence=result.artifacts.get("confidence"),
                        )
                    )
                    logger.debug("Engine %s: %s", engine.name, result.status)
                except Exception as exc:
                    logger.exception("Engine %s failed: %s", engine.name, exc)
                    context.warnings.append(f"{engine.name} error: {exc}")
                    tool_outcomes.append(
                        ToolOutcome(
                            tool_name=engine.name,
                            enabled=True,
                            status="error",
                            headline=f"{engine.name} failed: {exc}",
                        )
                    )

        top_scenario = context.scenarios[0] if context.scenarios else None
        top_region = context.trade_regions[0] if context.trade_regions else None

        overview = AnalysisOverview(
            active_tools=[o.tool_name for o in tool_outcomes if o.enabled],
            top_scenario=(
                f"{top_scenario.pattern}/{top_scenario.trend}" if top_scenario else None
            ),
            top_direction=top_region.direction if top_region else None,
            trade_region=top_region,
            tool_outcomes=tool_outcomes,
            warnings=context.warnings,
        )

        analysis_result = AnalysisResult(
            instrument=instrument,
            top_scenarios=context.scenarios[:3],
            trade_regions=context.trade_regions,
            overview=overview,
        )

        return df, context, analysis_result
