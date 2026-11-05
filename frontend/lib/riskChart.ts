/** Plotly figures for the Risk tab. Pure: data + theme in, figure out.
 *
 * Correlation uses the reference diverging pair (red ↔ grey ↔ blue, grey at 0):
 * red = moves together (concentration), blue = moves opposite (diversifies).
 * The Monte Carlo fan is one hue (blue) at three strengths: 5–95%, 25–75%, median.
 */
import type { Data, Layout } from "plotly.js";

import { THEMES, type ChartTheme } from "@/lib/wave/chartTheme";
import type { FanPoint } from "@/lib/risk";

export const RISK_COLORS = {
  light: {
    together: "#e34948",
    neutral: "#f0efec",
    opposite: "#2a78d6",
    median: "#2a78d6",
    outer: "rgba(42,120,214,0.14)",
    inner: "rgba(42,120,214,0.30)",
    weight: "#2a78d6",
    risk: "#eb6834",
  },
  dark: {
    together: "#e66767",
    neutral: "#383835",
    opposite: "#3987e5",
    median: "#3987e5",
    outer: "rgba(57,135,229,0.24)",
    inner: "rgba(57,135,229,0.48)",
    weight: "#3987e5",
    risk: "#d95926",
  },
} as const;

export function buildCorrelationFigure(
  tickers: string[],
  matrix: (number | null)[][],
  theme: ChartTheme,
): { data: Data[]; layout: Partial<Layout> } {
  const c = RISK_COLORS[theme];
  const t = THEMES[theme];
  const n = tickers.length;
  const showText = n <= 12;
  const size = Math.max(220, Math.min(560, 40 + n * 30));
  return {
    data: [
      {
        type: "heatmap",
        x: tickers,
        y: tickers,
        z: matrix,
        zmin: -1,
        zmax: 1,
        colorscale: [
          [0, c.opposite],
          [0.5, c.neutral],
          [1, c.together],
        ],
        xgap: 2,
        ygap: 2,
        showscale: true,
        colorbar: { thickness: 10, len: 0.8, tickvals: [-1, 0, 1], ticktext: ["−1", "0", "+1"], outlinewidth: 0 },
        hovertemplate: "%{y} · %{x}: %{z:.2f}<extra></extra>",
        ...(showText ? { texttemplate: "%{z:.2f}", textfont: { size: 10, color: t.font } } : {}),
      } as Data,
    ],
    layout: {
      height: size,
      margin: { l: 64, r: 8, t: 8, b: 56 },
      paper_bgcolor: t.paper,
      plot_bgcolor: t.bg,
      font: { color: t.font, size: 11 },
      xaxis: { tickangle: -45, fixedrange: true, showgrid: false },
      yaxis: { autorange: "reversed", fixedrange: true, showgrid: false },
    },
  };
}

/** One-year outcome fan from the Monte Carlo percentiles (x in months). */
export function buildFanFigure(fan: FanPoint[], theme: ChartTheme): { data: Data[]; layout: Partial<Layout> } {
  const c = RISK_COLORS[theme];
  const t = THEMES[theme];
  const x = fan.map((p) => +(p.day / 21).toFixed(1));
  const band = (lo: keyof FanPoint, hi: keyof FanPoint, fill: string, name: string): Data[] => [
    { type: "scatter", mode: "lines", x, y: fan.map((p) => p[lo]), line: { width: 0 }, hoverinfo: "skip", showlegend: false },
    {
      type: "scatter",
      mode: "lines",
      x,
      y: fan.map((p) => p[hi]),
      fill: "tonexty",
      fillcolor: fill,
      line: { width: 0 },
      name,
      hoverinfo: "skip",
    },
  ];
  return {
    data: [
      ...band("p5", "p95", c.outer, "5–95% of outcomes"),
      ...band("p25", "p75", c.inner, "25–75% of outcomes"),
      {
        type: "scatter",
        mode: "lines",
        x,
        y: fan.map((p) => p.p50),
        line: { color: c.median, width: 2 },
        name: "Median",
        customdata: fan.map((p) => [p.p5, p.p25, p.p75, p.p95]),
        hovertemplate:
          "Month %{x}<br>Median %{y:+.1%}<br>25–75%: %{customdata[1]:+.1%} to %{customdata[2]:+.1%}" +
          "<br>5–95%: %{customdata[0]:+.1%} to %{customdata[3]:+.1%}<extra></extra>",
      },
    ],
    layout: {
      height: 240,
      margin: { l: 48, r: 12, t: 8, b: 36 },
      paper_bgcolor: t.paper,
      plot_bgcolor: t.bg,
      font: { color: t.font, size: 11 },
      showlegend: false,
      hovermode: "x",
      xaxis: { title: { text: "Months ahead", font: { size: 11 } }, dtick: 3, fixedrange: true, gridcolor: "rgba(0,0,0,0)", linecolor: t.axis },
      yaxis: { tickformat: "+.0%", gridcolor: t.grid, zeroline: true, zerolinecolor: t.axis, fixedrange: true },
    },
  };
}
