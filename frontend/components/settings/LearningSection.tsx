"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { SectionCard } from "@/components/settings/SectionCard";
import { clearLearningMemories, getLearning, putLearning, runLearning } from "@/lib/api";
import { MEMORY_LABELS, memorySummary } from "@/lib/learning";
import { fmtSignedPct, returnTone } from "@/lib/performance";
import { BTN_PRIMARY_SM_CLASS, BTN_SECONDARY_CLASS, selectionPillClass } from "@/lib/uiClasses";

const KEY = ["learning"] as const;

export function LearningSection() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: KEY,
    queryFn: getLearning,
    refetchInterval: (query) => (query.state.data?.running ? 2000 : false),
  });
  const save = useMutation({
    mutationFn: putLearning,
    onSuccess: (data) => qc.setQueryData(KEY, data),
  });
  const run = useMutation({ mutationFn: runLearning, onSuccess: () => qc.invalidateQueries({ queryKey: KEY }) });
  const clear = useMutation({ mutationFn: clearLearningMemories, onSuccess: () => qc.invalidateQueries({ queryKey: KEY }) });
  const s = q.data;
  const error = (save.error ?? run.error ?? clear.error) as Error | null;

  return (
    <SectionCard
      id="learning"
      title="Learning loop"
      description="Let the agents learn from their own calls. Once a run's outcome is known, they compare what they said with what the price did and keep the lessons for your later analyses."
    >
      <div className="flex flex-col gap-4 px-4 py-4 text-sm">
        {q.isPending && <p className="text-muted">Loading…</p>}
        {s && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex gap-1.5" role="group" aria-label="Learning loop">
                <button type="button" className={selectionPillClass(!s.enabled, true)} aria-pressed={!s.enabled}
                  disabled={save.isPending} onClick={() => save.mutate({ enabled: false, horizon_days: s.horizon_days })}>Off</button>
                <button type="button" className={selectionPillClass(s.enabled, true)} aria-pressed={s.enabled}
                  disabled={save.isPending} onClick={() => save.mutate({ enabled: true, horizon_days: s.horizon_days })}>On</button>
              </div>
              <span className="text-xs text-muted">Judge each call after</span>
              <div className="flex gap-1.5" role="group" aria-label="Horizon">
                {s.horizons.map((h) => (
                  <button key={h} type="button" className={selectionPillClass(s.horizon_days === h, true)} aria-pressed={s.horizon_days === h}
                    disabled={save.isPending} onClick={() => save.mutate({ enabled: s.enabled, horizon_days: h })}>{h} days</button>
                ))}
              </div>
            </div>

            <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-fg-secondary">
              <li>Runs nightly on your completed runs, up to {s.per_pass} a night, oldest first. Each run is judged once; a failed attempt (say, an API error) is retried up to 3 times.</li>
              <li>Each reflection makes five calls to the model the run used, so it spends your API credits.</li>
              <li>Lessons are yours alone: your analyses read them only while this is on, and nobody else&apos;s ever do.</li>
              <li>A BUY is judged on the price move, a SELL on its inverse, a HOLD as zero with the move shown for context.</li>
            </ul>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="rounded-md border border-border px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-muted">Memory</div>
                <p className="text-fg">{memorySummary(s)}</p>
                <ul className="mt-1 grid grid-cols-2 gap-x-3 text-[11px] text-fg-secondary">
                  {Object.entries(s.memories).map(([k, n]) => (
                    <li key={k} className="flex justify-between"><span>{MEMORY_LABELS[k] ?? k}</span><span className="tabular-nums">{n}</span></li>
                  ))}
                </ul>
              </div>
              <div className="rounded-md border border-border px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-muted">Reflections</div>
                <p className="text-fg">
                  {s.reflections.done} done{s.reflections.failed ? ` · ${s.reflections.failed} failed` : ""}
                  {s.reflections.skipped ? ` · ${s.reflections.skipped} skipped` : ""}
                </p>
                <p className="text-[11px] text-fg-secondary">
                  {s.running ? "Reflecting now…" : s.due == null ? "Turn it on to see which runs are due." : `${s.due} run${s.due === 1 ? "" : "s"} due.`}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={BTN_PRIMARY_SM_CLASS} disabled={!s.enabled || s.running || run.isPending || !s.due}
                onClick={() => run.mutate()}>{s.running ? "Reflecting…" : "Reflect now"}</button>
              <button type="button" className={BTN_SECONDARY_CLASS} disabled={clear.isPending || s.running || !Object.values(s.memories).some(Boolean)}
                onClick={() => { if (window.confirm("Forget everything the agents learned from your runs?")) clear.mutate(); }}>Clear memories</button>
              {error && <span className="text-xs text-red-500" role="alert">{error.message}</span>}
            </div>

            {s.recent.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-xs">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
                      <th className="py-1.5 pr-2 font-medium">Run</th>
                      <th className="py-1.5 pr-2 font-medium">Call</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Stock moved</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Scored</th>
                      <th className="py-1.5 font-medium">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.recent.map((r) => (
                      <tr key={r.run_id} className="border-b border-border/60 align-top last:border-0">
                        <td className="py-1.5 pr-2">
                          <Link href={`/runs/${r.run_id}`} className="font-medium text-fg hover:text-blue-500">{r.ticker}</Link>
                          <span className="ml-1 text-muted">{r.analysis_date}</span>
                        </td>
                        <td className="py-1.5 pr-2 uppercase text-fg-secondary">{r.verdict ?? "—"}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums text-fg-secondary">{fmtSignedPct(r.stock_return, 1)}</td>
                        <td className={`py-1.5 pr-2 text-right tabular-nums ${returnTone(r.realised_return)}`}>{fmtSignedPct(r.realised_return, 1)}</td>
                        <td className="py-1.5">
                          <span className={r.status === "done" ? "text-emerald-600 dark:text-emerald-400" : r.status === "failed" ? "text-red-500" : "text-muted"}>
                            {r.status === "done" ? `Learned (${r.horizon_days}d)` : r.status === "failed"
                              ? `Failed (attempt ${r.attempts} of 3${r.attempts < 3 ? ", will retry" : ""})` : "Skipped"}
                          </span>
                          {r.error && <span className="block text-[11px] text-muted">{r.error}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </SectionCard>
  );
}
