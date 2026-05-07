"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { upsertApiKey } from "@/lib/api";

interface ApiKeyRowProps {
  provider: string;
  label?: string;
  description?: string;
  placeholder?: string;
  isSet: boolean;
  onSaved: () => void;
}

export function ApiKeyRow({ provider, label, description, placeholder, isSet, onSaved }: ApiKeyRowProps) {
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

  return (
    <div className="flex items-start gap-4 px-4 py-3">
      <div className="w-36 shrink-0">
        <div className="text-slate-200 text-sm">{displayName}</div>
        {description && <div className="text-slate-500 text-xs mt-0.5">{description}</div>}
      </div>
      <span className={`text-xs w-28 shrink-0 mt-0.5 ${isSet ? "text-green-400" : "text-slate-500"}`}>
        {isSet ? "Configured ✓" : "Not configured"}
      </span>
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder ?? "sk-…"}
        className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 w-64 focus:outline-none focus:border-blue-500"
      />
      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || !value}
        className="bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-1 text-xs disabled:opacity-50 shrink-0"
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
  );
}
