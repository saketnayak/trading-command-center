"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { LlmConfigPicker, type LlmConfigValue } from "@/components/llm/LlmConfigPicker";
import { createBacktest, getBacktestMeta } from "@/lib/api";
import { cutoffAdvice, cutoffFor, decisionDates, parseTickers } from "@/lib/backtest";
import { DEFAULT_LLM_PROVIDER, type LlmProvider } from "@/lib/llmConfig";
import { useDefaultLlmConfig } from "@/lib/useDefaultLlmConfig";
import { BTN_PRIMARY_SM_CLASS, FIELD_INPUT_SM_CLASS, FIELD_LABEL_CLASS, selectionPillClass } from "@/lib/uiClasses";

const CARD = "rounded-lg border border-border bg-surface p-4";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function BacktestForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const meta = useQuery({ queryKey: ["backtest-meta"], queryFn: getBacktestMeta, staleTime: Infinity });
  const { provider: defaultProvider, model: defaultModel, resolveModel } = useDefaultLlmConfig();

  const [tickersText, setTickersText] = useState("AAPL, MSFT");
  const [start, setStart] = useState(isoDaysAgo(120));
  const [end, setEnd] = useState(isoDaysAgo(14));
  const [frequency, setFrequency] = useState<"weekly" | "daily">("weekly");
  const [horizon, setHorizon] = useState(5);
  // Follows the user's default model until they pick one here.
  const [llmChoice, setLlm] = useState<LlmConfigValue | null>(null);
  const [analysts, setAnalysts] = useState<string[]>(["market", "news"]);
  const [dryRun, setDryRun] = useState(true);
  const [budget, setBudget] = useState("5");
  const [cutoffOverride, setCutoffOverride] = useState("");
  const [name, setName] = useState("");

  const llm: LlmConfigValue = llmChoice ?? { provider: (defaultProvider as LlmProvider) ?? DEFAULT_LLM_PROVIDER, model: defaultModel, depth: "quick" };

  const tickers = parseTickers(tickersText);
  const model = resolveModel(llm);
  const decisions = decisionDates(start, end, frequency).length * tickers.length;
  const limits = meta.data?.limits;
  const cap = limits ? (dryRun ? limits.decisions_dry_run : limits.decisions) : Infinity;
  const knownCutoff = meta.data ? cutoffFor(model, meta.data.model_cutoffs) : null;
  const cutoff = cutoffOverride || knownCutoff;
  const advice = cutoffAdvice(start, end, cutoff);

  const problem =
    !tickers.length ? "Add at least one ticker."
      : limits && tickers.length > limits.tickers ? `Up to ${limits.tickers} tickers.`
        : !start || !end || start > end ? "The start date must be on or before the end date."
          : decisions === 0 ? "No trading days in that range."
            : decisions > cap ? `${decisions} decisions is over the limit of ${cap}. Shorten the range, use weekly, or drop tickers.`
              : !analysts.length ? "Pick at least one analyst."
                : !dryRun && !(Number(budget) > 0) ? "Set a budget cap for a real run."
                  : null;

  const create = useMutation({
    mutationFn: () => createBacktest({
      name: name.trim() || undefined, tickers, start_date: start, end_date: end, frequency, horizon_days: horizon,
      llm_provider: llm.provider, llm_model: model, depth: llm.depth ?? "quick", analysts, dry_run: dryRun,
      reflect: true, ...(dryRun ? {} : { budget_usd: Number(budget) }), ...(cutoffOverride ? { training_cutoff: cutoffOverride } : {}),
    }),
    onSuccess: (bt) => {
      qc.invalidateQueries({ queryKey: ["backtests"] });
      router.push(`/runs/backtest/${bt.id}`);
    },
  });

  return (
    <form className={`${CARD} space-y-4`} aria-labelledby="bt-form-heading"
      onSubmit={(e) => { e.preventDefault(); if (!problem) create.mutate(); }}>
      <h2 id="bt-form-heading" className="text-sm font-semibold text-fg">New backtest</h2>

      <div className="flex gap-1.5" role="group" aria-label="Mode">
        <button type="button" className={selectionPillClass(dryRun, true)} aria-pressed={dryRun} onClick={() => setDryRun(true)}>Dry run (free)</button>
        <button type="button" className={selectionPillClass(!dryRun, true)} aria-pressed={!dryRun} onClick={() => setDryRun(false)}>Real run</button>
      </div>
      <p className="text-[11px] leading-relaxed text-muted">
        {dryRun
          ? "A stub model always answers BUY, so this checks dates, prices and scoring without spending anything. It says nothing about the agents."
          : "Every decision is a full multi-agent analysis with your API key. Costs are estimated from token counts and the run stops at the budget cap."}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="bt-tickers" className={FIELD_LABEL_CLASS}>Tickers</label>
          <input id="bt-tickers" className={FIELD_INPUT_SM_CLASS} value={tickersText} onChange={(e) => setTickersText(e.target.value)}
            placeholder="AAPL, MSFT" spellCheck={false} />
        </div>
        <div>
          <label htmlFor="bt-start" className={FIELD_LABEL_CLASS}>From</label>
          <input id="bt-start" type="date" className={FIELD_INPUT_SM_CLASS} value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <label htmlFor="bt-end" className={FIELD_LABEL_CLASS}>To</label>
          <input id="bt-end" type="date" className={FIELD_INPUT_SM_CLASS} value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <div>
          <span className={FIELD_LABEL_CLASS}>Decide every</span>
          <div className="flex gap-1.5" role="group" aria-label="Frequency">
            {(["weekly", "daily"] as const).map((f) => (
              <button key={f} type="button" className={selectionPillClass(frequency === f, true)} aria-pressed={frequency === f}
                onClick={() => setFrequency(f)}>{f === "weekly" ? "Friday" : "Trading day"}</button>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="bt-horizon" className={FIELD_LABEL_CLASS}>Hold for (trading days)</label>
          <input id="bt-horizon" type="number" min={1} max={30} step={1} className={FIELD_INPUT_SM_CLASS} value={horizon}
            onChange={(e) => setHorizon(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} />
        </div>
      </div>

      <div>
        <span className={FIELD_LABEL_CLASS}>Model</span>
        <LlmConfigPicker value={llm} onChange={setLlm} showDepth layout="compact" />
      </div>

      <div>
        <span className={FIELD_LABEL_CLASS}>Analysts</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Analysts">
          {(meta.data?.analysts ?? ["market", "social", "news", "fundamentals"]).map((a) => (
            <button key={a} type="button" className={selectionPillClass(analysts.includes(a), true)} aria-pressed={analysts.includes(a)}
              onClick={() => setAnalysts((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]))}>{a}</button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {!dryRun && (
          <div>
            <label htmlFor="bt-budget" className={FIELD_LABEL_CLASS}>Budget cap (USD)</label>
            <input id="bt-budget" type="number" min="0" step="any" max={limits?.budget_usd} className={FIELD_INPUT_SM_CLASS}
              value={budget} onChange={(e) => setBudget(e.target.value)} />
          </div>
        )}
        <div>
          <label htmlFor="bt-cutoff" className={FIELD_LABEL_CLASS}>Training cutoff {knownCutoff ? `(known: ${knownCutoff})` : "(unknown)"}</label>
          <input id="bt-cutoff" type="date" className={FIELD_INPUT_SM_CLASS} value={cutoffOverride} onChange={(e) => setCutoffOverride(e.target.value)} />
        </div>
        <div className={dryRun ? "" : "sm:col-span-2"}>
          <label htmlFor="bt-name" className={FIELD_LABEL_CLASS}>Name (optional)</label>
          <input id="bt-name" className={FIELD_INPUT_SM_CLASS} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </div>
      </div>

      <p className={`rounded-md border px-3 py-2 text-xs ${advice.tone === "ok"
        ? "border-border bg-muted-surface text-fg-secondary" : "border-amber-700/40 bg-amber-900/10 text-amber-700 dark:text-amber-300"}`}>
        {advice.text}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={BTN_PRIMARY_SM_CLASS} disabled={!!problem || create.isPending}>
          {create.isPending ? "Starting…" : `Run ${decisions || ""} decision${decisions === 1 ? "" : "s"}`}
        </button>
        <span className="text-xs text-muted">{problem ?? `${tickers.length} ticker${tickers.length === 1 ? "" : "s"} × ${decisionDates(start, end, frequency).length} dates`}</span>
        {create.isError && <span className="text-xs text-red-500" role="alert">{(create.error as Error).message}</span>}
      </div>
    </form>
  );
}
