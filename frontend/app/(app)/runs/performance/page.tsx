"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { TopNav } from "@/components/layout/TopNav";
import { getPerformanceStats } from "@/lib/api";
import { downloadPerformanceCsv } from "@/lib/export/buildCsv";

function AccuracyBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-500 text-sm">—</span>;
  const color = value >= 60 ? "text-green-400" : value >= 50 ? "text-amber-400" : "text-red-400";
  return <span className={`text-2xl font-bold ${color}`}>{value}%</span>;
}

export default function PerformancePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["performance"],
    queryFn: getPerformanceStats,
  });

  return (
    <div className="min-h-screen bg-navy-900">
      <TopNav />
      <main className="p-6 max-w-5xl mx-auto flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <Link href="/runs" className="text-blue-400 hover:underline text-sm">
            ← Back to History
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-white">Trade Accuracy</h1>
            <button
              onClick={() => data && downloadPerformanceCsv(data)}
              disabled={!data || data.outcomes.length === 0}
              title="Export outcomes table to CSV"
              className="text-slate-400 hover:text-slate-200 disabled:opacity-40 text-xs border border-slate-700 rounded px-2 py-1"
            >
              Export CSV
            </button>
          </div>
        </div>

        {isLoading && <div className="text-slate-400 text-sm">Loading…</div>}

        {data && (
          <>
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: "7-day accuracy", value: data.accuracy_7d },
                { label: "14-day accuracy", value: data.accuracy_14d },
                { label: "30-day accuracy", value: data.accuracy_30d },
                { label: "90-day accuracy", value: data.accuracy_90d },
              ].map(({ label, value }) => (
                <div key={label} className="bg-navy-800 border border-slate-700 rounded-xl p-5 flex flex-col gap-2">
                  <p className="text-xs text-slate-400 uppercase tracking-wide">{label}</p>
                  <AccuracyBadge value={value} />
                  <p className="text-xs text-slate-500">{data.total} total runs</p>
                </div>
              ))}
            </div>

            <div className="bg-navy-800 border border-slate-700 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-navy-900">
                  <tr>
                    {["Ticker", "Date", "Verdict", "Day 0", "+7d", "+14d", "+30d", "+90d"].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs text-slate-400 font-semibold uppercase">{h}</th>
                    ))}
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
                      if (!base || !v) return "text-slate-400";
                      const up = v > base;
                      return (o.verdict === "buy" && up) || (o.verdict === "sell" && !up)
                        ? "text-green-400"
                        : "text-red-400";
                    };
                    return (
                      <tr key={o.run_id} className="border-t border-slate-800 hover:bg-navy-700/50">
                        <td className="px-4 py-3 font-semibold text-white">
                          <Link href={`/runs/${o.run_id}`} className="hover:text-blue-400">{o.ticker}</Link>
                        </td>
                        <td className="px-4 py-3 text-slate-400">{o.analysis_date}</td>
                        <td className="px-4 py-3">
                          <span className={o.verdict === "buy" ? "text-green-400" : o.verdict === "sell" ? "text-red-400" : "text-amber-400"}>
                            {o.verdict.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-300">{base ? `$${base.toFixed(2)}` : "—"}</td>
                        {[o.price_7d, o.price_14d, o.price_30d, o.price_90d].map((v, i) => (
                          <td key={i} className={`px-4 py-3 ${color(v)}`}>{pct(v)}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {data.outcomes.length === 0 && (
                <p className="text-slate-500 text-sm text-center py-8">
                  No outcome data yet. Visit completed run pages to populate prices.
                </p>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
