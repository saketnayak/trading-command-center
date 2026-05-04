"use client";
import { useState } from "react";
import type { Report } from "@/lib/types";

interface Props {
  report: Report | undefined;
  analysts: string[];
}

export function AnalystReports({ report, analysts }: Props) {
  const [activeTab, setActiveTab] = useState(analysts[0] ?? "");

  if (!report) {
    return (
      <div className="bg-navy-700 border border-slate-800 rounded-lg p-6">
        <h2 className="text-slate-200 text-lg font-semibold mb-4">Analyst Reports</h2>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-4 bg-slate-800 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const activeAnalyst = activeTab || analysts[0] || "";
  const content = report.raw_report?.[activeAnalyst];
  const display =
    content === undefined || content === null
      ? "No report available."
      : typeof content === "string"
      ? content
      : JSON.stringify(content, null, 2);

  return (
    <div className="bg-navy-700 border border-slate-800 rounded-lg p-6">
      <h2 className="text-slate-200 text-lg font-semibold mb-4">Analyst Reports</h2>
      <div className="flex gap-1 border-b border-slate-800 mb-4 overflow-x-auto">
        {analysts.map((analyst) => (
          <button
            key={analyst}
            onClick={() => setActiveTab(analyst)}
            className={
              (activeTab || analysts[0]) === analyst
                ? "px-3 py-2 text-sm border-b-2 border-blue-400 text-blue-400 whitespace-nowrap"
                : "px-3 py-2 text-sm text-slate-500 hover:text-slate-300 whitespace-nowrap border-b-2 border-transparent"
            }
          >
            {analyst}
          </button>
        ))}
      </div>
      <pre className="text-slate-300 text-xs whitespace-pre-wrap break-words">
        {display}
      </pre>
    </div>
  );
}
