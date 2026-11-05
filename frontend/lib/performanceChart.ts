/** Plotly figures for the Performance tab. Pure: data + theme in, figure out.
 *
 * Colours: categorical slots 1–2 of the data-viz reference palette, validated
 * against this app's chart surfaces (#ffffff light, #0f1629 dark): adjacent
 * CVD ΔE ≥ 24, normal-vision ΔE ≥ 31, ≥ 3:1 contrast in both modes.
 */
import type { Data, Layout } from "plotly.js";

import { THEMES, type ChartTheme } from "@/lib/wave/chartTheme";
import type { PerformancePoint } from "@/lib/performance";

export const PERFORMANCE_COLORS = {
  light: { portfolio: "#2a78d6", benchmark: "#eb6834", gain: "#2a78d6", loss: "#e34948" },
  dark: { portfolio: "#3987e5", benchmark: "#d95926", gain: "#3987e5", loss: "#e66767" },
} as const;

function baseLayout(theme: ChartTheme, height: number, series: PerformancePoint[]): Partial<Layout> {
  const t = THEMES[theme];
  const first = series[0]?.date;
  const last = series[series.length - 1]?.date;
  return {
    height,
    margin: { l: 48, r: 64, t: 8, b: 32 },
    paper_bgcolor: t.paper,
    plot_bgcolor: t.bg,
    font: { color: t.font, size: 11 },
    hovermode: "x unified",
    hoverlabel: { bgcolor: t.legendBg, bordercolor: t.legendBorder, font: { color: t.font } },
    xaxis: {
      type: "date",
      // Pin to the data so end-of-line labels never stretch the axis past the last day.
      ...(first && last ? { range: [first, last], autorange: false } : {}),
      nticks: 6,
      tickangle: 0,
      gridcolor: "rgba(0,0,0,0)",
      linecolor: t.axis,
      showspikes: true,
      spikemode: "across",
      spikethickness: 1,
      spikecolor: t.axis,
      spikedash: "solid",
      fixedrange: true,
    },
    showlegend: false,
  };
}

/** Growth of 100: portfolio vs benchmark on one shared axis (both indexed, so one scale). */
export function buildGrowthFigure(
  series: PerformancePoint[],
  benchmark: string,
  theme: ChartTheme,
  height = 300,
): { data: Data[]; layout: Partial<Layout> } {
  const c = PERFORMANCE_COLORS[theme];
  const t = THEMES[theme];
  const x = series.map((p) => p.date);
  const data: Data[] = [
    {
      type: "scatter",
      mode: "lines",
      name: "Portfolio",
      x,
      y: series.map((p) => p.index),
      line: { color: c.portfolio, width: 2 },
      hovertemplate: "Portfolio %{y:.1f}<extra></extra>",
    },
  ];
  const hasBenchmark = series.some((p) => p.benchmark_index != null);
  if (hasBenchmark) {
    data.push({
      type: "scatter",
      mode: "lines",
      name: benchmark,
      x,
      y: series.map((p) => p.benchmark_index),
      line: { color: c.benchmark, width: 2 },
      hovertemplate: `${benchmark} %{y:.1f}<extra></extra>`,
    });
  }

  const last = series[series.length - 1];
  // Direct labels at the line ends, in text ink; the line colour sits beside them as a swatch.
  const annotations: Partial<Layout>["annotations"] = last
    ? [
        { x: last.date, y: last.index, text: "Portfolio", color: c.portfolio },
        ...(hasBenchmark && last.benchmark_index != null
          ? [{ x: last.date, y: last.benchmark_index, text: benchmark, color: c.benchmark }]
          : []),
      ].map((a, i, all) => {
        // Nudge apart when the two ends nearly overlap.
        const close = all.length === 2 && Math.abs((all[0].y as number) - (all[1].y as number)) < 3;
        const above = (a.y as number) >= ((all[1 - i]?.y as number) ?? -Infinity);
        return {
          x: a.x,
          y: a.y,
          xanchor: "left" as const,
          yanchor: "middle" as const,
          xshift: 6,
          yshift: close ? (above ? 8 : -8) : 0,
          text: `<span style="color:${a.color}">■</span> ${a.text}`,
          showarrow: false,
          font: { size: 11, color: t.font },
        };
      })
    : [];

  return {
    data,
    layout: {
      ...baseLayout(theme, height, series),
      yaxis: {
        gridcolor: t.grid,
        zeroline: false,
        ticks: "",
        tickformat: ".0f",
        fixedrange: true,
      },
      shapes: [
        {
          type: "line",
          xref: "paper",
          x0: 0,
          x1: 1,
          y0: 100,
          y1: 100,
          line: { color: t.axis, width: 1, dash: "dot" },
        },
      ],
      annotations,
    },
  };
}

/** Underwater chart: how far below its running peak the portfolio sat each day. */
export function buildDrawdownFigure(
  series: PerformancePoint[],
  theme: ChartTheme,
  height = 140,
): { data: Data[]; layout: Partial<Layout> } {
  const c = PERFORMANCE_COLORS[theme];
  const t = THEMES[theme];
  return {
    data: [
      {
        type: "scatter",
        mode: "lines",
        name: "Drawdown",
        x: series.map((p) => p.date),
        y: series.map((p) => p.drawdown),
        fill: "tozeroy",
        line: { color: c.portfolio, width: 2 },
        fillcolor: theme === "dark" ? "rgba(57,135,229,0.22)" : "rgba(42,120,214,0.16)",
        hovertemplate: "Drawdown %{y:.1%}<extra></extra>",
      },
    ],
    layout: {
      ...baseLayout(theme, height, series),
      yaxis: { gridcolor: t.grid, zeroline: false, tickformat: ".0%", fixedrange: true },
    },
  };
}
