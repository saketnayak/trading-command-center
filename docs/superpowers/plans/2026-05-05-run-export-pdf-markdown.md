# Run Research Export: PDF + Markdown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PDF and Markdown download buttons to the run view page (`/runs/[id]`), exporting all report content in well-structured, readable formats.

**Architecture:** All logic is client-side — no backend changes. A `DownloadMenu` dropdown replaces the existing inline "Download JSON" button and adds Markdown and PDF options. Markdown is assembled from a pure string builder; PDF is rendered via `@react-pdf/renderer` with dynamic import on first click.

**Tech Stack:** `@react-pdf/renderer` ^3.4.0, Next.js 14 App Router, TypeScript, `npx tsx` for running tests.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `frontend/lib/export/buildMarkdown.ts` | Pure fn `buildMarkdown(run, report) → string` |
| Create | `frontend/lib/export/buildMarkdown.test.ts` | Unit tests for buildMarkdown |
| Create | `frontend/lib/export/parseMdForPdf.ts` | Line-by-line Markdown → typed segment array |
| Create | `frontend/lib/export/parseMdForPdf.test.ts` | Unit tests for parseMdForPdf |
| Create | `frontend/lib/export/ReportPdf.tsx` | `@react-pdf/renderer` Document component |
| Create | `frontend/components/runs/DownloadMenu.tsx` | Dropdown replacing inline JSON button |
| Modify | `frontend/package.json` | Add `@react-pdf/renderer` |
| Modify | `frontend/app/runs/[id]/page.tsx` | Swap inline button → `<DownloadMenu>` |

---

## Task 1: Install @react-pdf/renderer

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install the package**

```bash
cd frontend && npm install @react-pdf/renderer@^3.4.0
```

Expected: package added to `dependencies`, `package-lock.json` updated.

- [ ] **Step 2: Verify TypeScript still compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "feat: add @react-pdf/renderer dependency"
```

---

## Task 2: Markdown export builder

**Files:**
- Create: `frontend/lib/export/buildMarkdown.ts`
- Create: `frontend/lib/export/buildMarkdown.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/lib/export/buildMarkdown.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMarkdown } from "./buildMarkdown";

// Minimal inline types mirror frontend/lib/types.ts to avoid tsconfig path alias issues
const run = {
  id: "abc",
  ticker: "AAPL",
  analysis_date: "2024-01-15",
  llm_provider: "openai",
  llm_model: "gpt-4",
  depth: "standard",
  analysts: ["market", "fundamentals"],
  label: null,
  status: "completed",
  verdict: "buy",
  archived: false,
  created_by: "user1",
  created_at: "2024-01-15T00:00:00Z",
  started_at: null,
  completed_at: null,
  suggested_entry: "150.00",
  suggested_stop: "140.00",
  suggested_target: "170.00",
} as const;

const report = {
  id: "r1",
  run_id: "abc",
  trader_decision: "Buy at market open.",
  verdict: "buy",
  suggested_entry: "150.00",
  suggested_stop: "140.00",
  suggested_target: "170.00",
  risk_assessment: "Low",
  raw_report: {
    market_report: "Market is bullish.",
    fundamentals_report: "Strong earnings.",
    investment_debate_state: { history: "Bull: positive.\nBear: cautious." },
    risk_debate_state: { history: "Risk is manageable." },
    investment_plan: "Scale in over 3 days.",
    final_trade_decision: "BUY 100 shares.",
  },
} as const;

test("includes ticker and verdict header", () => {
  const md = buildMarkdown(run as never, report as never);
  assert.ok(md.includes("# AAPL Research Report — 2024-01-15"));
  assert.ok(md.includes("**Verdict:** BUY"));
});

test("includes price levels", () => {
  const md = buildMarkdown(run as never, report as never);
  assert.ok(md.includes("$150.00"));
  assert.ok(md.includes("$140.00"));
  assert.ok(md.includes("$170.00"));
});

test("includes analyst sections", () => {
  const md = buildMarkdown(run as never, report as never);
  assert.ok(md.includes("### Market Analyst"));
  assert.ok(md.includes("Market is bullish."));
  assert.ok(md.includes("### Fundamentals Analyst"));
  assert.ok(md.includes("Strong earnings."));
});

