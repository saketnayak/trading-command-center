"use client";
import { useState, useEffect, useRef } from "react";
import type { Portfolio } from "@/lib/types";
import { BTN_AI_SM_CLASS, FIELD_INPUT_SM_CLASS } from "@/lib/uiClasses";

interface PortfolioSwitcherProps {
  portfolios: Portfolio[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onDelete: (id: string) => void;
  /** When true, opens the dropdown in create mode (e.g. from EmptyState CTA). */
  requestCreate?: boolean;
  onRequestCreateHandled?: () => void;
}

export function PortfolioSwitcher({
  portfolios,
  selectedId,
  onSelect,
  onCreate,
  onDelete,
  requestCreate = false,
  onRequestCreateHandled,
}: PortfolioSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = portfolios.find((p) => p.id === selectedId) ?? null;

  // Close on outside click
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
        setNewName("");
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  useEffect(() => {
    if (!requestCreate) return;
    setOpen(true);
    setCreating(true);
    onRequestCreateHandled?.();
  }, [requestCreate, onRequestCreateHandled]);

  function handleSelect(id: string) {
    onSelect(id);
    setOpen(false);
    setCreating(false);
    setNewName("");
  }

  function handleConfirmCreate() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    setNewName("");
    setCreating(false);
    setOpen(false);
  }

  function handleDeleteClick(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (id === selectedId) return;
    onDelete(id);
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      {/* Trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md border border-input-border bg-input px-3 py-2 text-sm text-fg transition-colors hover:border-border-strong focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500/30"
      >
        <span className="truncate max-w-[160px]">
          {selected ? selected.name : <span className="text-muted">Select portfolio</span>}
        </span>
        <span className="text-muted text-xs shrink-0">▾</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[220px] rounded-lg border border-input-border bg-input py-1 shadow-xl">
          {portfolios.length === 0 && (
            <div className="px-3 py-2 text-muted text-xs">No portfolios yet</div>
          )}

          {portfolios.map((p) => (
            <div
              key={p.id}
              onClick={() => handleSelect(p.id)}
              className={`group flex items-center justify-between px-3 py-2 cursor-pointer text-sm transition-colors ${
                p.id === selectedId
                  ? "bg-muted-surface text-fg"
                  : "text-fg-secondary hover:bg-muted-surface/60"
              }`}
            >
              <span className="truncate">{p.name}</span>
              {p.id !== selectedId && (
                <button
                  onClick={(e) => handleDeleteClick(e, p.id)}
                  className="opacity-0 group-hover:opacity-100 ml-2 text-muted hover:text-red-400 text-xs leading-none shrink-0 transition-opacity"
                  title="Delete portfolio"
                >
                  ✕
                </button>
              )}
            </div>
          ))}

          <div className="border-t border-input-border mt-1 pt-1">
            {creating ? (
              <div className="flex items-center gap-2 px-3 py-2">
                <input
                  autoFocus
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleConfirmCreate();
                    if (e.key === "Escape") {
                      setCreating(false);
                      setNewName("");
                    }
                  }}
                  placeholder="Portfolio name"
                  className={`${FIELD_INPUT_SM_CLASS} min-w-0 flex-1 text-xs`}
                />
                <button
                  onClick={handleConfirmCreate}
                  disabled={!newName.trim()}
                  className={`${BTN_AI_SM_CLASS} shrink-0`}
                >
                  Add
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="w-full text-left px-3 py-2 text-xs text-muted hover:text-fg hover:bg-muted-surface/60 transition-colors"
              >
                + New Portfolio
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
