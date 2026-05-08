"use client";
import { useEffect, useRef } from "react";
import type { AgentEventPayload } from "@/lib/types";

interface AgentFeedProps {
  events: AgentEventPayload[];
}

const agentNameColor: Record<AgentEventPayload["type"], string> = {
  started: "text-blue-300",
  token: "text-slate-400",
  completed: "text-green-400",
  error: "text-red-400",
  run_completed: "text-green-400",
  run_aborted: "text-yellow-400",
};

export function AgentFeed({ events }: AgentFeedProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  return (
    <div className="flex-1 overflow-y-auto bg-navy-900 rounded border border-slate-800 p-3 space-y-1">
      {events.map((event, i) => (
        <div key={i} className="flex gap-2">
          <span className={`text-xs font-mono w-28 flex-shrink-0 ${agentNameColor[event.type]}`}>
            {event.agent ?? event.type}
          </span>
          <span className="text-slate-300 text-xs font-mono whitespace-pre-wrap flex-1">
            {event.token ?? event.summary ?? event.message ?? ""}
          </span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
