"use client";
import { useState, useRef, useEffect } from "react";
import type { Run, Report } from "@/lib/types";
import { buildMarkdown } from "@/lib/export/buildMarkdown";

interface Props {
  run: Run | undefined;
  report: Report | undefined;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function DownloadMenu({ run, report }: Props) {
  const [open, setOpen] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const disabled = !report;
  const stem = run && report ? `${run.ticker}-${run.analysis_date}-report` : "report";

  function handleJson() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report.raw_report, null, 2)], { type: "application/json" });
    triggerDownload(blob, `${stem}.json`);
    setOpen(false);
  }

  function handleMarkdown() {
    if (!run || !report) return;
    const blob = new Blob([buildMarkdown(run, report)], { type: "text/markdown" });
    triggerDownload(blob, `${stem}.md`);
    setOpen(false);
  }

  async function handlePdf() {
    if (!run || !report) return;
    setPdfLoading(true);
    setOpen(false);
    try {
      const [{ pdf }, { ReportDocument }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/lib/export/ReportPdf"),
      ]);
      const blob = await pdf(<ReportDocument run={run} report={report} />).toBlob();
      triggerDownload(blob, `${stem}.pdf`);
    } catch (err) {
      console.error("PDF generation failed:", err);
    } finally {
      setPdfLoading(false);
    }
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || pdfLoading}
        className="text-xs text-slate-400 hover:text-slate-200 border border-slate-700 rounded px-3 py-1 disabled:opacity-40 flex items-center gap-1.5"
      >
        {pdfLoading ? (
          <>
            <span className="inline-block w-3 h-3 border border-slate-400 border-t-transparent rounded-full animate-spin" />
            Generating PDF…
          </>
        ) : (
          <>
            Download
            <span className="text-slate-500">▾</span>
          </>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-44 bg-navy-800 border border-slate-700 rounded shadow-lg z-20 py-1">
          <button
            onClick={handleJson}
            className="w-full text-left px-4 py-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-slate-100"
          >
            Download JSON
          </button>
          <button
            onClick={handleMarkdown}
            className="w-full text-left px-4 py-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-slate-100"
          >
            Download Markdown
          </button>
          <button
            onClick={handlePdf}
            className="w-full text-left px-4 py-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-slate-100"
          >
            Download PDF
          </button>
        </div>
      )}
    </div>
  );
}
