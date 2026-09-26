import { fmtPrice, tickTone, TONE_FILL } from "@/lib/jev/format";
import type { JevTick } from "@/lib/jev/types";

const W = 800;
const H = 220;
const PAD = { top: 12, right: 64, bottom: 20, left: 8 };

const LEGEND: [keyof typeof TONE_FILL, string][] = [
  ["quote", "Quote both sides"],
  ["wide", "Quote wide / widen"],
  ["idle", "Pull / stand down"],
  ["hold", "Hold or vetoed (late, closed, data error, risk veto)"],
  ["kill", "Kill"],
];

/** Mid price over recent ticks, one dot per tick coloured by the action taken. */
export function PriceActionChart({ ticks, finished = false }: { ticks: JevTick[]; finished?: boolean }) {
  const pts = ticks.filter((t) => t.mid != null) as (JevTick & { mid: number })[];
  if (pts.length < 2) {
    return <div className="flex h-[220px] items-center justify-center text-xs text-muted">{finished ? "No prices were recorded in this session." : "Waiting for ticks…"}</div>;
  }
  // Resting bids and directional trades, drawn over the price so "why no fill" is visible.
  const bids = pts.flatMap((p) =>
    p.orders.filter((o) => o.purpose === "quote_bid" && o.limit_price).map((o) => ({ tick: p.tick, price: o.limit_price as number })),
  );
  const trades = pts.flatMap((p) =>
    p.orders.filter((o) => o.purpose === "leg" && o.status !== "rejected").map((o) => ({ tick: p.tick, mid: p.mid, side: o.side })),
  );
  const lo = Math.min(...pts.map((p) => p.mid), ...bids.map((b) => b.price));
  const hi = Math.max(...pts.map((p) => p.mid));
  const span = Math.max(hi - lo, hi * 0.0001);
  const first = pts[0].tick;
  const last = pts[pts.length - 1].tick;
  const x = (tick: number) => PAD.left + ((tick - first) / Math.max(1, last - first)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - lo) / span) * (H - PAD.top - PAD.bottom);
  // step line: the price holds until the next tick moves it
  const path = pts
    .map((p, i) => (i ? `H${x(p.tick).toFixed(1)} V${y(p.mid).toFixed(1)}` : `M${x(p.tick).toFixed(1)} ${y(p.mid).toFixed(1)}`))
    .join(" ");
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
        {bids.map((b) => (
          <line key={`bid-${b.tick}`} x1={x(b.tick) - 5} x2={x(b.tick) + 5} y1={y(b.price)} y2={y(b.price)} stroke="#22c55e" strokeWidth={2}>
            <title>{`bid placed at ${fmtPrice(b.price)} (tick ${b.tick})`}</title>
          </line>
        ))}
        {trades.map((t) => (
          <path
            key={`trade-${t.tick}`}
            d={t.side === "buy"
              ? `M${x(t.tick)} ${y(t.mid) - 12} l-5 8 h10 z`
              : `M${x(t.tick)} ${y(t.mid) + 12} l-5 -8 h10 z`}
            fill={t.side === "buy" ? "#22c55e" : "#ef4444"}
          >
            <title>{`directional ${t.side} at tick ${t.tick}`}</title>
          </path>
        ))}
        {pts.map((p) => (
          <circle key={p.tick} cx={x(p.tick)} cy={y(p.mid)} r={2.6} fill={TONE_FILL[tickTone(p)]}>
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
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-3 bg-green-500" />bid placed</span>
        <span className="flex items-center gap-1"><span className="text-green-500">▲</span>/<span className="text-red-500">▼</span> directional trade</span>
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
