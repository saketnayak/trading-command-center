"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, X } from "lucide-react";

import { compileAlertRule, createAlertRule, listPortfolios } from "@/lib/api";
import {
  ALERT_RULES_QUERY_KEY,
  CHANNEL_LABELS,
  asCompound,
  canRerun,
  compiledToRequest,
  compoundSubject,
  describeCondition,
  describeRule,
  firingNote,
  needsPortfolio,
  unsupportedLabel,
  type AlertChannel,
  type CompileResult,
  type CompiledRule,
} from "@/lib/alerts";
import { portfolioQueryKeys } from "@/lib/portfolioQueries";
import {
  ALERT_BANNER_CLASS,
  BTN_AI_SM_CLASS,
  BTN_GHOST_CLASS,
  BTN_PRIMARY_SM_CLASS,
  FIELD_INPUT_SM_CLASS,
  FIELD_LABEL_CLASS,
} from "@/lib/uiClasses";

const EXAMPLES = [
  "Tell me if any semiconductor holding goes Bear on Markov and drops below its 200-day",
  "Email me if NVDA falls 5% in a day while its AI verdict is SELL",
  "Warn me when a holding in my portfolio passes 25%, and re-run the analysis",
];
const COOLDOWNS = [0, 1, 6, 24, 72];
const MAX_TEXT = 500;

/** "Describe an alert": a sentence → the user's default LLM → a proposed rule the user checks, edits and saves. */
export function DescribeAlert() {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [result, setResult] = useState<CompileResult | null>(null);
  const [draft, setDraft] = useState<CompiledRule | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const { data: portfolios = [] } = useQuery({ queryKey: portfolioQueryKeys.list, queryFn: listPortfolios });

  const compile = useMutation({
    mutationFn: () => compileAlertRule(text.trim()),
    onSuccess: (res) => {
      setResult(res);
      setDraft(res.ok && res.rule ? res.rule : null);
      setSaved(null);
    },
  });
  const save = useMutation({
    mutationFn: (rule: CompiledRule) => createAlertRule(compiledToRequest(rule)),
    onSuccess: (_, rule) => {
      qc.invalidateQueries({ queryKey: ALERT_RULES_QUERY_KEY });
      setSaved(describeRule(rule));
      setResult(null);
      setDraft(null);
      setText("");
    },
  });

  function discard() {
    setResult(null);
    setDraft(null);
    save.reset();
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-4" aria-labelledby="describe-alert-title">
      <div>
        <h2 id="describe-alert-title" className="text-sm font-semibold text-fg">Describe an alert</h2>
        <p className="mt-0.5 text-xs text-muted">
          Say it in your own words. Your default AI model turns it into a rule for you to check before anything is
          saved. The rule is then checked by AgentFloor&apos;s own engine, without AI.
        </p>
      </div>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim().length >= 3) compile.mutate();
        }}
      >
        <label htmlFor="describe-alert-text" className="sr-only">Alert, in your own words</label>
        <textarea
          id="describe-alert-text"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim().length >= 3) compile.mutate();
          }}
          rows={2}
          placeholder={EXAMPLES[0]}
          className={`${FIELD_INPUT_SM_CLASS} resize-y`}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5" aria-label="Examples">
            {EXAMPLES.slice(1).map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setText(ex)}
                className="rounded-full border border-border px-2 py-0.5 text-left text-[11px] text-fg-secondary hover:border-border-strong hover:text-fg"
              >
                {ex}
              </button>
            ))}
          </div>
          <button type="submit" disabled={text.trim().length < 3 || compile.isPending} className={`${BTN_AI_SM_CLASS} gap-1.5`}>
            <Sparkles size={14} aria-hidden />
            {compile.isPending ? "Reading…" : "Turn into a rule"}
          </button>
        </div>
      </form>

      {compile.isError && <div className={ALERT_BANNER_CLASS} role="alert">{(compile.error as Error).message}</div>}

      {result && !result.ok && (
        <div className={ALERT_BANNER_CLASS} role="status">
          <p className="font-medium">That couldn&apos;t be turned into an alert rule.</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {result.problems.map((p) => <li key={p}>{p}</li>)}
            {result.unsupported.map((u) => <li key={u}>{unsupportedLabel(u)}</li>)}
          </ul>
          <p className="mt-1">Try rephrasing it, or build the alert with the form below.</p>
        </div>
      )}

      {result?.ok && draft && (
        <Proposal
          draft={draft}
          onChange={setDraft}
          result={result}
          portfolios={portfolios}
          onSave={() => save.mutate(draft)}
          onDiscard={discard}
          saving={save.isPending}
          saveError={save.isError ? (save.error as Error).message : null}
        />
      )}

      {saved && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400" role="status">
          {`Saved: ${saved}. It is checked every 15 minutes.`}
        </p>
      )}
    </section>
  );
}

