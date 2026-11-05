"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { getLeaderboard } from "@/lib/api";
import type { Leaderboard } from "@/lib/backtest";
import { fmtPct, fmtSignedPct, returnTone } from "@/lib/performance";
import { selectionPillClass } from "@/lib/uiClasses";

const GROUPS: { id: Leaderboard["group_by"]; label: string }[] = [
  { id: "model", label: "Model" },
  { id: "depth", label: "Depth" },
  { id: "analysts", label: "Analysts" },
];

export function ModelLeaderboard() {
  const [groupBy, setGroupBy] = useState<Leaderboard["group_by"]>("model");
  const q = useQuery({ queryKey: ["leaderboard", groupBy], queryFn: () => getLeaderboard(groupBy), staleTime: 10 * 60_000 });
  return (
    <section className="rounded-lg border border-border bg-surface p-4" aria-labelledby="lb-heading">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id="lb-heading" className="text-sm font-semibold text-fg">Which setup calls it best?</h2>
        <div className="flex gap-1.5" role="group" aria-label="Group by">
          {GROUPS.map((g) => (
            <button key={g.id} type="button" className={selectionPillClass(g.id === groupBy, true)} aria-pressed={g.id === groupBy}
              onClick={() => setGroupBy(g.id)}>{g.label}</button>
          ))}
        </div>
      </div>
      {q.isPending && <p className="text-sm text-muted">Loading…</p>}
      {q.isError && <p className="text-sm text-red-500" role="alert">{(q.error as Error).message}</p>}
      {q.data && q.data.groups.length === 0 && <p className="text-sm text-muted">No completed runs with outcomes yet.</p>}
      {q.data && q.data.groups.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="py-1.5 pr-2 font-medium">{GROUPS.find((g) => g.id === groupBy)?.label}</th>
                <th className="py-1.5 pr-2 text-right font-medium">Runs</th>
                <th className="py-1.5 pr-2 text-right font-medium">7d right</th>
                <th className="py-1.5 pr-2 text-right font-medium">7d vs SPY</th>
                <th className="py-1.5 pr-2 text-right font-medium">30d right</th>
                <th className="py-1.5 text-right font-medium">30d vs SPY</th>
              </tr>
            </thead>
            <tbody>
              {q.data.groups.map((g) => (
                <tr key={g.group} className="border-b border-border/60 last:border-0">
                  <td className="py-1.5 pr-2 font-medium text-fg">{g.group}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{g.runs}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{fmtPct(g["7d"].accuracy, 0)} <span className="text-muted">({g["7d"].scored})</span></td>
                  <td className={`py-1.5 pr-2 text-right tabular-nums ${returnTone(g["7d"].avg_excess)}`}>{fmtSignedPct(g["7d"].avg_excess, 2)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{fmtPct(g["30d"].accuracy, 0)} <span className="text-muted">({g["30d"].scored})</span></td>
                  <td className={`py-1.5 text-right tabular-nums ${returnTone(g["30d"].avg_excess)}`}>{fmtSignedPct(g["30d"].avg_excess, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.data && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          {q.data.note} Numbers in brackets are the BUY/SELL calls scored.
          {!q.data.benchmark_available && q.data.groups.length > 0 && " SPY prices aren't available, so excess return is blank."}
        </p>
      )}
    </section>
  );
}
