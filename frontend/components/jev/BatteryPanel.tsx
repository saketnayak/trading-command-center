import { fmtPct } from "@/lib/jev/format";
import type { JevAnswers } from "@/lib/jev/types";

function Meter({ label, value, max, threshold, hint }: { label: string; value: number; max: number; threshold?: number; hint: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const over = threshold != null && value > threshold;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-fg-secondary">{label}</span>
        <span className={`tabular-nums ${over ? "text-amber-600 dark:text-amber-300" : "text-fg"}`}>
          {max === 1 ? value.toFixed(2) : `${value.toFixed(2)} / ${max}`}
        </span>
      </div>
      <div className="relative mt-1 h-1.5 rounded-full bg-elevated" aria-hidden>
        <div className={`h-full rounded-full ${over ? "bg-amber-500" : "bg-blue-500"}`} style={{ width: `${pct}%` }} />
        {threshold != null && (
          <div className="absolute -top-0.5 h-2.5 w-px bg-fg-secondary" style={{ left: `${(threshold / max) * 100}%` }} />
        )}
      </div>
      <p className="mt-0.5 text-[10px] text-muted">{hint}</p>
    </div>
  );
}

/** The seven judgments Jev returned on the latest tick, against this session's thresholds. */
export function BatteryPanel({
  answers,
  thresholds,
  ageS,
}: {
  answers: JevAnswers | null | undefined;
  thresholds: Record<string, number>;
  /** seconds since Jev gave these answers; 0 = this tick */
  ageS?: number | null;
}) {
  if (!answers) {
    return <p className="text-xs text-muted">No Jev answer yet in this session (or none recent enough to use).</p>;
  }
  const q = answers.quote_environment;
  return (
    <div className="space-y-3">
      <p className="text-[10px] text-muted">
        {ageS == null || ageS < 1 ? "Answered this tick." : `From Jev's answer ${ageS.toFixed(0)} s ago; Jev is paced to stay inside its provider's rate limit.`}
      </p>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted">Regime</p>
          <p className="text-fg">{answers.regime.choice.replace("_", " ")}</p>
          <p className="text-[10px] text-muted">confidence {fmtPct(answers.regime.confidence, 0)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted">Direction</p>
          <p className="text-fg">{answers.direction.choice}</p>
          <p className="text-[10px] text-muted">
            confidence {fmtPct(answers.direction.confidence, 0)} · leg above {fmtPct(thresholds.direction_confidence_threshold, 0)}
          </p>
        </div>
      </div>
      <Meter label="Toxic flow" value={answers.toxic_flow.noul} max={1} threshold={thresholds.toxic_flow_pull_threshold} hint="above the marker: pull quotes" />
      <Meter label="Liquidity stress" value={answers.liquidity_stressed.noul} max={1} threshold={thresholds.liquidity_stressed_widen_threshold} hint="above the marker: widen" />
      <Meter
        label="Quote environment"
        value={q.score}
        max={3}
        hint={`confidence ${fmtPct(q.confidence, 0)} · both sides at ≥ ${thresholds.quote_env_full_score} with > ${fmtPct(thresholds.quote_env_full_confidence, 0)}, wide at ≥ ${thresholds.quote_env_wide_score}`}
      />
      <Meter label="Inventory pressure" value={answers.inventory_pressure.score} max={3} hint="how urgently to cut the position" />
      <Meter label="Execution health" value={answers.execution_health.score} max={3} hint="below 1.0 the ladder drops to reduced size" />
    </div>
  );
}