function Proposal({
  draft, onChange, result, portfolios, onSave, onDiscard, saving, saveError,
}: {
  draft: CompiledRule;
  onChange: (r: CompiledRule) => void;
  result: CompileResult;
  portfolios: { id: string; name: string }[];
  onSave: () => void;
  onDiscard: () => void;
  saving: boolean;
  saveError: string | null;
}) {
  const needsPf = needsPortfolio(draft);
  const missingPortfolio = needsPf && !draft.portfolio_id;
  const isCompound = draft.kind === "compound";
  const compound = isCompound ? asCompound(draft.params) : null;
  const set = (patch: Partial<CompiledRule>) => onChange({ ...draft, ...patch });

  function setPortfolio(id: string) {
    const name = portfolios.find((p) => p.id === id)?.name ?? null;
    set({
      portfolio_id: id || null,
      portfolio_name: name,
      channels: id ? draft.channels : draft.channels.filter((c) => c !== "webhook"),
    });
  }
  function toggleChannel(c: AlertChannel) {
    set({ channels: draft.channels.includes(c) ? draft.channels.filter((x) => x !== c) : [...draft.channels, c] });
  }

  return (
    <div className="space-y-3 rounded-lg border border-purple-500/40 bg-purple-500/5 p-3" aria-live="polite">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Here&apos;s what I&apos;ll watch for</p>
        <p className="mt-1 text-sm font-semibold text-fg" data-testid="proposal-sentence">{describeRule(draft)}.</p>
        <p className="mt-0.5 text-[11px] text-muted">{firingNote(draft)}</p>
      </div>

      {compound && compound.conditions.length > 1 && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-secondary">
            <span>{`${compoundSubject(compound, draft.ticker, draft.portfolio_name)} matches`}</span>
            <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-input-border" role="group" aria-label="Combine conditions">
              {(["and", "or"] as const).map((op) => (
                <button
                  key={op}
                  type="button"
                  aria-pressed={compound.op === op}
                  onClick={() => set({ params: { ...compound, op } })}
                  className={`px-2 py-0.5 text-[11px] ${compound.op === op ? "bg-purple-600 text-white" : "text-fg-secondary hover:bg-muted-surface"}`}
                >
                  {op === "and" ? "all" : "any"}
                </button>
              ))}
            </div>
            <span>of:</span>
          </div>
          <ul className="space-y-1">
            {compound.conditions.map((c, i) => (
              <li key={i} className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg">
                <span>{describeCondition(c, draft.portfolio_name)}</span>
                <button
                  type="button"
                  aria-label={`Remove: ${describeCondition(c, draft.portfolio_name)}`}
                  onClick={() => set({ params: { ...compound, conditions: compound.conditions.filter((_, j) => j !== i) } })}
                  className="rounded p-0.5 text-muted hover:text-fg"
                >
                  <X size={12} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.unsupported.length > 0 && (
        <div className={ALERT_BANNER_CLASS}>
          <p className="font-medium">Left out (the rule can&apos;t express this):</p>
          <ul className="mt-0.5 list-disc pl-4">
            {result.unsupported.map((u) => <li key={u}>{u}</li>)}
          </ul>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="proposal-portfolio" className={FIELD_LABEL_CLASS}>
            Portfolio{needsPf ? "" : " (optional, for its webhook)"}
          </label>
          <select
            id="proposal-portfolio"
            value={draft.portfolio_id ?? ""}
            onChange={(e) => setPortfolio(e.target.value)}
            className={`${FIELD_INPUT_SM_CLASS} ${missingPortfolio ? "border-amber-500" : ""}`}
            aria-invalid={missingPortfolio}
          >
            <option value="">{needsPf ? "Choose…" : "None"}</option>
            {portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="proposal-cooldown" className={FIELD_LABEL_CLASS}>At most once every</label>
          <select
            id="proposal-cooldown"
            value={draft.cooldown_hours}
            onChange={(e) => set({ cooldown_hours: Number(e.target.value) })}
            className={FIELD_INPUT_SM_CLASS}
          >
            {COOLDOWNS.map((h) => <option key={h} value={h}>{h === 0 ? "no limit" : `${h} h`}</option>)}
          </select>
        </div>
      </div>

      <fieldset>
        <legend className={FIELD_LABEL_CLASS}>Deliver to</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-secondary">
          {(["inbox", "email", "webhook"] as AlertChannel[]).map((c) => (
            <label key={c} className={`inline-flex items-center gap-1.5 ${c === "webhook" && !draft.portfolio_id ? "opacity-50" : ""}`}>
              <input
                type="checkbox"
                checked={draft.channels.includes(c)}
                disabled={c === "inbox" || (c === "webhook" && !draft.portfolio_id)}
                onChange={() => toggleChannel(c)}
              />
              {CHANNEL_LABELS[c]}
            </label>
          ))}
        </div>
      </fieldset>

      {canRerun(draft.kind) && (
        <label className="flex items-start gap-2 text-xs text-fg-secondary">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={draft.rerun_analysis}
            onChange={(e) => set({ rerun_analysis: e.target.checked })}
          />
          <span>
            <span className="font-medium text-fg">Re-run the analysis when it fires</span>
            <span className="block text-[11px] text-muted">
              Starts a fresh AI analysis with your default model for each ticker it fires on (up to 3, reusing one from
              the last 20 hours) and links it from the alert. Uses your LLM credits. Research only: it never places an order.
            </span>
          </span>
        </label>
      )}

      {saveError && <div className={ALERT_BANNER_CLASS} role="alert">{saveError}</div>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-muted">{`Read by ${result.llm}. Nothing is saved until you save it.`}</p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onDiscard} className={BTN_GHOST_CLASS}>Discard</button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || missingPortfolio || (compound !== null && compound.conditions.length === 0)}
            className={BTN_PRIMARY_SM_CLASS}
          >
            {saving ? "Saving…" : missingPortfolio ? "Choose a portfolio" : "Save alert"}
          </button>
        </div>
      </div>
    </div>
  );
}
