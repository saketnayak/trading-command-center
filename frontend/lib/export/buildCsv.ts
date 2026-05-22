import type { Run, PerformanceStats } from "@/lib/types";

function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowsToCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(","));
  }
  return lines.join("\r\n");
}

function triggerDownload(filename: string, content: string) {
  const blob = new Blob(["﻿", content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function buildRunsCsv(runs: Run[]): string {
  const headers = [
    "id",
    "ticker",
    "analysis_date",
    "status",
    "verdict",
    "llm_provider",
    "llm_model",
    "depth",
    "analysts",
    "label",
    "notes",
    "suggested_entry",
    "suggested_stop",
    "suggested_target",
    "created_at",
    "started_at",
    "completed_at",
  ];
  const rows = runs.map((r) => [
    r.id,
    r.ticker,
    r.analysis_date,
    r.status,
    r.verdict ?? "",
    r.llm_provider,
    r.llm_model,
    r.depth,
    r.analysts.join("|"),
    r.label ?? "",
    r.notes ?? "",
    r.suggested_entry ?? "",
    r.suggested_stop ?? "",
    r.suggested_target ?? "",
    r.created_at,
    r.started_at ?? "",
    r.completed_at ?? "",
  ]);
  return rowsToCsv(headers, rows);
}

export function downloadRunsCsv(runs: Run[]): void {
  const stamp = new Date().toISOString().slice(0, 10);
  triggerDownload(`agentfloor-runs-${stamp}.csv`, buildRunsCsv(runs));
}

function pctChange(base: number | null, later: number | null): string {
  if (base === null || later === null) return "";
  if (base === 0) return "";
  return (((later - base) / base) * 100).toFixed(2);
}

export function buildPerformanceCsv(stats: PerformanceStats): string {
  const headers = [
    "run_id",
    "ticker",
    "verdict",
    "analysis_date",
    "price_at_analysis",
    "price_7d",
    "pct_7d",
    "price_14d",
    "pct_14d",
    "price_30d",
    "pct_30d",
    "price_90d",
    "pct_90d",
  ];
  const rows = stats.outcomes.map((o) => [
    o.run_id,
    o.ticker,
    o.verdict,
    o.analysis_date,
    o.price_at_analysis ?? "",
    o.price_7d ?? "",
    pctChange(o.price_at_analysis, o.price_7d),
    o.price_14d ?? "",
    pctChange(o.price_at_analysis, o.price_14d),
    o.price_30d ?? "",
    pctChange(o.price_at_analysis, o.price_30d),
    o.price_90d ?? "",
    pctChange(o.price_at_analysis, o.price_90d),
  ]);
  return rowsToCsv(headers, rows);
}

export function downloadPerformanceCsv(stats: PerformanceStats): void {
  const stamp = new Date().toISOString().slice(0, 10);
  triggerDownload(`agentfloor-performance-${stamp}.csv`, buildPerformanceCsv(stats));
}
