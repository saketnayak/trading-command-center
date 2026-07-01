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
  maxBars?: number;
  showModeBar?: boolean;
  visibility?: ChartVisibilityOptions;
  className?: string;
  /** Expand to fill the parent flex container (Quick Look pop-out). */
  fill?: boolean;
}

export function AnalysisChart({
  chart,
  title,
  hover = true,
  compact = false,
  height,
  maxBars,
  showModeBar = false,
  visibility,
  className = "",
  fill = false,
}: AnalysisChartProps) {
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "light" ? "light" : "dark";
  const chartHeight = fill ? "100%" : (height ?? (compact ? 190 : 620));
  const layoutHeight = fill ? undefined : typeof height === "number" ? height : compact ? 190 : undefined;
  const { data, layout } = useMemo(
    () => buildChartFigure(chart, title, theme, hover, {
      compact: fill ? false : compact,
      height: layoutHeight,
      maxBars,
      visibility,
    }),
    [chart, title, theme, hover, fill, compact, layoutHeight, maxBars, visibility],
  );

  return (
    <div
      className={`w-full ${
        fill
          ? "flex h-full min-h-0 flex-1 flex-col"
          : "overflow-hidden rounded-lg border border-border bg-surface"
      } ${className}`}
    >
      <div className={fill ? "min-h-0 flex-1" : undefined}>
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
    </div>
  );
}
