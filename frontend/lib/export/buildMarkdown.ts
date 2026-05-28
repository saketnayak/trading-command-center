import type { Run, Report } from "../types";
import { getAnalystReportContent } from "@/lib/analystReports";
import { normalizeMarkdown } from "@/lib/normalizeMarkdown";

/** "fundamental_analysis" → "Fundamental Analysis" */
function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Join non-empty sections, placing `---` *between* them (not after the last). */
function joinSections(...sections: string[]): string {
  return sections.filter(Boolean).join("---\n\n");
}

/** Format a price field safely, treating 0 as a valid value. */
function priceField(label: string, value: string | null | undefined): string | null {
  if (value == null) return null;
  return `**${label}:** ${value.trim()}`;
}

function extractHistory(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "history" in value) {
    return String((value as Record<string, unknown>).history ?? "");
  }
  return "";
}

/**
 * Render a level-2 section.
 * The separator is NOT appended here — callers decide whether a rule follows,
 * preventing a dangling `---` at the end of the document.
 */
function mdSection(heading: string, content: string | undefined | null): string {
  if (!content?.trim()) return "";
  return `## ${heading}\n\n${content.trim()}\n\n`;
}

export function buildMarkdown(run: Run, report: Report): string {
  const raw = report.raw_report;

  const priceParts = [
    priceField("Entry", report.suggested_entry), 
    priceField("Stop", report.suggested_stop), 
    priceField("Target", report.suggested_target)
  ].filter((x): x is string => x !== null);

  const pricesLine = priceParts.length > 0 ? priceParts.join(" · ") + "\n\n" : "";

  const header =
    `# ${run.ticker} Research Report — ${run.analysis_date}\n\n` +
    `**Verdict:** ${report.verdict.toUpperCase()}\n\n` +
    pricesLine +
    `**Model:** ${run.llm_provider} / ${run.llm_model}` +
    ` · **Depth:** ${String(run.depth)}\n\n` +
    `**Analysts:** ${run.analysts.map((a) => humanize(a)).join(", ")}\n\n`;

  const situationSummary = (raw?.situation_summary as string | undefined)?.trim() ?? "";

  const analystSections = run.analysts
    .map((analyst) => {
      const content = getAnalystReportContent(raw, analyst);
      if (!content.trim()) return "";
      // Wrap in a fenced block to prevent heading bleed; or strip leading #s:
      // Cap at h6 (or just strip headings entirely from analyst content)
      const safeContent = content.trim()
        .replace(/^(#{1,5}) /gm, (_, hashes) => hashes + "# ")  // demote, cap at 6
        // or more defensively:
        // .replace(/^#{1,6} /gm, "**")  // turn all headings into bold lines

      return `### ${humanize(analyst)} Analyst\n\n${safeContent}\n\n`;
    })
    .filter(Boolean)
    .join("");

  const analystBlock = analystSections ? `## Analyst Reports\n\n${analystSections}` : "";

  const debateHistory = extractHistory(raw?.investment_debate_state);
  const riskHistory = extractHistory(raw?.risk_debate_state);
  const debateBlock =
    debateHistory || riskHistory
      ? [
        "## Bull / Bear Debate", 
        debateHistory && `### Investment Debate\n\n${debateHistory.trim()}`, 
        riskHistory && `### Risk Discussion\n\n${riskHistory.trim()}`
      ].filter(Boolean).join("\n\n") + "\n\n"
      : "";

  const markdown = joinSections(
    header,
    mdSection("Trader Decision", report.trader_decision),
    mdSection("Situation Summary", situationSummary || undefined),
    analystBlock,
    debateBlock,
    mdSection("Investment Plan", raw?.investment_plan as string | undefined),
    mdSection("Final Trade Decision", raw?.final_trade_decision as string | undefined),
  );

  return normalizeMarkdown(markdown);
}
