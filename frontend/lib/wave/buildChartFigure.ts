import type { Data, Layout, Shape } from "plotly.js";

import { THEMES, type ChartTheme } from "@/lib/wave/chartTheme";
import type {
  ChartOverlay,
  ChartPayload,
  ChartVisibilityOptions,
  ElliottScenario,
} from "@/lib/wave/types";

const DEFAULT_VISIBILITY: ChartVisibilityOptions = {
  waves: true,
  fibonacci: true,
  projection: true,
  pivots: true,
  showAllHistory: true,
};

export function buildChartFigure(
  chart: ChartPayload,
  _title: string,
  theme: ChartTheme,
  hover: boolean,
  options: {
    compact?: boolean;
    height?: number;
    maxBars?: number;
    visibility?: ChartVisibilityOptions;
  } = {},
): { data: Data[]; layout: Partial<Layout> } {
  const t = THEMES[theme];
  const data: Array<Record<string, unknown>> = [];
  const shapes: Array<Partial<Shape>> = [];
  const compact = options.compact ?? false;
  const visibility = { ...DEFAULT_VISIBILITY, ...options.visibility };
  const limitBars = compact || !visibility.showAllHistory;
  const visibleBars = limitBars
    ? chart.ohlcv.slice(-(options.maxBars ?? (compact ? 160 : 260)))
    : chart.ohlcv;

  const times = visibleBars.map((b) => b.time);

  data.push({
    type: "candlestick",
    x: times,
    open: visibleBars.map((b) => b.open),
    high: visibleBars.map((b) => b.high),
    low: visibleBars.map((b) => b.low),
    close: visibleBars.map((b) => b.close),
    name: "Price",
    increasing: { line: { color: t.candleUp } },
    decreasing: { line: { color: t.candleDown } },
    showlegend: false,
    whiskerwidth: 0.35,
  });

  const renderChart = focusChart(chart, visibility, compact);
  if (chart.overlays.length > 0) {
    applyOverlays(renderChart.overlays, data, shapes, t, compact, visibility);
  } else {
    applyLegacyLayers(renderChart, data, shapes, t);
  }

  const layout = {
    title: {
      text: "",
      font: { size: 15, color: t.font },
    },
    paper_bgcolor: t.paper,
    plot_bgcolor: t.bg,
    font: { color: t.font, size: compact ? 10 : 12 },
    height: options.height,
    autosize: options.height == null,
    xaxis: {
      title: { text: "" },
      gridcolor: t.grid,
      linecolor: t.axis,
      tickcolor: t.axis,
      rangeslider: { visible: false },
      range: limitBars && times.length > 1 ? [times[0], times[times.length - 1]] : undefined,
      showgrid: true,
      zeroline: false,
      fixedrange: false,
      nticks: compact ? 4 : 8,
      mirror: true,
    },
    yaxis: {
      title: { text: "" },
      gridcolor: t.grid,
      linecolor: t.axis,
      tickcolor: t.axis,
      side: "right",
      showgrid: true,
      zeroline: false,
      fixedrange: false,
      nticks: compact ? 5 : 10,
      mirror: true,
    },
    hovermode: hover ? "x unified" : false,
    showlegend: !compact,
    legend: {
      orientation: "h",
      x: 0,
      y: 1.02,
      xanchor: "left",
      yanchor: "bottom",
      bgcolor: t.legendBg,
      bordercolor: t.legendBorder,
      borderwidth: 1,
      font: { size: 11, color: t.font },
      itemclick: "toggle",
      itemdoubleclick: "toggleothers",
    },
    dragmode: "pan",
    margin: compact ? { l: 8, r: 42, t: 8, b: 22 } : { l: 10, r: 66, t: 34, b: 28 },
    shapes,
  } as Partial<Layout>;

  return { data: data as Data[], layout };
}

