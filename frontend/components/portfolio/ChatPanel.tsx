"use client";
import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getProviderModels, sendPortfolioChat } from "@/lib/api";
import type { ChatMessage } from "@/lib/api";

const PROVIDERS = ["openai", "anthropic", "google", "groq", "ollama", "vllm"] as const;

const PROVIDER_PLACEHOLDERS: Record<string, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5-20251001",
  google: "gemini-2.5-flash",
  groq: "llama-3.3-70b-versatile",
  ollama: "llama3",
  vllm: "mistral-7b",
};

const SUGGESTED = [
  "Where am I most overexposed?",
  "What would you trim first and why?",
  "How diversified is my sector exposure?",
  "What's my biggest risk right now?",
];

export function ChatPanel({ portfolioId }: { portfolioId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: models = [] } = useQuery({
    queryKey: ["models", provider],
    queryFn: () => getProviderModels(provider),
    retry: false,
  });

  useEffect(() => { setModel(""); }, [provider]);

  useEffect(() => {
    if (["ollama", "vllm"].includes(provider) && models.length > 0 && !model) {
      setModel(models[0]);
    }
  }, [models, provider, model]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMutation = useMutation({
    mutationFn: (msg: string) =>
      sendPortfolioChat(portfolioId, msg, messages, provider, model || PROVIDER_PLACEHOLDERS[provider] || ""),
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
    <div className="flex h-[calc(100vh-200px)] gap-4">
      {/* Sidebar */}
      <div className="w-48 shrink-0 flex flex-col gap-4">
        <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-3">
          <p className="text-xs font-medium text-slate-400 mb-1">Context</p>
          <p className="text-xs text-slate-500">Live holdings, verdicts, and latest insight.</p>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-slate-400">Provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
          >
            {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-slate-400">Model</label>
          {models.length > 0 ? (
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
            >
              <option value="">— select —</option>
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={PROVIDER_PLACEHOLDERS[provider] ?? "model name"}
              className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
            />
          )}
        </div>

        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            className="text-xs text-slate-500 hover:text-slate-300 underline text-left mt-auto"
          >
            Clear conversation
          </button>
        )}
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col bg-slate-900/50 border border-slate-700 rounded-xl overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-6">
              <div className="text-center space-y-1">
                <p className="text-slate-300 text-sm font-medium">Ask about your portfolio</p>
                <p className="text-slate-500 text-xs">Questions answered using your live holdings, verdicts, and latest AI insight.</p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                {SUGGESTED.map((q) => (
                  <button
                    key={q}
                    onClick={() => submit(q)}
                    disabled={sendMutation.isPending}
                    className="px-3 py-2 text-xs bg-slate-800 hover:bg-slate-700 border border-slate-600 hover:border-slate-500 text-slate-300 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white rounded-br-sm"
                      : "bg-slate-800 text-slate-200 border border-slate-700 rounded-bl-sm"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))
          )}

          {sendMutation.isPending && (
            <div className="flex justify-start">
              <div className="bg-slate-800 border border-slate-700 rounded-xl rounded-bl-sm px-4 py-3">
                <div className="flex gap-1 items-center">
                  <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <div className="border-t border-slate-700 p-3 flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sendMutation.isPending}
            placeholder="Ask a question… (Enter to send, Shift+Enter for newline)"
            rows={1}
            className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500 resize-none disabled:opacity-50 max-h-32 overflow-y-auto"
            style={{ minHeight: "2.5rem" }}
          />
          <button
            onClick={() => submit(input)}
            disabled={sendMutation.isPending || !input.trim()}
            className="shrink-0 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
