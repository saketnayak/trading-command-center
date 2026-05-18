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
  return (
    <div className="flex items-center gap-3">
      <div className="relative w-16 h-16">
        <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#334155" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="15.9" fill="none"
            stroke={strokeColor}
            strokeWidth="3"
            strokeDasharray={`${score * 10} 100`}
            strokeLinecap="round"
          />
        </svg>
        <span className={`absolute inset-0 flex items-center justify-center text-lg font-bold ${color}`}>
          {score}
        </span>
      </div>
      <div>
        <p className="text-xs text-slate-400">Alignment score</p>
        <p className={`text-sm font-medium ${color}`}>
          {score <= 3 ? "Misaligned" : score <= 6 ? "Partial" : "Aligned"}
        </p>
      </div>
    </div>
  );
}

function CrossRefResult({ result }: { result: ThesisCrossRef }) {
  if (result.error) {
    return (
      <div className="mt-4 p-4 bg-red-900/20 border border-red-700 rounded-lg text-sm text-red-300">
        Analysis failed: {result.error}
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      {result.alignment_score !== null && result.alignment_score !== undefined && (
        <AlignmentGauge score={result.alignment_score} />
      )}

      {result.thesis_summary && (
        <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-3">
          <p className="text-xs text-slate-400 mb-1">Thesis (extracted)</p>
          <p className="text-sm text-slate-200 italic">{result.thesis_summary}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {result.aligned_positions && result.aligned_positions.length > 0 && (
          <div className="bg-green-900/10 border border-green-800/40 rounded-lg p-3">
            <p className="text-xs text-green-400 font-medium mb-2">Aligned positions</p>
            <ul className="space-y-1">
              {result.aligned_positions.map((p: ThesisCrossRefPosition) => (
                <li key={p.ticker} className="text-xs text-slate-300">
                  <span className="font-mono text-green-400">{p.ticker}</span> — {p.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.misaligned_positions && result.misaligned_positions.length > 0 && (
          <div className="bg-red-900/10 border border-red-800/40 rounded-lg p-3">
            <p className="text-xs text-red-400 font-medium mb-2">Misaligned positions</p>
            <ul className="space-y-1">
              {result.misaligned_positions.map((p: ThesisCrossRefPosition) => (
                <li key={p.ticker} className="text-xs text-slate-300">
                  <span className="font-mono text-red-400">{p.ticker}</span> — {p.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {result.missing_exposure && result.missing_exposure.length > 0 && (
        <div>
          <p className="text-xs text-slate-400 mb-1">Missing exposure</p>
          <div className="flex flex-wrap gap-1">
            {result.missing_exposure.map((e: string) => (
              <span key={e} className="text-xs px-2 py-0.5 bg-yellow-900/20 border border-yellow-700/40 text-yellow-400 rounded">
                {e}
              </span>
            ))}
          </div>
        </div>
      )}

      {result.recommendations && result.recommendations.length > 0 && (
        <div>
          <p className="text-xs text-slate-400 mb-2">Recommendations</p>
          <ul className="space-y-1">
            {result.recommendations.map((r: ThesisCrossRefRecommendation, i: number) => (
              <li key={i} className="text-xs text-slate-300 flex gap-2">
                <span className={`font-mono font-medium ${
                  r.action === "TRIM" || r.action === "EXIT" ? "text-red-400" :
                  r.action === "CONSIDER" ? "text-blue-400" : "text-slate-400"
                }`}>{r.action}</span>
                <span className="font-mono text-slate-200">{r.ticker}</span>
                <span className="text-slate-400">— {r.rationale}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.summary && (
        <div className="bg-slate-800/40 border border-slate-700 rounded-lg p-3">
          <p className="text-xs text-slate-400 mb-1">Narrative</p>
          <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{result.summary}</p>
        </div>
      )}
    </div>
  );
}

export function ThesisPanel({ portfolioId }: { portfolioId: string }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [thesisText, setThesisText] = useState("");
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("gpt-4o-mini");
  const [activeResult, setActiveResult] = useState<ThesisCrossRef | null>(null);

  const { data: history = [] } = useQuery({
    queryKey: ["thesisCrossRefs", portfolioId],
    queryFn: () => getThesisCrossRefs(portfolioId),
    enabled: expanded,
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
      queryClient.invalidateQueries({ queryKey: ["thesisCrossRefs", portfolioId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (crossrefId: string) => deleteThesisCrossRef(portfolioId, crossrefId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["thesisCrossRefs", portfolioId] });
    },
  });

  const charCount = thesisText.length;
  const charValid = charCount >= 50 && charCount <= 10000;

  return (
    <div className="border border-slate-700 rounded-xl overflow-hidden mt-6">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-800/60 hover:bg-slate-800 transition-colors"
      >
        <span className="text-sm font-medium text-slate-200">Thesis Check</span>
        <span className="text-slate-400 text-xs">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="p-4 space-y-4 bg-slate-900/40">
          <div className="space-y-2">
            <label className="text-xs text-slate-400">
              Paste a thesis, transcript, or article to check against your portfolio
            </label>
            <textarea
              value={thesisText}
              onChange={(e) => setThesisText(e.target.value)}
              rows={6}
              placeholder="Paste your investment thesis here (50–10,000 characters)…"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500 resize-none"
            />
            <div className="flex items-center justify-between">
              <span className={`text-xs ${charValid ? "text-slate-500" : "text-red-400"}`}>
                {charCount} / 10,000 characters {charCount < 50 ? "(minimum 50)" : ""}
              </span>
              <div className="flex items-center gap-2">
                <select
                  value={provider}
                  onChange={(e) => { setProvider(e.target.value); setModel(PROVIDER_DEFAULT_MODELS[e.target.value] ?? ""); }}
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none"
                >
                  {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="model"
                  className="w-36 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none"
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

          {activeResult && <CrossRefResult result={activeResult} />}

          {history.length > 0 && (
            <div className="border-t border-slate-700 pt-4">
              <p className="text-xs text-slate-400 mb-2">History</p>
              <ul className="space-y-1">
                {history.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-2 text-xs text-slate-400 hover:text-slate-200 cursor-pointer group"
                  >
                    <button
                      className="flex-1 text-left truncate"
                      onClick={() => setActiveResult(item)}
                    >
                      <span className={`font-medium mr-2 ${
                        (item.alignment_score ?? 0) <= 3 ? "text-red-400" :
                        (item.alignment_score ?? 0) <= 6 ? "text-yellow-400" : "text-green-400"
                      }`}>
                        {item.alignment_score ?? "?"}
                      </span>
                      {item.thesis_text_preview}
                      <span className="ml-2 text-slate-600">
                        {new Date(item.created_at).toLocaleDateString()}
                      </span>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(item.id); }}
                      className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-opacity px-1"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
