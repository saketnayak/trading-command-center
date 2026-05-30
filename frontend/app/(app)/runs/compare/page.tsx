"use client";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { TopNav } from "@/components/layout/TopNav";
import { ComparisonPanel } from "@/components/runs/ComparisonPanel";
import { compareRuns, getRuns } from "@/lib/api";
import type { Run } from "@/lib/types";

const verdictBadge: Record<NonNullable<Run["verdict"]>, string> = {
  buy: "bg-green-900 text-green-300",
  sell: "bg-red-900 text-red-300",
  hold: "bg-yellow-900 text-yellow-300",
};

function RunPickerRow({ run, onPick }: { run: Run; onPick: () => void }) {
  return (
    <tr className="border-t border-slate-800 hover:bg-slate-800/40">
      <td className="px-4 py-3 font-mono text-slate-200">{run.ticker}</td>
      <td className="px-4 py-3 text-slate-400 text-xs">{run.analysis_date}</td>
      <td className="px-4 py-3">
        {run.verdict ? (
          <span className={`rounded-sm px-2 py-0.5 text-xs font-medium ${verdictBadge[run.verdict]}`}>
            {run.verdict}
          </span>
        ) : (
          <span className="text-slate-600">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-slate-400 text-xs font-mono">{run.llm_model}</td>
      <td className="px-4 py-3 text-xs text-slate-400">
        {run.started_at ? new Date(run.started_at).toLocaleDateString() : "—"}
      </td>
      <td className="px-4 py-3">
        <button
          onClick={onPick}
          className="text-xs text-blue-400 hover:text-blue-300 hover:underline"
        >
          Compare →
        </button>
      </td>
    </tr>
  );
}

function RunPicker({ anchorId }: { anchorId: string }) {
  const router = useRouter();

  const { data: runs = [], isLoading } = useQuery({
    queryKey: ["runs-for-compare"],
    queryFn: () => getRuns({ archived: false, limit: 200 }),
  });

  const eligible = runs.filter((r) => r.status === "completed" && r.id !== anchorId);

  if (isLoading) return <p className="text-slate-400 text-sm">Loading runs…</p>;
  if (eligible.length === 0) {
    return <p className="text-slate-500 text-sm">No other completed runs to compare against.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-slate-400 text-sm">Pick a second run to compare against:</p>
      <div className="overflow-x-auto rounded-sm border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-navy-700 text-slate-400 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">Ticker</th>
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-left px-4 py-3">Verdict</th>
              <th className="text-left px-4 py-3">Model</th>
              <th className="text-left px-4 py-3">Started</th>
              <th className="text-left px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {eligible.map((run) => (
              <RunPickerRow
                key={run.id}
                run={run}
                onPick={() => router.push(`/runs/compare?a=${anchorId}&b=${run.id}`)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompareContent() {
  const params = useSearchParams();
  const a = params.get("a") ?? "";
  const b = params.get("b") ?? "";

  const { data, isLoading, error } = useQuery({
    queryKey: ["compare", a, b],
    queryFn: () => compareRuns(a, b),
    enabled: !!a && !!b,
  });

  if (!a) {
    return (
      <p className="text-slate-400 text-sm">
        Start from a run&apos;s detail page and click <span className="text-slate-300">Compare →</span>, or
        select two runs from{" "}
        <Link href="/runs" className="text-blue-400 hover:underline">
          Run History
        </Link>
        .
      </p>
    );
  }

  if (a && !b) return <RunPicker anchorId={a} />;

  if (isLoading) return <div className="text-slate-400 text-sm">Loading comparison…</div>;
  if (error) return <div className="text-red-400 text-sm">Failed to load comparison.</div>;
  if (!data) return null;

  return <ComparisonPanel a={data.a} b={data.b} />;
}

export default function ComparePage() {
  return (
    <div className="min-h-screen bg-navy-900">
      <TopNav />
      <main className="p-6 max-w-7xl mx-auto flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <Link href="/runs" className="text-blue-400 hover:underline text-sm">
            ← Back to History
          </Link>
          <h1 className="text-lg font-semibold text-white">Run Comparison</h1>
        </div>
        <Suspense fallback={<div className="text-slate-400 text-sm">Loading…</div>}>
          <CompareContent />
        </Suspense>
      </main>
    </div>
  );
}
