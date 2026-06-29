"use client";

import { useQuery } from "@tanstack/react-query";
import { getLatestInsight } from "@/lib/api";
import type { InsightActionItem, InsightStance, PortfolioInsight } from "@/lib/types";
import { BTN_AI_SM_CLASS } from "@/lib/uiClasses";

type MorningBriefStripProps = {
  portfolioId: string;
  onOpenInsights: () => void;
};

function stanceClasses(stance: InsightStance): string {
  if (stance === "bullish") return "bg-green-500/20 text-green-300 border-green-500/30";
  if (stance === "bearish") return "bg-red-500/20 text-red-300 border-red-500/30";
  if (stance === "mixed") return "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
  return "bg-muted-surface text-fg-secondary border-input-border";
}

function healthColor(score: number): string {
  if (score >= 8) return "text-green-400";
  if (score >= 5) return "text-yellow-400";
  return "text-red-400";
}

function pickTopAction(items: InsightActionItem[] | null | undefined): InsightActionItem | null {
  if (!items?.length) return null;
  const priorityOrder = { high: 0, medium: 1, low: 2 } as const;
  return [...items].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])[0];
}

function BriefContent({
  insight,
  onOpenInsights,
}: {
  insight: PortfolioInsight;
  onOpenInsights: () => void;
}) {
  if (insight.status === "pending" || insight.status === "running") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">AI briefing in progress…</p>
        <button type="button" onClick={onOpenInsights} className={BTN_AI_SM_CLASS}>
          View briefing
        </button>
      </div>
    );
  }

  if (insight.status === "failed") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-red-400">Latest briefing failed — open AI Insights to retry.</p>
        <button type="button" onClick={onOpenInsights} className={BTN_AI_SM_CLASS}>
          Open AI Insights
        </button>
      </div>
    );
  }

  const topAction = pickTopAction(insight.action_items);
  const stance = insight.overall_stance;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-3 min-w-0">
        {insight.health_score != null && (
          <div className="flex items-baseline gap-1.5 shrink-0">
            <span className={`text-2xl font-semibold font-data tabular-nums ${healthColor(insight.health_score)}`}>
              {insight.health_score}
            </span>
            <span className="text-xs text-muted">/ 10 health</span>
          </div>
        )}
        {stance && (
          <span className={`rounded-lg border px-2 py-0.5 text-xs font-medium capitalize ${stanceClasses(stance)}`}>
            {stance}
          </span>
        )}
        {topAction ? (
          <p className="text-sm text-fg-secondary min-w-0 truncate" title={topAction.rationale}>
            <span className="text-muted">Top action:</span>{" "}
            <span className="font-medium text-fg">{topAction.ticker}</span> — {topAction.action.replace(/_/g, " ").toLowerCase()}
          </p>
        ) : insight.summary ? (
          <p className="text-sm text-fg-secondary line-clamp-2 sm:line-clamp-1 min-w-0">{insight.summary}</p>
        ) : null}
      </div>
      <button type="button" onClick={onOpenInsights} className={`${BTN_AI_SM_CLASS} shrink-0`}>
        Full briefing →
      </button>
    </div>
  );
}

export function MorningBriefStrip({ portfolioId, onOpenInsights }: MorningBriefStripProps) {
  const { data: insight, isLoading } = useQuery({
    queryKey: ["insights-latest", portfolioId],
    queryFn: () => getLatestInsight(portfolioId),
    enabled: Boolean(portfolioId),
    staleTime: 60_000,
  });

  return (
    <section
      aria-label="Morning portfolio briefing"
      className="rounded-lg border border-border bg-surface px-4 py-3"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-medium text-muted">Morning briefing</span>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted">Loading latest insight…</p>
      ) : insight ? (
        <BriefContent insight={insight} onOpenInsights={onOpenInsights} />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">No AI briefing yet — generate one for today&apos;s action items.</p>
          <button type="button" onClick={onOpenInsights} className={BTN_AI_SM_CLASS}>
            Generate briefing
          </button>
        </div>
      )}
    </section>
  );
}
