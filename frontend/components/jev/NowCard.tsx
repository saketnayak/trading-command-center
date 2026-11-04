import { fmtPrice, fmtQty, fmtUsd, pnlClass } from "@/lib/jev/format";
import { DECISION_TONE_CLASS, decisionWord, explainTick } from "@/lib/jev/insights";
import type { JevTick } from "@/lib/jev/types";

/** The headline: price and position on the left, what the loop is doing and why on the right. */
export function NowCard({ tick, thresholds, bookAgeS }: { tick: JevTick | undefined; thresholds: Record<string, number>; bookAgeS: number | null }) {
  if (!tick) return <p className="text-xs text-muted">Waiting for the first tick…</p>;
  const { word, tone } = decisionWord(tick);
  const why = explainTick(tick, thresholds);
  const positionUsd = tick.mid ? Math.abs(tick.inventory) * tick.mid : 0;
  return (
    <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div className="min-w-0">
        <p className="font-mono text-3xl font-semibold tracking-tight text-fg tabular-nums">{fmtPrice(tick.mid)}</p>
        <p className="mt-1 text-xs text-muted">
          {tick.inventory === 0 ? "flat" : `holding ${fmtQty(tick.inventory)} (${fmtUsd(positionUsd)})`} ·{" "}
          <span className={pnlClass(tick.unrealised_pnl_usd)}>P&amp;L {fmtUsd(tick.unrealised_pnl_usd ?? 0, 4)}</span> · spread{" "}
          {tick.spread_bps != null ? `${tick.spread_bps.toFixed(1)} bps` : "—"}
          {bookAgeS != null && <> · book last changed {bookAgeS.toFixed(0)} s ago</>}
        </p>
      </div>
      <div className="min-w-0">
        <p className={`text-2xl font-semibold tracking-tight ${DECISION_TONE_CLASS[tone]}`}>{word}</p>
        <p className="text-[11px] text-muted">
          tick {tick.tick} · {tick.action}
          {tick.latency_ms != null ? ` · Jev ${Math.round(tick.latency_ms)} ms` : ""}
        </p>
        {why.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-fg-secondary">
            {why.map((line) => (
              <li key={line} className="flex gap-1.5">
                <span aria-hidden className="text-muted">•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
