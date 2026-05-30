"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getPerformanceStats } from "@/lib/api";
import { downloadPerformanceCsv } from "@/lib/export/buildCsv";

function AccuracyBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted text-sm">—</span>;
  const color = value >= 60 ? "text-green-400" : value >= 50 ? "text-amber-400" : "text-red-400";
  return <span className={`text-2xl font-bold ${color}`}>{value}%</span>;
}

export default function PerformancePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["performance"],
    queryFn: getPerformanceStats,
  });

  return (
    <main className="px-4 py-4 sm:p-6 max-w-5xl mx-auto flex flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/runs" className="text-blue-400 hover:underline text-sm">
            ← Back to History
          </Link>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h1 className="text-lg font-semibold text-fg">Trade Accuracy</h1>
            <button
              onClick={() => data && downloadPerformanceCsv(data)}
              disabled={!data || data.outcomes.length === 0}
              title="Export outcomes table to CSV"
              className="text-muted hover:text-fg disabled:opacity-40 text-xs border border-input-border rounded px-2 py-1"
            >
              Export CSV
            </button>
          </div>
        </div>

        {isLoading && <div className="text-muted text-sm">Loading…</div>}

        {data && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: "7-day accuracy", value: data.accuracy_7d },
                { label: "14-day accuracy", value: data.accuracy_14d },
                { label: "30-day accuracy", value: data.accuracy_30d },
                { label: "90-day accuracy", value: data.accuracy_90d },
              ].map(({ label, value }) => (
                <div key={label} className="bg-elevated border border-input-border rounded-xl p-5 flex flex-col gap-2">
                  <p className="text-xs text-muted uppercase tracking-wide">{label}</p>
                  <AccuracyBadge value={value} />
                  <p className="text-xs text-muted">{data.total} total runs</p>
                </div>
              ))}
            </div>

            <div className="bg-elevated border border-input-border rounded-xl overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-page">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs text-muted font-semibold uppercase">Ticker</th>
                    <th className="px-4 py-3 text-left text-xs text-muted font-semibold uppercase">Date</th>
                    <th className="px-4 py-3 text-left text-xs text-muted font-semibold uppercase">Verdict</th>
                    <th className="px-4 py-3 text-left text-xs text-muted font-semibold uppercase">Day 0</th>
                    <th className="px-4 py-3 text-left text-xs text-muted font-semibold uppercase">+7d</th>
                    <th className="hidden lg:table-cell px-4 py-3 text-left text-xs text-muted font-semibold uppercase">+14d</th>
                    <th className="hidden lg:table-cell px-4 py-3 text-left text-xs text-muted font-semibold uppercase">+30d</th>
                    <th className="hidden lg:table-cell px-4 py-3 text-left text-xs text-muted font-semibold uppercase">+90d</th>
                  </tr>
                </thead>
                <tbody>
                  {data.outcomes.map((o) => {
                    const base = o.price_at_analysis;
                    const pct = (v: number | null) => {
                      if (!base || !v) return "—";
                      const p = ((v - base) / base) * 100;
                      return (p >= 0 ? "+" : "") + p.toFixed(1) + "%";
                    };
                    const color = (v: number | null) => {
                      if (!base || !v) return "text-muted";
                      const up = v > base;
                      return (o.verdict === "buy" && up) || (o.verdict === "sell" && !up)
                        ? "text-green-400"
                        : "text-red-400";
                    };
                    return (
                      <tr key={o.run_id} className="border-t border-border hover:bg-muted-surface/50">
                        <td className="px-4 py-3 font-semibold text-fg">
                          <Link href={`/runs/${o.run_id}`} className="hover:text-blue-400">{o.ticker}</Link>
                        </td>
                        <td className="px-4 py-3 text-muted">{o.analysis_date}</td>
                        <td className="px-4 py-3">
                          <span className={o.verdict === "buy" ? "text-green-400" : o.verdict === "sell" ? "text-red-400" : "text-amber-400"}>
                            {o.verdict.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-fg-secondary">{base ? `$${base.toFixed(2)}` : "—"}</td>
                        {[o.price_7d, o.price_14d, o.price_30d, o.price_90d].map((v, i) => (
                          <td key={i} className={`${i > 0 ? "hidden lg:table-cell " : ""}px-4 py-3 ${color(v)}`}>{pct(v)}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {data.outcomes.length === 0 && (
                <p className="text-muted text-sm text-center py-8">
                  No outcome data yet. Visit completed run pages to populate prices.
                </p>
              )}
            </div>
          </>
        )}
      </main>
  );
}
