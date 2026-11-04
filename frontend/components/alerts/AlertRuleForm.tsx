"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createAlertRule, listPortfolios } from "@/lib/api";
import {
  ALERT_KINDS,
  ALERT_RULES_QUERY_KEY,
  CHANNEL_LABELS,
  defaultParams,
  describeRule,
  kindOption,
  toApiParams,
  type AlertChannel,
  type AlertKind,
} from "@/lib/alerts";
import { portfolioQueryKeys } from "@/lib/portfolioQueries";
import { ALERT_BANNER_CLASS, BTN_PRIMARY_SM_CLASS, FIELD_INPUT_SM_CLASS, FIELD_LABEL_CLASS } from "@/lib/uiClasses";

const COOLDOWNS = [0, 1, 6, 24, 72];

export function AlertRuleForm({ initialTicker = "", initialKind }: { initialTicker?: string; initialKind?: AlertKind }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<AlertKind>(initialKind ?? "price_above");
  const [ticker, setTicker] = useState(initialTicker.toUpperCase());
  const [portfolioId, setPortfolioId] = useState("");
  const [values, setValues] = useState<Record<string, number | string>>(() => defaultParams(initialKind ?? "price_above"));
  const [channels, setChannels] = useState<AlertChannel[]>(["inbox"]);
  const [cooldown, setCooldown] = useState(6);

  const opt = kindOption(kind);
  const { data: portfolios = [] } = useQuery({ queryKey: portfolioQueryKeys.list, queryFn: listPortfolios });

  const create = useMutation({
    mutationFn: () =>
      createAlertRule({
        kind,
        ticker: opt.scope === "ticker" ? ticker.trim().toUpperCase() : null,
        portfolio_id: portfolioId || null,
        params: toApiParams(kind, values),
        channels,
        cooldown_hours: cooldown,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ALERT_RULES_QUERY_KEY });
      setValues(defaultParams(kind));
    },
  });

  const missing = useMemo(() => {
    if (opt.scope === "ticker" && !ticker.trim()) return "Enter a ticker.";
    if (opt.scope === "portfolio" && !portfolioId) return "Choose a portfolio.";
    for (const f of opt.fields) {
      if (f.type === "number" && (values[f.name] === undefined || values[f.name] === "")) return `Enter ${f.label.toLowerCase()}.`;
    }
    return null;
  }, [opt, ticker, portfolioId, values]);

  const portfolioName = portfolios.find((p) => p.id === portfolioId)?.name ?? null;
  const preview = missing ? null : describeRule({ kind, ticker: ticker.trim().toUpperCase(), params: toApiParams(kind, values), portfolio_name: portfolioName });

  function toggleChannel(c: AlertChannel) {
    setChannels((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  }

  return (
    <form
      className="space-y-3 rounded-lg border border-border bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!missing) create.mutate();
      }}
    >
      <h2 className="text-sm font-semibold text-fg">New alert</h2>

      <div>
        <label htmlFor="alert-kind" className={FIELD_LABEL_CLASS}>Alert me when</label>
        <select
          id="alert-kind"
          value={kind}
          onChange={(e) => {
            const k = e.target.value as AlertKind;
            setKind(k);
            setValues(defaultParams(k));
          }}
          className={FIELD_INPUT_SM_CLASS}
        >
          {(["Price", "Signals", "Portfolio"] as const).map((g) => (
            <optgroup key={g} label={g}>
              {ALERT_KINDS.filter((k) => k.group === g).map((k) => (
                <option key={k.kind} value={k.kind}>{k.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-muted">{opt.hint}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {opt.scope === "ticker" && (
          <div>
            <label htmlFor="alert-ticker" className={FIELD_LABEL_CLASS}>Ticker</label>
            <input
              id="alert-ticker"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="AAPL, BTC-USD…"
              maxLength={16}
              className={`${FIELD_INPUT_SM_CLASS} placeholder:normal-case`}
            />
          </div>
        )}
        <div>
          <label htmlFor="alert-portfolio" className={FIELD_LABEL_CLASS}>
            Portfolio{opt.scope === "ticker" ? " (optional, for its webhook)" : ""}
          </label>
          <select
            id="alert-portfolio"
            value={portfolioId}
            onChange={(e) => {
              setPortfolioId(e.target.value);
              if (!e.target.value) setChannels((cur) => cur.filter((c) => c !== "webhook"));
            }}
            className={FIELD_INPUT_SM_CLASS}
          >
            <option value="">{opt.scope === "portfolio" ? "Choose…" : "None"}</option>
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        {opt.fields.map((f) => (
          <div key={f.name}>
            <label htmlFor={`alert-${f.name}`} className={FIELD_LABEL_CLASS}>
              {f.label}{f.type === "number" && f.suffix ? ` (${f.suffix.trim()})` : ""}
            </label>
            {f.type === "number" ? (
              <input
                id={`alert-${f.name}`}
                type="number"
                inputMode="decimal"
                min={f.min}
                max={f.max}
                step={f.step ?? "any"}
                value={values[f.name] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                className={FIELD_INPUT_SM_CLASS}
              />
            ) : (
              <select
                id={`alert-${f.name}`}
                value={String(values[f.name] ?? f.default)}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                className={FIELD_INPUT_SM_CLASS}
              >
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            )}
          </div>
        ))}
      </div>

      <fieldset>
        <legend className={FIELD_LABEL_CLASS}>Deliver to</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-secondary">
          {(["inbox", "email", "webhook"] as AlertChannel[]).map((c) => (
            <label key={c} className={`inline-flex items-center gap-1.5 ${c === "webhook" && !portfolioId ? "opacity-50" : ""}`}>
              <input
                type="checkbox"
                checked={channels.includes(c)}
                disabled={c === "inbox" || (c === "webhook" && !portfolioId)}
                onChange={() => toggleChannel(c)}
              />
              {CHANNEL_LABELS[c]}
              {c === "webhook" && !portfolioId ? " (choose a portfolio)" : ""}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <label htmlFor="alert-cooldown" className={FIELD_LABEL_CLASS}>At most once every</label>
          <select id="alert-cooldown" value={cooldown} onChange={(e) => setCooldown(Number(e.target.value))} className={`${FIELD_INPUT_SM_CLASS} !w-auto`}>
            {COOLDOWNS.map((h) => (
              <option key={h} value={h}>{h === 0 ? "no limit" : `${h} h`}</option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={!!missing || create.isPending} className={BTN_PRIMARY_SM_CLASS}>
          {create.isPending ? "Saving…" : "Create alert"}
        </button>
      </div>

      {preview && <p className="text-xs text-fg-secondary">Will alert when <b className="text-fg">{preview}</b>.</p>}
      {create.isError && (
        <div className={ALERT_BANNER_CLASS} role="alert">{(create.error as Error).message}</div>
      )}
      {create.isSuccess && !create.isPending && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400" role="status">Alert created. It is checked every 15 minutes.</p>
      )}
    </form>
  );
}
