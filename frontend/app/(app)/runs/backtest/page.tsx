"use client";

import { BacktestForm } from "@/components/backtest/BacktestForm";
import { BacktestList } from "@/components/backtest/BacktestList";
import { PageHeader, PageTitle } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";

export default function BacktestPage() {
  return (
    <PageShell gap="6">
      <PageHeader
        title={<PageTitle>Backtest Lab</PageTitle>}
        description="Re-run the agents on past dates and score each call on what the price did next. Only dates after the model's training cutoff count toward the headline, because before it the model may simply remember what happened."
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <BacktestForm />
        <BacktestList />
      </div>
    </PageShell>
  );
}
