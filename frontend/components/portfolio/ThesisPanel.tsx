"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createThesisCrossRef, getThesisCrossRefs, deleteThesisCrossRef } from "@/lib/api";
import type { ThesisCrossRef, ThesisCrossRefPosition, ThesisCrossRefRecommendation } from "@/lib/types";

const PROVIDERS = ["openai", "anthropic", "google", "groq", "ollama", "vllm"] as const;

const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5-20251001",
  google: "gemini-2.5-flash",
  groq: "llama-3.3-70b-versatile",
  ollama: "llama3",
  vllm: "mistral-7b",
};

function AlignmentGauge({ score }: { score: number }) {
  const color = score <= 3 ? "text-red-400" : score <= 6 ? "text-yellow-400" : "text-green-400";
  const strokeColor = score <= 3 ? "#f87171" : score <= 6 ? "#facc15" : "#4ade80";
  const label = score <= 3 ? "Misaligned" : score <= 6 ? "Partial" : "Aligned";
  return (
    <div className="flex items-center gap-4">
      <div className="relative w-20 h-20 shrink-0">
        <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#1e293b" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="15.9" fill="none"
            stroke={strokeColor}
            strokeWidth="3"
            strokeDasharray={`${score * 10} 100`}
            strokeLinecap="round"
          />
        </svg>
        <span className={`absolute inset-0 flex items-center justify-center text-2xl font-bold ${color}`}>
          {score}
        </span>
      </div>
      <div>
        <p className="text-xs text-slate-400 mb-0.5">Alignment score</p>
        <p className={`text-lg font-semibold ${color}`}>{label}</p>
        <p className="text-xs text-slate-500">out of 10</p>
      </div>
    </div>
  );
}

