import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { Run, Report } from "../types";
import { parseMdForPdf, type MdSegment } from "./parseMdForPdf";

const HEADER_HEIGHT = 36;
const FOOTER_HEIGHT = 28;

// ── accent colours per section type ──────────────────────────────────────
const ACCENT = {
  trader: "#2563eb",
  analyst: "#7c3aed",
  debate: "#dc2626",
  risk: "#ea580c",
  plan: "#16a34a",
  final: "#0f3460",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: HEADER_HEIGHT + 20,
    paddingBottom: FOOTER_HEIGHT + 20,
    paddingHorizontal: 40,
    fontFamily: "Helvetica",
    backgroundColor: "#ffffff",
    fontSize: 10,
    color: "#1a1a2e",
  },

  // ── fixed header ─────────────────────────────────────────────────────
  pageHeader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: HEADER_HEIGHT,
    paddingHorizontal: 40,
    paddingTop: 13,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#0f3460",
  },
  pageHeaderLeft: { fontSize: 9, color: "#ffffff", fontFamily: "Helvetica-Bold", letterSpacing: 1 },
  pageHeaderRight: { fontSize: 8, color: "#93c5fd" },

  // ── fixed footer ─────────────────────────────────────────────────────
  pageFooter: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: FOOTER_HEIGHT,
    paddingHorizontal: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 0.5,
    borderTopColor: "#e2e8f0",
  },
  pageFooterDisclaimer: { fontSize: 7, color: "#94a3b8" },
  pageNumber: { fontSize: 7, color: "#94a3b8" },

  // ── cover ─────────────────────────────────────────────────────────────
  coverTickerRow: { flexDirection: "row", alignItems: "flex-end", gap: 12, marginBottom: 4 },
  coverTicker: { fontSize: 44, fontFamily: "Helvetica-Bold", color: "#0f3460" },
  coverDate: { fontSize: 12, color: "#64748b", marginBottom: 20, paddingBottom: 20, borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0" },
  coverGeneratedAt: { fontSize: 8, color: "#94a3b8", marginBottom: 4 },

  // verdict badge
  verdictWrapperBuy:  { backgroundColor: "#166534", paddingVertical: 7, paddingHorizontal: 18, borderRadius: 4, alignSelf: "flex-start", marginBottom: 20 },
  verdictWrapperSell: { backgroundColor: "#991b1b", paddingVertical: 7, paddingHorizontal: 18, borderRadius: 4, alignSelf: "flex-start", marginBottom: 20 },
  verdictWrapperHold: { backgroundColor: "#92400e", paddingVertical: 7, paddingHorizontal: 18, borderRadius: 4, alignSelf: "flex-start", marginBottom: 20 },
  verdictText: { fontSize: 18, fontFamily: "Helvetica-Bold", color: "#ffffff" },

  // price boxes
  priceGrid: { flexDirection: "row", gap: 12, marginBottom: 20 },
  priceBox: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: "#f8fafc",
    minWidth: 70,
  },
  priceLabel: { fontSize: 7, color: "#94a3b8", letterSpacing: 1, textTransform: "uppercase", marginBottom: 3 },
  priceValue: { fontSize: 14, fontFamily: "Helvetica-Bold", color: "#0f3460" },

  // meta strip
  metaStrip: {
    flexDirection: "row",
    gap: 0,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 4,
    overflow: "hidden",
    alignSelf: "flex-start",
  },
  metaCell: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRightWidth: 1,
    borderRightColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
  },
  metaCellLast: { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: "#f8fafc" },
  metaLabel: { fontSize: 7, color: "#94a3b8", letterSpacing: 1, textTransform: "uppercase", marginBottom: 2 },
  metaValue: { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#1e293b" },

  // ── section titles ────────────────────────────────────────────────────
  sectionTitleRow: { flexDirection: "row", alignItems: "stretch", marginBottom: 16 },
  sectionAccentBar: { width: 4, borderRadius: 2, marginRight: 10 },
  sectionTitleText: { fontSize: 15, fontFamily: "Helvetica-Bold", color: "#0f3460", paddingTop: 1 },
  sectionSubtitle: { fontSize: 9, color: "#64748b", fontFamily: "Helvetica", marginTop: 1 },

  // ── body text ─────────────────────────────────────────────────────────
  h1: { fontSize: 13, fontFamily: "Helvetica-Bold", color: "#0f3460", marginTop: 12, marginBottom: 5 },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", color: "#1e3a5f", marginTop: 9, marginBottom: 4 },
  h3: { fontSize: 10, fontFamily: "Helvetica-Bold", color: "#334155", marginTop: 6, marginBottom: 3 },
  paragraph: { fontSize: 10, color: "#1e293b", lineHeight: 1.6, marginBottom: 5 },
  bulletRow: { flexDirection: "row", marginBottom: 3 },
  bulletDot: { fontSize: 10, color: "#1e293b", lineHeight: 1.6, marginRight: 6 },
  bulletText: { fontSize: 10, color: "#1e293b", lineHeight: 1.6, flex: 1 },
  numberedRow: { flexDirection: "row", marginLeft: 14, marginBottom: 3 },
  numberedNum: { fontSize: 10, color: "#1e293b", lineHeight: 1.6, marginRight: 4 },
  numberedText: { fontSize: 10, color: "#1e293b", lineHeight: 1.6, flex: 1 },
  boldInline: { fontFamily: "Helvetica-Bold" },
  italicInline: { fontFamily: "Helvetica-Oblique" },
});

