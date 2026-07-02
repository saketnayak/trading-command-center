"use client";

import { TraderDecision } from "@/components/runs/TraderDecision";
import { ConfluenceStrip } from "@/components/runs/ConfluenceStrip";
import { OutcomeCard } from "@/components/runs/OutcomeCard";
import { NotesEditor } from "@/components/runs/NotesEditor";
import type { Report, Run, RunOutcome, TickerMetadata } from "@/lib/types";

type StrategyFlags = {
  markovEnabled: boolean;
  kalmanEnabled: boolean;
  waveEnabled: boolean;
};

type RunSummaryPanelProps = {
  runId: string;
  run: Run;
  report: Report | undefined;
  outcome: RunOutcome | undefined;
  metadata?: TickerMetadata;
  strategy: StrategyFlags;
};

export function RunSummaryPanel({
  runId,
  run,
  report,
  outcome,
  metadata,
  strategy,
}: RunSummaryPanelProps) {
  return (
    <aside className="w-full lg:w-[min(100%,22rem)] xl:w-80 shrink-0 space-y-4 lg:sticky lg:top-[calc(3.5rem+1.5rem)] lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto lg:overscroll-contain">
      <TraderDecision run={run} report={report} metadata={metadata} compact />
      <ConfluenceStrip
        run={run}
        report={report}
        strategy={strategy}
        metadataCurrency={metadata?.currency}
      />
      {outcome && <OutcomeCard outcome={outcome} />}
      <NotesEditor id={runId} notes={run.notes} />
    </aside>
  );
}
