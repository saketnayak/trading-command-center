"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { TopNav } from "@/components/layout/TopNav";
import { RunFilters } from "@/components/runs/RunFilters";
import { RunTable } from "@/components/runs/RunTable";
import { getRuns } from "@/lib/api";
import type { Run } from "@/lib/types";

interface FilterValues {
  ticker: string;
  status: string;
}

export default function RunsPage() {
  const [filters, setFilters] = useState<FilterValues>({ ticker: "", status: "" });

  const { data, isLoading, isError } = useQuery({
    queryKey: ["runs", filters],
    queryFn: () => getRuns(filters.ticker ? { ticker: filters.ticker } : undefined),
  });

  const runs: Run[] = data
    ? filters.status
      ? data.filter((r) => r.status === filters.status)
      : data
    : [];

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
        <RunFilters value={filters} onChange={setFilters} />
        {isLoading && <p className="text-slate-500 text-sm">Loading…</p>}
        {isError && <p className="text-red-400 text-sm">Failed to load runs.</p>}
        {!isLoading && !isError && <RunTable runs={runs} />}
      </main>
    </>
  );
}
