"use client";
import type { Run, Report } from "@/lib/types";

interface Props {
  run: Run | undefined;
  report: Report | undefined;
}

const verdictStyles: Record<string, string> = {
  buy: "bg-green-900 text-green-300 text-2xl font-bold px-6 py-3 rounded-lg",
  sell: "bg-red-900 text-red-300 text-2xl font-bold px-6 py-3 rounded-lg",
  hold: "bg-yellow-900 text-yellow-300 text-2xl font-bold px-6 py-3 rounded-lg",
};

export function TraderDecision({ run, report }: Props) {
  const isTerminated = run?.status === "aborted" || run?.status === "failed";

  return (
    <div className="bg-navy-700 border border-slate-800 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-slate-200 text-lg font-semibold">
          {run?.ticker ?? "—"}
        </h2>
        {run?.analysis_date && (
          <span className="text-slate-500 text-sm">{run.analysis_date}</span>
        )}
      </div>

      {isTerminated && !report && (
        <p className="text-slate-500 text-sm">
          This run did not complete successfully.
        </p>
      )}

      {!report && !isTerminated && (
        <p className="text-slate-500 text-sm">Results not yet available.</p>
      )}

      {report && (
        <div className="flex flex-col gap-4">
          <div>
            <span className={verdictStyles[report.verdict] ?? verdictStyles.hold}>
              {report.verdict.toUpperCase()}
            </span>
          </div>
          {report.trader_decision && (
            <p className="text-slate-300 text-sm leading-relaxed">
              {report.trader_decision}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
