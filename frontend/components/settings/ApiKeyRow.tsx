"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { upsertApiKey } from "@/lib/api";
import type { FinnhubCapabilityStatus } from "@/lib/types";
import { FINNHUB_CAPABILITY_LABELS } from "@/lib/finnhubMessages";
import { BTN_PRIMARY_SM_CLASS, FIELD_INPUT_SM_CLASS } from "@/lib/uiClasses";

interface ApiKeyRowProps {
  provider: string;
  label?: string;
  description?: string;
  placeholder?: string;
  docsUrl?: string;
  isSet: boolean;
  capabilities?: Record<string, FinnhubCapabilityStatus> | null;
  capabilityWarning?: string | null;
  onSaved: () => void;
}

export function ApiKeyRow({
  provider,
  label,
  description,
  placeholder,
  docsUrl,
  isSet,
  capabilities,
  capabilityWarning,
  onSaved,
}: ApiKeyRowProps) {
  const [value, setValue] = useState("");
  const [savedResult, setSavedResult] = useState<"valid" | "invalid" | null>(null);

  const mutation = useMutation({
    mutationFn: () => upsertApiKey(provider, value),
    onSuccess: (data) => {
      setValue("");
      setSavedResult(data.is_valid ? "valid" : "invalid");
      onSaved();
    },
    onError: () => setSavedResult(null),
  });

  const displayName = label ?? provider.charAt(0).toUpperCase() + provider.slice(1);
  const capabilityEntries = capabilities ? Object.entries(capabilities) : [];

  return (
    <div className="px-4 py-3 space-y-3">
      <div className="flex items-start gap-4">
        <div className="w-36 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="text-fg text-sm">{displayName}</span>
            {docsUrl && (
              <a
                href={docsUrl}
                target="_blank"
                rel="noreferrer"
                title="Get API key"
                className="text-muted hover:text-blue-400 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                  <path d="M6.22 8.72a.75.75 0 0 0 1.06 1.06l5.22-5.22v1.69a.75.75 0 0 0 1.5 0v-3.5a.75.75 0 0 0-.75-.75h-3.5a.75.75 0 0 0 0 1.5h1.69L6.22 8.72Z" />
                  <path d="M3.5 6.75c0-.69.56-1.25 1.25-1.25H7A.75.75 0 0 0 7 4H4.75A2.75 2.75 0 0 0 2 6.75v4.5A2.75 2.75 0 0 0 4.75 14h4.5A2.75 2.75 0 0 0 12 11.25V9a.75.75 0 0 0-1.5 0v2.25c0 .69-.56 1.25-1.25 1.25h-4.5c-.69 0-1.25-.56-1.25-1.25v-4.5Z" />
                </svg>
              </a>
            )}
          </div>
          {description && <div className="text-muted text-xs mt-0.5">{description}</div>}
        </div>
        <span className={`text-xs w-28 shrink-0 mt-0.5 ${isSet ? "text-green-400" : "text-muted"}`}>
          {isSet ? "Configured ✓" : "Not configured"}
        </span>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder ?? "sk-…"}
          className={`${FIELD_INPUT_SM_CLASS} w-full sm:max-w-xs`}
        />
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !value}
          className={`${BTN_PRIMARY_SM_CLASS} shrink-0`}
        >
          {mutation.isPending ? "Saving…" : "Save"}
        </button>
        {mutation.isError && (
          <span className="text-red-400 text-xs mt-0.5">{(mutation.error as Error).message}</span>
        )}
        {!mutation.isError && savedResult === "valid" && (
          <span className="text-green-400 text-xs mt-0.5">Saved ✓</span>
        )}
        {!mutation.isError && savedResult === "invalid" && (
          <span className="text-amber-400 text-xs mt-0.5">Saved — key could not be verified</span>
        )}
      </div>

      {provider === "finnhub" && capabilityEntries.length > 0 && (
        <div className="pl-[calc(9rem+1rem)] space-y-2">
          <p className="text-[11px] text-muted uppercase tracking-wide">Plan capabilities</p>
          <div className="flex flex-wrap gap-2">
            {capabilityEntries.map(([key, status]) => (
              <span
                key={key}
                className={`text-[10px] px-2 py-1 rounded-sm border ${
                  status.ok
                    ? "text-green-300 border-green-500/30 bg-green-500/10"
                    : "text-amber-300 border-amber-500/30 bg-amber-500/10"
                }`}
                title={status.message ?? undefined}
              >
                {FINNHUB_CAPABILITY_LABELS[key] ?? key}
                {status.ok ? " ✓" : " ✕"}
              </span>
            ))}
          </div>
          {capabilityWarning && (
            <p className="text-xs text-amber-400/90">{capabilityWarning}</p>
          )}
        </div>
      )}
    </div>
  );
}
