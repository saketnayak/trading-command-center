"use client";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { getAppSettings, getJevMeta, getJevSessions } from "@/lib/api";
import { PageHeader, PageTitle } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { JevDisabled } from "@/components/jev/JevDisabled";
import { NewSessionForm } from "@/components/jev/NewSessionForm";
import { SessionTable } from "@/components/jev/SessionTable";
import { SplitExplainer } from "@/components/jev/SplitExplainer";

export default function JevLabPage() {
  const router = useRouter();
  const { data: authSession } = useSession();
  const isAdmin = (authSession?.user as { role?: string } | undefined)?.role === "admin";

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ["app-settings"],
    queryFn: getAppSettings,
    retry: false,
  });
  const enabled = settings?.enableJevLoop === true;

  const { data: meta } = useQuery({ queryKey: ["jev-meta"], queryFn: getJevMeta, enabled, staleTime: Infinity });
  const { data: sessions = [], isError } = useQuery({
    queryKey: ["jev-sessions"],
    queryFn: getJevSessions,
    enabled,
    refetchInterval: 5000,
  });

  return (
    <PageShell gap="6">
      <PageHeader
        leading={
          <div>
            <PageTitle>JEV Lab</PageTitle>
            <p className="text-xs text-muted">
              Experimental market-making loop driven by Jev&apos;s typed judgments. Research only: shadow by default,
              Alpaca paper at most, never live money.
            </p>
          </div>
        }
      />

      {settingsLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !enabled ? (
        <JevDisabled />
      ) : (
        <>
          {meta && <SplitExplainer meta={meta} />}
          <section>
            <h2 className="mb-2 text-base font-semibold text-fg">Start a session</h2>
            <div className="rounded-lg border border-border bg-surface">
              {meta ? (
                <NewSessionForm meta={meta} isAdmin={isAdmin} onCreated={(s) => router.push(`/jev/${s.id}`)} />
              ) : (
                <p className="px-4 py-4 text-xs text-muted">Loading…</p>
              )}
            </div>
            {meta && (
              <p className="mt-1 text-[11px] text-muted">At most {meta.max_active_sessions} sessions run at once; one paper session per symbol.</p>
            )}
          </section>
          <section>
            <h2 className="mb-2 text-base font-semibold text-fg">Sessions</h2>
            <div className="rounded-lg border border-border bg-surface">
              {isError ? <p className="px-4 py-4 text-xs text-red-500">Could not load sessions.</p> : <SessionTable sessions={sessions} />}
            </div>
          </section>
        </>
      )}
    </PageShell>
  );
}
