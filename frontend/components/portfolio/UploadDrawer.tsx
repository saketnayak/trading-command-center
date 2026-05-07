"use client";
import { useState, useRef, DragEvent } from "react";

interface UploadDrawerProps {
  open: boolean;
  onClose: () => void;
  onUpload: (file: File) => void;
  uploading: boolean;
}

const BROKER_BADGES = [
  { label: "Moomoo", className: "bg-purple-500/20 text-purple-300" },
  { label: "Fidelity", className: "bg-blue-500/20 text-blue-300" },
  { label: "Schwab", className: "bg-green-500/20 text-green-300" },
  { label: "Generic", className: "bg-pink-500/20 text-pink-300" },
] as const;

export function UploadDrawer({ open, onClose, onUpload, uploading }: UploadDrawerProps) {
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Please upload a CSV file.");
      setPendingFile(null);
      return;
    }
    setError(null);
    setPendingFile(file);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function handleUpload() {
    if (pendingFile) onUpload(pendingFile);
  }

  return (
    <div className="bg-[#181825] border border-slate-700 rounded mt-2 p-4 transition-all">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-slate-300 text-sm font-medium">Upload broker CSV</span>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-200 text-sm leading-none transition-colors"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* Broker badges */}
      <div className="flex items-center gap-2 mb-3">
        {BROKER_BADGES.map((b) => (
          <span
            key={b.label}
            className={`rounded px-2 py-0.5 text-xs font-medium ${b.className}`}
          >
            {b.label}
          </span>
        ))}
      </div>

      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded p-6 text-center transition-colors ${
          dragging
            ? "border-purple-500 bg-purple-500/5"
            : "border-slate-600 bg-slate-900/80"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleInputChange}
        />
        {pendingFile ? (
          <span className="text-slate-300 text-sm">{pendingFile.name}</span>
        ) : (
          <span className="text-slate-500 text-sm">
            Drag &amp; drop your broker CSV here, or{" "}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="text-purple-400 hover:text-purple-300 font-semibold underline underline-offset-2 transition-colors"
            >
              browse
            </button>
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <p className="text-red-400 text-xs mt-2">{error}</p>
      )}

      {/* Upload button */}
      {pendingFile && (
        <div className="flex justify-end mt-3">
          <button
            onClick={handleUpload}
            disabled={uploading}
            className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-medium rounded px-4 py-1.5 transition-colors"
          >
            {uploading ? "Uploading..." : "Upload"}
          </button>
        </div>
      )}
    </div>
  );
}
