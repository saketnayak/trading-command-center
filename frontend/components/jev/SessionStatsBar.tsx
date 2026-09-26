import { fmtUsd } from "@/lib/jev/format";
import type { JevWindowStats } from "@/lib/jev/insights";

function Stat({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <span className="whitespace-nowrap">
      {label} <span className={`font-mono text-fg ${tone}`}>{value}</span>
    </span>
  );
}

/** One line of live numbers: how long, how many, how Jev is doing, what it costs. */
export function SessionStatsBar({
  uptime,
  ticks,
  stats,
  costUsd,
}: {
  uptime: string;
  ticks: number;
  stats: JevWindowStats;
  costUsd: number;
}) {
  const rate = stats.answerRate;
  const rateTone = rate == null ? "" : rate >= 0.8 ? "text-green-500 dark:text-green-400" : rate >= 0.3 ? "text-amber-500 dark:text-amber-300" : "text-red-500 dark:text-red-400";
  const providers = Object.entries(stats.providers)
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => p)
    .join(", ");
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted" aria-label="Session statistics">
      <Stat label="uptime" value={uptime} />
      <Stat label="ticks" value={ticks.toLocaleString()} />
      <Stat label="Jev answered" value={rate == null ? "—" : `${Math.round(rate * 100)}%`} tone={rateTone} />
      <Stat label="last" value={stats.lastMs != null ? `${Math.round(stats.lastMs)} ms` : "—"} />
      <Stat label="avg" value={stats.avgMs != null ? `${Math.round(stats.avgMs)} ms` : "—"} />
      <Stat label="429s" value={String(stats.rateLimited)} tone={stats.rateLimited ? "text-amber-500 dark:text-amber-300" : ""} />
      <Stat label="late" value={String(stats.late)} />
      <Stat label="errors" value={String(stats.errors)} />
      <Stat label="Jev cost" value={fmtUsd(costUsd, 4)} />
      {providers && <Stat label="served by" value={providers} />}
      <span className="text-[10px] text-muted/80 self-center">(Jev figures cover the last 90 ticks)</span>
    </div>
  );
}
