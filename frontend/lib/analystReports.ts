/** Upstream TradingAgents analyst keys (technical analysis is part of market). */
export const ANALYST_OPTIONS = ["market", "social", "news", "fundamentals"] as const;

export const DEFAULT_ANALYSTS: string[] = [...ANALYST_OPTIONS];

/** Map run analyst key to `Report.raw_report` field written by TradingAgents. */
export function analystReportRawKey(analyst: string): string {
  if (analyst === "social") return "sentiment_report";
  return `${analyst}_report`;
}

export function getAnalystReportContent(
  raw: Record<string, unknown> | undefined,
  analyst: string,
): string {
  if (!raw) return "";
  const key = analystReportRawKey(analyst);
  const content = raw[key] ?? raw[analyst];
  if (content === undefined || content === null) return "";
  if (typeof content === "string") return content;
  return JSON.stringify(content, null, 2);
}