type PDFStyle = typeof styles[keyof typeof styles];

// ── inline bold/italic parser ─────────────────────────────────────────────
type InlineSpan = { bold?: boolean; italic?: boolean; text: string };

function parseInline(raw: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let s = raw.trimStart();
  while (s.length > 0) {
    const boldIdx = s.indexOf("**");
    const italicIdx = s.indexOf("*");
    if (boldIdx === 0) {
      const end = s.indexOf("**", 2);
      if (end !== -1) {
        spans.push({ bold: true, text: s.slice(2, end) });
        s = s.slice(end + 2);
        continue;
      }
    }
    if (italicIdx === 0) {
      const end = s.indexOf("*", 1);
      if (end !== -1) {
        spans.push({ italic: true, text: s.slice(1, end) });
        s = s.slice(end + 1);
        continue;
      }
    }
    // advance to next marker
    const nextBold = s.indexOf("**", 1);
    const nextItalic = s.indexOf("*", 1);
    let cut = s.length;
    if (nextBold !== -1) cut = Math.min(cut, nextBold);
    if (nextItalic !== -1) cut = Math.min(cut, nextItalic);
    spans.push({ text: s.slice(0, cut) });
    s = s.slice(cut);
  }
  return spans.filter((sp) => sp.text.length > 0);
}

function InlineText({ raw, style }: { raw: string; style: PDFStyle }) {
  const spans = parseInline(raw);
  if (spans.length === 1 && !spans[0].bold && !spans[0].italic) {
    return <Text style={style}>{spans[0].text}</Text>;
  }
  return (
    <Text style={style}>
      {spans.map((sp, i) =>
        sp.bold ? (
          <Text key={i} style={styles.boldInline}>{sp.text}</Text>
        ) : sp.italic ? (
          <Text key={i} style={styles.italicInline}>{sp.text}</Text>
        ) : (
          <Text key={i}>{sp.text}</Text>
        )
      )}
    </Text>
  );
}

// ── markdown content renderer ─────────────────────────────────────────────
function MdContent({ text }: { text: string }) {
  const segments = parseMdForPdf(text);
  return (
    <View>
      {segments.map((seg: MdSegment, i: number) => {
        if (seg.kind === "blank") return <View key={i} style={{ height: 5 }} />;
        if (seg.kind === "h1") return <InlineText key={i} raw={seg.text} style={styles.h1} />;
        if (seg.kind === "h2") return <InlineText key={i} raw={seg.text} style={styles.h2} />;
        if (seg.kind === "h3") return <InlineText key={i} raw={seg.text} style={styles.h3} />;
        if (seg.kind === "bullet") {
          const numMatch = seg.text.match(/^(\d+)\.\s+(.+)/);
          if (numMatch) {
            return (
              <View key={i} style={styles.numberedRow}>
                <Text style={styles.numberedNum}>{numMatch[1]}.</Text>
                <InlineText raw={numMatch[2]} style={styles.numberedText} />
              </View>
            );
          }
          return (
            <View key={i} style={styles.bulletRow}>
              <Text style={styles.bulletDot}>•</Text>
              <InlineText raw={seg.text} style={styles.bulletText} />
            </View>
          );
        }
        // paragraph — detect numbered items
        const numMatch = seg.text.match(/^(\d+)\.\s+(.+)/);
        if (numMatch) {
          return (
            <View key={i} style={styles.numberedRow}>
              <Text style={styles.numberedNum}>{numMatch[1]}.</Text>
              <InlineText raw={numMatch[2]} style={styles.numberedText} />
            </View>
          );
        }
        return <InlineText key={i} raw={seg.text} style={styles.paragraph} />;
      })}
    </View>
  );
}

// ── shared page chrome ────────────────────────────────────────────────────
function PageHeader({ ticker, date }: { ticker: string; date: string }) {
  return (
    <View style={styles.pageHeader} fixed>
      <Text style={styles.pageHeaderLeft}>AGENTFLOOR</Text>
      <Text style={styles.pageHeaderRight}>{ticker} · {date} · Research Report</Text>
    </View>
  );
}

function PageFooter() {
  return (
    <View style={styles.pageFooter} fixed>
      <Text style={styles.pageFooterDisclaimer}>
        For research purposes only — not financial or investment advice.
      </Text>
      <Text
        style={styles.pageNumber}
        render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      />
    </View>
  );
}

