"use client";
import { TickerLabel } from "@/components/ui/TickerLabel";
import type { Run, Report, TickerMetadata } from "@/lib/types";
import { Markdown } from "@/components/ui/Markdown";
import { fmtPriceString, resolveQuoteCurrency } from "@/lib/currency";

interface Props {
  run: Run | undefined;
  report: Report | undefined;
  metadata?: TickerMetadata;
  /** Sidebar layout: smaller verdict badge, rationale collapsed below fold. */
  compact?: boolean;
}

const verdictStyles: Record<string, string> = {
  buy: "bg-green-900 text-green-300 font-bold rounded-lg",
  sell: "bg-red-900 text-red-300 font-bold rounded-lg",
  hold: "bg-yellow-900 text-yellow-300 font-bold rounded-lg",
};

const verdictSize = {
  default: "text-2xl px-6 py-3",
  compact: "text-xl px-4 py-2",
};

interface PriceLevelProps {
  label: string;
  value: string | null | undefined;
  currency: string;
  compact?: boolean;
}

function PriceLevel({ label, value, currency, compact = false }: PriceLevelProps) {
  const formatted = fmtPriceString(value, currency);
  return (
    <div className={`min-w-0 flex-1 px-2 ${compact ? "py-1.5 text-center" : "px-3 py-2"}`}>
      <span
        className={`block uppercase tracking-wider text-muted ${
          compact ? "text-[10px]" : "text-xs"
        }`}
      >
        {label}
      </span>
      <span
        className={`block truncate font-mono text-fg ${compact ? "text-xs" : "text-sm"}`}
        title={formatted}
      >
        {formatted}
      </span>
    </div>
  );
}

interface TradePlanLevelsProps {
  entry: string | null | undefined;
  stop: string | null | undefined;
  target: string | null | undefined;
  currency: string;
  compact?: boolean;
}

function TradePlanLevels({ entry, stop, target, currency, compact = false }: TradePlanLevelsProps) {
  const levels = [
    { label: "Entry", value: entry },
    { label: "Stop", value: stop },
    { label: "Target", value: target },
  ];

  return (
    <div
      className={`grid grid-cols-3 divide-x divide-input-border overflow-hidden rounded-sm border border-input-border bg-input/20 ${
        compact ? "" : "sm:max-w-md"
      }`}
      role="table"
      aria-label="Trade plan levels"
    >
      {levels.map(({ label, value }) => (
        <PriceLevel
          key={label}
          label={label}
          value={value}
          currency={currency}
          compact={compact}
        />
      ))}
    </div>
  );
}

export function TraderDecision({ run, report, metadata, compact = false }: Props) {
  const isTerminated = run?.status === "aborted" || run?.status === "failed";
  const hasPrices =
    report?.suggested_entry || report?.suggested_stop || report?.suggested_target;
  const currency = resolveQuoteCurrency(
    report?.price_currency ?? run?.price_currency,
    metadata?.currency,
  );
  const sizeClass = compact ? verdictSize.compact : verdictSize.default;
  const padding = compact ? "p-4" : "p-6";

  return (
    <div className={`bg-surface border border-border rounded-lg ${padding}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className={`font-semibold text-fg ${compact ? "text-base" : "text-lg"}`}>
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
        <div className="flex flex-col gap-3">
          <div>
            <span className={`${verdictStyles[report.verdict] ?? verdictStyles.hold} ${sizeClass}`}>
              {report.verdict.toUpperCase()}
            </span>
          </div>

          {hasPrices && (
            <TradePlanLevels
              entry={report.suggested_entry}
              stop={report.suggested_stop}
              target={report.suggested_target}
              currency={currency}
              compact={compact}
            />
          )}

          {report.trader_decision && !compact && (
            <Markdown>{report.trader_decision}</Markdown>
          )}
          {report.trader_decision && compact && (
            <details className="group border-t border-input-border pt-3">
              <summary className="cursor-pointer text-xs text-muted hover:text-fg-secondary list-none flex items-center justify-between gap-2">
                <span>Rationale</span>
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted-surface text-base leading-none text-fg-secondary group-open:rotate-180 transition-transform duration-200">▾</span>
              </summary>
              <div className="mt-2 text-sm">
                <Markdown>{report.trader_decision}</Markdown>
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
