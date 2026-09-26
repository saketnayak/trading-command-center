"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getJevCalibration } from "@/lib/api";
import { FIELD_INPUT_SM_CLASS } from "@/lib/uiClasses";

/** Does 80% mean 80%? Brier score and reliability of Jev's up/down calls. */
export function CalibrationPanel({ sessionId, tickCount }: { sessionId: string; tickCount: number }) {
  const [horizon, setHorizon] = useState(5);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["jev-calibration", sessionId, horizon, Math.floor(tickCount / 25)],
    queryFn: () => getJevCalibration(sessionId, horizon),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-2 text-fg-secondary">
          Outcome checked
          <select
            value={horizon}
            onChange={(e) => setHorizon(Number(e.target.value))}
            className={FIELD_INPUT_SM_CLASS.replace("w-full", "w-auto")}
          >
            {[1, 5, 10, 30].map((h) => (
              <option key={h} value={h}>
                {h} tick{h > 1 ? "s" : ""} later
              </option>
            ))}
          </select>
        </label>
        {data && (
          <span className="text-muted">
            {data.n} scored call{data.n === 1 ? "" : "s"} · Brier{" "}
            <span className="font-mono text-fg">{data.brier != null ? data.brier.toFixed(4) : "—"}</span> (0 perfect, 0.25 coin flip)
          </span>
        )}
      </div>
      {isLoading && <p className="text-xs text-muted">Loading…</p>}
      {isError && <p className="text-xs text-red-500">Could not load calibration.</p>}
      {data && data.n === 0 && <p className="text-xs text-muted">No up/down calls with an outcome yet. Neutral calls are not scored.</p>}
      {data && data.n > 0 && (
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="px-2 py-1 font-medium">Stated confidence</th>
              <th className="px-2 py-1 text-right font-medium">Calls</th>
              <th className="px-2 py-1 text-right font-medium">Mean stated</th>
              <th className="px-2 py-1 font-medium">Hit rate</th>
            </tr>
          </thead>
          <tbody>
            {data.bins
              .filter((b) => b.n > 0)
              .map((b) => (
                <tr key={b.bin} className="border-b border-border last:border-0">
                  <td className="px-2 py-1 font-mono text-fg-secondary">{b.bin}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{b.n}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{b.mean_predicted?.toFixed(2)}</td>
                  <td className="px-2 py-1">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 rounded-full bg-elevated" aria-hidden>
                        <div className="h-full rounded-full bg-blue-500" style={{ width: `${(b.empirical ?? 0) * 100}%` }} />
                      </div>
                      <span className="tabular-nums">{b.empirical?.toFixed(2)}</span>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
