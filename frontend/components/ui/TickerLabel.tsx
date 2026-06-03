import type { ReactNode } from "react";
import type { TickerMetadata } from "@/lib/types";

interface TickerLabelProps {
  ticker: string;
  metadata?: TickerMetadata;
  children?: ReactNode;
  className?: string;
  subtitleClassName?: string;
}

export function tickerDisplayName(ticker: string, metadata?: TickerMetadata): string | null {
  const name = metadata?.company_name ?? metadata?.display_name ?? null;
  if (!name || name.toUpperCase() === ticker.toUpperCase()) return null;
  return name;
}

export function TickerLabel({
  ticker,
  metadata,
  children,
  className = "",
  subtitleClassName = "",
}: TickerLabelProps) {
  const companyName = tickerDisplayName(ticker, metadata);

  return (
    <span className={`inline-flex min-w-0 flex-col ${className}`}>
      {children ?? <span className="font-mono font-semibold">{ticker}</span>}
      {companyName && (
        <span className={`mt-0.5 max-w-[14rem] truncate text-[11px] leading-tight text-muted ${subtitleClassName}`}>
          {companyName}
        </span>
      )}
    </span>
  );
}
