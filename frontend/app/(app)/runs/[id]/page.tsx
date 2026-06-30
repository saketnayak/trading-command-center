"use client";
import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAppSettings, getRun, getReport, getRunOutcome, updateRun } from "@/lib/api";
import { DownloadMenu } from "@/components/runs/DownloadMenu";
import { RunSummaryPanel } from "@/components/runs/RunSummaryPanel";
import { RunEvidenceTabs } from "@/components/runs/RunEvidenceTabs";
import { useTickerMetadata } from "@/lib/useTickerMetadata";
import type { Run } from "@/lib/types";
import { PageShell } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Breadcrumbs, HISTORY_BREADCRUMB, RESEARCH_BREADCRUMB } from "@/components/layout/Breadcrumbs";
import { TickerLabel } from "@/components/ui/TickerLabel";

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
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); mutation.mutate(value); }}
      >
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Add a label…"
          className="bg-page border border-input-border rounded-sm px-2 py-0.5 text-sm text-fg focus:outline-hidden focus:border-blue-500 w-full sm:w-48"
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
      className="flex items-center gap-1.5 text-sm text-muted hover:text-fg group text-left"
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

  const {
    data: run,
    isLoading: runLoading,
    isError: runIsError,
    error: runError,
  } = useQuery({
    queryKey: ["run", id],
    queryFn: () => getRun(id),
  });

  const {
    data: report,
    isLoading: reportLoading,
    isError: reportIsError,
    error: reportError,
  } = useQuery({
    queryKey: ["report", id],
    queryFn: () => getReport(id),
    enabled: run?.status === "completed",
    retry: false,
  });

  const { data: outcome } = useQuery({
    queryKey: ["outcome", id],
    queryFn: () => getRunOutcome(id),
    enabled: run?.status === "completed",
    retry: false,
  });

  const { data: tickerMetadata = {} } = useTickerMetadata(
    run ? [run.ticker] : [],
    { enabled: !!run }
  );

  const { data: strategySettings } = useQuery({
    queryKey: ["app-settings"],
    queryFn: getAppSettings,
    retry: false,
  });

  const strategy = {
    markovEnabled: strategySettings?.enableMarkovRegime !== false,
    kalmanEnabled: strategySettings?.enableKalmanFilter !== false,
    waveEnabled: strategySettings?.enableElliottWave !== false,
  };

  const isRunning = run?.status === "pending" || run?.status === "running";
  const metadata = run ? tickerMetadata[run.ticker.toUpperCase()] : undefined;

  if (runLoading) {
    return (
      <PageShell gap="6">
        <PageHeader back={{ href: "/runs", label: "← Back to History" }} />
        <div className="bg-surface border border-input-border rounded-lg px-4 py-6 text-sm text-muted">
          Loading run…
        </div>
      </PageShell>
    );
  }

  if (runIsError || !run) {
    return (
      <PageShell gap="6">
        <PageHeader back={{ href: "/runs", label: "← Back to History" }} />
        <div className="bg-surface border border-red-500/40 rounded-lg px-4 py-6 text-sm text-red-300">
          {runError instanceof Error ? runError.message : "Failed to load this run."}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell gap="6">
      <Breadcrumbs
        className="mb-1"
        items={[
          RESEARCH_BREADCRUMB,
          HISTORY_BREADCRUMB,
          { label: `${run.ticker} Run` },
        ]}
      />
      <PageHeader
        title={
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <TickerLabel ticker={run.ticker} metadata={metadata} logoSize="md" className="text-lg" />
            <LabelEditor id={id} label={run.label} />
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <Link href={rerunUrl(run)} className="text-muted hover:text-blue-400 text-sm">
              Re-run
            </Link>
            <Link href={`/runs/compare?a=${id}`} className="text-muted hover:text-blue-400 text-sm">
              Compare →
            </Link>
            <DownloadMenu run={run} report={report} />
          </div>
        }
      />

      {isRunning && (
        <div className="bg-surface border border-input-border rounded-lg px-4 py-3 text-sm text-fg-secondary">
          Run in progress —{" "}
          <Link href={`/runs/${id}/live`} className="text-blue-400 hover:underline">
            View live feed →
          </Link>
        </div>
      )}

      {run.status === "completed" && reportLoading && (
        <div className="bg-surface border border-input-border rounded-lg px-4 py-3 text-sm text-muted">
          Loading report…
        </div>
      )}

      {run.status === "completed" && reportIsError && (
        <div className="bg-surface border border-red-500/40 rounded-lg px-4 py-3 text-sm text-red-300">
          {reportError instanceof Error ? reportError.message : "Failed to load report."}
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-6 lg:items-start">
        <RunSummaryPanel
          runId={id}
          run={run}
          report={report}
          outcome={outcome}
          metadata={metadata}
          strategy={strategy}
        />
        <RunEvidenceTabs run={run} report={report} />
      </div>
    </PageShell>
  );
}
