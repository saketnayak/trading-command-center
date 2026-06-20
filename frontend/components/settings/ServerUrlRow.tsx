"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { upsertApiKey } from "@/lib/api";
import { LLM_SERVER_URL_PLACEHOLDERS, type LocalLlmProvider } from "@/lib/llmConfig";

interface ServerUrlRowProps {
  provider: LocalLlmProvider;
  label: string;
  isValid: boolean;
  onSaved: () => void;
}

export function ServerUrlRow({ provider, label, isValid, onSaved }: ServerUrlRowProps) {
  const [value, setValue] = useState("");

  const mutation = useMutation({
    mutationFn: () => upsertApiKey(provider, value),
    onSuccess: () => {
      setValue("");
      onSaved();
    },
  });

  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="w-36 shrink-0">
        <div className="text-fg text-sm">{label}</div>
      </div>
      <span className={`text-xs w-28 shrink-0 ${isValid ? "text-green-400" : "text-muted"}`}>
        {isValid ? "Connected ✓" : "Not configured"}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={LLM_SERVER_URL_PLACEHOLDERS[provider]}
        className="bg-input border border-input-border rounded-sm px-2 py-1 text-xs text-fg w-full sm:max-w-xs focus:outline-hidden focus:border-blue-500"
      />
      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || !value}
        className="bg-blue-600 hover:bg-blue-700 text-fg rounded-sm px-3 py-1 text-xs disabled:opacity-50"
      >
        {mutation.isPending ? "Saving…" : "Save"}
      </button>
      {mutation.isError && (
        <span className="text-red-400 text-xs">{(mutation.error as Error).message}</span>
      )}
    </div>
  );
}
