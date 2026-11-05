"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { listAlertEvents, markAlertsRead } from "@/lib/api";
import {
  ALERT_EVENTS_QUERY_KEY,
  ALERT_UNREAD_QUERY_KEY,
  analysisLabel,
  deliveryIssues,
  timeAgo,
  type AlertEvent,
} from "@/lib/alerts";

export function AlertInbox() {
  const qc = useQueryClient();
  const { data: events = [], isPending, isError } = useQuery({
    queryKey: ALERT_EVENTS_QUERY_KEY,
    queryFn: () => listAlertEvents(100),
    refetchInterval: 60_000,
  });
  const read = useMutation({
    mutationFn: markAlertsRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ALERT_EVENTS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ALERT_UNREAD_QUERY_KEY });
    },
  });
  const unread = events.filter((e) => !e.read_at).length;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-fg">
          Inbox{unread ? <span className="ml-1.5 text-xs font-normal text-muted">{unread} unread</span> : null}
        </h2>
        {unread > 0 && (
          <button type="button" className="text-xs text-blue-500 hover:text-blue-400" onClick={() => read.mutate({ all: true })}>
            Mark all read
          </button>
        )}
      </div>
      {isPending && <p className="text-sm text-muted">Loading…</p>}
      {isError && <p className="text-sm text-muted">The inbox could not be loaded.</p>}
      {!isPending && !isError && events.length === 0 && (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
          Nothing yet. Alerts appear here when a rule fires.
        </p>
      )}
      <ul className="space-y-2">
        {events.map((e) => (
          <EventRow key={e.id} event={e} onRead={() => !e.read_at && read.mutate({ ids: [e.id] })} />
        ))}
      </ul>
    </section>
  );
}

function EventRow({ event, onRead }: { event: AlertEvent; onRead: () => void }) {
  const issues = deliveryIssues(event.delivery);
  const analyses = event.analyses ?? [];
  const runId = event.kind === "verdict_change" ? (event.data?.run_id as string | undefined) : undefined;
  const unread = !event.read_at;
  return (
    <li className={`rounded-lg border px-3 py-2.5 ${unread ? "border-blue-500/50 bg-blue-500/5" : "border-border bg-surface"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-fg">
          {unread && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-blue-500" aria-label="Unread" />}
          {event.title}
        </p>
        <time className="shrink-0 text-[11px] text-muted" dateTime={event.triggered_at ?? undefined}>
          {timeAgo(event.triggered_at)}
        </time>
      </div>
      <p className="mt-0.5 text-xs text-fg-secondary">{event.message}</p>
      <div className="mt-1 flex flex-wrap gap-x-3 text-[11px]">
        {runId && <Link href={`/runs/${runId}`} onClick={onRead} className="text-blue-500 hover:text-blue-400">Open the analysis</Link>}
        {analyses.map((a) =>
          a.status === "deleted" ? (
            <span key={a.run_id} className="text-muted">{analysisLabel(a)}</span>
          ) : (
            <Link
              key={a.run_id}
              href={a.status === "pending" || a.status === "running" ? `/runs/${a.run_id}/live` : `/runs/${a.run_id}`}
              onClick={onRead}
              className="text-blue-500 hover:text-blue-400"
              title={a.source === "recent" ? "An analysis from the last 20 hours, linked instead of starting another" : "Started by this alert"}
            >
              {analysisLabel(a)}
            </Link>
          ),
        )}
        {event.portfolio_id && !runId && <Link href="/portfolio" onClick={onRead} className="text-blue-500 hover:text-blue-400">Open portfolio</Link>}
        {unread && (
          <button type="button" onClick={onRead} className="text-muted hover:text-fg-secondary">Mark read</button>
        )}
        {issues.map((i) => (
          <span key={i} className="text-amber-600 dark:text-amber-400">{i}</span>
        ))}
      </div>
    </li>
  );
}
