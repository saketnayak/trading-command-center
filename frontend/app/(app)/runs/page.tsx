"use client";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RunFilters, dateRangeToFrom, type DateRangePreset } from "@/components/runs/RunFilters";
import { RunTable } from "@/components/runs/RunTable";
import { StatsBar } from "@/components/runs/StatsBar";
import { PageHeader, PageTitle } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { getRuns, bulkAbortRuns, bulkDeleteRuns } from "@/lib/api";
import { downloadRunsCsv } from "@/lib/export/buildCsv";
import type { Run } from "@/lib/types";

interface FilterValues {
  ticker: string;
  status: string;
  verdict: string;
  dateRange: DateRangePreset;
}

type Tab = "active" | "archived";

export default function RunsPage() {
  const [tab, setTab] = useState<Tab>("active");
  const [filters, setFilters] = useState<FilterValues>({ ticker: "", status: "", verdict: "", dateRange: "" });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const queryClient = useQueryClient();
  const router = useRouter();

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["runs", tab, filters],
    queryFn: () => {
      const dateFrom = dateRangeToFrom(filters.dateRange);
      return getRuns({
        ...(filters.ticker ? { ticker: filters.ticker } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.verdict ? { verdict: filters.verdict } : {}),
        ...(dateFrom ? { date_from: dateFrom } : {}),
        archived: tab === "archived",
      });
    },
    refetchInterval: (query) => {
      const runs = query.state.data ?? [];
      const hasActive = runs.some((r) => r.status === "running" || r.status === "pending");
      return hasActive ? 5_000 : 60_000;
    },
  });

  // Update lastUpdated timestamp whenever a fetch completes.
  useEffect(() => {
    if (!isFetching) setLastUpdated(new Date());
  }, [isFetching]);

  // Tick the "X ago" counter every second.
  useEffect(() => {
    const id = setInterval(() => {
      setSecondsAgo(lastUpdated ? Math.floor((Date.now() - lastUpdated.getTime()) / 1000) : 0);
    }, 1000);
    return () => clearInterval(id);
  }, [lastUpdated]);

  const runs: Run[] = data ?? [];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["runs"] });
  }

  function handleSelectionChange(ids: string[]) {
    setSelectedIds(ids);
    setConfirmBulkDelete(false);
  }

  const abortMutation = useMutation({
    mutationFn: () => bulkAbortRuns(selectedIds),
    onSuccess: () => { setSelectedIds([]); invalidate(); },
  });

  const deleteMutation = useMutation({
    mutationFn: () => bulkDeleteRuns(selectedIds),
    onSuccess: () => { setSelectedIds([]); setConfirmBulkDelete(false); invalidate(); },
  });

  const selectedRuns = runs.filter((r) => selectedIds.includes(r.id));
  const abortableCount = selectedRuns.filter((r) => r.status === "running" || r.status === "pending").length;
  const deletableCount = selectedRuns.filter((r) => r.status !== "running").length;
  const canCompare = selectedIds.length === 2 && selectedRuns.every((r) => r.status === "completed");

  return (
    <PageShell>
        <PageHeader
          className="mb-4"
          leading={<PageTitle className="text-fg text-lg font-semibold">Run History</PageTitle>}
          trailing={
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {lastUpdated && (
              <span className="text-muted text-xs">
                Updated {secondsAgo < 5 ? "just now" : `${secondsAgo}s ago`}
              </span>
            )}
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              title="Refresh"
              className="text-muted hover:text-fg disabled:opacity-40 transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`}
              >
                <path fillRule="evenodd" d="M13.836 2.477a.75.75 0 0 1 .75.75v3.182a.75.75 0 0 1-.75.75h-3.182a.75.75 0 0 1 0-1.5h1.37l-.84-.841a4.5 4.5 0 0 0-7.08.932.75.75 0 0 1-1.3-.75 6 6 0 0 1 9.44-1.242l.842.84V3.227a.75.75 0 0 1 .75-.75Zm-.911 7.5A.75.75 0 0 1 13.199 11a6 6 0 0 1-9.44 1.241l-.84-.84v1.371a.75.75 0 0 1-1.5 0V9.591a.75.75 0 0 1 .75-.75H5.35a.75.75 0 0 1 0 1.5H3.98l.841.841a4.5 4.5 0 0 0 7.08-.932.75.75 0 0 1 1.025-.273Z" clipRule="evenodd" />
              </svg>
            </button>
            <button
              onClick={() => downloadRunsCsv(runs)}
              disabled={runs.length === 0}
              title="Export current view to CSV"
              className="text-muted hover:text-fg disabled:opacity-40 text-xs border border-input-border rounded px-2 py-1.5"
            >
              Export CSV
            </button>
            <Link
              href="/runs/new"
              className="bg-blue-600 hover:bg-blue-700 text-fg rounded-sm px-3 py-1.5 text-sm"
            >
              New Run
            </Link>
          </div>
          }
        />

        <div className="flex gap-1 border-b border-border mb-4">
          {(["active", "archived"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={
                tab === t
                  ? "px-4 py-2 text-sm border-b-2 border-blue-400 text-blue-400 capitalize"
                  : "px-4 py-2 text-sm text-muted hover:text-fg-secondary capitalize border-b-2 border-transparent"
              }
            >
              {t}
            </button>
          ))}
        </div>

        <StatsBar />
        <RunFilters value={filters} onChange={setFilters} />

        {selectedIds.length > 0 && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between bg-input/80 border border-input-border rounded-lg px-4 py-2.5 mb-1">
            <span className="text-sm text-fg-secondary">
              {selectedIds.length} {selectedIds.length === 1 ? "run" : "runs"} selected
            </span>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <button
                onClick={() => { setSelectedIds([]); setConfirmBulkDelete(false); }}
                className="text-xs text-muted hover:text-fg"
              >
                Clear
              </button>

              {abortableCount > 0 && (
                <button
                  onClick={() => abortMutation.mutate()}
                  disabled={abortMutation.isPending}
                  className="text-xs text-yellow-400 hover:text-yellow-300 disabled:opacity-40"
                >
                  {abortMutation.isPending ? "Aborting…" : `Abort ${abortableCount} running`}
                </button>
              )}

              {deletableCount > 0 && (
                confirmBulkDelete ? (
                  <span className="flex items-center gap-2">
                    <button
                      onClick={() => deleteMutation.mutate()}
                      disabled={deleteMutation.isPending}
                      className="text-xs text-red-400 hover:text-red-300 disabled:opacity-40"
                    >
                      {deleteMutation.isPending ? "Deleting…" : `Confirm delete ${deletableCount}`}
                    </button>
                    <button
                      onClick={() => setConfirmBulkDelete(false)}
                      className="text-xs text-muted hover:text-fg-secondary"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmBulkDelete(true)}
                    className="text-xs text-muted hover:text-red-400"
                  >
                    Delete {deletableCount}
                  </button>
                )
              )}

              {canCompare && (
                <button
                  onClick={() => router.push(`/runs/compare?a=${selectedIds[0]}&b=${selectedIds[1]}`)}
                  className="bg-blue-600 hover:bg-blue-700 text-fg text-xs px-3 py-1.5 rounded-sm"
                >
                  Compare 2 runs →
                </button>
              )}
            </div>
          </div>
        )}

        {isLoading && <p className="text-muted text-sm">Loading…</p>}
        {isError && <p className="text-red-400 text-sm">Failed to load runs.</p>}
        {!isLoading && !isError && (
          <RunTable
            runs={runs}
            archived={tab === "archived"}
            onMutate={invalidate}
            selectedIds={selectedIds}
            onSelectionChange={handleSelectionChange}
          />
        )}
      </PageShell>
  );
}
