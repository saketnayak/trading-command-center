"use client";

import { useEffect, useState } from "react";
import { isCrypto } from "@/lib/asset";
import { LlmConfigPicker, type LlmConfigValue } from "@/components/llm/LlmConfigPicker";
import { useDefaultLlmConfig } from "@/lib/useDefaultLlmConfig";
import { DEFAULT_LLM_DEPTH } from "@/lib/llmConfig";
import { DEFAULT_RESPONSE_LANGUAGE, RESPONSE_LANGUAGE_OPTIONS } from "@/lib/responseLanguage";
import type { ResponseLanguage } from "@/lib/responseLanguage";
import { ANALYST_OPTIONS, DEFAULT_ANALYSTS } from "@/lib/analystReports";
import type { AddWatchlistItemRequest } from "@/lib/types";
import {
  DEFAULT_WATCHLIST_CRON,
  WatchlistScheduleBuilder,
} from "@/components/watchlist/WatchlistScheduleBuilder";
import {
  WATCHLIST_FIELD_INPUT_CLASS,
  WATCHLIST_FIELD_LABEL_CLASS,
  watchlistAnalystPillClass,
} from "@/components/watchlist/watchlistFormStyles";
import { BTN_PRIMARY_CLASS } from "@/lib/uiClasses";

const ANALYSTS = ANALYST_OPTIONS;

type AddWatchlistItemFormProps = {
  onAdd: (req: AddWatchlistItemRequest) => void;
  isPending: boolean;
};

export function AddWatchlistItemForm({ onAdd, isPending }: AddWatchlistItemFormProps) {
  const { provider, model, depth, resolveModel } = useDefaultLlmConfig();
  const [ticker, setTicker] = useState("");
  const [llmConfig, setLlmConfig] = useState<LlmConfigValue>({ provider, model, depth });
  const [analysts, setAnalysts] = useState<string[]>(DEFAULT_ANALYSTS);
  const [responseLanguage, setResponseLanguage] = useState<ResponseLanguage>(DEFAULT_RESPONSE_LANGUAGE);
  const [cron, setCron] = useState<string | null>(DEFAULT_WATCHLIST_CRON);

  useEffect(() => {
    setLlmConfig({ provider, model, depth });
  }, [provider, model, depth]);

  const cryptoTicker = isCrypto(ticker);

  function toggleAnalyst(name: string) {
    if (name === "fundamentals" && cryptoTicker) return;
    setAnalysts((prev) =>
      prev.includes(name) ? prev.filter((a) => a !== name) : [...prev, name],
    );
  }

  useEffect(() => {
    if (cryptoTicker) {
      setAnalysts((prev) => prev.filter((a) => a !== "fundamentals"));
    }
  }, [cryptoTicker]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker || analysts.length === 0) return;
    onAdd({
      ticker,
      llm_provider: llmConfig.provider,
      llm_model: resolveModel(llmConfig),
      depth: llmConfig.depth ?? DEFAULT_LLM_DEPTH,
      analysts,
      response_language: responseLanguage,
      schedule_cron: cron,
    });
    setTicker("");
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-2 lg:gap-8">
      {/* Left: ticker + schedule */}
      <div className="space-y-4">
        <div>
          <label className={WATCHLIST_FIELD_LABEL_CLASS}>Ticker</label>
          <input
            required
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="AAPL"
            className={WATCHLIST_FIELD_INPUT_CLASS}
          />
        </div>

        <div className="rounded-lg border border-border bg-input/30 px-3 py-3">
          <WatchlistScheduleBuilder cron={cron} onCronChange={setCron} compact />
        </div>
      </div>

      {/* Right: LLM → analysts → language (matches New Run field order) */}
      <div className="space-y-4">
        <LlmConfigPicker value={llmConfig} onChange={setLlmConfig} showDepth layout="stacked" />

        <div>
          <label className={WATCHLIST_FIELD_LABEL_CLASS}>Analysts</label>
          <div className="flex flex-wrap gap-2">
            {ANALYSTS.map((analyst) => {
              const selected = analysts.includes(analyst);
              const disabled = analyst === "fundamentals" && cryptoTicker;
              return (
                <button
                  key={analyst}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleAnalyst(analyst)}
                  className={`${watchlistAnalystPillClass(selected)} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
                >
                  {analyst}
                </button>
              );
            })}
          </div>
          {analysts.length === 0 && (
            <p className="mt-1 text-xs text-red-400">Select at least one analyst.</p>
          )}
        </div>

        <div>
          <label className={WATCHLIST_FIELD_LABEL_CLASS}>Response language</label>
          <select
            value={responseLanguage}
            onChange={(e) => setResponseLanguage(e.target.value as ResponseLanguage)}
            className={WATCHLIST_FIELD_INPUT_CLASS}
          >
            {RESPONSE_LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={!ticker || analysts.length === 0 || isPending}
            className={BTN_PRIMARY_CLASS}
          >
            {isPending ? "Adding…" : "Add to watchlist"}
          </button>
        </div>
      </div>
    </form>
  );
}
