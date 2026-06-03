"use client";
import { useState } from "react";
import type { Report } from "@/lib/types";
import { getAnalystReportContent } from "@/lib/analystReports";
import { Markdown } from "@/components/ui/Markdown";
import { AnalystIconBadge } from "@/components/runs/RunContextIcons";

interface Props {
  report: Report | undefined;
  analysts: string[];
}

export function AnalystReports({ report, analysts }: Props) {
  const [activeTab, setActiveTab] = useState(analysts[0] ?? "");

  if (!report) {
    return (
      <div className="bg-surface border border-border rounded-lg p-6">
        <h2 className="text-fg text-lg font-semibold mb-4">Analyst Reports</h2>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-4 bg-input rounded-sm animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const activeAnalyst = activeTab || analysts[0] || "";
  const display = getAnalystReportContent(report.raw_report, activeAnalyst) || null;

  return (
    <div className="bg-surface border border-border rounded-lg p-6">
      <h2 className="text-fg text-lg font-semibold mb-4">Analyst Reports</h2>
      <div className="flex gap-1 border-b border-border mb-4 overflow-x-auto">
        {analysts.map((analyst) => (
          <button
            key={analyst}
            onClick={() => setActiveTab(analyst)}
            className={
              (activeTab || analysts[0]) === analyst
                ? "px-3 py-2 text-sm border-b-2 border-blue-400 text-blue-400 whitespace-nowrap capitalize"
                : "px-3 py-2 text-sm text-muted hover:text-fg-secondary whitespace-nowrap border-b-2 border-transparent capitalize"
            }
          >
            <span className="inline-flex items-center gap-1.5">
              <AnalystIconBadge analyst={analyst} />
              <span>{analyst}</span>
            </span>
          </button>
        ))}
      </div>
      {display ? (
        <Markdown>{display}</Markdown>
      ) : (
        <p className="text-muted text-sm">No report available.</p>
      )}
    </div>
  );
}
