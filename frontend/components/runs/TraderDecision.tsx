"use client";
import type { Run, Report } from "@/lib/types";
import { Markdown } from "@/components/ui/Markdown";

interface Props {
  run: Run | undefined;
  report: Report | undefined;
}

const verdictStyles: Record<string, string> = {
  buy: "bg-green-900 text-green-300 text-2xl font-bold px-6 py-3 rounded-lg",
  sell: "bg-red-900 text-red-300 text-2xl font-bold px-6 py-3 rounded-lg",
  hold: "bg-yellow-900 text-yellow-300 text-2xl font-bold px-6 py-3 rounded-lg",
};

interface PriceLevelProps {
  label: string;
  value: string | null | undefined;
}

function PriceLevel({ label, value }: PriceLevelProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-slate-400 text-xs uppercase tracking-wider">{label}</span>
      <span className="text-slate-200 font-mono text-sm">{value ? `$${value}` : "—"}</span>
    </div>
  );
}

export function TraderDecision({ run, report }: Props) {
  const isTerminated = run?.status === "aborted" || run?.status === "failed";
  const hasPrices =
    report?.suggested_entry || report?.suggested_stop || report?.suggested_target;

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

          {hasPrices && (
            <div className="flex gap-6 border-t border-slate-700 pt-4">
              <PriceLevel label="Entry" value={report.suggested_entry} />
              <div className="w-px bg-slate-700" />
              <PriceLevel label="Stop" value={report.suggested_stop} />
              <div className="w-px bg-slate-700" />
              <PriceLevel label="Target" value={report.suggested_target} />
            </div>
          )}

          {report.trader_decision && (
            <Markdown>{report.trader_decision}</Markdown>
          )}
        </div>
      )}
    </div>
  );
}
