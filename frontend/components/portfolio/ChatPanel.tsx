"use client";
import { useState, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { sendPortfolioChat } from "@/lib/api";
import type { ChatMessage } from "@/lib/api";
import { LlmConfigPicker, type LlmConfigValue } from "@/components/llm/LlmConfigPicker";
import { useDefaultLlmConfig } from "@/lib/useDefaultLlmConfig";

const SUGGESTED = [
  "Where am I most overexposed?",
  "What would you trim first and why?",
  "How diversified is my sector exposure?",
  "What's my biggest risk right now?",
];

export function ChatPanel({ portfolioId }: { portfolioId: string }) {
  const { provider, model, resolveModel } = useDefaultLlmConfig();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [llmConfig, setLlmConfig] = useState<LlmConfigValue>({ provider, model });
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLlmConfig({ provider, model });
  }, [provider, model]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMutation = useMutation({
    mutationFn: (msg: string) =>
      sendPortfolioChat(
        portfolioId,
        msg,
        messages,
        llmConfig.provider,
        resolveModel(llmConfig),
      ),
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: "assistant", content: data.response }]);
    },
    onError: (err: Error) => {
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${err.message}` }]);
    },
  });

  function submit(msg: string) {
    const trimmed = msg.trim();
    if (!trimmed || sendMutation.isPending) return;
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setInput("");
    sendMutation.mutate(trimmed);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(input);
    }
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4 min-h-[24rem] lg:h-[calc(100vh-200px)]">
      <div className="w-full lg:w-48 shrink-0 flex flex-col gap-4">
        <div className="bg-input/60 border border-input-border rounded-lg p-3">
          <p className="text-xs font-medium text-muted mb-1">Context</p>
          <p className="text-xs text-muted">Live holdings, verdicts, and latest insight.</p>
        </div>

        <LlmConfigPicker
          layout="stacked"
          value={llmConfig}
          onChange={setLlmConfig}
          providerClassName="w-full bg-input border border-input-border rounded-sm px-2 py-1.5 text-sm text-fg focus:outline-hidden focus:border-blue-500"
          modelClassName="w-full bg-input border border-input-border rounded-sm px-2 py-1.5 text-sm text-fg focus:outline-hidden focus:border-blue-500"
        />

        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            className="text-xs text-muted hover:text-fg-secondary underline text-left mt-auto"
          >
            Clear conversation
          </button>
        )}
      </div>

      <div className="flex-1 flex flex-col bg-page/50 border border-input-border rounded-xl overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-4">
              <p className="text-muted text-sm">Ask anything about your portfolio.</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {SUGGESTED.map((q) => (
                  <button
                    key={q}
                    onClick={() => submit(q)}
                    className="text-xs bg-input border border-input-border rounded-full px-3 py-1.5 text-fg-secondary hover:border-blue-500 hover:text-fg transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  msg.role === "user"
                    ? "ml-auto bg-blue-900/30 border border-blue-800/40 text-fg"
                    : "bg-input/60 border border-input-border text-fg-secondary"
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-input-border p-3">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              placeholder="Ask about your portfolio…"
              className="flex-1 bg-input border border-input-border rounded-lg px-3 py-2 text-sm text-fg placeholder:text-subtle focus:outline-hidden focus:border-blue-500 resize-none"
            />
            <button
              onClick={() => submit(input)}
              disabled={!input.trim() || sendMutation.isPending}
              className="self-end px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-fg text-sm rounded-lg transition-colors"
            >
              {sendMutation.isPending ? "…" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
