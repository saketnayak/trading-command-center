"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createJevSession, validateJevSymbol } from "@/lib/api";
import type { JevMeta, JevMode, JevSession, JevSymbolSpec } from "@/lib/jev/types";

const inputClass =
  "bg-input border border-input-border rounded-sm px-2 py-1 text-xs text-fg focus:outline-hidden focus:border-blue-500";

function OverrideGrid({
  names,
  defaults,
  values,
  onChange,
  maxIsDefault,
}: {
  names: string[];
  defaults: Record<string, number>;
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  maxIsDefault?: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {names.map((name) => (
        <label key={name} className="flex items-center justify-between gap-2 text-[11px] text-fg-secondary">
          <span className="font-mono truncate" title={name}>{name}</span>
          <input
            type="number"
            step="any"
            min={0}
            max={maxIsDefault && name !== "tick_seconds" ? defaults[name] : undefined}
            value={values[name] ?? ""}
            placeholder={String(defaults[name])}
            onChange={(e) => onChange(name, e.target.value)}
            className={`${inputClass} w-24 text-right`}
          />
        </label>
      ))}
    </div>
  );
}

function toNumbers(values: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v.trim() !== "" && Number.isFinite(Number(v))) out[k] = Number(v);
  }
  return out;
}

export function NewSessionForm({
  meta,
  isAdmin,
  onCreated,
}: {
  meta: JevMeta;
  isAdmin: boolean;
  onCreated: (s: JevSession) => void;
}) {
  const [symbol, setSymbol] = useState("BTC/USD");
  const [spec, setSpec] = useState<JevSymbolSpec | null>(null);
  const [symbolError, setSymbolError] = useState<string | null>(null);
  const [mode, setMode] = useState<JevMode>("shadow");
  const [forceMock, setForceMock] = useState(false);
  const [minutes, setMinutes] = useState("60");
  const [maxTicks, setMaxTicks] = useState("");
  const [thresholds, setThresholds] = useState<Record<string, string>>({});
  const [limits, setLimits] = useState<Record<string, string>>({});

  async function checkSymbol() {
    setSpec(null);
    setSymbolError(null);
    if (!symbol.trim()) return;
    try {
      setSpec(await validateJevSymbol(symbol));
    } catch (e) {
      setSymbolError((e as Error).message);
    }
  }

  const mutation = useMutation({
    mutationFn: () =>
      createJevSession({
        symbol,
        mode,
        force_mock: mode === "shadow" && forceMock,
        max_duration_minutes: Number(minutes) || 60,
        max_ticks: maxTicks.trim() ? Number(maxTicks) : null,
        thresholds: toNumbers(thresholds),
        limits: toNumbers(limits),
      }),
    onSuccess: onCreated,
  });

  return (
    <form
      className="space-y-4 px-4 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Symbol
          <input
            value={symbol}
            onChange={(e) => {
              setSymbol(e.target.value.toUpperCase());
              setSpec(null);
              setSymbolError(null);
            }}
            onBlur={checkSymbol}
            placeholder="BTC/USD or AAPL"
            aria-describedby="jev-symbol-hint"
            className={`${inputClass} w-36 font-mono`}
          />
        </label>
        <fieldset className="flex flex-col gap-1 text-xs text-muted">
          <legend className="mb-1">Mode</legend>
          <div className="flex gap-3">
            <label className="flex items-center gap-1 text-fg-secondary">
              <input type="radio" checked={mode === "shadow"} onChange={() => setMode("shadow")} className="accent-blue-600" />
              Shadow
            </label>
            <label className={`flex items-center gap-1 ${isAdmin ? "text-fg-secondary" : "text-muted opacity-60"}`}>
              <input
                type="radio"
                checked={mode === "paper"}
                disabled={!isAdmin}
                onChange={() => setMode("paper")}
                className="accent-green-600"
              />
              Paper
            </label>
          </div>
        </fieldset>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Max duration (min)
          <input type="number" min={1} max={1440} value={minutes} onChange={(e) => setMinutes(e.target.value)} className={`${inputClass} w-24`} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Max ticks (optional)
          <input type="number" min={1} value={maxTicks} onChange={(e) => setMaxTicks(e.target.value)} placeholder="none" className={`${inputClass} w-24`} />
        </label>
        {mode === "shadow" && (
          <label className="flex items-center gap-1.5 text-xs text-fg-secondary">
            <input type="checkbox" checked={forceMock} onChange={(e) => setForceMock(e.target.checked)} className="accent-amber-500" />
            Use the mock decider (no Jev cost)
          </label>
        )}
      </div>

      <p id="jev-symbol-hint" className="text-[11px] text-muted">
        {symbolError ? (
          <span className="text-red-500 dark:text-red-400">{symbolError}</span>
        ) : spec ? (
          <>
            <span className="font-mono text-fg-secondary">{spec.symbol}</span> ·{" "}
            {spec.is_24_7 ? "crypto, trades 24/7 with order-book depth" : "US equity, market hours only, best bid/ask only"} · min order $
            {spec.min_notional_usd}
          </>
        ) : mode === "paper" ? (
          "Paper mode places real orders on your Alpaca paper account (never live). Admin-only; needs a Jev key."
        ) : (
          "Shadow mode uses real market data and real Jev answers but never places an order."
        )}
      </p>

      <details className="rounded-md border border-border bg-input/30 px-3 py-2">
        <summary className="cursor-pointer text-xs text-fg-secondary">Strategy thresholds and risk limits</summary>
        <div className="mt-3 space-y-4">
          <div>
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted">Strategy thresholds</p>
            <OverrideGrid
              names={meta.threshold_names}
              defaults={meta.thresholds}
              values={thresholds}
              onChange={(n, v) => setThresholds({ ...thresholds, [n]: v })}
            />
          </div>
          <div>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted">Risk limits</p>
            <p className="mb-2 text-[11px] text-muted">Limits can only be tightened (lowered); the tick interval can only be slowed.</p>
            <OverrideGrid
              names={meta.lowerable_limits}
              defaults={meta.limits}
              values={limits}
              onChange={(n, v) => setLimits({ ...limits, [n]: v })}
              maxIsDefault
            />
          </div>
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={mutation.isPending || !symbol.trim()}
          className="rounded-sm bg-blue-600 px-4 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {mutation.isPending ? "Starting…" : mode === "paper" ? "Start paper session" : "Start shadow session"}
        </button>
        {mutation.isError && <span className="text-xs text-red-500 dark:text-red-400">{(mutation.error as Error).message}</span>}
      </div>
    </form>
  );
}
