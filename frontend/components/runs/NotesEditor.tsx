"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateRun } from "@/lib/api";

export function NotesEditor({ id, notes }: { id: string; notes: string | null }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(notes ?? "");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (next: string) => updateRun(id, { notes: next || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["run", id] });
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      setEditing(false);
    },
  });

  if (editing) {
    return (
      <div className="bg-elevated border border-input-border rounded-lg p-4 flex flex-col gap-2">
        <label className="text-xs text-muted uppercase tracking-wide">Notes</label>
        <textarea
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="What did you decide? Did you take the trade? Any context worth keeping…"
          rows={4}
          className="bg-page border border-input-border rounded px-3 py-2 text-sm text-fg focus:outline-none focus:border-blue-500 resize-y"
        />
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <button
            onClick={() => mutation.mutate(value)}
            disabled={mutation.isPending}
            className="bg-blue-600 hover:bg-blue-700 text-fg text-xs rounded px-3 py-1.5 disabled:opacity-50"
          >
            {mutation.isPending ? "Saving…" : "Save"}
          </button>
          <button
            onClick={() => { setValue(notes ?? ""); setEditing(false); }}
            className="text-xs text-muted hover:text-fg-secondary"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-elevated border border-input-border rounded-lg p-4 flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted uppercase tracking-wide mb-1">Notes</p>
        {notes ? (
          <p className="text-sm text-fg whitespace-pre-wrap wrap-break-word">{notes}</p>
        ) : (
          <p className="text-sm text-subtle italic">No notes yet — capture your decision or context.</p>
        )}
      </div>
      <button
        onClick={() => { setValue(notes ?? ""); setEditing(true); }}
        className="text-xs text-muted hover:text-blue-400 shrink-0"
      >
        {notes ? "Edit" : "Add"}
      </button>
    </div>
  );
}
