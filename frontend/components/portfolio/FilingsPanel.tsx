"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, RefreshCw } from "lucide-react";

import { getPortfolioFilings, refreshPortfolioFilings } from "@/lib/api";
import { timeAgo } from "@/lib/alerts";
import {
  CHANGE_LABELS,
  FORM_FILTERS,
  FORM_NAMES,
  compactMoney,
  digestNote,
  filingsQueryKey,
  filterFilings,
  insiderLine,
  type Filing,
  type FilingsReport,
  type FormFilter,
  type InsiderSummary,
} from "@/lib/filings";
import { ALERT_BANNER_CLASS, BTN_SECONDARY_CLASS, selectionPillClass } from "@/lib/uiClasses";

const RANGES = [30, 90, 120] as const;
const LINK = "inline-flex items-center gap-1 text-blue-500 hover:text-blue-400";

export function FilingsPanel({ portfolioId }: { portfolioId: string }) {
  const qc = useQueryClient();
  const [days, setDays] = useState<number>(90);
  const [filter, setFilter] = useState<FormFilter>("all");
  const { data, isPending, isError, error } = useQuery({
    queryKey: filingsQueryKey(portfolioId, days),
    queryFn: () => getPortfolioFilings(portfolioId, days),
    refetchInterval: (q) => ((q.state.data as FilingsReport | undefined)?.syncing ? 3000 : false),
  });
  const refresh = useMutation({
    mutationFn: () => refreshPortfolioFilings(portfolioId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["filings", portfolioId] }),
  });

  if (isPending) return <p className="text-sm text-muted">Loading filings…</p>;
  if (isError) return <div className={ALERT_BANNER_CLASS}>{(error as Error).message}</div>;

  const filings = filterFilings(data.filings, filter);
  const firstSync = data.syncing && data.never_synced.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">What changed in your holdings&apos; SEC filings</h2>
          <p className="mt-0.5 text-xs text-muted">
            {`New 10-K and 10-Q risk factors compared with the previous report, 8-K current reports, and insider trades from Form 4, straight from SEC EDGAR. ${data.covered.length} of ${data.holdings} holdings file with the SEC.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted" role="status">
            {data.syncing ? "Checking EDGAR…" : data.last_synced_at ? `Updated ${timeAgo(data.last_synced_at)}` : ""}
          </span>
          <button
            type="button"
            className={`${BTN_SECONDARY_CLASS} gap-1.5`}
            onClick={() => refresh.mutate()}
            disabled={data.syncing || refresh.isPending || data.holdings === 0 || data.needs_contact}
          >
            <RefreshCw size={13} className={data.syncing ? "animate-spin" : ""} aria-hidden />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="group" aria-label="Period">
          {RANGES.map((d) => (
            <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={selectionPillClass(days === d, true)}>
              {`${d} days`}
            </button>
          ))}
        </div>
        <div className="flex gap-1" role="group" aria-label="Form type">
          {FORM_FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} className={selectionPillClass(filter === f.id, true)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {data.needs_contact && (
        <div className={ALERT_BANNER_CLASS}>
          The SEC only answers clients that identify themselves with a contact email. Your administrator needs to set{" "}
          <code>SEC_USER_AGENT</code> to a name and email, such as <code>Jane Doe jane@example.com</code>, and restart
          AgentFloor. Filings will load after that.
        </div>
      )}
      {!data.llm_available && data.filings.length > 0 && (
        <div className={ALERT_BANNER_CLASS}>
          Add an LLM key in Settings to get a short summary of each filing, with every point quoted from the filing.
          Until then each filing shows what changed by count, with links to the source.
        </div>
      )}
      {Object.keys(data.sync_errors).length > 0 && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          {`EDGAR could not be read for ${Object.keys(data.sync_errors).join(", ")}; the next refresh tries again.`}
        </p>
      )}
      {refresh.isError && <div className={ALERT_BANNER_CLASS}>{(refresh.error as Error).message}</div>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="space-y-2" aria-label="Filings">
          {firstSync ? (
            <Empty>Fetching filings from SEC EDGAR. This takes a few seconds per holding.</Empty>
          ) : data.holdings === 0 ? (
            <Empty>Add holdings to see their SEC filings.</Empty>
          ) : filings.length === 0 ? (
            <Empty>{`No ${filter === "all" ? "" : FORM_FILTERS.find((f) => f.id === filter)?.label + " "}filings in the last ${days} days.`}</Empty>
          ) : (
            <ul className="space-y-2">
              {filings.map((f) => (
                <FilingCard key={f.accession} filing={f} llmAvailable={data.llm_available} />
              ))}
            </ul>
          )}
          {data.no_filer.length > 0 && (
            <p className="text-[11px] text-muted">
              {`No SEC reports for ${data.no_filer.join(", ")} (funds, crypto and companies listed outside the US usually don't file them).`}
            </p>
          )}
        </section>

        <section className="space-y-2" aria-labelledby="insiders-title">
          <h3 id="insiders-title" className="text-sm font-semibold text-fg">Insider trades</h3>
          <p className="text-[11px] text-muted">
            Open-market buys and sells by officers, directors and 10% owners (Form 4). Grants, option exercises,
            tax withholding and gifts are counted but not listed.
          </p>
          {data.insiders.length === 0 ? (
            <Empty>{firstSync ? "Waiting for EDGAR…" : `No insider trades in the last ${days} days.`}</Empty>
          ) : (
            <ul className="space-y-2">
              {data.insiders.map((s) => (
                <InsiderCard key={s.ticker} s={s} />
              ))}
            </ul>
          )}
        </section>
      </div>
      <p className="text-[11px] text-muted">
        Research only. Summaries are written by your AI model from the filing text and every point quotes it; check
        the filing before relying on it.
      </p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">{children}</p>;
}