test("includes debate history", () => {
  const md = buildMarkdown(run as never, report as never);
  assert.ok(md.includes("Bull: positive."));
  assert.ok(md.includes("Risk is manageable."));
});

test("includes investment plan and final decision", () => {
  const md = buildMarkdown(run as never, report as never);
  assert.ok(md.includes("Scale in over 3 days."));
  assert.ok(md.includes("BUY 100 shares."));
});

test("omits section when field is absent", () => {
  const reportNoDebate = {
    ...report,
    raw_report: { market_report: "Bullish." },
  };
  const md = buildMarkdown(
    { ...run, analysts: ["market"] } as never,
    reportNoDebate as never
  );
  assert.ok(!md.includes("Investment Debate"));
  assert.ok(!md.includes("Investment Plan"));
});
```

- [ ] **Step 2: Run the test to see it fail**

```bash
cd frontend && npx tsx --test lib/export/buildMarkdown.test.ts
```

Expected: error — `buildMarkdown` module not found.

- [ ] **Step 3: Write the implementation**

Create `frontend/lib/export/buildMarkdown.ts`:

```typescript
import type { Run, Report } from "../types";

function extractHistory(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "history" in value) {
    return String((value as Record<string, unknown>).history ?? "");
  }
  return "";
}

function mdSection(heading: string, content: string | undefined | null): string {
  if (!content?.trim()) return "";
  return `## ${heading}\n\n${content.trim()}\n\n---\n\n`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function buildMarkdown(run: Run, report: Report): string {
  const raw = report.raw_report;

  const priceParts = [
    report.suggested_entry ? `**Entry:** $${report.suggested_entry}` : null,
    report.suggested_stop ? `**Stop:** $${report.suggested_stop}` : null,
    report.suggested_target ? `**Target:** $${report.suggested_target}` : null,
  ].filter(Boolean);

  const pricesLine = priceParts.length > 0 ? priceParts.join(" · ") + "\n" : "";

  const header =
    `# ${run.ticker} Research Report — ${run.analysis_date}\n\n` +
    `**Verdict:** ${report.verdict.toUpperCase()}\n` +
    pricesLine +
    `**Model:** ${run.llm_provider} / ${run.llm_model} · **Depth:** ${run.depth}\n` +
    `**Analysts:** ${run.analysts.map(capitalize).join(", ")}\n\n` +
    `---\n\n`;

  const analystSections = run.analysts
    .map((analyst) => {
      const content =
        (raw?.[`${analyst}_report`] as string | undefined) ??
        (raw?.[analyst] as string | undefined) ??
        "";
      if (!content.trim()) return "";
      return `### ${capitalize(analyst)} Analyst\n\n${content.trim()}\n\n`;
    })
    .filter(Boolean)
    .join("");

  const analystBlock = analystSections
    ? `## Analyst Reports\n\n${analystSections}---\n\n`
    : "";

  const debateHistory = extractHistory(raw?.investment_debate_state);
  const riskHistory = extractHistory(raw?.risk_debate_state);
  let debateBlock = "";
  if (debateHistory || riskHistory) {
    debateBlock = "## Bull / Bear Debate\n\n";
    if (debateHistory)
      debateBlock += `### Investment Debate\n\n${debateHistory.trim()}\n\n`;
    if (riskHistory)
      debateBlock += `### Risk Discussion\n\n${riskHistory.trim()}\n\n`;
    debateBlock += "---\n\n";
  }

  return (
    header +
    mdSection("Trader Decision", report.trader_decision) +
    analystBlock +
    debateBlock +
    mdSection("Investment Plan", raw?.investment_plan as string | undefined) +
    mdSection("Final Trade Decision", raw?.final_trade_decision as string | undefined)
  )
    .trimEnd()
    .concat("\n");
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd frontend && npx tsx --test lib/export/buildMarkdown.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/export/buildMarkdown.ts frontend/lib/export/buildMarkdown.test.ts
git commit -m "feat: add buildMarkdown export utility"
```

---

## Task 3: Markdown-to-PDF segment parser

**Files:**
- Create: `frontend/lib/export/parseMdForPdf.ts`
- Create: `frontend/lib/export/parseMdForPdf.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/lib/export/parseMdForPdf.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMdForPdf } from "./parseMdForPdf";

test("parses h1", () => {
  const result = parseMdForPdf("# Title");
  assert.deepEqual(result, [{ kind: "h1", text: "Title" }]);
});

test("parses h2", () => {
  const result = parseMdForPdf("## Section");
  assert.deepEqual(result, [{ kind: "h2", text: "Section" }]);
});

test("parses h3", () => {
  const result = parseMdForPdf("### Sub");
  assert.deepEqual(result, [{ kind: "h3", text: "Sub" }]);
});

test("parses bullet with dash", () => {
  const result = parseMdForPdf("- item one");
  assert.deepEqual(result, [{ kind: "bullet", text: "item one" }]);
});

test("parses bullet with asterisk", () => {
  const result = parseMdForPdf("* item two");
  assert.deepEqual(result, [{ kind: "bullet", text: "item two" }]);
});

test("parses blank line", () => {
  const result = parseMdForPdf("");
  assert.deepEqual(result, [{ kind: "blank" }]);
});

test("parses paragraph", () => {
  const result = parseMdForPdf("Some plain text.");
  assert.deepEqual(result, [{ kind: "paragraph", text: "Some plain text." }]);
});

test("strips trailing whitespace from lines", () => {
  const result = parseMdForPdf("hello   ");
  assert.deepEqual(result, [{ kind: "paragraph", text: "hello" }]);
});

test("parses multi-line input", () => {
  const input = "# H1\n\nParagraph.\n- Bullet";
  const result = parseMdForPdf(input);
  assert.deepEqual(result, [
    { kind: "h1", text: "H1" },
    { kind: "blank" },
    { kind: "paragraph", text: "Paragraph." },
    { kind: "bullet", text: "Bullet" },
  ]);
});
```

- [ ] **Step 2: Run the test to see it fail**

```bash
cd frontend && npx tsx --test lib/export/parseMdForPdf.test.ts
```

Expected: error — module not found.

- [ ] **Step 3: Write the implementation**

Create `frontend/lib/export/parseMdForPdf.ts`:

```typescript
export type MdSegment =
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "blank" };

