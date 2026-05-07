"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { archiveRun, deleteRun } from "@/lib/api";
import type { Run } from "@/lib/types";

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt || !completedAt) return "—";
  const secs = Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

interface RunTableProps {
  runs: Run[];
  archived: boolean;
  onMutate: () => void;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
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

function PriceSummary({ run }: { run: Run }) {
  const { suggested_entry: entry, suggested_stop: stop, suggested_target: target } = run;
  if (!entry && !stop && !target) return <span className="text-slate-600">—</span>;

  const fmt = (v: string | null) => (v ? `$${v}` : "—");
  return (
    <span
      className="font-mono text-xs text-slate-300"
      title="Entry · Stop · Target"
    >
      {fmt(entry)} · {fmt(stop)} · {fmt(target)}
    </span>
  );
}

function RunRow({
  run,
  archived,
  onMutate,
  selected,
  onToggle,
  selectable,
}: {
  run: Run;
  archived: boolean;
  onMutate: () => void;
  selected?: boolean;
  onToggle?: () => void;
  selectable?: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const archiveMutation = useMutation({
    mutationFn: () => archiveRun(run.id),
    onSuccess: onMutate,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteRun(run.id),
    onSuccess: onMutate,
  });

  const isRunning = run.status === "running";

  return (
    <tr className={`border-t border-slate-800 hover:bg-slate-800/40 ${selected ? "bg-blue-950/30" : ""}`}>
      {onToggle !== undefined && (
        <td className="px-3 py-3">
          <input
            type="checkbox"
            checked={!!selected}
            onChange={onToggle}
            disabled={!selectable && !selected}
            className="accent-blue-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-30"
            title={!selectable && !selected ? "Only completed runs can be compared" : ""}
          />
        </td>
      )}
      <td className="px-4 py-3">
        <span className="text-slate-200 font-mono">{run.ticker}</span>
        {run.label && <p className="text-slate-500 text-xs mt-0.5">{run.label}</p>}
      </td>
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
      <td className="px-4 py-3">
        <PriceSummary run={run} />
      </td>
      <td className="px-4 py-3 text-slate-400 text-xs">{run.analysts.join(", ")}</td>
      <td className="px-4 py-3 text-slate-400 text-xs font-mono">{run.llm_model}</td>
      <td className="px-4 py-3 text-slate-400 text-xs">
        {run.started_at ? new Date(run.started_at).toLocaleDateString() : "—"}
      </td>
      <td className="px-4 py-3 text-slate-400 text-xs">{formatDuration(run.started_at, run.completed_at)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href={`/runs/${run.id}`} className="text-blue-400 hover:underline text-xs">
            View
          </Link>
          <button
            onClick={() => archiveMutation.mutate()}
            disabled={archiveMutation.isPending || isRunning}
            className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
            title={isRunning ? "Cannot archive a running run" : archived ? "Unarchive" : "Archive"}
          >
            {archiveMutation.isPending ? "…" : archived ? "Unarchive" : "Archive"}
          </button>
          {confirmDelete ? (
            <span className="flex items-center gap-1">
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="text-xs text-red-400 hover:text-red-300 disabled:opacity-40"
              >
                {deleteMutation.isPending ? "…" : "Confirm"}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-xs text-slate-500 hover:text-slate-300"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={isRunning}
              className="text-xs text-slate-500 hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed"
              title={isRunning ? "Abort the run before deleting" : "Delete permanently"}
            >
              Delete
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export function RunTable({ runs, archived, onMutate, selectedIds, onSelectionChange }: RunTableProps) {
  function toggle(id: string) {
    if (!onSelectionChange) return;
    if (selectedIds?.includes(id)) {
      onSelectionChange(selectedIds.filter((x) => x !== id));
    } else {
      const next = [...(selectedIds ?? []), id];
      // keep only the two most-recently selected
      onSelectionChange(next.length > 2 ? next.slice(next.length - 2) : next);
    }
  }

  const showCheckboxes = !!onSelectionChange;

  return (
    <div className="overflow-x-auto rounded border border-slate-800">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-navy-700 text-slate-400 text-xs uppercase tracking-wider">
          <tr>
            {showCheckboxes && <th className="px-3 py-3 w-8" />}
            <th className="text-left px-4 py-3">Ticker</th>
            <th className="text-left px-4 py-3">Status</th>
            <th className="text-left px-4 py-3">Verdict</th>
            <th className="text-left px-4 py-3">Prices</th>
            <th className="text-left px-4 py-3">Analysts</th>
            <th className="text-left px-4 py-3">Model</th>
            <th className="text-left px-4 py-3">Started</th>
            <th className="text-left px-4 py-3">Duration</th>
            <th className="text-left px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {runs.length === 0 ? (
            <tr>
              <td colSpan={showCheckboxes ? 10 : 9} className="text-center text-slate-500 px-4 py-8">
                {archived ? "No archived runs." : "No runs yet."}
              </td>
            </tr>
          ) : (
            runs.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                archived={archived}
                onMutate={onMutate}
                selected={selectedIds?.includes(run.id)}
                onToggle={showCheckboxes ? () => toggle(run.id) : undefined}
                selectable={run.status === "completed"}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
