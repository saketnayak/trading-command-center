"use client";

import { useState } from "react";
import { tickerLogoSrc } from "@/lib/tickerLogo";

const SIZE_CLASS = {
  sm: "h-7 w-7 text-[9px]",
  md: "h-8 w-8 text-[9px]",
  lg: "h-10 w-10 text-[10px]",
} as const;

export type CompanyLogoSize = keyof typeof SIZE_CLASS;

interface CompanyLogoProps {
  ticker: string;
  size?: CompanyLogoSize;
  className?: string;
}

function InitialsFallback({
  ticker,
  size,
  className = "",
}: {
  ticker: string;
  size: CompanyLogoSize;
  className?: string;
}) {
  return (
    <div
      className={`${SIZE_CLASS[size]} shrink-0 rounded-sm bg-muted-surface flex items-center justify-center ${className}`.trim()}
      aria-hidden
    >
      <span className="font-bold text-muted">{ticker.slice(0, 2)}</span>
    </div>
  );
}

export function CompanyLogo({ ticker, size = "md", className = "" }: CompanyLogoProps) {
  const normalized = ticker.trim().toUpperCase();
  const [failed, setFailed] = useState(false);

  if (!normalized || failed) {
    return <InitialsFallback ticker={normalized || ticker} size={size} className={className} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={tickerLogoSrc(normalized)}
      alt=""
      className={`${SIZE_CLASS[size]} shrink-0 rounded-sm object-contain bg-muted-surface p-0.5 ${className}`.trim()}
      onError={() => setFailed(true)}
    />
  );
}
