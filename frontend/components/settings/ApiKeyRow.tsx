"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { upsertApiKey } from "@/lib/api";

interface ApiKeyRowProps {
  provider: string;
  isSet: boolean;
  onSaved: () => void;
}

export function ApiKeyRow({ provider, isSet, onSaved }: ApiKeyRowProps) {
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
      <span className="text-slate-200 text-sm w-28 capitalize">{provider}</span>
      <span className={`text-xs w-28 ${isSet ? "text-green-400" : "text-slate-500"}`}>
        {isSet ? "Set ✓" : "Not configured"}
      </span>
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="sk-…"
        className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 w-64 focus:outline-none focus:border-blue-500"
      />
      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || !value}
        className="bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-1 text-xs disabled:opacity-50"
      >
        {mutation.isPending ? "Saving…" : "Save"}
      </button>
      {mutation.isError && (
        <span className="text-red-400 text-xs">{(mutation.error as Error).message}</span>
      )}
    </div>
  );
}
