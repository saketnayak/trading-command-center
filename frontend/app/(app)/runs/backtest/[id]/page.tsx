"use client";

import { useParams } from "next/navigation";

import { BacktestDetailView } from "@/components/backtest/BacktestDetailView";
import { PageShell } from "@/components/layout/PageShell";

export default function BacktestDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PageShell gap="6">
      <BacktestDetailView id={id} />
    </PageShell>
  );
}
