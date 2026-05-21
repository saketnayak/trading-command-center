"use client";
import type { Report } from "@/lib/types";
import { Markdown } from "@/components/ui/Markdown";
import { normalizeMarkdown } from "@/lib/normalizeMarkdown";

interface Props {
  report: Report | undefined;
}

function extractHistory(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "history" in value) {
    return String((value as Record<string, unknown>).history ?? "");
  }
  return "";
}

export function BullBearDebate({ report }: Props) {
  if (!report) return null;

  const debateHistory = extractHistory(report.raw_report?.investment_debate_state);
  const riskHistory = extractHistory(report.raw_report?.risk_debate_state);

  if (!debateHistory && !riskHistory) return null;

  return (
    <div className="bg-navy-700 border border-slate-800 rounded-lg p-6 flex flex-col gap-6">
      <h2 className="text-slate-200 text-lg font-semibold">Bull / Bear Debate</h2>
      {debateHistory && (
        <div>
          <h3 className="text-slate-400 text-xs uppercase tracking-wider mb-3">Investment Debate</h3>
          <Markdown>{normalizeMarkdown(debateHistory)}</Markdown>
        </div>
      )}
      {riskHistory && (
        <div>
          <h3 className="text-slate-400 text-xs uppercase tracking-wider mb-3">Risk Discussion</h3>
          <Markdown>{normalizeMarkdown(riskHistory)}</Markdown>
        </div>
      )}
    </div>
  );
}
