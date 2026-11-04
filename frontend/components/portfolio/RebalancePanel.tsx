"use client";

import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";

import { getRebalancePlan, putPortfolioTargets } from "@/lib/api";
import { fmtMoney } from "@/lib/currency";
import { fmtPct } from "@/lib/performance";
import { portfolioQueryKeys } from "@/lib/portfolioQueries";
import {
  REBALANCE_MODES,
  draftProblem,
  draftSum,
  draftsFromCurrent,
  draftsFromTargets,
  draftsToTargets,
  equalWeightDrafts,
  normaliseDrafts,
  planCsv,
  type DriftRow,
  type RebalanceMode,
  type RebalanceResponse,
  type TargetDraft,
} from "@/lib/rebalance";
import type { TrimSignalEntry } from "@/lib/types";
import { IconButton } from "@/components/ui/IconButton";
import {
  ALERT_BANNER_CLASS,
  BTN_PRIMARY_SM_CLASS,
  BTN_SECONDARY_CLASS,
  FIELD_INPUT_SM_CLASS,
  FIELD_LABEL_CLASS,
  selectionPillClass,
} from "@/lib/uiClasses";

const CARD = "rounded-lg border border-border bg-surface p-3";
const CURRENT_COLOR = "bg-[#2a78d6] dark:bg-[#3987e5]"; // categorical slot 1, as on the other tabs

const TRIM_LABEL: Record<string, string> = { strong_trim: "Strong trim signal", consider_trim: "Trim signal", watch: "Watch" };

interface Props {
  portfolioId: string;
  /** Trim signals from the Holdings tab, when the Markov module is on. */
  trimEntries?: TrimSignalEntry[];
}