function CrossRefResult({ result }: { result: ThesisCrossRef }) {
  if (result.error) {
    return (
      <div className="p-4 bg-red-900/20 border border-red-700 rounded-lg text-sm text-red-300">
        Analysis failed: {result.error}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {result.alignment_score !== null && result.alignment_score !== undefined && (
        <AlignmentGauge score={result.alignment_score} />
      )}

      {result.thesis_summary && (
        <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-4">
          <p className="text-xs text-slate-400 mb-1.5 font-medium uppercase tracking-wide">Thesis extracted</p>
          <p className="text-sm text-slate-200 italic leading-relaxed">{result.thesis_summary}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {result.aligned_positions && result.aligned_positions.length > 0 && (
          <div className="bg-green-900/10 border border-green-800/40 rounded-lg p-4">
            <p className="text-xs text-green-400 font-medium uppercase tracking-wide mb-2">
              Aligned ({result.aligned_positions.length})
            </p>
            <ul className="space-y-2">
              {result.aligned_positions.map((p: ThesisCrossRefPosition) => (
                <li key={p.ticker} className="text-xs text-slate-300">
                  <span className="font-mono font-semibold text-green-400">{p.ticker}</span>
                  <span className="text-slate-400 ml-1">— {p.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.misaligned_positions && result.misaligned_positions.length > 0 && (
          <div className="bg-red-900/10 border border-red-800/40 rounded-lg p-4">
            <p className="text-xs text-red-400 font-medium uppercase tracking-wide mb-2">
              Misaligned ({result.misaligned_positions.length})
            </p>
            <ul className="space-y-2">
              {result.misaligned_positions.map((p: ThesisCrossRefPosition) => (
                <li key={p.ticker} className="text-xs text-slate-300">
                  <span className="font-mono font-semibold text-red-400">{p.ticker}</span>
                  <span className="text-slate-400 ml-1">— {p.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {result.missing_exposure && result.missing_exposure.length > 0 && (
          <div>
            <p className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-2">Missing exposure</p>
            <div className="flex flex-wrap gap-1.5">
              {result.missing_exposure.map((e: string) => (
                <span key={e} className="text-xs px-2 py-1 bg-yellow-900/20 border border-yellow-700/40 text-yellow-400 rounded-md">
                  {e}
                </span>
              ))}
            </div>
          </div>
        )}

        {result.excess_exposure && result.excess_exposure.length > 0 && (
          <div>
            <p className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-2">Excess exposure</p>
            <div className="flex flex-wrap gap-1.5">
              {result.excess_exposure.map((e: string) => (
                <span key={e} className="text-xs px-2 py-1 bg-orange-900/20 border border-orange-700/40 text-orange-400 rounded-md">
                  {e}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {result.recommendations && result.recommendations.length > 0 && (
        <div>
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-2">Recommendations</p>
          <div className="space-y-2">
            {result.recommendations.map((r: ThesisCrossRefRecommendation, i: number) => (
              <div key={i} className="flex items-start gap-3 py-2 border-b border-slate-800 last:border-0">
                <span className={`text-xs font-mono font-bold shrink-0 mt-0.5 ${
                  r.action === "TRIM" || r.action === "EXIT" ? "text-red-400" :
                  r.action === "CONSIDER" ? "text-blue-400" : "text-slate-400"
                }`}>{r.action}</span>
                <span className="text-xs font-mono font-semibold text-slate-200 shrink-0">{r.ticker}</span>
                <span className="text-xs text-slate-400 leading-relaxed">{r.rationale}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.summary && (
        <div className="bg-slate-800/40 border border-slate-700 rounded-lg p-4">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-2">Narrative</p>
          <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{result.summary}</p>
        </div>
      )}
    </div>
  );
}

export function ThesisPanel({ portfolioId }: { portfolioId: string }) {
  const queryClient = useQueryClient();
  const [thesisText, setThesisText] = useState("");
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("gpt-4o-mini");
  const [activeResult, setActiveResult] = useState<ThesisCrossRef | null>(null);

  const { data: history = [] } = useQuery({
    queryKey: ["thesisCrossRefs", portfolioId],
    queryFn: () => getThesisCrossRefs(portfolioId),
  });

  const analyzeMutation = useMutation({
    mutationFn: () =>
      createThesisCrossRef(portfolioId, {
        thesis_text: thesisText,
        llm_provider: provider,
        llm_model: model || PROVIDER_DEFAULT_MODELS[provider],
      }),
    onSuccess: (data) => {
      setActiveResult(data);
      setThesisText("");
      queryClient.invalidateQueries({ queryKey: ["thesisCrossRefs", portfolioId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (crossrefId: string) => deleteThesisCrossRef(portfolioId, crossrefId),
    onSuccess: (_, crossrefId) => {
      if (activeResult?.id === crossrefId) setActiveResult(null);
      queryClient.invalidateQueries({ queryKey: ["thesisCrossRefs", portfolioId] });
    },
  });

  const charCount = thesisText.length;
  const charValid = charCount >= 50 && charCount <= 10000;

  return (
    <div className="flex gap-5 h-[calc(100vh-220px)]">
      {/* Left sidebar — history */}
      <div className="w-56 shrink-0 flex flex-col gap-3">
        <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-3">
          <p className="text-xs font-medium text-slate-300 mb-0.5">Thesis Check</p>
          <p className="text-xs text-slate-500 leading-relaxed">
            Paste any investment thesis and see how your portfolio aligns with it.
          </p>
        </div>

        {history.length > 0 && (
          <div className="flex-1 overflow-y-auto">
            <p className="text-xs text-slate-500 px-1 mb-1.5 uppercase tracking-wide">History</p>
            <ul className="space-y-1">
              {history.map((item) => (
                <li key={item.id} className="group flex items-center gap-1">
                  <button
                    onClick={() => setActiveResult(item)}
                    className={`flex-1 text-left rounded-lg px-2 py-2 text-xs transition-colors truncate ${
                      activeResult?.id === item.id
                        ? "bg-slate-700 text-slate-100"
                        : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                    }`}
                  >
                    <span className={`font-bold mr-1.5 ${
                      (item.alignment_score ?? 0) <= 3 ? "text-red-400" :
                      (item.alignment_score ?? 0) <= 6 ? "text-yellow-400" : "text-green-400"
                    }`}>
                      {item.alignment_score ?? "?"}
                    </span>
                    <span className="truncate">{item.thesis_text_preview}</span>
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate(item.id)}
                    className="opacity-0 group-hover:opacity-100 shrink-0 p-1 text-slate-600 hover:text-red-400 transition-all"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {history.length === 0 && (
          <p className="text-xs text-slate-600 px-1">No analyses yet.</p>
        )}
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col gap-4 overflow-hidden">
        {/* Input form */}
        <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-4 shrink-0">
          <textarea
            value={thesisText}
            onChange={(e) => setThesisText(e.target.value)}
            rows={5}
            placeholder="Paste an investment thesis, article excerpt, podcast notes, or any text (50–10,000 characters)…"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500 resize-none"
          />
          <div className="flex items-center justify-between mt-2">
            <span className={`text-xs ${charValid ? "text-slate-500" : charCount > 0 ? "text-red-400" : "text-slate-600"}`}>
              {charCount > 0 ? `${charCount.toLocaleString()} / 10,000` : "50 characters minimum"}
            </span>
            <div className="flex items-center gap-2">
              <select
                value={provider}
                onChange={(e) => { setProvider(e.target.value); setModel(PROVIDER_DEFAULT_MODELS[e.target.value] ?? ""); }}
                className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
              >
                {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="model"
                className="w-40 bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={() => analyzeMutation.mutate()}
                disabled={!charValid || analyzeMutation.isPending}
                className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-medium rounded-lg transition-colors"
              >
                {analyzeMutation.isPending ? "Analyzing…" : "Analyze thesis"}
              </button>
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {activeResult ? (
            <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs text-slate-500 truncate max-w-md">
                  {new Date(activeResult.created_at).toLocaleString()} · {activeResult.llm_provider} / {activeResult.llm_model}
                </p>
                <button
                  onClick={() => setActiveResult(null)}
                  className="text-xs text-slate-500 hover:text-slate-300"
                >
                  ✕ clear
                </button>
              </div>
              <CrossRefResult result={activeResult} />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-purple-900/20 border border-purple-800/40 flex items-center justify-center">
                <span className="text-purple-400 text-xl">⊗</span>
              </div>
              <p className="text-slate-400 text-sm font-medium">No thesis analyzed yet</p>
              <p className="text-slate-600 text-xs max-w-xs">
                Paste an investment thesis above to see how your current portfolio stacks up.
              </p>
              {history.length > 0 && (
                <p className="text-slate-600 text-xs">
                  Or select a past analysis from the history on the left.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
