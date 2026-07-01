"use client";
import { useQuery } from "@tanstack/react-query";
import { getRunStats } from "@/lib/api";

function formatDur(secs: number): string {
  if (!secs) return "—";
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex flex-col items-center px-3 sm:px-5 py-3 min-w-[4.5rem]">
      <span className={`text-lg sm:text-xl font-semibold font-data ${color ?? "text-fg"}`}>{value}</span>
      <span className="text-muted text-xs mt-0.5 text-center">{label}</span>
    </div>
  );
}

export function StatsBar() {
  const { data: stats } = useQuery({
    queryKey: ["run-stats"],
    queryFn: getRunStats,
    staleTime: 30_000,
  });

  if (!stats) return null;

  const successRate = stats.completed + stats.failed > 0
    ? Math.round((stats.completed / (stats.completed + stats.failed)) * 100)
    : null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:flex lg:items-center lg:divide-x lg:divide-border bg-input/50 rounded-sm border border-border mb-4 overflow-x-auto">
      <Stat label="Total Runs" value={stats.total} />
      <Stat label="Buy" value={stats.verdicts.buy} color="text-green-400" />
      <Stat label="Sell" value={stats.verdicts.sell} color="text-red-400" />
      <Stat label="Hold" value={stats.verdicts.hold} color="text-yellow-400" />
      <Stat label="Success Rate" value={successRate != null ? `${successRate}%` : "—"} />
      <Stat label="Avg Duration" value={formatDur(stats.avg_duration_secs)} />
    </div>
  );
}
