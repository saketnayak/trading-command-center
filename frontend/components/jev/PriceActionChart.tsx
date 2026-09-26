import { actionTone, fmtPrice, TONE_FILL } from "@/lib/jev/format";
import type { JevTick } from "@/lib/jev/types";

const W = 800;
const H = 220;
const PAD = { top: 12, right: 64, bottom: 20, left: 8 };

const LEGEND: [keyof typeof TONE_FILL, string][] = [
  ["quote", "Quote both sides"],
  ["wide", "Quote wide / widen"],
  ["idle", "Pull / stand down"],
  ["hold", "Hold (late, closed, data error)"],
  ["kill", "Kill"],
];

/** Mid price over recent ticks, one dot per tick coloured by the action taken. */
export function PriceActionChart({ ticks, finished = false }: { ticks: JevTick[]; finished?: boolean }) {
  const pts = ticks.filter((t) => t.mid != null) as (JevTick & { mid: number })[];
  if (pts.length < 2) {
    return <div className="flex h-[220px] items-center justify-center text-xs text-muted">{finished ? "No prices were recorded in this session." : "Waiting for ticks…"}</div>;
  }
  const lo = Math.min(...pts.map((p) => p.mid));
  const hi = Math.max(...pts.map((p) => p.mid));
  const span = Math.max(hi - lo, hi * 0.0001);
  const first = pts[0].tick;
  const last = pts[pts.length - 1].tick;
  const x = (tick: number) => PAD.left + ((tick - first) / Math.max(1, last - first)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - lo) / span) * (H - PAD.top - PAD.bottom);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.tick).toFixed(1)} ${y(p.mid).toFixed(1)}`).join(" ");
  const grid = [0, 1, 2, 3].map((k) => lo + (span * k) / 3);
  const lastPt = pts[pts.length - 1];

  return (
    <figure>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[220px] w-full"
        role="img"
        aria-label={`Mid price over ticks ${first} to ${last}, from ${fmtPrice(pts[0].mid)} to ${fmtPrice(lastPt.mid)}`}
      >
        {grid.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={0.1} strokeDasharray="3 4" />
            <text x={W - PAD.right + 6} y={y(v) + 4} fontSize={10} fill="currentColor" fillOpacity={0.55}>
              {fmtPrice(v)}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="currentColor" strokeOpacity={0.7} strokeWidth={1.4} />
        {pts.map((p) => (
          <circle key={p.tick} cx={x(p.tick)} cy={y(p.mid)} r={2.6} fill={TONE_FILL[actionTone(p.action)]}>
            <title>{`#${p.tick} ${p.action} @ ${fmtPrice(p.mid)}`}</title>
          </circle>
        ))}
        <text x={PAD.left} y={H - 4} fontSize={10} fill="currentColor" fillOpacity={0.55}>
          tick {first}
        </text>
        <text x={W - PAD.right} y={H - 4} fontSize={10} textAnchor="end" fill="currentColor" fillOpacity={0.55}>
          tick {last}
        </text>
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted">
        {LEGEND.map(([tone, label]) => (
          <span key={tone} className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: TONE_FILL[tone] }} />
            {label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
