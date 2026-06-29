import type { RegimeData } from "@/lib/types";
import { matrixCellToneClass } from "@/lib/uiClasses";

const REGIME_LABELS = ["Bear", "Sidew.", "Bull"] as const;

function matrixCellColor(value: number): string {
  return matrixCellToneClass(value);
}

type MarkovTransitionMatrixProps = {
  matrix: number[][];
  compact?: boolean;
  expanded?: boolean;
};

export function MarkovTransitionMatrix({ matrix, compact = false, expanded = false }: MarkovTransitionMatrixProps) {
  const cellClass = expanded
    ? "px-3 py-2 text-sm"
    : compact
      ? "px-1 py-0.5 text-[9px]"
      : "px-2 py-0.5 text-[10px]";
  const rowLabelClass = expanded
    ? "pr-2 text-sm"
    : compact
      ? "text-[9px]"
      : "text-[10px]";

  return (
    <table className={`font-mono border-collapse ${compact || expanded ? "w-full" : ""}`}>
      <thead>
        <tr>
          <th className="text-subtle pr-1" />
          {REGIME_LABELS.map((label) => (
            <th key={label} className={`${cellClass} text-muted text-center font-normal`}>
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {matrix.map((row, rowIndex) => (
          <tr key={rowIndex}>
            <td className={`text-muted ${rowLabelClass}`}>
              {REGIME_LABELS[rowIndex]}
            </td>
            {row.map((value, colIndex) => (
              <td
                key={colIndex}
                className={`${cellClass} text-center rounded ${matrixCellColor(value)}`}
              >
                {(value * 100).toFixed(0)}%
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type MarkovStationaryBarsProps = {
  stationary: RegimeData["stationary"];
  compact?: boolean;
  expanded?: boolean;
};

export function MarkovStationaryBars({ stationary, compact = false, expanded = false }: MarkovStationaryBarsProps) {
  const statRows = [
    { label: "Bull", value: stationary.bull, color: "bg-green-500" },
    { label: "Sidew.", value: stationary.sideways, color: "bg-yellow-500" },
    { label: "Bear", value: stationary.bear, color: "bg-red-500" },
  ];

  const labelClass = expanded
    ? "w-14 text-sm"
    : compact
      ? "w-8 text-[9px]"
      : "w-10 text-[10px]";
  const barHeight = expanded ? "h-2.5" : compact ? "h-1" : "h-1.5";
  const valueClass = expanded
    ? "w-10 text-sm"
    : compact
      ? "w-7 text-[9px]"
      : "w-8 text-[10px]";

  return (
    <div className={expanded ? "space-y-2" : compact ? "space-y-0.5" : "space-y-1"}>
      {(!compact || expanded) && (
        <span
          className={`text-muted uppercase tracking-wide block mb-1 ${
            expanded ? "text-xs" : "text-[10px]"
          }`}
        >
          Long-run distribution
        </span>
      )}
      {statRows.map((bar) => (
        <div key={bar.label} className="flex items-center gap-3">
          <span className={`text-muted ${labelClass}`}>
            {bar.label}
          </span>
          <div className={`flex-1 bg-muted-surface rounded ${barHeight}`}>
            <div
              className={`rounded ${bar.color} ${barHeight}`}
              style={{ width: `${(bar.value * 100).toFixed(0)}%` }}
            />
          </div>
          <span
            className={`font-mono text-fg-secondary text-right ${valueClass}`}
          >
            {(bar.value * 100).toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  );
}
