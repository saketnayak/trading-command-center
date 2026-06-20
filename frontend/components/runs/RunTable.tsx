"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  Check,
  Eye,
  LoaderCircle,
  RefreshCcw,
  Trash2,
  X,
} from "lucide-react";
import { archiveRun, deleteRun } from "@/lib/api";
import { IconButton, IconLink } from "@/components/ui/IconButton";
import { TickerLabel } from "@/components/ui/TickerLabel";
import { RunContextIcons } from "@/components/runs/RunContextIcons";
import { fmtPriceString, resolveQuoteCurrency } from "@/lib/currency";
import { useTickerMetadata } from "@/lib/useTickerMetadata";
import type { Run, TickerMetadata } from "@/lib/types";

function rerunUrl(run: Run): string {
  const p = new URLSearchParams({
    ticker: run.ticker,
    provider: run.llm_provider,
    model: run.llm_model,
    depth: run.depth,
    analysts: run.analysts.join(","),
    response_language: run.response_language,
  });
  return `/runs/new?${p.toString()}`;
}

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
  pending: "bg-muted-surface text-fg-secondary",
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

function PriceSummary({ run, metadata }: { run: Run; metadata?: TickerMetadata }) {
  const { suggested_entry: entry, suggested_stop: stop, suggested_target: target } = run;
  if (!entry && !stop && !target) return <span className="text-subtle">—</span>;

  const currency = resolveQuoteCurrency(run.price_currency, metadata?.currency);
  const fmt = (v: string | null) => fmtPriceString(v, currency);
  return (
    <span
      className="font-mono text-xs text-fg-secondary"
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
  metadata,
}: {
  run: Run;
  archived: boolean;
  onMutate: () => void;
  selected?: boolean;
  onToggle?: () => void;
  metadata?: TickerMetadata;
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
    <tr className={`border-t border-border hover:bg-input/40 ${selected ? "bg-blue-950/30" : ""}`}>
      {onToggle !== undefined && (
        <td className="px-3 py-3">
          <input
            type="checkbox"
            checked={!!selected}
            onChange={onToggle}
            className="accent-blue-500 cursor-pointer"
          />
        </td>
      )}
      <td className="px-4 py-3">
        <TickerLabel ticker={run.ticker} metadata={metadata} href={`/runs/${run.id}`} />
        {run.label && <p className="text-muted text-xs mt-0.5">{run.label}</p>}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-medium ${statusBadge[run.status]}`}>
          {run.status === "running" && (
            <span className="w-1.5 h-1.5 rounded-full bg-blue-300 animate-pulse" />
          )}
          {run.status}
        </span>
      </td>
      <td className="px-4 py-3">
        {run.verdict ? (
          <span className={`rounded-sm px-2 py-0.5 text-xs font-medium ${verdictBadge[run.verdict]}`}>
            {run.verdict}
          </span>
        ) : (
          <span className="text-subtle">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <PriceSummary run={run} metadata={metadata} />
      </td>
      <td className="hidden lg:table-cell px-4 py-3 text-muted text-xs">
        <RunContextIcons analysts={run.analysts} responseLanguage={run.response_language} />
      </td>
      <td className="hidden lg:table-cell px-4 py-3 text-muted text-xs font-mono">{run.llm_model}</td>
      <td className="hidden lg:table-cell px-4 py-3 text-muted text-xs">
        {run.started_at ? new Date(run.started_at).toLocaleDateString() : "—"}
      </td>
      <td className="hidden lg:table-cell px-4 py-3 text-muted text-xs">{formatDuration(run.started_at, run.completed_at)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <IconLink
            href={`/runs/${run.id}`}
            icon={Eye}
            label={`View ${run.ticker} run`}
            title="View"
            tone="primary"
          />
          <IconLink
            href={rerunUrl(run)}
            icon={RefreshCcw}
            label={`Re-run ${run.ticker} analysis`}
            title="Re-run"
            tone="primary"
          />
          <IconButton
            icon={archiveMutation.isPending ? LoaderCircle : archived ? ArchiveRestore : Archive}
            label={archived ? `Unarchive ${run.ticker} run` : `Archive ${run.ticker} run`}
            title={isRunning ? "Cannot archive a running run" : archived ? "Unarchive" : "Archive"}
            tone="default"
            onClick={() => archiveMutation.mutate()}
            disabled={archiveMutation.isPending || isRunning}
            iconClassName={archiveMutation.isPending ? "animate-spin" : undefined}
          />
          {confirmDelete ? (
            <span className="flex items-center gap-1">
              <IconButton
                icon={deleteMutation.isPending ? LoaderCircle : Check}
                label={`Confirm deleting ${run.ticker} run`}
                title="Confirm delete"
                tone="danger"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                iconClassName={deleteMutation.isPending ? "animate-spin" : undefined}
              />
              <IconButton
                icon={X}
                label={`Cancel deleting ${run.ticker} run`}
                title="Cancel"
                tone="default"
                onClick={() => setConfirmDelete(false)}
              />
            </span>
          ) : (
            <IconButton
              icon={Trash2}
              label={`Delete ${run.ticker} run`}
              title={isRunning ? "Abort the run before deleting" : "Delete permanently"}
              tone="danger"
              onClick={() => setConfirmDelete(true)}
              disabled={isRunning}
            />
          )}
        </div>
      </td>
    </tr>
  );
}

export function RunTable({ runs, archived, onMutate, selectedIds, onSelectionChange }: RunTableProps) {
  const { data: tickerMetadata = {} } = useTickerMetadata(runs.map((run) => run.ticker));

  function toggle(id: string) {
    if (!onSelectionChange) return;
    if (selectedIds?.includes(id)) {
      onSelectionChange(selectedIds.filter((x) => x !== id));
    } else {
      onSelectionChange([...(selectedIds ?? []), id]);
    }
  }

  const showCheckboxes = !!onSelectionChange;
  const allSelected = runs.length > 0 && runs.every((r) => selectedIds?.includes(r.id));
  const someSelected = !allSelected && runs.some((r) => selectedIds?.includes(r.id));

  function toggleAll() {
    if (!onSelectionChange) return;
    if (allSelected) {
      onSelectionChange((selectedIds ?? []).filter((id) => !runs.some((r) => r.id === id)));
    } else {
      const existing = selectedIds ?? [];
      const toAdd = runs.map((r) => r.id).filter((id) => !existing.includes(id));
      onSelectionChange([...existing, ...toAdd]);
    }
  }

  return (
    <div className="overflow-x-auto rounded-sm border border-border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface text-muted text-xs uppercase tracking-wider">
          <tr>
            {showCheckboxes && (
              <th className="px-3 py-3 w-8">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={toggleAll}
                  className="accent-blue-500 cursor-pointer"
                  title="Select all visible"
                />
              </th>
            )}
            <th className="text-left px-4 py-3">Ticker</th>
            <th className="text-left px-4 py-3">Status</th>
            <th className="text-left px-4 py-3">Verdict</th>
            <th className="text-left px-4 py-3">Prices</th>
            <th className="hidden lg:table-cell text-left px-4 py-3">Analysts</th>
            <th className="hidden lg:table-cell text-left px-4 py-3">Model</th>
            <th className="hidden lg:table-cell text-left px-4 py-3">Started</th>
            <th className="hidden lg:table-cell text-left px-4 py-3">Duration</th>
            <th className="text-left px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {runs.length === 0 ? (
            <tr>
              <td colSpan={showCheckboxes ? 10 : 9} className="text-center text-muted px-4 py-8">
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
                metadata={tickerMetadata[run.ticker.toUpperCase()]}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
