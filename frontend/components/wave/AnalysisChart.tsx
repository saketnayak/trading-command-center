"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { useTheme } from "next-themes";

import { buildChartFigure } from "@/lib/wave/buildChartFigure";
import type { ChartPayload, ChartVisibilityOptions } from "@/lib/wave/types";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface AnalysisChartProps {
  chart: ChartPayload;
  title: string;
  hover?: boolean;
  compact?: boolean;
  height?: number | string;
  showModeBar?: boolean;
  visibility?: ChartVisibilityOptions;
  className?: string;
}

export function AnalysisChart({
  chart,
  title,
  hover = true,
  compact = false,
  height,
  showModeBar = false,
  visibility,
  className = "",
}: AnalysisChartProps) {
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "light" ? "light" : "dark";
  const chartHeight = height ?? (compact ? 190 : 620);
  const layoutHeight = typeof chartHeight === "number" ? chartHeight : undefined;
  const { data, layout } = useMemo(
    () => buildChartFigure(chart, title, theme, hover, {
      compact,
      height: layoutHeight,
      visibility,
    }),
    [chart, title, theme, hover, compact, layoutHeight, visibility],
  );

  return (
    <div className={`w-full overflow-hidden rounded-lg border border-border bg-surface ${className}`}>
      <Plot
        data={data}
        layout={layout}
        config={{ responsive: true, displayModeBar: showModeBar }}
        style={{
          width: "100%",
          height: typeof chartHeight === "number" ? `${chartHeight}px` : chartHeight,
        }}
        useResizeHandler
      />
    </div>
  );
}
