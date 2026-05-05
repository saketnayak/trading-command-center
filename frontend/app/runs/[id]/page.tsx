"use client";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { TopNav } from "@/components/layout/TopNav";
import { TraderDecision } from "@/components/runs/TraderDecision";
import { AnalystReports } from "@/components/runs/AnalystReports";
import { BullBearDebate } from "@/components/runs/BullBearDebate";
import { getRun, getReport } from "@/lib/api";

export default function RunResultsPage() {
  const { id } = useParams<{ id: string }>();

  const { data: run } = useQuery({
    queryKey: ["run", id],
    queryFn: () => getRun(id),
  });

  const { data: report } = useQuery({
    queryKey: ["report", id],
    queryFn: () => getReport(id),
    enabled: run?.status === "completed",
    retry: false,
  });

  const isRunning = run?.status === "pending" || run?.status === "running";

  return (
    <div className="min-h-screen bg-navy-900">
      <TopNav />
      <main className="p-6 max-w-5xl mx-auto flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <Link href="/runs" className="text-blue-400 hover:underline text-sm">
            ← Back to History
          </Link>
          {report && (
            <button
              onClick={() => {
                const blob = new Blob([JSON.stringify(report.raw_report, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${run?.ticker ?? "report"}-${id.slice(0, 8)}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="text-xs text-slate-400 hover:text-slate-200 border border-slate-700 rounded px-3 py-1"
            >
              Download JSON
            </button>
          )}
        </div>

        {isRunning && (
          <div className="bg-navy-700 border border-slate-700 rounded-lg px-4 py-3 text-sm text-slate-300">
            Run in progress —{" "}
            <Link href={`/runs/${id}/live`} className="text-blue-400 hover:underline">
              View live feed →
            </Link>
          </div>
        )}

        <TraderDecision run={run} report={report} />
        <AnalystReports report={report} analysts={run?.analysts ?? []} />
        <BullBearDebate report={report} />
      </main>
    </div>
  );
}
