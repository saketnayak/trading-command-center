"use client";
import type { Report } from "@/lib/types";

interface Props {
  report: Report | undefined;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export function BullBearDebate({ report }: Props) {
  if (!report) return null;

  const bullContent = formatValue(report.raw_report?.bull_case);
  const bearContent = formatValue(report.raw_report?.bear_case);

  if (!bullContent && !bearContent) return null;

  return (
    <div className="bg-navy-700 border border-slate-800 rounded-lg p-6">
      <h2 className="text-slate-200 text-lg font-semibold mb-4">Bull / Bear Debate</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <h3 className="text-green-400 font-semibold mb-2">Bull Case</h3>
          <pre className="text-slate-300 text-xs whitespace-pre-wrap break-words">
            {bullContent || "No bull case available."}
          </pre>
        </div>
        <div>
          <h3 className="text-red-400 font-semibold mb-2">Bear Case</h3>
          <pre className="text-slate-300 text-xs whitespace-pre-wrap break-words">
            {bearContent || "No bear case available."}
          </pre>
        </div>
      </div>
    </div>
  );
}
