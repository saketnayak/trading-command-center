"use client";

import { rateLine, type FxMeta } from "@/lib/displayCurrency";

type FxRateLineProps = {
  fx?: FxMeta | null;
  display: string;
  /** The pair to show first (e.g. the largest holding's currency). */
  primary?: string | null;
};

/** "1 USD = 1.5234 AUD · live · 2 min ago" — which rate the converted figures used and how fresh it is. */
export function FxRateLine({ fx, display, primary }: FxRateLineProps) {
  const line = rateLine(fx, display, new Date(), primary);
  if (!line) return null;
  return (
    <div
      className={`text-[10px] tabular-nums ${line.tone === "amber" ? "text-amber-400" : "text-muted"}`}
      title={line.pairs.join("\n")}
    >
      {line.text}
    </div>
  );
}
