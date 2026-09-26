"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { upsertApiKey } from "@/lib/api";
import { BTN_PRIMARY_SM_CLASS, FIELD_INPUT_SM_CLASS } from "@/lib/uiClasses";

interface AlpacaPaperKeyRowProps {
  isSet: boolean;
  lastError: string | null;
  onSaved: () => void;
}

/** Alpaca needs a Key ID and a Secret; both are stored together, encrypted, as one key row. */
export function AlpacaPaperKeyRow({ isSet, lastError, onSaved }: AlpacaPaperKeyRowProps) {
  const [keyId, setKeyId] = useState("");
  const [secret, setSecret] = useState("");
  const [savedResult, setSavedResult] = useState<"valid" | "invalid" | null>(null);
  const [savedError, setSavedError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      upsertApiKey("alpaca_paper", JSON.stringify({ key_id: keyId.trim(), secret: secret.trim() })),
    onSuccess: (data) => {
      setKeyId("");
      setSecret("");
      setSavedResult(data.is_valid ? "valid" : "invalid");
      setSavedError(data.last_error_message ?? null);
      onSaved();
    },
    onError: () => setSavedResult(null),
  });

  const inputClass = `${FIELD_INPUT_SM_CLASS} sm:w-36`;
  const warning = savedResult === "invalid" ? savedError : isSet ? null : lastError;

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-start gap-4">
        <div className="w-36 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="text-fg text-sm">Alpaca (paper)</span>
            <a
              href="https://app.alpaca.markets/paper/dashboard/overview"
              target="_blank"
              rel="noreferrer"
              title="Get paper API keys"
              className="text-muted hover:text-blue-400 transition-colors text-xs"
            >
              ↗
            </a>
          </div>
          <div className="text-muted text-xs mt-0.5">Market data and paper orders. Key ID starts with PK.</div>
        </div>
        <span className={`text-xs w-28 shrink-0 mt-0.5 ${isSet ? "text-green-400" : "text-muted"}`}>
          {isSet ? "Configured ✓" : "Not configured"}
        </span>
        <input
          type="password"
          value={keyId}
          onChange={(e) => setKeyId(e.target.value)}
          placeholder="Key ID (PK…)"
          aria-label="Alpaca paper Key ID"
          className={inputClass}
        />
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="Secret"
          aria-label="Alpaca paper Secret"
          className={inputClass}
        />
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !keyId.trim() || !secret.trim()}
          className={`${BTN_PRIMARY_SM_CLASS} shrink-0`}
        >
          {mutation.isPending ? "Saving…" : "Save"}
        </button>
        {mutation.isError && <span className="text-red-400 text-xs mt-0.5">{(mutation.error as Error).message}</span>}
        {!mutation.isError && savedResult === "valid" && <span className="text-green-400 text-xs mt-0.5">Saved ✓</span>}
      </div>
      {warning && <p className="text-amber-400 text-xs">{warning}</p>}
    </div>
  );
}
