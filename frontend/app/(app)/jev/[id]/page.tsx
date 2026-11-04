"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  flattenJevSession,
  getAppSettings,
  getJevMeta,
  getJevSession,
  getJevTicks,
  stopJevSession,
} from "@/lib/api";
import { effectiveValues, isFinished } from "@/lib/jev/format";
import { jevHealth, jevWindowStats, uptime } from "@/lib/jev/insights";
import type { JevAnswers, JevSession, JevStreamMessage, JevTick } from "@/lib/jev/types";
import { useJevStream } from "@/lib/jev/useJevStream";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { BatteryPanel } from "@/components/jev/BatteryPanel";
import { CalibrationPanel } from "@/components/jev/CalibrationPanel";
import { JevDisabled } from "@/components/jev/JevDisabled";
import { ModeBadge, StatusBadge } from "@/components/jev/JevBadges";
import { PriceActionChart } from "@/components/jev/PriceActionChart";
import { RiskPanel } from "@/components/jev/RiskPanel";
import { TickFeed } from "@/components/jev/TickFeed";
import { JevHealthBanner } from "@/components/jev/JevHealthBanner";
import { NowCard } from "@/components/jev/NowCard";
import { SessionStatsBar } from "@/components/jev/SessionStatsBar";
import { TickStrip } from "@/components/jev/TickStrip";
import { BTN_DANGER_CLASS, BTN_SECONDARY_CLASS } from "@/lib/uiClasses";

const WINDOW = 300; // ticks kept on screen (10 minutes at 2 s)

