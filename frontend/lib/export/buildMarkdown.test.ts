import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMarkdown } from "./buildMarkdown";

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

test("maps social analyst to sentiment_report", () => {
  const socialRun = { ...run, analysts: ["social"] } as const;
  const socialReport = {
    ...report,
    raw_report: {
      sentiment_report: "Retail sentiment is improving.",
    },
  };
  const md = buildMarkdown(socialRun as never, socialReport as never);
  assert.ok(md.includes("### Social Analyst"));
  assert.ok(md.includes("Retail sentiment is improving."));
});

test("includes situation summary when present", () => {
  const withSummary = {
    ...report,
    raw_report: {
      ...report.raw_report,
      situation_summary: "Condensed cross-analyst snapshot.",
    },
  };
  const md = buildMarkdown(run as never, withSummary as never);
  assert.ok(md.includes("## Situation Summary"));
  assert.ok(md.includes("Condensed cross-analyst snapshot."));
});
