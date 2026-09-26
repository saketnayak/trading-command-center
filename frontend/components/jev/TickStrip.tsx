import { stripTone } from "@/lib/jev/insights";
import type { JevTick } from "@/lib/jev/types";

const CELLS = 120;
const TONE: Record<ReturnType<typeof stripTone>, string> = {
  trade: "bg-green-500",
  quote: "bg-blue-500/70",
  hold: "bg-amber-400",
  idle: "bg-gray-400/60",
  kill: "bg-red-600",
  error: "bg-red-400/70",
};
const LEGEND: [keyof typeof TONE, string][] = [
  ["trade", "traded"],
  ["quote", "quoting"],
  ["idle", "standing by"],
  ["hold", "held or vetoed"],
  ["error", "Jev or data error"],
  ["kill", "kill"],
];

/** One cell per tick, newest on the right: the session's rhythm at a glance. */
export function TickStrip({ ticks }: { ticks: JevTick[] }) {
  const recent = ticks.slice(-CELLS);
  const pad = CELLS - recent.length;
  return (
    <div>
      <div className="flex h-4 gap-px" role="img" aria-label={`Last ${recent.length} ticks by outcome`}>
        {Array.from({ length: pad }, (_, i) => (
          <span key={`pad-${i}`} className="flex-1 rounded-[1px] bg-elevated" />
        ))}
        {recent.map((t, i) => (
          <span
            key={t.tick}
            title={`#${t.tick} ${t.action}${t.jev_status ? ` · Jev ${t.jev_status}` : ""}`}
            className={`flex-1 rounded-[1px] ${TONE[stripTone(t)]} ${i === recent.length - 1 ? "ring-1 ring-fg" : ""}`}
          />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted">
        {LEGEND.map(([tone, label]) => (
          <span key={tone} className="flex items-center gap-1">
            <span className={`inline-block h-2 w-2 rounded-[1px] ${TONE[tone]}`} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
