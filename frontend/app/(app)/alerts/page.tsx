"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { AlertInbox } from "@/components/alerts/AlertInbox";
import { AlertRuleForm } from "@/components/alerts/AlertRuleForm";
import { AlertRuleList } from "@/components/alerts/AlertRuleList";
import { DescribeAlert } from "@/components/alerts/DescribeAlert";
import { PageHeader, PageTitle } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { ALERT_KINDS, type AlertKind } from "@/lib/alerts";

function AlertsContent() {
  const params = useSearchParams();
  const ticker = params.get("ticker") ?? "";
  const kindParam = params.get("kind");
  const kind = ALERT_KINDS.some((k) => k.kind === kindParam) ? (kindParam as AlertKind) : undefined;

  return (
    <PageShell gap="6">
      <PageHeader
        title={<PageTitle>Alerts</PageTitle>}
        description="Price, signal and portfolio alerts, checked every 15 minutes and delivered here, by email or to a portfolio webhook. Describe one in words, or build it yourself."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <AlertInbox />
        <div className="space-y-4">
          <DescribeAlert />
          <AlertRuleForm initialTicker={ticker} initialKind={kind} />
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-fg">Your alert rules</h2>
            <AlertRuleList />
          </section>
        </div>
      </div>
    </PageShell>
  );
}

export default function AlertsPage() {
  return (
    <Suspense fallback={<PageShell gap="6"><PageHeader title={<PageTitle>Alerts</PageTitle>} /></PageShell>}>
      <AlertsContent />
    </Suspense>
  );
}
