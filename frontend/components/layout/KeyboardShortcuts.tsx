"use client";
import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useHotkeys, type HotkeyBinding } from "@/lib/hotkeys";

const SHORTCUTS: Array<{ keys: string; description: string }> = [
  { keys: "n", description: "New run" },
  { keys: "/", description: "Focus ticker filter (on History page)" },
  { keys: "g r", description: "Go to Run History" },
  { keys: "g n", description: "Go to New Run" },
  { keys: "g p", description: "Go to Portfolio" },
  { keys: "g m", description: "Go to Market" },
  { keys: "g w", description: "Go to Watchlist" },
  { keys: "g f", description: "Go to Performance" },
  { keys: "g c", description: "Go to Compare" },
  { keys: "g s", description: "Go to Settings" },
  { keys: "?", description: "Show this help" },
];

export function KeyboardShortcuts() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const bindings = useMemo<HotkeyBinding[]>(
    () => [
      { key: "n", handler: () => router.push("/runs/new"), description: "New run" },
      { key: "?", handler: () => setOpen((v) => !v), description: "Toggle help" },
      {
        key: "/",
        handler: () => {
          const el = document.querySelector<HTMLInputElement>("[data-run-filter-ticker]");
          if (el) el.focus();
        },
        description: "Focus ticker filter",
      },
      { sequencePrefix: "g", key: "r", handler: () => router.push("/runs"), description: "Go to History" },
      { sequencePrefix: "g", key: "n", handler: () => router.push("/runs/new"), description: "Go to New Run" },
      { sequencePrefix: "g", key: "p", handler: () => router.push("/portfolio"), description: "Go to Portfolio" },
      { sequencePrefix: "g", key: "m", handler: () => router.push("/market"), description: "Go to Market" },
      { sequencePrefix: "g", key: "w", handler: () => router.push("/watchlist"), description: "Go to Watchlist" },
      { sequencePrefix: "g", key: "f", handler: () => router.push("/runs/performance"), description: "Go to Performance" },
      { sequencePrefix: "g", key: "c", handler: () => router.push("/runs/compare"), description: "Go to Compare" },
      { sequencePrefix: "g", key: "s", handler: () => router.push("/settings"), description: "Go to Settings" },
    ],
    [router],
  );

  useHotkeys(bindings);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-100 flex items-center justify-center bg-black/60"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-label="Keyboard shortcuts"
    >
      <div
        className="bg-elevated border border-input-border rounded-lg p-6 w-[480px] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-fg text-base font-semibold">Keyboard shortcuts</h2>
          <button
            onClick={() => setOpen(false)}
            className="text-muted hover:text-fg-secondary text-xs"
            aria-label="Close"
          >
            Esc
          </button>
        </div>
        <ul className="flex flex-col gap-2">
          {SHORTCUTS.map(({ keys, description }) => (
            <li key={keys} className="flex items-center justify-between text-sm">
              <span className="text-fg-secondary">{description}</span>
              <kbd className="bg-page border border-input-border rounded px-2 py-0.5 text-xs text-fg font-mono">
                {keys}
              </kbd>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted mt-4">
          Shortcuts are disabled while typing in inputs.
        </p>
      </div>
    </div>
  );
}
