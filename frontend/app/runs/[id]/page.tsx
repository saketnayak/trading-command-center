"use client";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { TopNav } from "@/components/layout/TopNav";
import { TraderDecision } from "@/components/runs/TraderDecision";
import { AnalystReports } from "@/components/runs/AnalystReports";
import { BullBearDebate } from "@/components/runs/BullBearDebate";
import { getRun, getReport, getRunOutcome } from "@/lib/api";
import { DownloadMenu } from "@/components/runs/DownloadMenu";
import { OutcomeCard } from "@/components/runs/OutcomeCard";
import type { RunOutcome } from "@/lib/types";

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

  const { data: outcome } = useQuery<RunOutcome>({
    queryKey: ["outcome", id],
    queryFn: () => getRunOutcome(id),
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
          <div className="flex items-center gap-3">
            {run && (
              <Link href={`/runs/compare?a=${id}&b=`} className="text-slate-400 hover:text-blue-400 text-sm">
                Compare →
              </Link>
            )}
            <DownloadMenu run={run} report={report} />
          </div>
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
        {outcome && <OutcomeCard outcome={outcome} />}
        <AnalystReports report={report} analysts={run?.analysts ?? []} />
        <BullBearDebate report={report} />
      </main>
    </div>
  );
}
