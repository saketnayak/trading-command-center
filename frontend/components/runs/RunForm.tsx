"use client";
import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { createRun } from "@/lib/api";
import { isCrypto } from "@/lib/asset";
import { DEFAULT_RESPONSE_LANGUAGE, RESPONSE_LANGUAGE_OPTIONS } from "@/lib/responseLanguage";
import type { ResponseLanguage } from "@/lib/responseLanguage";
import { ANALYST_OPTIONS, DEFAULT_ANALYSTS } from "@/lib/analystReports";
import { LlmConfigPicker, type LlmConfigValue } from "@/components/llm/LlmConfigPicker";
import { useDefaultLlmConfig } from "@/lib/useDefaultLlmConfig";
import { DEFAULT_LLM_DEPTH, DEFAULT_LLM_PROVIDER, type LlmDepth, type LlmProvider } from "@/lib/llmConfig";
import { BTN_PRIMARY_CLASS, FIELD_INPUT_CLASS, FIELD_LABEL_CLASS, selectionPillClass } from "@/lib/uiClasses";

const ANALYSTS = ANALYST_OPTIONS;

const POPULAR_TICKERS = [
  // Stocks
  "AAPL","MSFT","GOOGL","AMZN","NVDA","META","TSLA","BRK.B","JPM","V",
  "UNH","XOM","LLY","JNJ","MA","PG","MRK","HD","AVGO","CVX",
  "PEP","ABBV","KO","COST","WMT","BAC","MCD","ACN","CRM","TMO",
  "NFLX","AMD","ADBE","ORCL","QCOM","TXN","DHR","AMGN","NEE","PM",
  "INTC","RTX","HON","IBM","GE","BA","CAT","SBUX","NOW","PYPL",
  "COIN","PLTR","SNOW","UBER","ABNB","SHOP","SQ","ROKU","ZM","DDOG",
  // Crypto (BTC-USD format)
  "BTC-USD","ETH-USD","SOL-USD","BNB-USD","XRP-USD","ADA-USD",
  "DOGE-USD","AVAX-USD","DOT-USD","LINK-USD","MATIC-USD","UNI-USD",
  "NEAR-USD","APT-USD","ARB-USD","OP-USD","SUI-USD","TON-USD",
  "AAVE-USD","MKR-USD","PEPE-USD","WIF-USD",
];

export interface RunFormInitialValues {
  ticker?: string;
  provider?: string;
  model?: string;
  depth?: string;
  analysts?: string[];
  response_language?: ResponseLanguage;
  label?: string;
}

interface Props {
  onSuccess: (runId: string) => void;
  initialValues?: RunFormInitialValues;
}

export function RunForm({ onSuccess, initialValues }: Props) {
  const { provider: defaultProvider, model: defaultModel, depth: defaultDepth, resolveModel } = useDefaultLlmConfig();
  const [ticker, setTicker] = useState(initialValues?.ticker ?? "");
  const [label, setLabel] = useState(initialValues?.label ?? "");
  const [analysisDate, setAnalysisDate] = useState(new Date().toISOString().slice(0, 10));
  const [analysts, setAnalysts] = useState<string[]>(
    initialValues?.analysts ?? DEFAULT_ANALYSTS
  );
  const [llmConfig, setLlmConfig] = useState<LlmConfigValue>({
    provider: (initialValues?.provider as LlmProvider) ?? DEFAULT_LLM_PROVIDER,
    model: initialValues?.model ?? "",
    depth: (initialValues?.depth as LlmDepth) ?? DEFAULT_LLM_DEPTH,
  });
  const [responseLanguage, setResponseLanguage] = useState<ResponseLanguage>(
    initialValues?.response_language ?? DEFAULT_RESPONSE_LANGUAGE
  );

  useEffect(() => {
    if (initialValues?.provider || initialValues?.model || initialValues?.depth) return;
    setLlmConfig({
      provider: defaultProvider,
      model: defaultModel,
      depth: defaultDepth,
    });
  }, [defaultProvider, defaultModel, defaultDepth, initialValues]);

  const mutation = useMutation({
    mutationFn: createRun,
    onSuccess: (run) => onSuccess(run.id),
  });

  const cryptoTicker = isCrypto(ticker);

  function toggleAnalyst(name: string) {
    if (name === "fundamentals" && cryptoTicker) return;
    setAnalysts((prev) =>
      prev.includes(name) ? prev.filter((a) => a !== name) : [...prev, name]
    );
  }

  useEffect(() => {
    if (cryptoTicker) {
      setAnalysts((prev) => prev.filter((a) => a !== "fundamentals"));
    }
  }, [cryptoTicker]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (analysts.length === 0) return;
    mutation.mutate({
      ticker,
      analysis_date: analysisDate,
      analysts,
      llm_provider: llmConfig.provider,
      llm_model: resolveModel(llmConfig),
      depth: llmConfig.depth ?? DEFAULT_LLM_DEPTH,
      response_language: responseLanguage,
      ...(label ? { label } : {}),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface border border-border rounded-lg p-6 max-w-lg">
      <div className="mb-4">
        <label className={FIELD_LABEL_CLASS}>Label <span className="normal-case text-subtle">(optional)</span></label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. pre-earnings check"
          className={FIELD_INPUT_CLASS}
        />
      </div>

      <div className="mb-4">
        <label className={FIELD_LABEL_CLASS}>Ticker</label>
        <input
          required
          type="text"
          list="ticker-suggestions"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="AAPL"
          className={FIELD_INPUT_CLASS}
        />
        <datalist id="ticker-suggestions">
          {POPULAR_TICKERS.map((t) => <option key={t} value={t} />)}
        </datalist>
      </div>

      <div className="mb-4">
        <label className={FIELD_LABEL_CLASS}>Analysis Date</label>
        <input
          required
          type="date"
          value={analysisDate}
          onChange={(e) => setAnalysisDate(e.target.value)}
          className={FIELD_INPUT_CLASS}
        />
      </div>

      <div className="mb-4">
        <label className={FIELD_LABEL_CLASS}>Analysts</label>
        <div className="flex flex-wrap gap-2">
          {ANALYSTS.map((a) => {
            const selected = analysts.includes(a);
            return (
              <button
                key={a}
                type="button"
                onClick={() => toggleAnalyst(a)}
                className={selectionPillClass(selected)}
              >
                {a}
              </button>
            );
          })}
        </div>
        {analysts.length === 0 && (
          <p className="text-red-400 text-xs mt-1">Select at least one analyst.</p>
        )}
      </div>

      <div className="mb-6">
        <LlmConfigPicker
          value={llmConfig}
          onChange={setLlmConfig}
          showDepth
        />
      </div>

      <div className="mb-6">
        <label className={FIELD_LABEL_CLASS}>Response Language</label>
        <select
          value={responseLanguage}
          onChange={(e) => setResponseLanguage(e.target.value as ResponseLanguage)}
          className={FIELD_INPUT_CLASS}
        >
          {RESPONSE_LANGUAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={mutation.isPending || analysts.length === 0}
        className={BTN_PRIMARY_CLASS}
      >
        {mutation.isPending ? "Launching…" : "Launch Run"}
      </button>

      {mutation.isError && (
        <p className="text-red-400 text-xs mt-2">Failed to launch run.</p>
      )}
    </form>
  );
}
