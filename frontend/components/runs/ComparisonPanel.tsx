"use client";
import { RunContextIcons } from "@/components/runs/RunContextIcons";
import type { RunWithReport } from "@/lib/types";
import { getAnalystReportContent } from "@/lib/analystReports";

const VERDICT_COLOR: Record<string, string> = {
  buy: "text-green-400",
  sell: "text-red-400",
  hold: "text-amber-400",
};

function AnalystSection({ label, content }: { label: string; content: string | undefined }) {
  if (!content?.trim()) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1">{label}</p>
      <p className="text-sm text-fg-secondary whitespace-pre-wrap leading-relaxed line-clamp-6">{content.trim()}</p>
    </div>
  );
}

function RunColumn({ side, data }: { side: "A" | "B"; data: RunWithReport }) {
  const { run, report } = data;
  const raw = report?.raw_report as Record<string, unknown> | undefined;

  return (
    <div className="flex-1 min-w-0 bg-elevated border border-input-border rounded-xl p-5 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="bg-muted-surface text-fg-secondary text-xs font-bold px-2 py-0.5 rounded-sm">Run {side}</span>
        <span className="text-xl font-bold text-fg">{run.ticker}</span>
        <span className="text-sm text-muted">{run.analysis_date}</span>
      </div>

      {report ? (
        <div className={`text-2xl font-bold ${VERDICT_COLOR[report.verdict] ?? "text-fg-secondary"}`}>
          {report.verdict.toUpperCase()}
        </div>
      ) : (
        <div className="text-muted text-sm">No report available</div>
      )}

      {report && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center">
          {[
            { label: "Entry", value: report.suggested_entry },
            { label: "Stop", value: report.suggested_stop },
            { label: "Target", value: report.suggested_target },
          ].map(({ label, value }) => (
            <div key={label} className="bg-page rounded-lg p-2">
              <p className="text-xs text-muted">{label}</p>
              <p className="text-sm font-semibold text-fg">{value ? `$${value}` : "—"}</p>
            </div>
          ))}
        </div>
      )}

      <div className="text-xs text-muted space-y-1">
        <p><span className="text-muted">Model:</span> {run.llm_provider} / {run.llm_model}</p>
        <p><span className="text-muted">Depth:</span> {run.depth}</p>
        <div className="flex items-center gap-2 pt-1">
          <span className="text-muted">Analysts / Language:</span>
          <RunContextIcons analysts={run.analysts} responseLanguage={run.response_language} />
        </div>
      </div>

      {report && (
        <div className="border-t border-input-border pt-3">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Trader Decision</p>
          <p className="text-sm text-fg-secondary whitespace-pre-wrap leading-relaxed line-clamp-8">{report.trader_decision}</p>
        </div>
      )}

      {raw && run.analysts.map((analyst) => (
        <AnalystSection
          key={analyst}
          label={analyst.charAt(0).toUpperCase() + analyst.slice(1) + " Analyst"}
          content={getAnalystReportContent(raw, analyst) || undefined}
        />
      ))}
    </div>
  );
}

export function ComparisonPanel({ a, b }: { a: RunWithReport; b: RunWithReport }) {
  const verdictA = a.report?.verdict;
  const verdictB = b.report?.verdict;
  const agree = verdictA && verdictB && verdictA === verdictB;

  return (
    <div className="flex flex-col gap-4">
      {verdictA && verdictB && (
        <div className={`text-center text-sm px-4 py-2 rounded-lg border ${agree ? "border-green-700 bg-green-900/20 text-green-400" : "border-amber-700 bg-amber-900/20 text-amber-400"}`}>
          {agree
            ? `Both runs agree: ${verdictA.toUpperCase()}`
            : `Verdicts differ — Run A says ${verdictA.toUpperCase()}, Run B says ${verdictB.toUpperCase()}`}
        </div>
      )}
      <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-start">
        <RunColumn side="A" data={a} />
        <RunColumn side="B" data={b} />
      </div>
    </div>
  );
}
