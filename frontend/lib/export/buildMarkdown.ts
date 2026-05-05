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
