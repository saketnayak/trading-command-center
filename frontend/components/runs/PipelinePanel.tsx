"use client";
import type { AgentEventPayload } from "@/lib/types";

interface PipelinePanelProps {
  analysts: string[];
  events: AgentEventPayload[];
}

type StageStatus = "waiting" | "running" | "done" | "error";

const DOWNSTREAM_STAGES = [
  { key: "bull_researcher", label: "Bull Research" },
  { key: "bear_researcher", label: "Bear Research" },
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
  waiting: "bg-slate-500",
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

function StageRow({ label, status }: { label: string; status: StageStatus }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot[status]}`} />
      <span className="text-slate-300 text-sm flex-1">{label}</span>
      <span className="text-slate-500 text-xs">{statusLabel[status]}</span>
    </div>
  );
}

export function PipelinePanel({ analysts, events }: PipelinePanelProps) {
  return (
    <div className="bg-navy-700 rounded border border-slate-800 p-4">
      <p className="text-slate-500 text-xs uppercase tracking-wider mb-3">Pipeline</p>
      <div className="space-y-2">
        {analysts.map((analyst) => (
          <StageRow
            key={analyst}
            label={analyst.charAt(0).toUpperCase() + analyst.slice(1)}
            status={getStageStatus(analyst, events)}
          />
        ))}
        <div className="border-t border-slate-700 my-2" />
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
