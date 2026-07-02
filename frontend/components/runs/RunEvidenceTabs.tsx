"use client";

import { useState } from "react";
import { AnalystReports } from "@/components/runs/AnalystReports";
import { BullBearDebate } from "@/components/runs/BullBearDebate";
import { RunDetailsPanel } from "@/components/runs/RunDetailsPanel";
import type { Report, Run } from "@/lib/types";

type EvidenceTab = "analysts" | "debate" | "details";

const TABS: Array<{ id: EvidenceTab; label: string }> = [
  { id: "analysts", label: "Analysts" },
  { id: "debate", label: "Debate" },
  { id: "details", label: "Details" },
];

type RunEvidenceTabsProps = {
  run: Run;
  report: Report | undefined;
};

export function RunEvidenceTabs({ run, report }: RunEvidenceTabsProps) {
  const [activeTab, setActiveTab] = useState<EvidenceTab>("analysts");

  return (
    <section className="flex-1 min-w-0 bg-surface border border-border rounded-lg overflow-hidden">
      <div
        role="tablist"
        className="flex gap-1 border-b border-border overflow-x-auto scrollbar-thin px-2 sm:px-4"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              activeTab === tab.id
                ? "border-blue-400 text-blue-400"
                : "border-transparent text-muted hover:text-fg"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-4 sm:p-6 min-h-[12rem]">
        {activeTab === "analysts" && (
          <AnalystReports report={report} analysts={run.analysts} embedded />
        )}
        {activeTab === "debate" && (
          <BullBearDebate report={report} embedded />
        )}
        {activeTab === "details" && (
          <RunDetailsPanel run={run} />
        )}
      </div>
    </section>
  );
}