function mergeTicks(prev: JevTick[], incoming: JevTick[]): JevTick[] {
  const byTick = new Map(prev.map((t) => [t.tick, t]));
  for (const t of incoming) byTick.set(t.tick, t);
  return [...byTick.values()].sort((a, b) => a.tick - b.tick).slice(-WINDOW);
}

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-lg border border-border bg-surface p-4 ${className}`}>
      <h2 className="mb-3 text-[10px] font-medium uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </section>
  );
}

export default function JevSessionPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data: authSession } = useSession();
  const isAdmin = (authSession?.user as { role?: string } | undefined)?.role === "admin";
  const [tab, setTab] = useState<"live" | "calibration">("live");
  const [streamTicks, setStreamTicks] = useState<JevTick[]>([]);
  // undefined until the stream delivers a tick; null when that tick had no Jev answer
  const [streamAnswers, setStreamAnswers] = useState<JevAnswers | null | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);

  const { data: settings, isLoading: settingsLoading } = useQuery({ queryKey: ["app-settings"], queryFn: getAppSettings, retry: false });
  const enabled = settings?.enableJevLoop === true;
  const { data: meta } = useQuery({ queryKey: ["jev-meta"], queryFn: getJevMeta, enabled, staleTime: Infinity });
  const { data: session, isError } = useQuery({
    queryKey: ["jev-session", id],
    queryFn: () => getJevSession(id),
    enabled,
    refetchInterval: (q) => (q.state.data && !isFinished(q.state.data) ? 10000 : false),
  });
  const running = !!session && !isFinished(session);

  const { data: initialTicks } = useQuery({
    queryKey: ["jev-ticks", id],
    queryFn: () => getJevTicks(id, { tail: WINDOW }),
    enabled,
  });
  const { data: latestFull } = useQuery({
    queryKey: ["jev-latest-tick", id],
    queryFn: () => getJevTicks(id, { tail: 30, full: true }),
    enabled,
  });

  const ticks = useMemo(() => mergeTicks(initialTicks ?? [], streamTicks), [initialTicks, streamTicks]);
  // Most recent tick that carried Jev answers (fresh or reused), from the stream or the initial fetch.
  const answered = useMemo(() => {
    const pool = mergeTicks(latestFull ?? [], streamTicks);
    return [...pool].reverse().find((t) => t.answers) ?? null;
  }, [latestFull, streamTicks]);
  const latestAnswers = streamAnswers !== undefined ? streamAnswers ?? answered?.answers ?? null : (answered?.answers ?? null);
  const bookAgeS = useMemo(() => {
    const pool = mergeTicks(latestFull ?? [], streamTicks);
    const withSnap = [...pool].reverse().find((t) => t.snapshot);
    const age = withSnap?.snapshot?.["book_age_s"];
    return typeof age === "number" ? age : null;
  }, [latestFull, streamTicks]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const onMessage = useCallback(
    (m: JevStreamMessage) => {
      if (m.type === "tick") {
        setStreamTicks((prev) => mergeTicks(prev, [m.tick]));
        setStreamAnswers(m.tick.answers ?? null);
        queryClient.setQueryData<JevSession>(["jev-session", id], (s) => (s ? { ...s, ...m.summary } : s));
      } else {
        queryClient.invalidateQueries({ queryKey: ["jev-session", id] });
        queryClient.invalidateQueries({ queryKey: ["jev-sessions"] });
      }
    },
    [id, queryClient],
  );
  useJevStream(id, enabled && running, onMessage);

  const stop = useMutation({
    mutationFn: () => stopJevSession(id),
    onSuccess: (s) => queryClient.setQueryData(["jev-session", id], s),
  });
  const flatten = useMutation({
    mutationFn: () => flattenJevSession(id),
    onSuccess: (r) => {
      setNotice(r.message);
      queryClient.setQueryData(["jev-session", id], r.session);
    },
  });

  const thresholds = useMemo(() => effectiveValues(meta?.thresholds ?? {}, session?.thresholds ?? {}), [meta, session]);
  const limits = useMemo(() => effectiveValues(meta?.limits ?? {}, session?.limits ?? {}), [meta, session]);
  const latest = ticks[ticks.length - 1];
  const stats = useMemo(() => jevWindowStats(ticks), [ticks]);
  const health = jevHealth(stats);
  const answersAgeS = answered && latest ? Math.max(0, latest.ts - answered.ts) + (answered.answer_age_s ?? 0) : null;

  if (settingsLoading) return <PageShell><p className="text-sm text-muted">Loading…</p></PageShell>;
  if (!enabled) return <PageShell><JevDisabled /></PageShell>;
  if (isError) return <PageShell><p className="text-sm text-red-500">Session not found.</p></PageShell>;
  if (!session || !meta) return <PageShell><p className="text-sm text-muted">Loading…</p></PageShell>;

  const canFlatten = isAdmin && session.mode === "paper" && isFinished(session) && session.inventory !== 0;

  return (
    <PageShell gap="4">
      <PageHeader back={{ href: "/jev", label: "← JEV Lab" }} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-2xl font-semibold text-fg">{session.symbol}</h1>
            <ModeBadge mode={session.mode} mock={session.force_mock || session.decision_route === "MOCK"} />
            <StatusBadge status={session.status} />
          </div>
          <p className="mt-1 text-xs text-muted">
            decider {session.decision_route ?? "—"} {session.decision_model ? `(${session.decision_model})` : ""}
          </p>
          {(session.stop_reason || session.status === "failed") && (
            <p className={`mt-1 text-xs ${session.status === "failed" ? "text-red-500 dark:text-red-400" : "text-fg-secondary"}`}>
              Ended: {session.stop_reason || "failed without a recorded reason (see the backend log)"}
            </p>
          )}
          {session.status === "interrupted" && session.mode === "paper" && session.inventory !== 0 && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">
              The backend restarted while this session held a position. Resting orders were cancelled; flatten to close the position.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {running && (
            <button
              onClick={() => stop.mutate()}
              disabled={stop.isPending || session.status === "stopping"}
              className={BTN_SECONDARY_CLASS}
            >
              {session.status === "stopping" ? "Stopping…" : "Stop session"}
            </button>
          )}
          {canFlatten && (
            <button
              onClick={() => {
                if (window.confirm(`Send a market order to close ${session.inventory} ${session.symbol} on the Alpaca paper account?`)) flatten.mutate();
              }}
              disabled={flatten.isPending}
              className={BTN_DANGER_CLASS}
            >
              {flatten.isPending ? "Flattening…" : "Flatten position"}
            </button>
          )}
        </div>
      </div>
      {(stop.isError || flatten.isError) && (
        <p className="text-xs text-red-500">{((stop.error ?? flatten.error) as Error).message}</p>
      )}
      {notice && <p className="text-xs text-fg-secondary">{notice}</p>}

      <SessionStatsBar
        uptime={uptime(session.started_at, isFinished(session) ? session.stopped_at : null, nowMs)}
        ticks={session.tick_count}
        stats={stats}
        costUsd={session.cost_usd}
      />
      {health && running && <JevHealthBanner health={health} />}

      <div role="tablist" className="flex gap-4 border-b border-border text-xs">
        {(["live", "calibration"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b px-1 pb-1.5 capitalize ${tab === t ? "border-blue-500 text-fg" : "border-transparent text-muted hover:text-fg-secondary"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "live" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Now" className="lg:col-span-2">
            <NowCard tick={latest} thresholds={thresholds} bookAgeS={bookAgeS} />
          </Card>
          <Card title="Jev's answers">
            <BatteryPanel answers={latestAnswers} thresholds={thresholds} ageS={answersAgeS} />
          </Card>
          <Card title="Price and actions" className="lg:col-span-2">
            <PriceActionChart ticks={ticks} finished={!running} />
            <div className="mt-3">
              <TickStrip ticks={ticks} />
            </div>
          </Card>
          <Card title="Position and limits">
            <RiskPanel session={session} latest={latest} limits={limits} />
          </Card>
          <Card title="Tick log" className="lg:col-span-3">
            <TickFeed ticks={ticks} />
          </Card>
        </div>
      ) : (
        <Card title="Calibration">
          <CalibrationPanel sessionId={id} tickCount={session.tick_count} />
        </Card>
      )}
    </PageShell>
  );
}