export function parseMdForPdf(md: string): MdSegment[] {
  return md.split("\n").map((raw): MdSegment => {
    const line = raw.trimEnd();
    if (line.startsWith("### ")) return { kind: "h3", text: line.slice(4) };
    if (line.startsWith("## ")) return { kind: "h2", text: line.slice(3) };
    if (line.startsWith("# ")) return { kind: "h1", text: line.slice(2) };
    if (line.startsWith("- ") || line.startsWith("* "))
      return { kind: "bullet", text: line.slice(2) };
    if (line.trim() === "") return { kind: "blank" };
    return { kind: "paragraph", text: line };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd frontend && npx tsx --test lib/export/parseMdForPdf.test.ts
```

Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/export/parseMdForPdf.ts frontend/lib/export/parseMdForPdf.test.ts
git commit -m "feat: add parseMdForPdf utility for PDF text rendering"
```

---

## Task 4: ReportPdf document component

**Files:**
- Create: `frontend/lib/export/ReportPdf.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/lib/export/ReportPdf.tsx`:

```tsx
import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { Run, Report } from "../types";
import { parseMdForPdf, type MdSegment } from "./parseMdForPdf";

const HEADER_HEIGHT = 36;

const styles = StyleSheet.create({
  page: {
    paddingTop: HEADER_HEIGHT + 24,
    paddingBottom: 48,
    paddingHorizontal: 40,
    fontFamily: "Helvetica",
    backgroundColor: "#ffffff",
    fontSize: 10,
    color: "#1a1a2e",
  },
  pageHeader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: HEADER_HEIGHT,
    paddingHorizontal: 40,
    paddingTop: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 0.5,
    borderBottomColor: "#cbd5e1",
  },
  pageHeaderText: {
    fontSize: 8,
    color: "#94a3b8",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  pageNumber: {
    position: "absolute",
    bottom: 20,
    right: 40,
    fontSize: 8,
    color: "#94a3b8",
  },
  // Cover
  coverTicker: {
    fontSize: 40,
    fontFamily: "Helvetica-Bold",
    color: "#0f3460",
    marginBottom: 6,
  },
  coverDate: {
    fontSize: 13,
    color: "#64748b",
    marginBottom: 24,
  },
  verdictBadgeBuy: {
    backgroundColor: "#166534",
    color: "#ffffff",
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 4,
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    alignSelf: "flex-start",
    marginBottom: 24,
  },
  verdictBadgeSell: {
    backgroundColor: "#991b1b",
    color: "#ffffff",
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 4,
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    alignSelf: "flex-start",
    marginBottom: 24,
  },
  verdictBadgeHold: {
    backgroundColor: "#92400e",
    color: "#ffffff",
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 4,
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    alignSelf: "flex-start",
    marginBottom: 24,
  },
  priceGrid: {
    flexDirection: "row",
    gap: 24,
    marginBottom: 24,
  },
  priceItem: {
    flexDirection: "column",
    gap: 3,
  },
  priceLabel: {
    fontSize: 8,
    color: "#94a3b8",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  priceValue: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: "#1a1a2e",
  },
  metaRow: {
    flexDirection: "row",
    gap: 16,
    flexWrap: "wrap",
  },
  metaItem: {
    flexDirection: "row",
    gap: 4,
  },
  metaLabel: { fontSize: 9, color: "#94a3b8" },
  metaValue: { fontSize: 9, color: "#1a1a2e" },
  // Section
  sectionTitle: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: "#0f3460",
    marginBottom: 14,
  },
  // Markdown rendering
  h1: { fontSize: 14, fontFamily: "Helvetica-Bold", color: "#0f3460", marginTop: 10, marginBottom: 5 },
  h2: { fontSize: 12, fontFamily: "Helvetica-Bold", color: "#1e3a5f", marginTop: 8, marginBottom: 4 },
  h3: { fontSize: 10, fontFamily: "Helvetica-Bold", color: "#334155", marginTop: 6, marginBottom: 3 },
  paragraph: { fontSize: 10, color: "#1e293b", lineHeight: 1.5, marginBottom: 4 },
  bullet: { fontSize: 10, color: "#1e293b", lineHeight: 1.5, marginBottom: 2, marginLeft: 12 },
});

function PageHeader({ ticker, date }: { ticker: string; date: string }) {
  return (
    <View style={styles.pageHeader} fixed>
      <Text style={styles.pageHeaderText}>AgentFloor</Text>
      <Text style={styles.pageHeaderText}>
        {ticker} — {date}
      </Text>
    </View>
  );
}

function PageNum() {
  return (
    <Text
      style={styles.pageNumber}
      render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      fixed
    />
  );
}

function MdContent({ text }: { text: string }) {
  const segments = parseMdForPdf(text);
  return (
    <>
      {segments.map((seg: MdSegment, i: number) => {
        if (seg.kind === "blank") return <View key={i} style={{ height: 6 }} />;
        if (seg.kind === "h1") return <Text key={i} style={styles.h1}>{seg.text}</Text>;
        if (seg.kind === "h2") return <Text key={i} style={styles.h2}>{seg.text}</Text>;
        if (seg.kind === "h3") return <Text key={i} style={styles.h3}>{seg.text}</Text>;
        if (seg.kind === "bullet") return <Text key={i} style={styles.bullet}>• {seg.text}</Text>;
        return <Text key={i} style={styles.paragraph}>{seg.text}</Text>;
      })}
    </>
  );
}

function verdictStyle(verdict: string) {
  if (verdict === "buy") return styles.verdictBadgeBuy;
  if (verdict === "sell") return styles.verdictBadgeSell;
  return styles.verdictBadgeHold;
}

function extractHistory(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "history" in value)
    return String((value as Record<string, unknown>).history ?? "");
  return "";
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function ReportDocument({ run, report }: { run: Run; report: Report }) {
  const raw = report.raw_report;
  const hasPrices =
    report.suggested_entry || report.suggested_stop || report.suggested_target;

  const analysts = run.analysts.filter((analyst) => {
    const content =
      (raw?.[`${analyst}_report`] as string | undefined) ??
      (raw?.[analyst] as string | undefined) ??
      "";
    return content.trim().length > 0;
  });

  const debateHistory = extractHistory(raw?.investment_debate_state);
  const riskHistory = extractHistory(raw?.risk_debate_state);
  const investmentPlan = raw?.investment_plan as string | undefined;
  const finalDecision = raw?.final_trade_decision as string | undefined;

  return (
    <Document
      title={`${run.ticker} Research Report — ${run.analysis_date}`}
      author="AgentFloor"
    >
      <Page size="A4" style={styles.page}>
        <PageHeader ticker={run.ticker} date={run.analysis_date} />
        <PageNum />

        {/* Cover */}
        <Text style={styles.coverTicker}>{run.ticker}</Text>
        <Text style={styles.coverDate}>{run.analysis_date}</Text>
        <Text style={verdictStyle(report.verdict)}>
          {report.verdict.toUpperCase()}
        </Text>

        {hasPrices && (
          <View style={styles.priceGrid}>
            {report.suggested_entry && (
              <View style={styles.priceItem}>
                <Text style={styles.priceLabel}>Entry</Text>
                <Text style={styles.priceValue}>${report.suggested_entry}</Text>
              </View>
            )}
            {report.suggested_stop && (
              <View style={styles.priceItem}>
                <Text style={styles.priceLabel}>Stop</Text>
                <Text style={styles.priceValue}>${report.suggested_stop}</Text>
              </View>
            )}
            {report.suggested_target && (
              <View style={styles.priceItem}>
                <Text style={styles.priceLabel}>Target</Text>
                <Text style={styles.priceValue}>${report.suggested_target}</Text>
              </View>
            )}
          </View>
        )}

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Model</Text>
            <Text style={styles.metaValue}>{run.llm_provider} / {run.llm_model}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Depth</Text>
            <Text style={styles.metaValue}>{run.depth}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Analysts</Text>
            <Text style={styles.metaValue}>{run.analysts.map(capitalize).join(", ")}</Text>
          </View>
        </View>

        {/* Trader Decision */}
        {report.trader_decision?.trim() && (
          <View break>
            <Text style={styles.sectionTitle}>Trader Decision</Text>
            <MdContent text={report.trader_decision} />
          </View>
        )}

        {/* Per-analyst sections */}
        {analysts.map((analyst) => {
          const content =
            (raw?.[`${analyst}_report`] as string) ??
            (raw?.[analyst] as string) ??
            "";
          return (
            <View key={analyst} break>
              <Text style={styles.sectionTitle}>{capitalize(analyst)} Analyst Report</Text>
              <MdContent text={content} />
            </View>
          );
        })}

        {/* Investment Debate */}
        {debateHistory && (
          <View break>
            <Text style={styles.sectionTitle}>Investment Debate</Text>
            <MdContent text={debateHistory} />
          </View>
        )}

        {/* Risk Discussion */}
        {riskHistory && (
          <View break>
            <Text style={styles.sectionTitle}>Risk Discussion</Text>
            <MdContent text={riskHistory} />
          </View>
        )}

        {/* Investment Plan */}
        {investmentPlan?.trim() && (
          <View break>
            <Text style={styles.sectionTitle}>Investment Plan</Text>
            <MdContent text={investmentPlan} />
          </View>
        )}

        {/* Final Trade Decision */}
        {finalDecision?.trim() && (
          <View break>
            <Text style={styles.sectionTitle}>Final Trade Decision</Text>
            <MdContent text={finalDecision} />
          </View>
        )}
      </Page>
    </Document>
  );
}
```

- [ ] **Step 2: TypeScript-check the component**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors. If `@react-pdf/renderer` types complain about JSX, ensure `tsconfig.json` has `"jsx": "preserve"` (Next.js default — already set).

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/export/ReportPdf.tsx
git commit -m "feat: add ReportDocument PDF component"
```

---

## Task 5: DownloadMenu component

**Files:**
- Create: `frontend/components/runs/DownloadMenu.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/components/runs/DownloadMenu.tsx`:

```tsx
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
  const stem =
    run && report
      ? `${run.ticker}-${run.analysis_date}-report`
      : "report";

  function handleJson() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report.raw_report, null, 2)], {
      type: "application/json",
    });
    triggerDownload(blob, `${stem}.json`);
    setOpen(false);
  }

  function handleMarkdown() {
    if (!run || !report) return;
    const md = buildMarkdown(run, report);
    const blob = new Blob([md], { type: "text/markdown" });
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
      const blob = await pdf(
        <ReportDocument run={run} report={report} />
      ).toBlob();
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
```

- [ ] **Step 2: TypeScript-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/runs/DownloadMenu.tsx
git commit -m "feat: add DownloadMenu dropdown for JSON/Markdown/PDF export"
```

---

## Task 6: Wire DownloadMenu into the view page

**Files:**
- Modify: `frontend/app/runs/[id]/page.tsx:36-51`

- [ ] **Step 1: Replace the inline button**

In `frontend/app/runs/[id]/page.tsx`, replace:

```tsx
import { getRun, getReport } from "@/lib/api";
```

with:

```tsx
import { getRun, getReport } from "@/lib/api";
import { DownloadMenu } from "@/components/runs/DownloadMenu";
```

Then replace the entire inline `{report && (<button ...>Download JSON</button>)}` block (lines 36–51) with:

```tsx
<DownloadMenu run={run} report={report} />
```

The full updated header row becomes:

```tsx
<div className="flex items-center justify-between">
  <Link href="/runs" className="text-blue-400 hover:underline text-sm">
    ← Back to History
  </Link>
  <DownloadMenu run={run} report={report} />
</div>
```

- [ ] **Step 2: TypeScript-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manual browser test**

Start the dev server:

```bash
cd frontend && npm run dev
```

1. Navigate to a completed run's view page (`/runs/<id>`).
2. Confirm the "Download" dropdown appears in the top-right of the page.
3. Click "Download JSON" — verify a `.json` file downloads with `raw_report` contents.
4. Click "Download Markdown" — verify a `.md` file downloads with all sections present (ticker header, verdict, each analyst, debate, plan, decision).
5. Click "Download PDF" — verify the spinner appears briefly, then a `.pdf` downloads. Open it and confirm: cover page with ticker/verdict/prices, per-section pages with headers, text is selectable (not a screenshot).
6. Navigate to an in-progress or failed run — confirm the "Download" button is disabled.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/runs/[id]/page.tsx
git commit -m "feat: wire DownloadMenu into run view page"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Covered by |
|-------------|-----------|
| PDF download with all fields | Tasks 4 + 6 |
| Markdown download with all fields | Tasks 2 + 6 |
| Dropdown replaces inline JSON button | Task 5 + 6 |
| Cover page (verdict, prices, metadata) | Task 4 — Cover section |
| Per-section headers / page breaks | Task 4 — `<View break>` per section |
| Analyst pages (one per analyst in run) | Task 4 — `analysts.map(...)` with `break` |
| Debate, risk, plan, final decision sections | Task 4 |
| Missing fields silently omitted | Tasks 2 (mdSection), 4 (guards) |
| Spinner while PDF generates | Task 5 — `pdfLoading` state |
| Disabled when report not loaded | Task 5 — `disabled={!report}` |
| Filename `{TICKER}-{date}-report.{ext}` | Task 5 — `stem` variable |
| Shared page header on every PDF page | Task 4 — `<PageHeader fixed>` |
| Lightweight Markdown renderer for PDF | Task 3 (parser) + Task 4 (MdContent) |

**Placeholder scan:** None found. All steps contain complete code.

**Type consistency check:**
- `MdSegment` defined in `parseMdForPdf.ts` Task 3, imported in `ReportPdf.tsx` Task 4 — consistent.
- `buildMarkdown(run: Run, report: Report)` defined Task 2, imported in `DownloadMenu.tsx` Task 5 — consistent.
- `ReportDocument` exported from `ReportPdf.tsx` Task 4, dynamically imported in `DownloadMenu.tsx` Task 5 — consistent.
- `triggerDownload` is local to `DownloadMenu.tsx` — no external dependency.
- `capitalize` defined independently in both `buildMarkdown.ts` and `ReportPdf.tsx` — intentional duplication, no shared dependency needed.