function applyLegacyLayers(
  chart: ChartPayload,
  data: Array<Record<string, unknown>>,
  shapes: Array<Partial<Shape>>,
  t: (typeof THEMES)["dark"],
) {
  if (chart.pivots.length > 0) {
    data.push({
      type: "scatter",
      mode: "lines+markers+text" as const,
      x: chart.pivots.map((p) => p.time),
      y: chart.pivots.map((p) => p.price),
      text: chart.pivots.map((p) => p.kind[0]?.toUpperCase() ?? ""),
      textposition: "top center",
      name: "Pivots",
      line: { color: t.pivot, width: 1, dash: "dot" },
      marker: { color: t.pivot, size: 6 },
      textfont: { color: t.pivot, size: 10 },
    });
  }

  chart.scenarios.forEach((scenario, sIdx) => {
    addScenarioTraces(scenario, sIdx, data, t);
  });

}

function applyOverlays(
  overlays: ChartOverlay[],
  data: Array<Record<string, unknown>>,
  shapes: Array<Partial<Shape>>,
  t: (typeof THEMES)["dark"],
  compact = false,
  visibility: ChartVisibilityOptions = DEFAULT_VISIBILITY,
) {
  const scenarioColors = new Map<string, string>();
  let scenarioIdx = 0;

  for (const overlay of overlays) {
    switch (overlay.kind) {
      case "pivot":
        if (compact || !visibility.pivots) break;
        data.push({
          type: "scatter",
          mode: "lines+markers+text",
          x: overlay.times,
          y: overlay.prices,
          text: overlay.labels,
          textposition: "top center",
          name: "Pivots",
          line: { color: t.pivot, width: 1, dash: "dot" },
          marker: { color: t.pivot, size: 6 },
          showlegend: false,
        });
        break;
      case "wave_leg": {
        if (!visibility.waves) break;
        let color = scenarioColors.get(overlay.scenario_label);
        if (!color) {
          color = t.scenario[scenarioIdx % t.scenario.length];
          scenarioColors.set(overlay.scenario_label, color);
          scenarioIdx += 1;
        }
        data.push({
          type: "scatter",
          mode: "lines+text",
          x: [overlay.start_time, overlay.end_time],
          y: [overlay.start_price, overlay.end_price],
          text: ["", overlay.label],
          textposition: "top center",
          name: `Wave: ${overlay.scenario_label}`,
          line: { color, width: compact ? 2.5 : 2.4 },
          textfont: { color, size: compact ? 10 : 12 },
          legendgroup: overlay.scenario_label,
          showlegend: !compact && !scenarioColors.has(overlay.scenario_label + "_shown"),
        });
        scenarioColors.set(overlay.scenario_label + "_shown", "1");
        break;
      }
      case "zone":
        // Trade zones are execution aids, not Elliott Wave structure.
        break;
      case "level":
        if (overlay.color_hint === "fib" && !visibility.fibonacci) break;
        if (overlay.color_hint === "stop" || overlay.color_hint === "target") break;
        if (overlay.color_hint === "invalidation" && !visibility.waves) break;
        addLevelShapeAndLegend(overlay, shapes, data, t, compact);
        break;
      case "projection_path":
        if (!visibility.projection) break;
        data.push({
          type: "scatter",
          mode: "lines+markers+text",
          x: overlay.times,
          y: overlay.prices,
          text: overlay.prices.map((_price, idx) => (idx === 0 ? "" : `P${idx}`)),
          textposition: "top center",
          name: `${overlay.label} (${overlay.confidence.toFixed(0)})`,
          line: { color: t.projection, width: 2, dash: "dash" },
          marker: { color: t.projection, size: compact ? 4 : 6, symbol: "circle-open" },
          textfont: { color: t.projection, size: compact ? 10 : 11 },
          showlegend: !compact,
        });
        break;
      case "projection_level":
        if (!visibility.projection) break;
        addLevelShapeAndLegend(overlay, shapes, data, t, compact);
        break;
      default:
        break;
    }
  }
}

