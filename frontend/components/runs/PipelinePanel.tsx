"use client";
import { AnalystIconBadge } from "@/components/runs/RunContextIcons";
import type { AgentEventPayload } from "@/lib/types";

interface PipelinePanelProps {
  analysts: string[];
  events: AgentEventPayload[];
}

type StageStatus = "waiting" | "running" | "done" | "error";

const DOWNSTREAM_STAGES = [
  { key: "situation_summariser", label: "Situation Summary" },
  { key: "bull_researcher", label: "Bull Research" },
  { key: "bear_researcher", label: "Bear Research" },
  { key: "research_manager", label: "Research Manager" },
  { key: "trader", label: "Trader" },
  { key: "aggressive_analyst", label: "Risk: Aggressive" },
  { key: "conservative_analyst", label: "Risk: Conservative" },
  { key: "neutral_analyst", label: "Risk: Neutral" },
  { key: "risk_judge", label: "Risk Judge" },
];

function getStageStatus(key: string, events: AgentEventPayload[]): StageStatus {
  const matched = events.filter((e) => e.agent === key || e.agent === `${key}_analyst`);
  if (matched.length === 0) return "waiting";
  if (matched.some((e) => e.type === "error")) return "error";
  if (matched.some((e) => e.type === "completed")) return "done";
  if (matched.some((e) => e.type === "started")) return "running";
  return "waiting";
}

const statusDot: Record<StageStatus, string> = {
  waiting: "bg-subtle",
  running: "bg-blue-400 animate-pulse",
  done: "bg-green-400",
  error: "bg-red-400",
};

const statusLabel: Record<StageStatus, string> = {
  waiting: "waiting",
  running: "running",
  done: "done",
  error: "error",
};

function StageRow({ label, status, analyst }: { label: string; status: StageStatus; analyst?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot[status]}`} />
      {analyst && <AnalystIconBadge analyst={analyst} />}
      <span className="text-fg-secondary text-sm flex-1">{label}</span>
      <span className="text-muted text-xs">{statusLabel[status]}</span>
    </div>
  );
}

export function PipelinePanel({ analysts, events }: PipelinePanelProps) {
  return (
    <div className="bg-surface rounded-sm border border-border p-4">
      <p className="text-muted text-xs uppercase tracking-wider mb-3">Pipeline</p>
      <div className="space-y-2">
        {analysts.map((analyst) => (
          <StageRow
            key={analyst}
            label={analyst.charAt(0).toUpperCase() + analyst.slice(1)}
            status={getStageStatus(analyst, events)}
            analyst={analyst}
          />
        ))}
        <div className="border-t border-input-border my-2" />
        {DOWNSTREAM_STAGES.map((stage) => (
          <StageRow
            key={stage.key}
            label={stage.label}
            status={getStageStatus(stage.key, events)}
          />
        ))}
      </div>
    </div>
  );
}
