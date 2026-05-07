"use client";
import { useState, useEffect, useRef } from "react";
import type { Portfolio } from "@/lib/types";

interface PortfolioSwitcherProps {
  portfolios: Portfolio[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onDelete: (id: string) => void;
}

export function PortfolioSwitcher({
  portfolios,
  selectedId,
  onSelect,
  onCreate,
  onDelete,
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
        className="flex items-center gap-2 bg-slate-800 border border-slate-700 hover:border-slate-600 rounded px-3 py-2 text-sm text-slate-200 focus:outline-none transition-colors"
      >
        <span className="truncate max-w-[160px]">
          {selected ? selected.name : <span className="text-slate-500">Select portfolio</span>}
        </span>
        <span className="text-slate-500 text-xs shrink-0">▾</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 min-w-[220px] bg-slate-800 border border-slate-700 rounded shadow-xl py-1">
          {portfolios.length === 0 && (
            <div className="px-3 py-2 text-slate-500 text-xs">No portfolios yet</div>
          )}

          {portfolios.map((p) => (
            <div
              key={p.id}
              onClick={() => handleSelect(p.id)}
              className={`group flex items-center justify-between px-3 py-2 cursor-pointer text-sm transition-colors ${
                p.id === selectedId
                  ? "bg-slate-700 text-slate-100"
                  : "text-slate-300 hover:bg-slate-700/60"
              }`}
            >
              <span className="truncate">{p.name}</span>
              {p.id !== selectedId && (
                <button
                  onClick={(e) => handleDeleteClick(e, p.id)}
                  className="opacity-0 group-hover:opacity-100 ml-2 text-slate-500 hover:text-red-400 text-xs leading-none shrink-0 transition-opacity"
                  title="Delete portfolio"
                >
                  ✕
                </button>
              )}
            </div>
          ))}

          <div className="border-t border-slate-700 mt-1 pt-1">
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
                  className="flex-1 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-purple-500 min-w-0"
                />
                <button
                  onClick={handleConfirmCreate}
                  disabled={!newName.trim()}
                  className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded px-2 py-1 text-xs shrink-0"
                >
                  Add
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="w-full text-left px-3 py-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-700/60 transition-colors"
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