export function RebalancePanel({ portfolioId, trimEntries }: Props) {
  const [mode, setMode] = useState<RebalanceMode>("bands");
  const [amountText, setAmountText] = useState("");
  const [wholeShares, setWholeShares] = useState(false);
  const modeInfo = REBALANCE_MODES.find((m) => m.id === mode)!;
  // Debounced so typing "5000" asks for one plan, not four.
  const debouncedAmount = useDebounced(amountText, 400);
  const amount = modeInfo.needsAmount ? Number(debouncedAmount) || 0 : 0;
  const ready = !modeInfo.needsAmount || amount > 0;

  const query = useQuery({
    queryKey: portfolioQueryKeys.rebalance(portfolioId, ready ? mode : "bands", amount, wholeShares),
    queryFn: () => getRebalancePlan(portfolioId, ready ? mode : "bands", amount, wholeShares),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === portfolioId ? keepPreviousData(previous) : undefined,
  });
  const data = query.data;

  return (
    <div className="space-y-4" aria-busy={query.isFetching}>
      {query.isPending && <div className={`${CARD} py-10 text-center text-sm text-muted`}>Loading prices and targets…</div>}
      {query.isError && !data && (
        <div className={ALERT_BANNER_CLASS} role="alert">{(query.error as Error).message}</div>
      )}
      {data && (
        <>
          {data.warnings.length > 0 && (
            <ul className={`${ALERT_BANNER_CLASS} list-disc space-y-0.5 pl-6`}>
              {data.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <DriftChart rows={data.drift} hasTargets={data.targets.length > 0} />
            <TargetsEditor key={JSON.stringify(data.targets)} portfolioId={portfolioId} data={data} />
          </div>
          {data.targets.length > 0 && (
            <section className={`${CARD} space-y-3`}>
              <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
                <fieldset className="min-w-0">
                  <legend className={FIELD_LABEL_CLASS}>Plan</legend>
                  <div className="flex flex-wrap gap-1">
                    {REBALANCE_MODES.map((m) => (
                      <button key={m.id} type="button" title={m.hint} aria-pressed={mode === m.id}
                        onClick={() => setMode(m.id)} className={`${selectionPillClass(mode === m.id, true)} !normal-case`}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                {modeInfo.needsAmount && (
                  <div>
                    <label htmlFor="rebal-amount" className={FIELD_LABEL_CLASS}>
                      {mode === "contribute" ? "Amount to invest" : "Amount to raise"} ({data.display_currency})
                    </label>
                    <input id="rebal-amount" type="number" inputMode="decimal" min={0} step="any" value={amountText}
                      onChange={(e) => setAmountText(e.target.value)} placeholder="e.g. 5000"
                      className={`${FIELD_INPUT_SM_CLASS} !w-36`} />
                  </div>
                )}
                <label className="inline-flex items-center gap-1.5 pb-1.5 text-xs text-fg-secondary">
                  <input type="checkbox" checked={wholeShares} onChange={(e) => setWholeShares(e.target.checked)} />
                  Whole shares (stocks)
                </label>
              </div>
              <p className="text-[11px] text-muted">{modeInfo.hint}</p>
              {!ready ? (
                <p className="text-sm text-muted">Enter an amount to see the plan.</p>
              ) : (
                <PlanView data={data} trimEntries={trimEntries} refreshing={query.isFetching} />
              )}
              <p className="text-[11px] text-muted">{data.disclaimer}</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

function DriftChart({ rows, hasTargets }: { rows: DriftRow[]; hasTargets: boolean }) {
  const max = Math.max(0.05, ...rows.map((r) => Math.max(r.weight ?? 0, (r.target ?? 0) + (r.band ?? 0))));
  const pct = (x: number) => `${(Math.max(0, x) / max) * 100}%`;
  const statusText: Record<DriftRow["status"], string> = {
    over: "over", under: "under", ok: "on target", untargeted: "no target", not_held: "not held",
  };
  return (
    <section className={CARD}>
      <h3 className="text-sm font-medium text-fg">Where you are vs your targets</h3>
      <div className="mb-2 mt-1 flex flex-wrap items-center gap-3 text-[11px] text-fg-secondary" aria-label="Legend">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className={`inline-block h-2 w-3 rounded-sm ${CURRENT_COLOR}`} />Current weight</span>
        {hasTargets && (
          <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-2 w-3 rounded-sm border border-border-strong bg-muted-surface" />Target ± band</span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted">No holdings yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const lo = (r.target ?? 0) - (r.band ?? 0);
            const hi = (r.target ?? 0) + (r.band ?? 0);
            const off = r.status === "over" || r.status === "under" || r.status === "not_held";
            return (
              <li key={r.ticker} className="grid grid-cols-[4.5rem_1fr_7.5rem] items-center gap-2 text-xs"
                title={`${r.ticker}: ${fmtPct(r.weight)} now${r.status !== "untargeted" ? `, target ${fmtPct(r.target)} ± ${fmtPct(r.band, 0)}` : ""}`}>
                <span className="truncate font-medium text-fg">{r.ticker}</span>
                <span className="relative h-4" aria-hidden>
                  {r.status !== "untargeted" && (
                    <>
                      <span className="absolute inset-y-0 rounded-sm border border-border-strong bg-muted-surface"
                        style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }} />
                      <span className="absolute inset-y-0 w-px bg-fg-secondary" style={{ left: pct(r.target ?? 0) }} />
                    </>
                  )}
                  <span className={`absolute top-1/2 h-1.5 -translate-y-1/2 rounded-r ${CURRENT_COLOR}`} style={{ left: 0, width: pct(r.weight ?? 0) }} />
                </span>
                <span className={`text-right tabular-nums ${off ? "font-medium text-fg" : "text-fg-secondary"}`}>
                  {fmtPct(r.weight)}
                  <span className="text-muted"> · {statusText[r.status]}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function TargetsEditor({ portfolioId, data }: { portfolioId: string; data: RebalanceResponse }) {
  const qc = useQueryClient();
  const saved = data.targets;
  const [open, setOpen] = useState(saved.length === 0);
  const [drafts, setDrafts] = useState<TargetDraft[]>(() =>
    saved.length ? draftsFromTargets(saved) : draftsFromCurrent(data.drift),
  );
  const [bandPct, setBandPct] = useState(() => String(Math.round((saved[0]?.band ?? 0.05) * 1000) / 10));
  const [newTicker, setNewTicker] = useState("");
  const held = useMemo(() => data.drift.filter((r) => r.shares > 0).map((r) => r.ticker), [data.drift]);
  const problem = draftProblem(drafts);
  const band = Math.min(50, Math.max(0.1, Number(bandPct) || 5)) / 100;

  const save = useMutation({
    mutationFn: () => putPortfolioTargets(portfolioId, draftsToTargets(drafts, band)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio-rebalance", portfolioId] });
      setOpen(false);
    },
  });

  if (!open) {
    return (
      <section className={CARD}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-fg">Targets</h3>
          <button type="button" className={BTN_SECONDARY_CLASS} onClick={() => setOpen(true)}>Edit targets</button>
        </div>
        <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
          {saved.map((t) => (
            <li key={t.ticker} className="flex justify-between gap-2">
              <span className="text-fg">{t.ticker}</span>
              <span className="tabular-nums text-fg-secondary">{fmtPct(t.weight)} ± {fmtPct(t.band, 1)}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const sum = draftSum(drafts.filter((d) => d.ticker.trim()));
  return (
    <form className={`${CARD} space-y-3`} onSubmit={(e) => { e.preventDefault(); if (!problem) save.mutate(); }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-fg">{saved.length ? "Edit targets" : "Set your target weights"}</h3>
        <div className="flex flex-wrap gap-1">
          <button type="button" className={BTN_SECONDARY_CLASS} onClick={() => setDrafts(draftsFromCurrent(data.drift))}>Current weights</button>
          <button type="button" className={BTN_SECONDARY_CLASS} onClick={() => setDrafts(equalWeightDrafts(held))}>Equal weight</button>
        </div>
      </div>
      <ul className="space-y-1.5">
        {drafts.map((d, i) => (
          <li key={i} className="grid grid-cols-[1fr_6rem_2rem] items-center gap-2">
            <input aria-label="Ticker" value={d.ticker} maxLength={16}
              onChange={(e) => setDrafts((cur) => cur.map((x, j) => (j === i ? { ...x, ticker: e.target.value.toUpperCase() } : x)))}
              className={FIELD_INPUT_SM_CLASS} />
            <span className="relative">
              <input aria-label={`Target % for ${d.ticker || "ticker"}`} type="number" inputMode="decimal" min={0} max={100} step="any"
                value={d.pct} onChange={(e) => setDrafts((cur) => cur.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))}
                className={`${FIELD_INPUT_SM_CLASS} pr-6 text-right`} />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted">%</span>
            </span>
            <IconButton icon={Trash2} label={`Remove ${d.ticker}`} tone="danger"
              onClick={() => setDrafts((cur) => cur.filter((_, j) => j !== i))} />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Add a ticker" placeholder="Add ticker, e.g. VTI" value={newTicker} maxLength={16}
          onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (newTicker.trim()) { setDrafts((cur) => [...cur, { ticker: newTicker.trim(), pct: "0" }]); setNewTicker(""); }
            }
          }}
          className={`${FIELD_INPUT_SM_CLASS} !w-44 placeholder:normal-case`} />
        <button type="button" className={BTN_SECONDARY_CLASS} disabled={!newTicker.trim()}
          onClick={() => { setDrafts((cur) => [...cur, { ticker: newTicker.trim(), pct: "0" }]); setNewTicker(""); }}>
          Add
        </button>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="rebal-band" className={FIELD_LABEL_CLASS}>Tolerance band (± pp)</label>
            <input id="rebal-band" type="number" min={0.1} max={50} step="any" value={bandPct}
              onChange={(e) => setBandPct(e.target.value)} className={`${FIELD_INPUT_SM_CLASS} !w-24`} />
          </div>
          <p className={`pb-2 text-xs tabular-nums ${Math.abs(sum - 100) <= 0.1 ? "text-fg-secondary" : "font-medium text-amber-600 dark:text-amber-400"}`}>
            Total {sum.toFixed(2)}%
            {Math.abs(sum - 100) > 0.1 && sum > 0 && (
              <button type="button" className="ml-2 underline" onClick={() => setDrafts(normaliseDrafts(drafts.filter((d) => d.ticker.trim())))}>
                Scale to 100%
              </button>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {saved.length > 0 && <button type="button" className={BTN_SECONDARY_CLASS} onClick={() => setOpen(false)}>Cancel</button>}
          <button type="submit" disabled={!!problem || save.isPending} className={BTN_PRIMARY_SM_CLASS}>
            {save.isPending ? "Saving…" : "Save targets"}
          </button>
        </div>
      </div>
      {problem && drafts.some((d) => d.ticker.trim()) && <p className="text-xs text-amber-600 dark:text-amber-400">{problem}</p>}
      {save.isError && <div className={ALERT_BANNER_CLASS} role="alert">{(save.error as Error).message}</div>}
    </form>
  );
}

function PlanView({ data, trimEntries, refreshing }: { data: RebalanceResponse; trimEntries?: TrimSignalEntry[]; refreshing: boolean }) {
  const plan = data.plan;
  const ccy = data.display_currency;
  const trim = useMemo(() => Object.fromEntries((trimEntries ?? []).map((e) => [e.ticker.toUpperCase(), e])), [trimEntries]);
  if (!plan) return <p className="text-sm text-muted">{data.message}</p>;
  const s = plan.summary;

  function download() {
    const blob = new Blob([planCsv(plan!, ccy)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rebalance-plan-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={`space-y-3 transition-opacity ${refreshing ? "opacity-70" : ""}`}>
      {plan.trades.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-fg-secondary">
          Nothing to trade: every holding is within its band.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-fg-secondary">
            <span><b className="text-fg">{s.trades}</b> trades</span>
            <span>Sell <b className="text-fg">{fmtMoney(s.sells, ccy)}</b></span>
            <span>Buy <b className="text-fg">{fmtMoney(s.buys, ccy)}</b></span>
            {s.cash_in > 0 && <span>New cash {fmtMoney(s.cash_in, ccy)}</span>}
            {s.cash_out > 0 && <span>Cash raised {fmtMoney(s.cash_out, ccy)}</span>}
            {Math.abs(s.cash_left) >= 0.01 && <span>Cash left {fmtMoney(s.cash_left, ccy)}</span>}
            <span>Turnover {fmtPct(s.turnover)}</span>
            <span>Largest drift {fmtPct(s.max_drift_before)} → {fmtPct(s.max_drift_after)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular-nums sm:min-w-[560px]">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 text-left font-medium">Ticker</th>
                  <th className="py-1 text-left font-medium">Action</th>
                  <th className="py-1 text-right font-medium">Shares</th>
                  <th className="py-1 text-right font-medium">Amount</th>
                  <th className="hidden py-1 text-right font-medium sm:table-cell">Weight</th>
                  <th className="hidden py-1 pl-3 text-left font-medium sm:table-cell">Signal</th>
                </tr>
              </thead>
              <tbody>
                {plan.trades.map((t) => {
                  const sig = trim[t.ticker];
                  const flag = t.action === "sell" && sig && sig.level !== "none" ? TRIM_LABEL[sig.level] : null;
                  return (
                    <tr key={t.ticker} className="border-t border-border/60">
                      <td className="py-1.5 font-medium text-fg">{t.ticker}</td>
                      <td className={`py-1.5 font-medium ${t.action === "sell" ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                        {t.action === "sell" ? "Sell" : "Buy"}
                      </td>
                      <td className="py-1.5 text-right text-fg-secondary">{Number(t.shares.toFixed(4)).toLocaleString()}</td>
                      <td className="py-1.5 text-right text-fg">{fmtMoney(t.amount, ccy)}</td>
                      <td className="hidden py-1.5 text-right text-fg-secondary sm:table-cell">{fmtPct(t.weight_before)} → {fmtPct(t.weight_after)}</td>
                      <td className="hidden py-1.5 pl-3 text-[11px] text-muted sm:table-cell" title={sig?.reasons.join(" · ")}>{flag ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button type="button" className={BTN_SECONDARY_CLASS} onClick={download}>Download plan (CSV)</button>
        </>
      )}
    </div>
  );
}
