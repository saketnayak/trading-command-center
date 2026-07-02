"use client";
import type { Report } from "@/lib/types";
import { Markdown } from "@/components/ui/Markdown";

interface Props {
  report: Report | undefined;
  embedded?: boolean;
}

function extractHistory(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "history" in value) {
    return String((value as Record<string, unknown>).history ?? "");
  }
  return "";
}

export function BullBearDebate({ report, embedded = false }: Props) {
  if (!report) {
    if (embedded) {
      return <p className="text-muted text-sm">Debate transcript not available yet.</p>;
    }
    return null;
  }

  const debateHistory = extractHistory(report.raw_report?.investment_debate_state);
  const riskHistory = extractHistory(report.raw_report?.risk_debate_state);

  if (!debateHistory && !riskHistory) {
    if (embedded) {
      return <p className="text-muted text-sm">No bull/bear debate recorded for this run.</p>;
    }
    return null;
  }

  const content = (
    <div className="flex flex-col gap-6">
      {debateHistory && (
        <div>
          <h3 className="text-muted text-xs uppercase tracking-wider mb-3">Investment Debate</h3>
          <Markdown>{debateHistory}</Markdown>
        </div>
      )}
      {riskHistory && (
        <div>
          <h3 className="text-muted text-xs uppercase tracking-wider mb-3">Risk Discussion</h3>
          <Markdown>{riskHistory}</Markdown>
        </div>
      )}
    </div>
  );

  if (embedded) return content;

  return (
    <div className="bg-surface border border-border rounded-lg p-6 flex flex-col gap-6">
      <h2 className="text-fg text-sm font-medium">Bull / Bear Debate</h2>
      {content}
    </div>
  );
}