function addLevelShapeAndLegend(
  overlay: { price: number; label: string; style: "solid" | "dashed" | "dotted"; color_hint?: string | null },
  shapes: Array<Partial<Shape>>,
  data: Array<Record<string, unknown>>,
  t: (typeof THEMES)["dark"],
  compact: boolean,
) {
  const color = levelColor(overlay.color_hint, t);
  const dash =
    overlay.style === "dashed"
      ? "dash"
      : overlay.style === "dotted"
        ? "dot"
        : "solid";

  shapes.push({
    type: "line",
    xref: "paper",
    x0: 0,
    x1: 1,
    y0: overlay.price,
    y1: overlay.price,
    line: {
      color,
      width: compact ? 1.5 : overlay.color_hint === "fib" ? 1 : 1.7,
      dash,
    },
  });
  if (!compact) {
    data.push({
      type: "scatter",
      mode: "lines",
      x: [null],
      y: [null],
      name: overlay.label,
      line: {
        color,
        width: overlay.color_hint === "fib" ? 1 : 1.7,
        dash,
      },
      showlegend: true,
    });
  }
}

function levelColor(colorHint: string | null | undefined, t: (typeof THEMES)["dark"]): string {
  if (colorHint === "stop") return t.stop;
  if (colorHint === "target") return t.target;
  if (colorHint === "invalidation") return t.invalidation;
  if (colorHint === "fib") return t.fib;
  if (colorHint === "projection") return t.projection;
  return t.pivot;
}

function focusChart(
  chart: ChartPayload,
  visibility: ChartVisibilityOptions,
  compact: boolean,
): ChartPayload {
  const topScenario = chart.scenarios[0];
  const topRegion = chart.trade_regions[0];
  const latestClose = chart.ohlcv.at(-1)?.close;
  const topLabelPrefix = topScenario
    ? `${topScenario.pattern}/${topScenario.trend}`
    : "";

  let fibCount = 0;
  const overlays = chart.overlays.filter((overlay) => {
    if (overlay.kind === "wave_leg") {
      return visibility.waves && topLabelPrefix !== "" && overlay.scenario_label.startsWith(topLabelPrefix);
    }
    if (overlay.kind === "zone") {
      return false;
    }
    if (overlay.kind === "level") {
      if (overlay.color_hint === "stop" || overlay.color_hint === "target") return false;
      if (overlay.color_hint === "invalidation") return visibility.waves;
      if (overlay.color_hint === "fib" && latestClose != null) {
        if (!visibility.fibonacci) return false;
        if (!compact) return true;
        const nearLatestPrice = Math.abs(overlay.price - latestClose) / latestClose <= 0.18;
        if (nearLatestPrice && fibCount < 4) {
          fibCount += 1;
          return true;
        }
      }
    }
    if (overlay.kind === "projection_path" || overlay.kind === "projection_level") {
      return visibility.projection;
    }
    if (overlay.kind === "pivot") return visibility.pivots;
    return false;
  });

  return {
    ...chart,
    scenarios: topScenario ? [topScenario] : [],
    trade_regions: topRegion ? [topRegion] : [],
    overlays,
  };
}

function addScenarioTraces(
  scenario: ElliottScenario,
  sIdx: number,
  data: Array<Record<string, unknown>>,
  t: (typeof THEMES)["dark"],
) {
  const color = t.scenario[sIdx % t.scenario.length];
  const label = `${scenario.pattern}/${scenario.trend} (score=${scenario.score})`;
  let first = true;
  for (const leg of scenario.legs) {
    data.push({
      type: "scatter",
      mode: "lines+text" as const,
      x: [leg.start_time, leg.end_time],
      y: [leg.start_price, leg.end_price],
      text: ["", leg.label],
      textposition: "top center",
      line: { color, width: 2 },
      textfont: { color, size: 11 },
      name: label,
      legendgroup: label,
      showlegend: first,
    });
    first = false;
  }
}
