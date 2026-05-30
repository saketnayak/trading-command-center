"use client";
import type { RunOutcome } from "@/lib/types";

function pct(base: number | null, target: number | null): string {
  if (!base || !target) return "—";
  const p = ((target - base) / base) * 100;
  return (p >= 0 ? "+" : "") + p.toFixed(2) + "%";
}

function pctColor(base: number | null, target: number | null, verdict: string): string {
  if (!base || !target) return "text-muted";
  const up = target > base;
  const correct = (verdict === "buy" && up) || (verdict === "sell" && !up);
  return correct ? "text-green-400" : "text-red-400";
}

const CHECKPOINTS: Array<{ label: string; key: keyof RunOutcome }> = [
  { label: "Day 0", key: "price_at_analysis" },
  { label: "+7d", key: "price_7d" },
  { label: "+14d", key: "price_14d" },
  { label: "+30d", key: "price_30d" },
  { label: "+90d", key: "price_90d" },
];

export function OutcomeCard({ outcome }: { outcome: RunOutcome }) {
  const base = outcome.price_at_analysis;

  return (
    <div className="bg-elevated border border-input-border rounded-xl p-5">
      <h2 className="text-sm font-semibold text-fg-secondary uppercase tracking-wide mb-4">
        Trade Outcome
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {CHECKPOINTS.map(({ label, key }) => {
          const price = outcome[key] as number | null;
          return (
            <div key={label} className="flex flex-col items-center bg-page rounded-lg p-3 gap-1">
              <span className="text-xs text-muted">{label}</span>
              <span className="text-sm font-semibold text-fg">
                {price ? `$${price.toFixed(2)}` : "—"}
              </span>
              {key !== "price_at_analysis" && (
                <span className={`text-xs font-medium ${pctColor(base, price, outcome.verdict)}`}>
                  {pct(base, price)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted mt-3">
        Verdict was{" "}
        <span className="font-semibold text-muted">{outcome.verdict.toUpperCase()}</span>.
        Prices fetched from Finnhub. Future dates show &ldquo;—&rdquo; until available.
      </p>
    </div>
  );
}
