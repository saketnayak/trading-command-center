"use client";

import { useMemo, useState } from "react";
import type { TrimSignalEntry } from "@/lib/types";

interface Props {
  entries: TrimSignalEntry[];
  computedAt?: string;
}

function levelStyle(level: TrimSignalEntry["level"]) {
  switch (level) {
    case "strong_trim":
      return { label: "● Strong Trim", cls: "text-red-400 bg-red-900/30" };
    case "consider_trim":
      return { label: "● Trim", cls: "text-orange-400 bg-orange-900/30" };
    case "watch":
      return { label: "● Watch", cls: "text-yellow-400 bg-yellow-900/30" };
    default:
      return { label: "—", cls: "text-slate-500" };
  }
}

function regimeStyle(regime: TrimSignalEntry["regime"]) {
  switch (regime) {
    case "Bull":
      return "text-green-400";
    case "Sideways":
      return "text-yellow-400";
    case "Bear":
      return "text-red-400";
    default:
      return "text-slate-500";
  }
}

function relativeTime(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, Math.round((now - then) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

export function SellCandidatesPanel({ entries, computedAt }: Props) {
  const flagged = useMemo(
    () => entries.filter((e) => e.level !== "none"),
    [entries]
  );
  const strongCount = flagged.filter((e) => e.level === "strong_trim").length;
  const considerCount = flagged.filter((e) => e.level === "consider_trim").length;
  const watchCount = flagged.filter((e) => e.level === "watch").length;
  const [expanded, setExpanded] = useState(strongCount > 0);

  if (flagged.length === 0) return null;

  return (
    <section className="mb-4 rounded-lg border border-slate-700 bg-slate-900/50">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-slate-800/50"
      >
        <span className="font-medium text-slate-200">
          {expanded ? "▾" : "▸"} Sell Candidates · {flagged.length} flagged
          {strongCount > 0 && (
            <span className="ml-2 text-red-400">({strongCount} strong)</span>
          )}
        </span>
        <span className="text-xs text-slate-500">
          {computedAt ? `evaluated ${relativeTime(computedAt)}` : ""}
        </span>
      </button>
      {expanded && (
        <div className="px-4 pb-3">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 uppercase">
              <tr>
                <th className="text-left py-1">Ticker</th>
                <th className="text-right py-1">Gain</th>
                <th className="text-left py-1">Verdict</th>
                <th className="text-left py-1">Regime</th>
                <th className="text-left py-1">Trim</th>
                <th className="text-left py-1">Top reason</th>
              </tr>
            </thead>
            <tbody>
              {flagged.map((e) => {
                const lvl = levelStyle(e.level);
                return (
                  <tr key={e.holding_id} className="border-t border-slate-800">
                    <td className="py-2 font-medium text-slate-200">{e.ticker}</td>
                    <td
                      className={`py-2 text-right ${
                        e.unrealized_pnl_pct !== null && e.unrealized_pnl_pct >= 0
                          ? "text-green-400"
                          : e.unrealized_pnl_pct !== null
                          ? "text-red-400"
                          : "text-slate-500"
                      }`}
                    >
                      {e.unrealized_pnl_pct !== null
                        ? `${e.unrealized_pnl_pct >= 0 ? "+" : ""}${e.unrealized_pnl_pct.toFixed(0)}%`
                        : "—"}
                    </td>
                    <td className="py-2 text-slate-300">{e.current_verdict ?? "—"}</td>
                    <td className={`py-2 ${regimeStyle(e.regime)}`}>
                      {e.regime ?? "—"}
                      {e.regime_signal !== null && e.regime !== null && (
                        <span className="ml-1 text-xs text-slate-500">
                          {e.regime_signal >= 0 ? "+" : ""}
                          {e.regime_signal.toFixed(2)}
                        </span>
                      )}
                    </td>
                    <td className="py-2">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${lvl.cls}`}
                        title={e.reasons.join("\n")}
                      >
                        {lvl.label}
                      </span>
                    </td>
                    <td className="py-2 text-slate-400" title={e.reasons.join("\n")}>
                      {e.reasons[0] ?? ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">
            Showing {flagged.length} of {entries.length} holdings · {strongCount} strong · {considerCount} consider · {watchCount} watch
          </p>
        </div>
      )}
    </section>
  );
}
