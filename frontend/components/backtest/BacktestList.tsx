"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { listBacktests } from "@/lib/api";
import { ACTIVE_STATUSES, STATUS_LABELS, type BacktestSummary } from "@/lib/backtest";
import { fmtPct, fmtSignedPct, returnTone } from "@/lib/performance";

const CARD = "rounded-lg border border-border bg-surface p-4";

export function StatusBadge({ status }: { status: BacktestSummary["status"] }) {
  const tone = status === "completed" ? "border-emerald-600/40 text-emerald-600 dark:text-emerald-400"
    : status === "failed" ? "border-red-600/40 text-red-600 dark:text-red-400"
      : ACTIVE_STATUSES.includes(status) ? "border-blue-600/40 text-blue-600 dark:text-blue-400"
        : "border-amber-600/40 text-amber-700 dark:text-amber-400";
  return <span className={`rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>{STATUS_LABELS[status]}</span>;
}

export function BacktestList() {
  const q = useQuery({
    queryKey: ["backtests"],
    queryFn: listBacktests,
    refetchInterval: (query) => (query.state.data?.some((b) => ACTIVE_STATUSES.includes(b.status)) ? 3000 : false),
  });
  return (
    <section className={CARD} aria-labelledby="bt-list-heading">
      <h2 id="bt-list-heading" className="mb-3 text-sm font-semibold text-fg">Your backtests</h2>
      {q.isPending && <p className="text-sm text-muted">Loading…</p>}
      {q.isError && <p className="text-sm text-red-500" role="alert">{(q.error as Error).message}</p>}
      {q.data && q.data.length === 0 && (
        <p className="text-sm text-muted">None yet. Start with a dry run: it checks the dates and scoring for free.</p>
      )}
      <ul className="divide-y divide-border/60">
        {q.data?.map((b) => (
          <li key={b.id} className="py-2.5">
            <Link href={`/runs/backtest/${b.id}`} className="group block">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-fg group-hover:text-blue-500">{b.name}</span>
                <StatusBadge status={b.status} />
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                <span>{b.config.llm_provider} · {b.config.llm_model}{b.config.dry_run ? " · dry run" : ""}</span>
                <span>{b.done}/{b.total_decisions} decisions</span>
                {b.cost_usd > 0 && <span>${b.cost_usd.toFixed(2)}</span>}
                {b.headline && (
                  <span>
                    <span className={returnTone(b.headline.total_return)}>{fmtSignedPct(b.headline.total_return, 1)}</span>
                    {" "}· hit {fmtPct(b.headline.hit_rate, 0)}
                    {b.headline_basis === "out_of_sample" ? " · out of sample" : b.headline_basis === "all" ? " · cutoff unknown" : ""}
                  </span>
                )}
                {b.headline_basis === "none" && <span className="text-amber-600 dark:text-amber-400">no out-of-sample decisions</span>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