function FilingCard({ filing: f, llmAvailable }: { filing: Filing; llmAvailable: boolean }) {
  const note = digestNote(f, llmAvailable);
  return (
    <li className="rounded-lg border border-border bg-surface px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-data text-sm font-semibold text-fg">{f.ticker}</span>
        <span className="rounded border border-input-border px-1.5 py-px text-[11px] font-medium text-fg-secondary" title={FORM_NAMES[f.form]}>
          {f.form}
        </span>
        <time className="text-[11px] text-muted" dateTime={f.filed_date}>{`filed ${f.filed_date}`}</time>
        {f.items.map((i) => (
          <span
            key={i.item}
            className={`rounded px-1.5 py-px text-[11px] ${i.notable ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-muted-surface text-fg-secondary"}`}
          >
            {i.label}
          </span>
        ))}
      </div>

      {f.digest ? (
        <div className="mt-1.5">
          <p className="text-sm font-medium text-fg">{f.digest.headline}</p>
          <ul className="mt-1 space-y-1.5">
            {f.digest.points.map((p, i) => (
              <li key={i} className="text-xs text-fg-secondary">
                {CHANGE_LABELS[p.kind] && (
                  <span className="mr-1.5 rounded bg-muted-surface px-1 py-px text-[10px] font-medium uppercase tracking-wide text-muted">
                    {CHANGE_LABELS[p.kind]}
                  </span>
                )}
                {p.text}
                <blockquote className="mt-0.5 border-l-2 border-border pl-2 text-[11px] italic text-muted">
                  {`“${p.quote}” `}
                  <a href={p.link} target="_blank" rel="noopener noreferrer" className={`${LINK} not-italic`}>
                    {p.kind === "removed" ? "in the previous filing" : "in the filing"}
                    <ExternalLink size={10} aria-hidden />
                  </a>
                </blockquote>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] text-muted">{`AI summary${f.digest.model ? ` by ${f.digest.model}` : ""}; each point quotes the filing.`}</p>
        </div>
      ) : null}

      {f.summary && <p className={`text-xs text-fg-secondary ${f.digest ? "mt-1 text-[11px] text-muted" : "mt-1"}`}>{f.summary}</p>}
      {note && <p className="mt-0.5 text-[11px] text-muted">{note}</p>}

      <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px]">
        <a href={f.url} target="_blank" rel="noopener noreferrer" className={LINK}>
          {`Open ${f.form}`}
          <ExternalLink size={10} aria-hidden />
        </a>
        {f.prev && (
          <a href={f.prev.url} target="_blank" rel="noopener noreferrer" className={LINK}>
            {`Previous ${f.prev.form} (${f.prev.filed_date})`}
            <ExternalLink size={10} aria-hidden />
          </a>
        )}
      </div>
    </li>
  );
}

function InsiderCard({ s }: { s: InsiderSummary }) {
  const tone = s.net_value > 0 ? "text-emerald-600 dark:text-emerald-400" : s.net_value < 0 ? "text-red-600 dark:text-red-400" : "text-muted";
  return (
    <li className="rounded-lg border border-border bg-surface px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-data text-sm font-semibold text-fg">{s.ticker}</span>
        {(s.buys > 0 || s.sells > 0) && (
          <span className={`font-data text-xs tabular-nums ${tone}`}>
            {`net ${s.net_value >= 0 ? "+" : "−"}${compactMoney(s.net_value)}`}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-xs text-fg-secondary">{insiderLine(s)}</p>
      {s.other_transactions > 0 && (
        <p className="text-[11px] text-muted">{`${s.other_transactions} other transaction${s.other_transactions === 1 ? "" : "s"} (grants, exercises, tax, gifts)`}</p>
      )}
      {s.recent.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {s.recent.map((t, i) => (
            <li key={`${t.url}-${i}`} className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
              <span className="text-muted">{t.date}</span>
              <span className={t.code === "P" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                {t.code === "P" ? "Bought" : "Sold"}
              </span>
              <span className="font-data tabular-nums text-fg">
                {`${t.shares.toLocaleString()}${t.price ? ` @ ${t.price.toFixed(2)}` : ""}`}
              </span>
              <a href={t.url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-fg-secondary hover:text-fg" title={t.role ?? undefined}>
                {`${t.owner ?? "Insider"}${t.role ? `, ${t.role}` : ""}`}
              </a>
              {t.planned && <span className="rounded bg-muted-surface px-1 text-[10px] text-muted" title="Under a pre-arranged Rule 10b5-1 trading plan">10b5-1</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
