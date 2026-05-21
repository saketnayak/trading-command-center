import type { Run, Report } from "../types";
import { normalizeMarkdown } from "@/lib/normalizeMarkdown";

/** "fundamental_analysis" → "Fundamental Analysis" */
function humanize(s: string): string {
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
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
    priceField("Target", report.suggested_target),
  ].filter((x): x is string => x !== null);

  const pricesLine = priceParts.length > 0 ? priceParts.join(" · ") + "\n\n" : "";

  const header =
    `# ${run.ticker} Research Report — ${run.analysis_date}\n\n` +
    `**Verdict:** ${report.verdict.toUpperCase()}\n\n` +
    pricesLine +
    `**Model:** ${run.llm_provider} / ${run.llm_model}` +
    ` · **Depth:** ${String(run.depth)}\n\n` +
    `**Analysts:** ${run.analysts.map((a) => humanize(a)).join(", ")}\n\n`;

  const analystSections = run.analysts
    .map((analyst) => {
      const content =
        (raw?.[`${analyst}_report`] as string | undefined) ??
        (raw?.[analyst] as string | undefined) ??
        "";
      if (!content.trim()) return "";
      // Wrap in a fenced block to prevent heading bleed; or strip leading #s:
      const safeContent = content.trim().replace(/^#{1,6} /gm, (h) => "#" + h);
      return `### ${humanize(analyst)} Analyst\n\n${safeContent}\n\n`;
    })
    .filter(Boolean)
    .join("");

  const analystBlock = analystSections
    ? `## Analyst Reports\n\n${analystSections}`
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
  }

  const markdown = joinSections(
    header,
    mdSection("Trader Decision", report.trader_decision),
    analystBlock,
    debateBlock,
    mdSection("Investment Plan", raw?.investment_plan as string | undefined),
    mdSection("Final Trade Decision", raw?.final_trade_decision as string | undefined),
  );

  return normalizeMarkdown(markdown);
}
