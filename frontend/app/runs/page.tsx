"use client";
import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TopNav } from "@/components/layout/TopNav";
import { RunFilters } from "@/components/runs/RunFilters";
import { RunTable } from "@/components/runs/RunTable";
import { StatsBar } from "@/components/runs/StatsBar";
import { getRuns, bulkAbortRuns, bulkDeleteRuns } from "@/lib/api";
import type { Run } from "@/lib/types";

interface FilterValues {
  ticker: string;
  status: string;
  verdict: string;
}

type Tab = "active" | "archived";

export default function RunsPage() {
  const [tab, setTab] = useState<Tab>("active");
  const [filters, setFilters] = useState<FilterValues>({ ticker: "", status: "", verdict: "" });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const queryClient = useQueryClient();
  const router = useRouter();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["runs", tab, filters],
    queryFn: () =>
      getRuns({
        ...(filters.ticker ? { ticker: filters.ticker } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.verdict ? { verdict: filters.verdict } : {}),
        archived: tab === "archived",
      }),
  });

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
    <>
      <TopNav />
      <main className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-slate-200 text-lg font-semibold">Run History</h1>
          <Link
            href="/runs/new"
            className="bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-1.5 text-sm"
          >
            New Run
          </Link>
        </div>

        <div className="flex gap-1 border-b border-slate-800 mb-4">
          {(["active", "archived"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={
                tab === t
                  ? "px-4 py-2 text-sm border-b-2 border-blue-400 text-blue-400 capitalize"
                  : "px-4 py-2 text-sm text-slate-500 hover:text-slate-300 capitalize border-b-2 border-transparent"
              }
            >
              {t}
            </button>
          ))}
        </div>

        <StatsBar />
        <RunFilters value={filters} onChange={setFilters} />

        {selectedIds.length > 0 && (
          <div className="flex items-center justify-between bg-slate-800/80 border border-slate-700 rounded-lg px-4 py-2.5 mb-1">
            <span className="text-sm text-slate-300">
              {selectedIds.length} {selectedIds.length === 1 ? "run" : "runs"} selected
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => { setSelectedIds([]); setConfirmBulkDelete(false); }}
                className="text-xs text-slate-400 hover:text-slate-200"
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
                      className="text-xs text-slate-500 hover:text-slate-300"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmBulkDelete(true)}
                    className="text-xs text-slate-400 hover:text-red-400"
                  >
                    Delete {deletableCount}
                  </button>
                )
              )}

              {canCompare && (
                <button
                  onClick={() => router.push(`/runs/compare?a=${selectedIds[0]}&b=${selectedIds[1]}`)}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1.5 rounded"
                >
                  Compare 2 runs →
                </button>
              )}
            </div>
          </div>
        )}

        {isLoading && <p className="text-slate-500 text-sm">Loading…</p>}
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
      </main>
    </>
  );
}
