/** Plotly figure for the Income tab's reinvestment projection. Pure: data + theme in, figure out.
 *
 * Colours: the same validated categorical pair as the Performance tab
 * (blue = with reinvestment, orange = without).
 */
import type { Data, Layout } from "plotly.js";

import { THEMES, type ChartTheme } from "@/lib/wave/chartTheme";
import { fmtMoney } from "@/lib/currency";
import type { IncomeReport } from "@/lib/income";

export const INCOME_COLORS = {
  light: { drip: "#2a78d6", noDrip: "#eb6834" },
  dark: { drip: "#3987e5", noDrip: "#d95926" },
} as const;

export function buildProjectionFigure(
  projection: NonNullable<IncomeReport["projection"]>,
  currency: string,
  theme: ChartTheme,
  height = 260,
): { data: Data[]; layout: Partial<Layout> } {
  const c = INCOME_COLORS[theme];
  const t = THEMES[theme];
  const x = projection.years.map((y) => y.year);
  const line = (key: "with_drip" | "without_drip", name: string, color: string): Data => ({
    type: "scatter",
    mode: "lines+markers",
    name,
    x,
    y: projection.years.map((y) => y[key]),
    line: { color, width: 2 },
    marker: { color, size: 5 },
    customdata: projection.years.map((y) => fmtMoney(y[key], currency)),
    hovertemplate: `${name}: %{customdata} a year<extra></extra>`,
  });
  return {
    data: [line("with_drip", "Reinvested", c.drip), line("without_drip", "Taken as cash", c.noDrip)],
    layout: {
      height,
      margin: { l: 56, r: 16, t: 8, b: 36 },
      paper_bgcolor: t.paper,
      plot_bgcolor: t.bg,
      font: { color: t.font, size: 11 },
      hovermode: "x unified",
      hoverlabel: { bgcolor: t.legendBg, bordercolor: t.legendBorder, font: { color: t.font } },
      xaxis: {
        title: { text: "Years from now" },
        dtick: 1,
        gridcolor: "rgba(0,0,0,0)",
        linecolor: t.axis,
        fixedrange: true,
      },
      yaxis: { gridcolor: t.grid, zeroline: false, rangemode: "tozero", tickprefix: "", fixedrange: true },
      showlegend: false,
    },
  };
}
