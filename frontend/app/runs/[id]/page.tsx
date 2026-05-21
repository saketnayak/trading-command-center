"use client";
import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TopNav } from "@/components/layout/TopNav";
import { TraderDecision } from "@/components/runs/TraderDecision";
import { AnalystReports } from "@/components/runs/AnalystReports";
import { BullBearDebate } from "@/components/runs/BullBearDebate";
import { getRun, getReport, getRunOutcome, updateRun } from "@/lib/api";
import { DownloadMenu } from "@/components/runs/DownloadMenu";
import { OutcomeCard } from "@/components/runs/OutcomeCard";
import type { RunOutcome } from "@/lib/types";
import { normalizeMarkdown } from "@/lib/normalizeMarkdown";


function rerunUrl(run: { ticker: string; llm_provider: string; llm_model: string; depth: string; analysts: string[] }): string {
  const p = new URLSearchParams({
    ticker: run.ticker,
    provider: run.llm_provider,
    model: run.llm_model,
    depth: run.depth,
    analysts: run.analysts.join(","),
  });
  return `/runs/new?${p.toString()}`;
}

function LabelEditor({ id, label }: { id: string; label: string | null }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(label ?? "");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (newLabel: string) => updateRun(id, { label: newLabel || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["run", id] });
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      setEditing(false);
    },
  });

  if (editing) {
    return (
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); mutation.mutate(value); }}
      >
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Add a label…"
          className="bg-navy-900 border border-slate-600 rounded px-2 py-0.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500 w-48"
        />
        <button type="submit" disabled={mutation.isPending} className="text-xs text-blue-400 hover:text-blue-300">
          {mutation.isPending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setEditing(false)} className="text-xs text-slate-500 hover:text-slate-300">
          Cancel
        </button>
      </form>
    );
  }

  return (
    <button
      onClick={() => { setValue(label ?? ""); setEditing(true); }}
      className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 group"
      title="Click to edit label"
    >
      {label ? (
        <span className="text-slate-300">{label}</span>
      ) : (
        <span className="text-slate-600 italic">Add label…</span>
      )}
      <span className="text-slate-600 group-hover:text-slate-400 text-xs">✎</span>
    </button>
  );
}

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
          <div className="flex items-center gap-4">
            <Link href="/runs" className="text-blue-400 hover:underline text-sm">
              ← Back to History
            </Link>
            {run && <LabelEditor id={id} label={run.label} />}
          </div>
          <div className="flex items-center gap-3">
            {run && (
              <Link href={rerunUrl(run)} className="text-slate-400 hover:text-blue-400 text-sm">
                Re-run
              </Link>
            )}
            {run && (
              <Link href={`/runs/compare?a=${id}`} className="text-slate-400 hover:text-blue-400 text-sm">
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