// ── section title with coloured left bar ─────────────────────────────────
function SectionTitle({ title, subtitle, accent }: { title: string; subtitle?: string; accent: string }) {
  return (
    <View style={styles.sectionTitleRow}>
      <View style={[styles.sectionAccentBar, { backgroundColor: accent }]} />
      <View>
        <Text style={styles.sectionTitleText}>{title}</Text>
        {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
      </View>
    </View>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────
function verdictWrapper(verdict: string) {
  if (verdict === "buy") return styles.verdictWrapperBuy;
  if (verdict === "sell") return styles.verdictWrapperSell;
  return styles.verdictWrapperHold;
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

function formatNow(): string {
  return new Date().toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── document ──────────────────────────────────────────────────────────────
export function ReportDocument({ run, report }: { run: Run; report: Report }) {
  const raw = report.raw_report;
  const hasPrices = report.suggested_entry || report.suggested_stop || report.suggested_target;

  const analysts = run.analysts.filter((analyst) => {
    const content =
      (raw?.[`${analyst}_report`] as string | undefined) ??
      (raw?.[analyst] as string | undefined) ?? "";
    return content.trim().length > 0;
  });

  const debateHistory = extractHistory(raw?.investment_debate_state);
  const riskHistory = extractHistory(raw?.risk_debate_state);
  const investmentPlan = raw?.investment_plan as string | undefined;
  const finalDecision = raw?.final_trade_decision as string | undefined;

  const metaCells = [
    { label: "Provider", value: run.llm_provider },
    { label: "Model", value: run.llm_model },
    { label: "Depth", value: run.depth },
    { label: "Analysts", value: run.analysts.map(capitalize).join(", ") },
  ];

  return (
    <Document title={`${run.ticker} Research Report — ${run.analysis_date}`} author="AgentFloor">
      <Page size="A4" style={styles.page}>
        <PageHeader ticker={run.ticker} date={run.analysis_date} />
        <PageFooter />

        {/* ── Cover ── */}
        <Text style={styles.coverGeneratedAt}>Generated {formatNow()}</Text>
        <View style={styles.coverTickerRow}>
          <Text style={styles.coverTicker}>{run.ticker}</Text>
        </View>
        <Text style={styles.coverDate}>{run.analysis_date}</Text>

        <View style={verdictWrapper(report.verdict)}>
          <Text style={styles.verdictText}>{report.verdict.toUpperCase()}</Text>
        </View>

        {hasPrices && (
          <View style={styles.priceGrid}>
            {report.suggested_entry && (
              <View style={styles.priceBox}>
                <Text style={styles.priceLabel}>Entry</Text>
                <Text style={styles.priceValue}>${report.suggested_entry}</Text>
              </View>
            )}
            {report.suggested_stop && (
              <View style={styles.priceBox}>
                <Text style={styles.priceLabel}>Stop</Text>
                <Text style={styles.priceValue}>${report.suggested_stop}</Text>
              </View>
            )}
            {report.suggested_target && (
              <View style={styles.priceBox}>
                <Text style={styles.priceLabel}>Target</Text>
                <Text style={styles.priceValue}>${report.suggested_target}</Text>
              </View>
            )}
          </View>
        )}

        <View style={styles.metaStrip}>
          {metaCells.map((cell, i) => (
            <View key={cell.label} style={i < metaCells.length - 1 ? styles.metaCell : styles.metaCellLast}>
              <Text style={styles.metaLabel}>{cell.label}</Text>
              <Text style={styles.metaValue}>{cell.value}</Text>
            </View>
          ))}
        </View>

        {/* ── Trader Decision ── */}
        {report.trader_decision?.trim() && (
          <View break>
            <SectionTitle title="Trader Decision" accent={ACCENT.trader} />
            <MdContent text={report.trader_decision} />
          </View>
        )}

        {/* ── Per-analyst sections ── */}
        {analysts.map((analyst) => {
          const content =
            (raw?.[`${analyst}_report`] as string) ??
            (raw?.[analyst] as string) ?? "";
          return (
            <View key={analyst} break>
              <SectionTitle
                title={`${capitalize(analyst)} Analyst Report`}
                subtitle={`Specialist analysis — ${analyst}`}
                accent={ACCENT.analyst}
              />
              <MdContent text={content} />
            </View>
          );
        })}

        {/* ── Investment Debate ── */}
        {debateHistory && (
          <View break>
            <SectionTitle title="Investment Debate" subtitle="Bull vs Bear arguments" accent={ACCENT.debate} />
            <MdContent text={debateHistory} />
          </View>
        )}

        {/* ── Risk Discussion ── */}
        {riskHistory && (
          <View break>
            <SectionTitle title="Risk Discussion" subtitle="Risk manager assessment" accent={ACCENT.risk} />
            <MdContent text={riskHistory} />
          </View>
        )}

        {/* ── Investment Plan ── */}
        {investmentPlan?.trim() && (
          <View break>
            <SectionTitle title="Investment Plan" accent={ACCENT.plan} />
            <MdContent text={investmentPlan} />
          </View>
        )}

        {/* ── Final Trade Decision ── */}
        {finalDecision?.trim() && (
          <View break>
            <SectionTitle title="Final Trade Decision" accent={ACCENT.final} />
            <MdContent text={finalDecision} />
          </View>
        )}
      </Page>
    </Document>
  );
}
