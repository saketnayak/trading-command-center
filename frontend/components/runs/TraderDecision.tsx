"use client";
import { TickerLabel } from "@/components/ui/TickerLabel";
import type { Run, Report, TickerMetadata } from "@/lib/types";
import { Markdown } from "@/components/ui/Markdown";
import { fmtPriceString, resolveQuoteCurrency } from "@/lib/currency";

interface Props {
  run: Run | undefined;
  report: Report | undefined;
  metadata?: TickerMetadata;
}

const verdictStyles: Record<string, string> = {
  buy: "bg-green-900 text-green-300 text-2xl font-bold px-6 py-3 rounded-lg",
  sell: "bg-red-900 text-red-300 text-2xl font-bold px-6 py-3 rounded-lg",
  hold: "bg-yellow-900 text-yellow-300 text-2xl font-bold px-6 py-3 rounded-lg",
};

interface PriceLevelProps {
  label: string;
  value: string | null | undefined;
  currency: string;
}

function PriceLevel({ label, value, currency }: PriceLevelProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted text-xs uppercase tracking-wider">{label}</span>
      <span className="text-fg font-mono text-sm">{fmtPriceString(value, currency)}</span>
    </div>
  );
}

export function TraderDecision({ run, report, metadata }: Props) {
  const isTerminated = run?.status === "aborted" || run?.status === "failed";
  const hasPrices =
    report?.suggested_entry || report?.suggested_stop || report?.suggested_target;
  const currency = resolveQuoteCurrency(
    report?.price_currency ?? run?.price_currency,
    metadata?.currency,
  );

  return (
    <div className="bg-surface border border-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-fg text-lg font-semibold">
          {run ? (
            <TickerLabel ticker={run.ticker} metadata={metadata} />
          ) : "—"}
        </h2>
        {run?.analysis_date && (
          <span className="text-muted text-sm">{run.analysis_date}</span>
        )}
      </div>

      {isTerminated && !report && (
        <p className="text-muted text-sm">
          This run did not complete successfully.
        </p>
      )}

      {!report && !isTerminated && (
        <p className="text-muted text-sm">Results not yet available.</p>
      )}

      {report && (
        <div className="flex flex-col gap-4">
          <div>
            <span className={verdictStyles[report.verdict] ?? verdictStyles.hold}>
              {report.verdict.toUpperCase()}
            </span>
          </div>

          {hasPrices && (
            <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 border-t border-input-border pt-4">
              <PriceLevel label="Entry" value={report.suggested_entry} currency={currency} />
              <div className="w-px bg-muted-surface" />
              <PriceLevel label="Stop" value={report.suggested_stop} currency={currency} />
              <div className="w-px bg-muted-surface" />
              <PriceLevel label="Target" value={report.suggested_target} currency={currency} />
            </div>
          )}

          {report.trader_decision && (
            <Markdown>{report.trader_decision}</Markdown>
          )}
        </div>
      )}
    </div>
  );
}
