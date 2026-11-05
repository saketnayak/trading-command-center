"use client";

import { PageHeader, PageTitle } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { NetWorthView } from "@/components/networth/NetWorthView";

export default function NetWorthPage() {
  return (
    <PageShell gap="6">
      <PageHeader
        title={<PageTitle>Net worth</PageTitle>}
        description="Your portfolios plus everything else you own or owe: cash, property, private holdings, loans and crypto wallets."
      />
      <NetWorthView />
    </PageShell>
  );
}
