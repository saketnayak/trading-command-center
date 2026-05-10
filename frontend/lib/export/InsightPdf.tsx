import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { PortfolioInsight } from "../types";

const HEADER_HEIGHT = 36;
const FOOTER_HEIGHT = 28;

const STANCE_COLOR: Record<string, string> = {
  bullish: "#166534",
  bearish: "#991b1b",
  mixed:   "#92400e",
  neutral: "#1e3a5f",
};

const ACTION_COLOR: Record<string, string> = {
  BUY_MORE:  "#166534",
  TRIM:      "#92400e",
  EXIT:      "#991b1b",
  WATCH:     "#1e3a5f",
  REANALYZE: "#4c1d95",
};

const SEVERITY_LABEL: Record<string, string> = {
  critical: "CRITICAL",
  warning:  "WARNING",
  info:     "INFO",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: HEADER_HEIGHT + 16,
    paddingBottom: FOOTER_HEIGHT + 16,
    paddingHorizontal: 40,
    fontFamily: "Helvetica",
    backgroundColor: "#ffffff",
    fontSize: 10,
    color: "#1a1a2e",
  },

  pageHeader: {
    position: "absolute",
    top: 0, left: 0, right: 0,
    height: HEADER_HEIGHT,
    paddingHorizontal: 40,
    paddingTop: 13,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#4c1d95",
  },
  pageHeaderLeft:  { fontSize: 9,  color: "#ffffff", fontFamily: "Helvetica-Bold", letterSpacing: 1 },
  pageHeaderRight: { fontSize: 8,  color: "#c4b5fd" },

  pageFooter: {
    position: "absolute",
    bottom: 0, left: 0, right: 0,
    height: FOOTER_HEIGHT,
    paddingHorizontal: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 0.5,
    borderTopColor: "#e2e8f0",
  },
  disclaimer: { fontSize: 7, color: "#94a3b8" },
  pageNum:    { fontSize: 7, color: "#94a3b8" },

  // Cover
  coverLabel: { fontSize: 10, color: "#94a3b8", marginBottom: 4 },
  coverTitle: { fontSize: 26, fontFamily: "Helvetica-Bold", color: "#1e1b4b", marginBottom: 3 },
  coverSub:   { fontSize: 10, color: "#64748b", marginBottom: 12, paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0" },

  stanceBadge: {
    paddingVertical: 4, paddingHorizontal: 12,
    borderRadius: 4, alignSelf: "flex-start", marginBottom: 8,
  },
  stanceText: { fontSize: 12, fontFamily: "Helvetica-Bold", color: "#ffffff" },

  // Health score box
  scoreRow:   { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 12 },
  scoreBox:   {
    borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 6,
    paddingVertical: 8, paddingHorizontal: 16,
    backgroundColor: "#f8fafc", alignItems: "center",
  },
  scoreNum:   { fontSize: 26, fontFamily: "Helvetica-Bold", color: "#1e1b4b" },
  scoreDen:   { fontSize: 9, color: "#94a3b8" },
  scoreLabel: { fontSize: 7, color: "#94a3b8", letterSpacing: 1, marginTop: 2 },
  summaryBox: {
    flex: 1, borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 6,
    padding: 10, backgroundColor: "#f8fafc",
  },
  summaryText: { fontSize: 9.5, color: "#1e293b", lineHeight: 1.5 },

  // Meta
  metaStrip: {
    flexDirection: "row", borderWidth: 1, borderColor: "#e2e8f0",
    borderRadius: 4, overflow: "hidden", alignSelf: "flex-start", marginBottom: 14,
  },
  metaCell:     { paddingVertical: 5, paddingHorizontal: 10, borderRightWidth: 1, borderRightColor: "#e2e8f0", backgroundColor: "#f8fafc" },
  metaCellLast: { paddingVertical: 5, paddingHorizontal: 10, backgroundColor: "#f8fafc" },
  metaLabel:    { fontSize: 7, color: "#94a3b8", letterSpacing: 1, marginBottom: 2 },
  metaValue:    { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#1e293b" },

  // Section title
  sectionRow:    { flexDirection: "row", alignItems: "stretch", marginBottom: 6, marginTop: 10 },
  accentBar:     { width: 4, borderRadius: 2, marginRight: 10 },
  sectionTitle:  { fontSize: 13, fontFamily: "Helvetica-Bold", color: "#1e1b4b", paddingTop: 1 },

  // Action items
  actionItem: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 4,
    padding: 6, marginBottom: 4, backgroundColor: "#f8fafc",
  },
  actionBadge: { paddingVertical: 2, paddingHorizontal: 5, borderRadius: 3 },
  actionBadgeText: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#ffffff" },
  actionTicker: { fontSize: 9.5, fontFamily: "Helvetica-Bold", color: "#1e293b", marginBottom: 1 },
  actionRationale: { fontSize: 8.5, color: "#64748b", lineHeight: 1.4 },
  priorityDot: { width: 6, height: 6, borderRadius: 3, marginTop: 3 },

  // Risk alerts
  riskItem: {
    flexDirection: "row", alignItems: "flex-start", gap: 7,
    borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 4,
    padding: 6, marginBottom: 4, backgroundColor: "#fefce8",
  },
  riskBadge: { paddingVertical: 2, paddingHorizontal: 4, borderRadius: 3 },
  riskBadgeText: { fontSize: 6.5, fontFamily: "Helvetica-Bold", color: "#ffffff" },
  riskDesc:    { fontSize: 8.5, color: "#1e293b", lineHeight: 1.4, marginBottom: 3 },
  riskTickers: { flexDirection: "row", flexWrap: "wrap", gap: 3 },
  riskTicker:  { fontSize: 7.5, color: "#475569", backgroundColor: "#e2e8f0", paddingVertical: 1, paddingHorizontal: 3, borderRadius: 2 },

  // Sector
  sectorRow:  { flexDirection: "row", alignItems: "center", marginBottom: 3 },
  sectorName: { width: 130, fontSize: 8.5, color: "#475569", textAlign: "right" },
  sectorBar:  { height: 9, backgroundColor: "#6366f1", borderRadius: 2, marginHorizontal: 7 },
  sectorPct:  { fontSize: 8.5, color: "#64748b" },

  // Strengths / Weaknesses
  swRow:   { flexDirection: "row", gap: 10, marginTop: 4 },
  swBox:   { flex: 1, borderWidth: 1, borderRadius: 4, padding: 8 },
  swTitle: { fontSize: 8.5, fontFamily: "Helvetica-Bold", letterSpacing: 1, marginBottom: 5 },
  swItem:  { flexDirection: "row", gap: 4, marginBottom: 3 },
  swBullet:{ fontSize: 8.5, color: "#64748b" },
  swText:  { fontSize: 8.5, color: "#1e293b", lineHeight: 1.4, flex: 1 },
});

