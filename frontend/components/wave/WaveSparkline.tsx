type WaveSparklineProps = {
  closes: number[];
  zoneLow?: number | null;
  zoneHigh?: number | null;
  invalidationLevel?: number | null;
  entry?: number | null;
  width?: number;
  height?: number;
  className?: string;
};

function priceToY(value: number, min: number, span: number, height: number, paddingY: number): number {
  const plotHeight = height - paddingY * 2;
  return paddingY + plotHeight - ((value - min) / span) * plotHeight;
}

export function WaveSparkline({
  closes,
  zoneLow,
  zoneHigh,
  invalidationLevel,
  entry,
  width = 400,
  height = 64,
  className = "",
}: WaveSparklineProps) {
  if (closes.length < 2) {
    return (
      <div
        className={`flex h-16 items-center justify-center text-[10px] text-muted ${className}`}
        role="img"
        aria-label="Wave price sparkline unavailable"
      >
        Preview unavailable
      </div>
    );
  }

  const paddingX = 4;
  const paddingY = 6;
  const plotWidth = width - paddingX * 2;

  const pricePoints = closes;
  const scaleValues = [...pricePoints];
  if (zoneLow != null) scaleValues.push(zoneLow);
  if (zoneHigh != null) scaleValues.push(zoneHigh);
  if (invalidationLevel != null) scaleValues.push(invalidationLevel);
  if (entry != null) scaleValues.push(entry);

  const rawMin = Math.min(...scaleValues);
  const rawMax = Math.max(...scaleValues);
  const margin = (rawMax - rawMin) * 0.08 || rawMax * 0.01 || 1;
  const min = rawMin - margin;
  const max = rawMax + margin;
  const span = max - min || 1;

  const toY = (value: number) => priceToY(value, min, span, height, paddingY);

  const linePoints = pricePoints
    .map((value, idx) => {
      const x =
        paddingX + (pricePoints.length > 1 ? (idx / (pricePoints.length - 1)) * plotWidth : plotWidth / 2);
      return `${x.toFixed(2)},${toY(value).toFixed(2)}`;
    })
    .join(" ");

  const lastClose = pricePoints[pricePoints.length - 1];
  const lastX = paddingX + plotWidth;
  const lastY = toY(lastClose);

  const hasZone = zoneLow != null && zoneHigh != null && zoneHigh > zoneLow;
  const zoneTop = hasZone ? Math.min(toY(zoneLow!), toY(zoneHigh!)) : 0;
  const zoneBottom = hasZone ? Math.max(toY(zoneLow!), toY(zoneHigh!)) : 0;
  const zoneHeight = hasZone ? zoneBottom - zoneTop : 0;

  const invalidationY =
    invalidationLevel != null && invalidationLevel >= min && invalidationLevel <= max
      ? toY(invalidationLevel)
      : null;

  const entryY =
    entry != null && entry >= min && entry <= max ? toY(entry) : null;
  const entryInZone =
    hasZone && entry != null && entry >= zoneLow! && entry <= zoneHigh!;

  return (
    <div className={`space-y-1 ${className}`}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Elliott wave price sparkline with trade zone"
        className="h-16 w-full"
      >
        {hasZone && (
          <rect
            x={paddingX}
            y={zoneTop}
            width={plotWidth}
            height={zoneHeight}
            fill="rgb(96 165 250 / 0.18)"
            stroke="rgb(96 165 250 / 0.35)"
            strokeWidth="0.75"
          />
        )}
        {invalidationY != null && (
          <line
            x1={paddingX}
            y1={invalidationY}
            x2={paddingX + plotWidth}
            y2={invalidationY}
            stroke="rgb(248 113 113 / 0.75)"
            strokeWidth="1"
            strokeDasharray="4 3"
          />
        )}
        <polyline
          points={linePoints}
          fill="none"
          stroke="rgb(148 163 184)"
          strokeWidth="1.75"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx={lastX} cy={lastY} r="2.5" fill="rgb(96 165 250)" />
        {entryY != null && (
          <circle
            cx={lastX - 8}
            cy={entryY}
            r="2.25"
            fill={entryInZone ? "rgb(74 222 128)" : "rgb(148 163 184)"}
            stroke="rgb(15 23 42 / 0.5)"
            strokeWidth="0.75"
          />
        )}
      </svg>
      <div className="flex items-center justify-between text-[9px] text-muted">
        <span>Price</span>
        {hasZone && <span className="text-blue-400/90">Trade zone</span>}
        {invalidationLevel != null && <span className="text-red-400/80">Invalidation</span>}
      </div>
    </div>
  );
}
