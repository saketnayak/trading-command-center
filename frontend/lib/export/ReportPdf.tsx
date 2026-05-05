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
  sectionTitle: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: "#0f3460",
    marginBottom: 14,
  },
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
      <Text style={styles.pageHeaderText}>{ticker} — {date}</Text>
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
  const hasPrices = report.suggested_entry || report.suggested_stop || report.suggested_target;

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
    <Document title={`${run.ticker} Research Report — ${run.analysis_date}`} author="AgentFloor">
      <Page size="A4" style={styles.page}>
        <PageHeader ticker={run.ticker} date={run.analysis_date} />
        <PageNum />

        <Text style={styles.coverTicker}>{run.ticker}</Text>
        <Text style={styles.coverDate}>{run.analysis_date}</Text>
        <Text style={verdictStyle(report.verdict)}>{report.verdict.toUpperCase()}</Text>

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

        {report.trader_decision?.trim() && (
          <View break>
            <Text style={styles.sectionTitle}>Trader Decision</Text>
            <MdContent text={report.trader_decision} />
          </View>
        )}

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

        {debateHistory && (
          <View break>
            <Text style={styles.sectionTitle}>Investment Debate</Text>
            <MdContent text={debateHistory} />
          </View>
        )}

        {riskHistory && (
          <View break>
            <Text style={styles.sectionTitle}>Risk Discussion</Text>
            <MdContent text={riskHistory} />
          </View>
        )}

        {investmentPlan?.trim() && (
          <View break>
            <Text style={styles.sectionTitle}>Investment Plan</Text>
            <MdContent text={investmentPlan} />
          </View>
        )}

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
