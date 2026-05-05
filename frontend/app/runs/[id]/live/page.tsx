"use client";
import { useState, useCallback, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { TopNav } from "@/components/layout/TopNav";
import { AgentFeed } from "@/components/runs/AgentFeed";
import { AgentSidebar } from "@/components/runs/AgentSidebar";
import { PipelinePanel } from "@/components/runs/PipelinePanel";
import { getRun, abortRun, getRunEvents } from "@/lib/api";
import { useAgentStream } from "@/lib/websocket";
import type { AgentEventPayload } from "@/lib/types";

export default function LiveRunPage() {
  const { id } = useParams<{ id: string }>();
  const [events, setEvents] = useState<AgentEventPayload[]>([]);
  const seenSequences = useRef(new Set<number>());

  const { data: run, refetch } = useQuery({
    queryKey: ["run", id],
    queryFn: () => getRun(id),
    refetchInterval: 3000,
  });

  // Seed historical events on mount so revisiting a live or completed run
  // shows all past events rather than a blank feed.
  useEffect(() => {
    getRunEvents(id).then((past) => {
      setEvents(past);
      past.forEach((e) => {
        if (e.sequence != null) seenSequences.current.add(e.sequence);
      });
    }).catch(() => {});
  }, [id]);

  const handleEvent = useCallback((e: AgentEventPayload) => {
    // Deduplicate against events already loaded from the REST endpoint.
    if (e.sequence != null && seenSequences.current.has(e.sequence)) return;
    if (e.sequence != null) seenSequences.current.add(e.sequence);
    setEvents((prev) => [...prev, e]);
    if (e.type === "run_completed" || e.type === "run_aborted") {
      refetch();
    }
  }, [refetch]);

  useAgentStream(id, handleEvent);

  const handleAbort = async () => {
    await abortRun(id);
    refetch();
  };

  const isDone =
    run?.status === "completed" ||
    run?.status === "failed" ||
    run?.status === "aborted";

  return (
    <div className="min-h-screen bg-navy-900">
      <TopNav />
      <div className="flex gap-4 p-6 max-w-7xl mx-auto">
        <div className="w-64 flex-shrink-0 space-y-4">
          <AgentSidebar run={run} onAbort={handleAbort} />
          {run && <PipelinePanel analysts={run.analysts} events={events} />}
          {isDone && (
            <Link
              href={`/runs/${id}`}
              className="block text-center bg-blue-800 hover:bg-blue-700 text-blue-200 rounded px-3 py-2 text-sm"
            >
              View Results
            </Link>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-slate-200 text-sm font-semibold">Live Event Feed</h1>
            <span className="text-slate-500 text-xs">{events.length} events</span>
          </div>
          <AgentFeed events={events} />
        </div>
      </div>
    </div>
  );
}
