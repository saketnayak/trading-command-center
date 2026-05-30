"use client";
import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TraderDecision } from "@/components/runs/TraderDecision";
import { AnalystReports } from "@/components/runs/AnalystReports";
import { BullBearDebate } from "@/components/runs/BullBearDebate";
import { getRun, getReport, getRunOutcome, updateRun } from "@/lib/api";
import { DownloadMenu } from "@/components/runs/DownloadMenu";
import { OutcomeCard } from "@/components/runs/OutcomeCard";
import { MarkovConfirmation } from "@/components/runs/MarkovConfirmation";
import type { RunOutcome } from "@/lib/types";

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

function NotesEditor({ id, notes }: { id: string; notes: string | null }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(notes ?? "");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (next: string) => updateRun(id, { notes: next || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["run", id] });
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      setEditing(false);
    },
  });

  if (editing) {
    return (
      <div className="bg-elevated border border-input-border rounded-lg p-4 flex flex-col gap-2">
        <label className="text-xs text-muted uppercase tracking-wide">Notes</label>
        <textarea
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="What did you decide? Did you take the trade? Any context worth keeping…"
          rows={4}
          className="bg-page border border-input-border rounded px-3 py-2 text-sm text-fg focus:outline-none focus:border-blue-500 resize-y"
        />
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <button
            onClick={() => mutation.mutate(value)}
            disabled={mutation.isPending}
            className="bg-blue-600 hover:bg-blue-700 text-fg text-xs rounded px-3 py-1.5 disabled:opacity-50"
          >
            {mutation.isPending ? "Saving…" : "Save"}
          </button>
          <button
            onClick={() => { setValue(notes ?? ""); setEditing(false); }}
            className="text-xs text-muted hover:text-fg-secondary"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-elevated border border-input-border rounded-lg p-4 flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted uppercase tracking-wide mb-1">Notes</p>
        {notes ? (
          <p className="text-sm text-fg whitespace-pre-wrap wrap-break-word">{notes}</p>
        ) : (
          <p className="text-sm text-subtle italic">No notes yet — capture your decision or context.</p>
        )}
      </div>
      <button
        onClick={() => { setValue(notes ?? ""); setEditing(true); }}
        className="text-xs text-muted hover:text-blue-400 shrink-0"
      >
        {notes ? "Edit" : "Add"}
      </button>
    </div>
  );
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
          className="bg-page border border-input-border rounded-sm px-2 py-0.5 text-sm text-fg focus:outline-hidden focus:border-blue-500 w-48"
        />
        <button type="submit" disabled={mutation.isPending} className="text-xs text-blue-400 hover:text-blue-300">
          {mutation.isPending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setEditing(false)} className="text-xs text-muted hover:text-fg-secondary">
          Cancel
        </button>
      </form>
    );
  }

  return (
    <button
      onClick={() => { setValue(label ?? ""); setEditing(true); }}
      className="flex items-center gap-1.5 text-sm text-muted hover:text-fg group"
      title="Click to edit label"
    >
      {label ? (
        <span className="text-fg-secondary">{label}</span>
      ) : (
        <span className="text-subtle italic">Add label…</span>
      )}
      <span className="text-subtle group-hover:text-muted text-xs">✎</span>
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
    <main className="px-4 py-4 sm:p-6 max-w-5xl mx-auto flex flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <Link href="/runs" className="text-blue-400 hover:underline text-sm">
              ← Back to History
            </Link>
            {run && <LabelEditor id={id} label={run.label} />}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {run && (
              <Link href={rerunUrl(run)} className="text-muted hover:text-blue-400 text-sm">
                Re-run
              </Link>
            )}
            {run && (
              <Link href={`/runs/compare?a=${id}`} className="text-muted hover:text-blue-400 text-sm">
                Compare →
              </Link>
            )}
            <DownloadMenu run={run} report={report} />
          </div>
        </div>

        {isRunning && (
          <div className="bg-surface border border-input-border rounded-lg px-4 py-3 text-sm text-fg-secondary">
            Run in progress —{" "}
            <Link href={`/runs/${id}/live`} className="text-blue-400 hover:underline">
              View live feed →
            </Link>
          </div>
        )}

        <TraderDecision run={run} report={report} />
        {run && <MarkovConfirmation ticker={run.ticker} verdict={run.verdict} />}
        {outcome && <OutcomeCard outcome={outcome} />}
        {run && <NotesEditor id={id} notes={run.notes} />}
        <AnalystReports report={report} analysts={run?.analysts ?? []} />
        <BullBearDebate report={report} />
      </main>
  );
}
