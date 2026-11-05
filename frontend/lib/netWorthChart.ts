/** Plotly figure for the net-worth page. Pure: data + theme in, figure out.
 *
 * Colours: the validated categorical pair used across the app (blue = net
 * worth, orange = liabilities).
 */
import type { Data, Layout } from "plotly.js";

import { THEMES, type ChartTheme } from "@/lib/wave/chartTheme";
import { fmtMoney } from "@/lib/currency";
import type { NetWorthPoint } from "@/lib/netWorth";

export const NET_WORTH_COLORS = {
  light: { netWorth: "#2a78d6", liabilities: "#eb6834" },
  dark: { netWorth: "#3987e5", liabilities: "#d95926" },
} as const;

export function buildNetWorthFigure(
  series: NetWorthPoint[],
  currency: string,
  theme: ChartTheme,
  height = 300,
): { data: Data[]; layout: Partial<Layout> } {
  const c = NET_WORTH_COLORS[theme];
  const t = THEMES[theme];
  const x = series.map((p) => p.date);
  const money = (v: number) => fmtMoney(v, currency);
  const hasDebt = series.some((p) => p.liabilities > 0);
  const data: Data[] = [
    {
      type: "scatter",
      mode: "lines",
      name: "Net worth",
      x,
      y: series.map((p) => p.net_worth),
      line: { color: c.netWorth, width: 2.5 },
      customdata: series.map((p) => [money(p.net_worth), money(p.investments), money(p.other_assets), money(p.liabilities)]),
      hovertemplate:
        "Net worth %{customdata[0]}<br>Portfolios %{customdata[1]} · Other assets %{customdata[2]}<br>Liabilities %{customdata[3]}<extra></extra>",
    },
  ];
  if (hasDebt) {
    data.push({
      type: "scatter",
      mode: "lines",
      name: "Liabilities",
      x,
      y: series.map((p) => p.liabilities),
      line: { color: c.liabilities, width: 1.5 },
      hoverinfo: "skip",
    });
  }
  const first = x[0];
  const last = x[x.length - 1];
  return {
    data,
    layout: {
      height,
      margin: { l: 64, r: 16, t: 8, b: 32 },
      paper_bgcolor: t.paper,
      plot_bgcolor: t.bg,
      font: { color: t.font, size: 11 },
      hovermode: "x unified",
      hoverlabel: { bgcolor: t.legendBg, bordercolor: t.legendBorder, font: { color: t.font } },
      xaxis: {
        type: "date",
        ...(first && last ? { range: [first, last], autorange: false } : {}),
        nticks: 6,
        gridcolor: "rgba(0,0,0,0)",
        linecolor: t.axis,
        fixedrange: true,
      },
      yaxis: { gridcolor: t.grid, zerolinecolor: t.axis, fixedrange: true, tickformat: "~s" },
      showlegend: false,
    },
  };
}
