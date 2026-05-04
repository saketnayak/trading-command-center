"use client";
import Link from "next/link";
import type { Run } from "@/lib/types";

interface RunTableProps {
  runs: Run[];
}

const statusBadge: Record<Run["status"], string> = {
  pending: "bg-slate-700 text-slate-300",
  running: "bg-blue-900 text-blue-300",
  completed: "bg-green-900 text-green-300",
  aborted: "bg-yellow-900 text-yellow-300",
  failed: "bg-red-900 text-red-300",
};

const verdictBadge: Record<NonNullable<Run["verdict"]>, string> = {
  buy: "bg-green-900 text-green-300",
  sell: "bg-red-900 text-red-300",
  hold: "bg-yellow-900 text-yellow-300",
};

export function RunTable({ runs }: RunTableProps) {
  return (
    <div className="overflow-x-auto rounded border border-slate-800">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-navy-700 text-slate-400 text-xs uppercase tracking-wider">
          <tr>
            <th className="text-left px-4 py-3">Ticker</th>
            <th className="text-left px-4 py-3">Status</th>
            <th className="text-left px-4 py-3">Verdict</th>
            <th className="text-left px-4 py-3">Analysts</th>
            <th className="text-left px-4 py-3">Started</th>
            <th className="text-left px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {runs.length === 0 ? (
            <tr>
              <td colSpan={6} className="text-center text-slate-500 px-4 py-8">
                No runs yet.
              </td>
            </tr>
          ) : (
            runs.map((run) => (
              <tr key={run.id} className="border-t border-slate-800 hover:bg-slate-800/40">
                <td className="px-4 py-3 text-slate-200 font-mono">{run.ticker}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium ${statusBadge[run.status]}`}>
                    {run.status === "running" && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-300 animate-pulse" />
                    )}
                    {run.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {run.verdict ? (
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${verdictBadge[run.verdict]}`}>
                      {run.verdict}
                    </span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs">{run.analysts.join(", ")}</td>
                <td className="px-4 py-3 text-slate-400 text-xs">
                  {run.started_at ? new Date(run.started_at).toLocaleDateString() : "—"}
                </td>
                <td className="px-4 py-3">
                  <Link href={`/runs/${run.id}`} className="text-blue-400 hover:underline text-xs">
                    View
                  </Link>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
