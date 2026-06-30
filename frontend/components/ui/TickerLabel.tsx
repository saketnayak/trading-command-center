import Link from "next/link";
import type { TickerMetadata } from "@/lib/types";
import { CompanyLogo, type CompanyLogoSize } from "@/components/ui/CompanyLogo";

interface TickerLabelProps {
  ticker: string;
  metadata?: TickerMetadata;
  href?: string;
  onClick?: () => void;
  className?: string;
  logoSize?: CompanyLogoSize;
  showLogo?: boolean;
}

export function tickerDisplayName(ticker: string, metadata?: TickerMetadata): string | null {
  const name = metadata?.company_name ?? metadata?.display_name ?? null;
  if (!name || name.toUpperCase() === ticker.toUpperCase()) return null;
  return name;
}

const NAME_CLASS =
  "max-w-[14rem] truncate font-mono font-semibold text-sm text-purple-400";
const TICKER_CLASS =
  "max-w-[14rem] truncate text-[11px] leading-tight text-muted";
const INTERACTIVE_CLASS =
  "flex min-w-0 items-center gap-2 text-left transition-colors hover:[&_span]:text-purple-300 hover:[&_span]:underline";

function LabelText({ ticker, metadata }: { ticker: string; metadata?: TickerMetadata }) {
  const companyName = tickerDisplayName(ticker, metadata);

  return (
    <span className="inline-flex min-w-0 flex-col items-start text-left">
      {companyName && <span className={NAME_CLASS}>{companyName}</span>}
      <span className={`${TICKER_CLASS} ${companyName ? "mt-0.5" : ""}`}>{ticker}</span>
    </span>
  );
}

export function TickerLabel({
  ticker,
  metadata,
  href,
  onClick,
  className = "",
  logoSize = "sm",
  showLogo = true,
}: TickerLabelProps) {
  const content = (
    <>
      {showLogo && <CompanyLogo ticker={ticker} size={logoSize} />}
      <LabelText ticker={ticker} metadata={metadata} />
    </>
  );

  const wrapperClass = `inline-flex min-w-0 items-center gap-2 text-left ${className}`.trim();

  if (href) {
    return (
      <Link href={href} className={`${wrapperClass} ${INTERACTIVE_CLASS}`}>
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${wrapperClass} ${INTERACTIVE_CLASS}`}>
        {content}
      </button>
    );
  }

  return <span className={wrapperClass}>{content}</span>;
}
