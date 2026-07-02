"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Importer, ImporterField, type ImportInfo } from "react-csv-importer";
import {
  type MappedImportRow,
  mappedRowsToPortfolioCsvFile,
} from "@/lib/portfolioCsvFromImport";

interface UploadDrawerProps {
  open: boolean;
  onClose: () => void;
  onUpload: (file: File) => void;
  uploading: boolean;
}

export function UploadDrawer({ open, onClose, onUpload, uploading }: UploadDrawerProps) {
  const [importError, setImportError] = useState<string | null>(null);
  const rowsBuffer = useRef<MappedImportRow[]>([]);
  const onUploadRef = useRef(onUpload);
  onUploadRef.current = onUpload;

  useEffect(() => {
    if (open) {
      setImportError(null);
      rowsBuffer.current = [];
    }
  }, [open]);

  const handleStart = useCallback(() => {
    rowsBuffer.current = [];
    setImportError(null);
  }, []);

  const dataHandler = useCallback(async (rows: MappedImportRow[]) => {
    rowsBuffer.current.push(...rows);
  }, []);

  const handleComplete = useCallback((info: ImportInfo) => {
    const base =
      (info.file.name || "portfolio-import").replace(/\.[^/.]+$/, "") || "portfolio-import";
    const result = mappedRowsToPortfolioCsvFile(rowsBuffer.current, `${base}.csv`);
    rowsBuffer.current = [];
    if ("error" in result) {
      setImportError(result.error);
      return;
    }
    setImportError(null);
    onUploadRef.current(result.file);
  }, []);

  if (!open) return null;

  return (
    <div className="bg-input border border-input-border rounded-lg mt-2 p-4 transition-all relative">
      <div className="flex items-center justify-between mb-3">
        <span className="text-fg-secondary text-sm font-medium">Upload broker CSV</span>
        <button
          type="button"
          onClick={onClose}
          className="text-muted hover:text-fg text-sm leading-none transition-colors"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <p className="text-muted text-xs mb-2">
        Pick your CSV, map columns to Ticker and Shares (Average Cost optional), then start import. We upload a
        normalized snapshot to the server.
      </p>

      <div className="upload-drawer-csv-importer relative rounded-lg overflow-hidden">
        <Importer<MappedImportRow>
          dataHandler={dataHandler}
          onStart={handleStart}
          onComplete={handleComplete}
          restartable
          defaultNoHeader={false}
        >
          <ImporterField name="ticker" label="Ticker / Symbol" />
          <ImporterField name="shares" label="Shares / Quantity" />
          <ImporterField name="avg_cost" label="Average Cost" optional />
        </Importer>

        {uploading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-input/90 backdrop-blur-[2px] rounded-lg">
            <span className="text-fg text-sm font-medium">Uploading snapshot…</span>
          </div>
        ) : null}
      </div>

      {importError ? <p className="text-red-400 text-xs mt-2">{importError}</p> : null}
    </div>
  );
}
