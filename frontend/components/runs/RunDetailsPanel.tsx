"use client";

import type { ReactNode } from "react";
import type { Run } from "@/lib/types";
import { AnalystIcons, LanguageFlag } from "@/components/runs/RunContextIcons";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  aborted: "Aborted",
};

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-4 py-2 border-b border-border last:border-0">
      <span className="text-xs text-muted uppercase tracking-wide sm:w-36 shrink-0">{label}</span>
      <div className="text-sm text-fg-secondary min-w-0">{children}</div>
    </div>
  );
}

export function RunDetailsPanel({ run }: { run: Run }) {
  return (
    <div className="space-y-1">
      <DetailRow label="Ticker">{run.ticker}</DetailRow>
      <DetailRow label="Status">{STATUS_LABELS[run.status] ?? run.status}</DetailRow>
      <DetailRow label="Analysis date">{run.analysis_date}</DetailRow>
      {run.started_at && (
        <DetailRow label="Started">
          {new Date(run.started_at).toLocaleString()}
        </DetailRow>
      )}
      {run.completed_at && (
        <DetailRow label="Completed">
          {new Date(run.completed_at).toLocaleString()}
        </DetailRow>
      )}
      <DetailRow label="Provider">{run.llm_provider}</DetailRow>
      <DetailRow label="Model">
        <span className="font-mono text-xs break-all">{run.llm_model}</span>
      </DetailRow>
      <DetailRow label="Depth">{run.depth}</DetailRow>
      <DetailRow label="Analysts">
        <AnalystIcons analysts={run.analysts} />
      </DetailRow>
      <DetailRow label="Language">
        <LanguageFlag value={run.response_language} />
      </DetailRow>
      {run.label && <DetailRow label="Label">{run.label}</DetailRow>}
      {run.verdict && (
        <DetailRow label="Verdict">
          <span className="uppercase font-semibold">{run.verdict}</span>
        </DetailRow>
      )}
    </div>
  );
}
