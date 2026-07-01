"use client";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createThesisCrossRef, getThesisCrossRefs, deleteThesisCrossRef } from "@/lib/api";
import type { ThesisCrossRef, ThesisCrossRefPosition, ThesisCrossRefRecommendation } from "@/lib/types";
import { LlmConfigPicker, type LlmConfigValue } from "@/components/llm/LlmConfigPicker";
import { useDefaultLlmConfig } from "@/lib/useDefaultLlmConfig";
import { BTN_AI_CLASS, FIELD_INPUT_SM_CLASS } from "@/lib/uiClasses";

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
        <p className="text-xs text-muted mb-0.5">Alignment score</p>
        <p className={`text-lg font-semibold ${color}`}>{label}</p>
        <p className="text-xs text-muted">out of 10</p>
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
        <div className="bg-input/60 border border-input-border rounded-lg p-4">
          <p className="text-xs text-muted mb-1.5 font-medium uppercase tracking-wide">Thesis extracted</p>
          <p className="text-sm text-fg italic leading-relaxed">{result.thesis_summary}</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {result.aligned_positions && result.aligned_positions.length > 0 && (
          <div className="bg-green-900/10 border border-green-800/40 rounded-lg p-4">
            <p className="text-xs text-green-400 font-medium uppercase tracking-wide mb-2">
              Aligned ({result.aligned_positions.length})
            </p>
            <ul className="space-y-2">
              {result.aligned_positions.map((p: ThesisCrossRefPosition) => (
                <li key={p.ticker} className="text-xs text-fg-secondary">
                  <span className="font-mono font-semibold text-green-400">{p.ticker}</span>
                  <span className="text-muted ml-1">— {p.reason}</span>
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
                <li key={p.ticker} className="text-xs text-fg-secondary">
                  <span className="font-mono font-semibold text-red-400">{p.ticker}</span>
                  <span className="text-muted ml-1">— {p.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {result.missing_exposure && result.missing_exposure.length > 0 && (
          <div>
            <p className="text-xs text-muted font-medium uppercase tracking-wide mb-2">Missing exposure</p>
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
            <p className="text-xs text-muted font-medium uppercase tracking-wide mb-2">Excess exposure</p>
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
          <p className="text-xs text-muted font-medium uppercase tracking-wide mb-2">Recommendations</p>
          <div className="space-y-2">
            {result.recommendations.map((r: ThesisCrossRefRecommendation, i: number) => (
              <div key={i} className="flex items-start gap-3 py-2 border-b border-border last:border-0">
                <span className={`text-xs font-mono font-bold shrink-0 mt-0.5 ${
                  r.action === "TRIM" || r.action === "EXIT" ? "text-red-400" :
                  r.action === "CONSIDER" ? "text-blue-400" : "text-muted"
                }`}>{r.action}</span>
                <span className="text-xs font-mono font-semibold text-fg shrink-0">{r.ticker}</span>
                <span className="text-xs text-muted leading-relaxed">{r.rationale}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.summary && (
        <div className="bg-input/40 border border-input-border rounded-lg p-4">
          <p className="text-xs text-muted font-medium uppercase tracking-wide mb-2">Narrative</p>
          <p className="text-sm text-fg-secondary leading-relaxed whitespace-pre-wrap">{result.summary}</p>
        </div>
      )}
    </div>
  );
}

export function ThesisPanel({ portfolioId }: { portfolioId: string }) {
  const queryClient = useQueryClient();
  const { provider, model, resolveModel } = useDefaultLlmConfig();
  const [thesisText, setThesisText] = useState("");
  const [llmConfig, setLlmConfig] = useState<LlmConfigValue>({ provider, model });
  const [activeResult, setActiveResult] = useState<ThesisCrossRef | null>(null);

  useEffect(() => {
    setLlmConfig({ provider, model });
  }, [provider, model]);

  const { data: history = [] } = useQuery({
    queryKey: ["thesisCrossRefs", portfolioId],
    queryFn: () => getThesisCrossRefs(portfolioId),
  });

  const analyzeMutation = useMutation({
    mutationFn: () =>
      createThesisCrossRef(portfolioId, {
        thesis_text: thesisText,
        llm_provider: llmConfig.provider,
        llm_model: resolveModel(llmConfig),
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
        <div className="bg-input/60 border border-input-border rounded-lg p-3">
          <p className="text-xs font-medium text-fg-secondary mb-0.5">Thesis Check</p>
          <p className="text-xs text-muted leading-relaxed">
            Paste any investment thesis and see how your portfolio aligns with it.
          </p>
        </div>

        {history.length > 0 && (
          <div className="flex-1 overflow-y-auto">
            <p className="text-xs text-muted px-1 mb-1.5 uppercase tracking-wide">History</p>
            <ul className="space-y-1">
              {history.map((item) => (
                <li key={item.id} className="group flex items-center gap-1">
                  <button
                    onClick={() => setActiveResult(item)}
                    className={`flex-1 text-left rounded-lg px-2 py-2 text-xs transition-colors truncate ${
                      activeResult?.id === item.id
                        ? "bg-muted-surface text-fg"
                        : "text-muted hover:bg-input hover:text-fg"
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
                    className="opacity-0 group-hover:opacity-100 shrink-0 p-1 text-subtle hover:text-red-400 transition-all"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {history.length === 0 && (
          <p className="text-xs text-subtle px-1">No analyses yet.</p>
        )}
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col gap-4 overflow-hidden">
        {/* Input form */}
        <div className="bg-page/50 border border-input-border rounded-xl p-4 shrink-0">
          <textarea
            value={thesisText}
            onChange={(e) => setThesisText(e.target.value)}
            rows={5}
            placeholder="Paste an investment thesis, article excerpt, podcast notes, or any text (50–10,000 characters)…"
            className="w-full bg-input border border-input-border rounded-lg px-3 py-2.5 text-sm text-fg placeholder:text-subtle focus:outline-hidden focus:border-blue-500 resize-none"
          />
          <div className="flex items-center justify-between mt-2">
            <span className={`text-xs ${charValid ? "text-muted" : charCount > 0 ? "text-red-400" : "text-subtle"}`}>
              {charCount > 0 ? `${charCount.toLocaleString()} / 10,000` : "50 characters minimum"}
            </span>
            <div className="flex items-center gap-2">
              <LlmConfigPicker
                layout="compact"
                value={llmConfig}
                onChange={setLlmConfig}
                providerClassName={FIELD_INPUT_SM_CLASS}
                modelClassName={`${FIELD_INPUT_SM_CLASS} w-40`}
              />
              <button
                onClick={() => analyzeMutation.mutate()}
                disabled={!charValid || analyzeMutation.isPending}
                className={BTN_AI_CLASS}
              >
                {analyzeMutation.isPending ? "Analyzing…" : "Analyze thesis"}
              </button>
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {activeResult ? (
            <div className="bg-page/50 border border-input-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs text-muted truncate max-w-md">
                  {new Date(activeResult.created_at).toLocaleString()} · {activeResult.llm_provider} / {activeResult.llm_model}
                </p>
                <button
                  onClick={() => setActiveResult(null)}
                  className="text-xs text-muted hover:text-fg-secondary"
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
              <p className="text-muted text-sm font-medium">No thesis analyzed yet</p>
              <p className="text-subtle text-xs max-w-xs">
                Paste an investment thesis above to see how your current portfolio stacks up.
              </p>
              {history.length > 0 && (
                <p className="text-subtle text-xs">
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