function PageHeader({ date }: { date: string }) {
  return (
    <View style={styles.pageHeader} fixed>
      <Text style={styles.pageHeaderLeft}>AGENTFLOOR · PORTFOLIO AI INSIGHTS</Text>
      <Text style={styles.pageHeaderRight}>{date}</Text>
    </View>
  );
}

function PageFooter() {
  return (
    <View style={styles.pageFooter} fixed>
      <Text style={styles.disclaimer}>For research purposes only — not financial or investment advice.</Text>
      <Text style={styles.pageNum} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}

function SectionTitle({ title, accent }: { title: string; accent: string }) {
  return (
    <View style={styles.sectionRow}>
      <View style={[styles.accentBar, { backgroundColor: accent }]} />
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function priorityColor(p: string) {
  if (p === "high")   return "#ef4444";
  if (p === "medium") return "#f59e0b";
  return "#94a3b8";
}

function severityBg(s: string) {
  if (s === "critical") return "#991b1b";
  if (s === "warning")  return "#b45309";
  return "#1e3a5f";
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function InsightDocument({ insight, portfolioName }: { insight: PortfolioInsight; portfolioName?: string }) {
  const date = formatDate(insight.generated_at);
  const stance = insight.overall_stance ?? "neutral";
  const stanceBg = STANCE_COLOR[stance] ?? "#1e3a5f";
  const sectors = insight.sector_analysis
    ? Object.entries(insight.sector_analysis).sort((a, b) => b[1] - a[1])
    : [];
  const maxSector = sectors[0]?.[1] ?? 100;

  return (
    <Document title={`${portfolioName ?? "Portfolio"} AI Insights — ${date}`} author="AgentFloor">
      <Page size="A4" style={styles.page}>
        <PageHeader date={date} />
        <PageFooter />

        {/* Cover */}
        <Text style={styles.coverLabel}>Generated {date}</Text>
        <Text style={styles.coverTitle}>{portfolioName ?? "Portfolio"}</Text>
        <Text style={styles.coverSub}>AI Insights Report · {insight.trigger} · {insight.llm_provider} / {insight.llm_model}</Text>

        <View style={[styles.stanceBadge, { backgroundColor: stanceBg }]}>
          <Text style={styles.stanceText}>{stance.toUpperCase()}</Text>
        </View>

        {/* Health score + summary */}
        <View style={styles.scoreRow}>
          {insight.health_score != null && (
            <View style={styles.scoreBox}>
              <Text style={styles.scoreNum}>{insight.health_score}</Text>
              <Text style={styles.scoreDen}>/ 10</Text>
              <Text style={styles.scoreLabel}>HEALTH SCORE</Text>
            </View>
          )}
          {insight.summary && (
            <View style={styles.summaryBox}>
              <Text style={styles.summaryText}>{insight.summary}</Text>
            </View>
          )}
        </View>

        {/* Meta strip */}
        <View style={styles.metaStrip}>
          {[
            { label: "Provider", value: insight.llm_provider },
            { label: "Model",    value: insight.llm_model },
            { label: "Trigger",  value: insight.trigger },
            { label: "Date",     value: date },
          ].map((c, i, arr) => (
            <View key={c.label} style={i < arr.length - 1 ? styles.metaCell : styles.metaCellLast}>
              <Text style={styles.metaLabel}>{c.label.toUpperCase()}</Text>
              <Text style={styles.metaValue}>{c.value}</Text>
            </View>
          ))}
        </View>

        {/* Action Items — flows directly after cover, no forced page break */}
        {(insight.action_items?.length ?? 0) > 0 && (
          <View>
            <SectionTitle title="Action Items" accent="#7c3aed" />
            {insight.action_items!.map((item, i) => (
              <View key={i} style={styles.actionItem}>
                <View style={[styles.priorityDot, { backgroundColor: priorityColor(item.priority) }]} />
                <View style={[styles.actionBadge, { backgroundColor: ACTION_COLOR[item.action] ?? "#475569" }]}>
                  <Text style={styles.actionBadgeText}>{item.action.replace("_", " ")}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.actionTicker}>{item.ticker}</Text>
                  <Text style={styles.actionRationale}>{item.rationale}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Risk Alerts */}
        {(insight.risk_alerts?.length ?? 0) > 0 && (
          <View>
            <SectionTitle title="Risk Alerts" accent="#dc2626" />
            {insight.risk_alerts!.map((alert, i) => (
              <View key={i} style={styles.riskItem}>
                <View style={[styles.riskBadge, { backgroundColor: severityBg(alert.severity) }]}>
                  <Text style={styles.riskBadgeText}>{SEVERITY_LABEL[alert.severity] ?? alert.severity.toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.riskDesc}>{alert.description}</Text>
                  {alert.affected_tickers?.length > 0 && (
                    <View style={styles.riskTickers}>
                      {alert.affected_tickers.map((t) => (
                        <Text key={t} style={styles.riskTicker}>{t}</Text>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Sector Exposure */}
        {sectors.length > 0 && (
          <View>
            <SectionTitle title="Sector Exposure" accent="#0891b2" />
            {sectors.map(([sector, pct]) => (
              <View key={sector} style={styles.sectorRow}>
                <Text style={styles.sectorName}>{sector}</Text>
                <View style={[styles.sectorBar, { width: `${(pct / maxSector) * 200}` as unknown as number }]} />
                <Text style={styles.sectorPct}>{typeof pct === "number" ? pct.toFixed(1) : pct}%</Text>
              </View>
            ))}
          </View>
        )}

        {/* Strengths & Weaknesses */}
        {((insight.strengths?.length ?? 0) > 0 || (insight.weaknesses?.length ?? 0) > 0) && (
          <View>
            <SectionTitle title="Strengths &amp; Weaknesses" accent="#16a34a" />
            <View style={styles.swRow}>
              {(insight.strengths?.length ?? 0) > 0 && (
                <View style={[styles.swBox, { borderColor: "#bbf7d0", backgroundColor: "#f0fdf4" }]}>
                  <Text style={[styles.swTitle, { color: "#15803d" }]}>STRENGTHS</Text>
                  {insight.strengths!.map((s, i) => (
                    <View key={i} style={styles.swItem}>
                      <Text style={styles.swBullet}>✓</Text>
                      <Text style={styles.swText}>{s}</Text>
                    </View>
                  ))}
                </View>
              )}
              {(insight.weaknesses?.length ?? 0) > 0 && (
                <View style={[styles.swBox, { borderColor: "#fecaca", backgroundColor: "#fff1f2" }]}>
                  <Text style={[styles.swTitle, { color: "#b91c1c" }]}>WEAKNESSES</Text>
                  {insight.weaknesses!.map((w, i) => (
                    <View key={i} style={styles.swItem}>
                      <Text style={styles.swBullet}>!</Text>
                      <Text style={styles.swText}>{w}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        )}
      </Page>
    </Document>
  );
}
