"use client";
import { useState } from "react";
import type { Report } from "@/lib/types";
import { getAnalystReportContent } from "@/lib/analystReports";
import { Markdown } from "@/components/ui/Markdown";
import { AnalystIconBadge } from "@/components/runs/RunContextIcons";
import { ANALYST_TAB_ACTIVE_CLASS } from "@/lib/uiClasses";

interface Props {
  report: Report | undefined;
  analysts: string[];
  embedded?: boolean;
}

export function AnalystReports({ report, analysts, embedded = false }: Props) {
  const [activeTab, setActiveTab] = useState(analysts[0] ?? "");

  if (!report) {
    const loading = (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-4 bg-input rounded-sm animate-pulse" />
        ))}
      </div>
    );
    if (embedded) return loading;
    return (
      <div className="bg-surface border border-border rounded-lg p-6">
        <h2 className="text-fg text-sm font-medium mb-4">Analyst Reports</h2>
        {loading}
      </div>
    );
  }

  const activeAnalyst = activeTab || analysts[0] || "";
  const display = getAnalystReportContent(report.raw_report, activeAnalyst) || null;

  const content = (
    <>
      <div className="flex gap-1 border-b border-border mb-4 overflow-x-auto">
        {analysts.map((analyst) => (
          <button
            key={analyst}
            onClick={() => setActiveTab(analyst)}
            className={
              (activeTab || analysts[0]) === analyst
                ? `px-3 py-2 text-sm whitespace-nowrap capitalize ${ANALYST_TAB_ACTIVE_CLASS}`
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
    </>
  );

  if (embedded) return content;

  return (
    <div className="bg-surface border border-border rounded-lg p-6">
      <h2 className="text-fg text-sm font-medium mb-4">Analyst Reports</h2>
      {content}
    </div>
  );
}
