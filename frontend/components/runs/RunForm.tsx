"use client";
import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createRun, getProviderModels } from "@/lib/api";
import { isCrypto } from "@/lib/asset";

const ANALYSTS = ["market", "social", "news", "fundamentals", "technical"];
const LOCAL_PROVIDERS = ["ollama", "vllm"];

const PLACEHOLDERS: Record<string, string> = {
  openai: "gpt-5.5",
  anthropic: "claude-sonnet-4-6",
  google: "gemini-3-flash-preview",
  groq: "llama-3.3-70b-versatile",
  ollama: "llama3",
  vllm: "mistralai/Mistral-7B-Instruct-v0.3",
};

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
  label?: string;
}

interface Props {
  onSuccess: (runId: string) => void;
  initialValues?: RunFormInitialValues;
}

export function RunForm({ onSuccess, initialValues }: Props) {
  const [ticker, setTicker] = useState(initialValues?.ticker ?? "");
  const [label, setLabel] = useState(initialValues?.label ?? "");
  const [analysisDate, setAnalysisDate] = useState(new Date().toISOString().slice(0, 10));
  const [analysts, setAnalysts] = useState<string[]>(
    initialValues?.analysts ?? ["market", "social", "news", "fundamentals", "technical"]
  );
  const [provider, setProvider] = useState(initialValues?.provider ?? "openai");
  const [model, setModel] = useState(initialValues?.model ?? "");
  const [depth, setDepth] = useState<"quick" | "standard" | "deep">(
    (initialValues?.depth as "quick" | "standard" | "deep") ?? "standard"
  );

  const isLocal = LOCAL_PROVIDERS.includes(provider);

  const { data: models = [], isLoading: modelsLoading } = useQuery({
    queryKey: ["models", provider],
    queryFn: () => getProviderModels(provider),
    enabled: true,
    retry: false,
  });

  useEffect(() => {
    // Only reset model when provider changes if no initial model was provided
    if (!initialValues?.model) setModel("");
  }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isLocal && models.length > 0 && !model) {
      setModel(models[0]);
    }
  }, [models, isLocal, model]);

  // If an initial model was provided and the model list has loaded, keep it selected
  useEffect(() => {
    if (initialValues?.model && !model) setModel(initialValues.model);
  }, [initialValues?.model]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: createRun,
    onSuccess: (run) => onSuccess(run.id),
  });

  const cryptoTicker = isCrypto(ticker);

  function toggleAnalyst(name: string) {
    if (name === "fundamentals" && cryptoTicker) return; // disabled for crypto
    setAnalysts((prev) =>
      prev.includes(name) ? prev.filter((a) => a !== name) : [...prev, name]
    );
  }

  // Auto-remove fundamentals when user types a crypto ticker
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
      llm_provider: provider,
      llm_model: model || PLACEHOLDERS[provider],
      depth,
      ...(label ? { label } : {}),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="bg-navy-700 border border-slate-800 rounded-lg p-6 max-w-lg">
      <div className="mb-4">
        <label className="block text-slate-400 text-xs mb-1">Label <span className="text-slate-600">(optional)</span></label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. pre-earnings check"
          className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-blue-600"
        />
      </div>

      <div className="mb-4">
        <label className="block text-slate-400 text-xs mb-1">Ticker</label>
        <input
          required
          type="text"
          list="ticker-suggestions"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="AAPL"
          className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-blue-600"
        />
        <datalist id="ticker-suggestions">
          {POPULAR_TICKERS.map((t) => <option key={t} value={t} />)}
        </datalist>
      </div>

      <div className="mb-4">
        <label className="block text-slate-400 text-xs mb-1">Analysis Date</label>
        <input
          required
          type="date"
          value={analysisDate}
          onChange={(e) => setAnalysisDate(e.target.value)}
          className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-blue-600"
        />
      </div>

      <div className="mb-4">
        <label className="block text-slate-400 text-xs mb-1">Analysts</label>
        <div className="flex flex-wrap gap-2">
          {ANALYSTS.map((a) => {
            const selected = analysts.includes(a);
            return (
              <button
                key={a}
                type="button"
                onClick={() => toggleAnalyst(a)}
                className={`px-3 py-1 rounded border text-xs capitalize ${
                  selected
                    ? "bg-blue-700 text-white border-blue-600"
                    : "bg-slate-800 text-slate-400 border-slate-700"
                }`}
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

      <div className="mb-4">
        <label className="block text-slate-400 text-xs mb-1">LLM Provider</label>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-blue-600"
        >
          <option value="openai">openai</option>
          <option value="anthropic">anthropic</option>
          <option value="google">google</option>
          <option value="groq">groq</option>
          <option value="ollama">ollama (local)</option>
          <option value="vllm">vllm (local)</option>
        </select>
      </div>

      <div className="mb-4">
        <label className="block text-slate-400 text-xs mb-1">LLM Model</label>
        {modelsLoading ? (
          <select disabled className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-500 text-sm">
            <option>Loading models…</option>
          </select>
        ) : models.length > 0 ? (
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-blue-600"
          >
            {models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        ) : (
          <>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={PLACEHOLDERS[provider]}
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-blue-600"
            />
            {isLocal && <p className="text-amber-400 text-xs mt-1">Server unreachable — enter model name manually</p>}
          </>
        )}
      </div>

      <div className="mb-6">
        <label className="block text-slate-400 text-xs mb-1">Research Depth</label>
        <select
          value={depth}
          onChange={(e) => setDepth(e.target.value as "quick" | "standard" | "deep")}
          className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-blue-600"
        >
          <option value="quick">Quick — 1 debate round, faster</option>
          <option value="standard">Standard — 2 debate rounds</option>
          <option value="deep">Deep — 3 debate rounds, most thorough</option>
        </select>
      </div>

      <button
        type="submit"
        disabled={mutation.isPending || analysts.length === 0}
        className="bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {mutation.isPending ? "Launching…" : "Launch Run"}
      </button>

      {mutation.isError && (
        <p className="text-red-400 text-xs mt-2">Failed to launch run.</p>
      )}
    </form>
  );
}
