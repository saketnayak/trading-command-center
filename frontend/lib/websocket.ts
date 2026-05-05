"use client";
import { useEffect, useRef, useCallback } from "react";
import type { AgentEventPayload } from "./types";

const WS_BASE = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;

export function useAgentStream(runId: string, onEvent: (e: AgentEventPayload) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    const ws = new WebSocket(`${WS_BASE}/ws/runs/${runId}`);
    wsRef.current = ws;
    ws.onmessage = (msg) => {
      try {
        onEventRef.current(JSON.parse(msg.data) as AgentEventPayload);
      } catch {}
    };
    ws.onclose = (e) => {
      if (e.code !== 1000) setTimeout(connect, 2000); // reconnect unless intentional close
    };
  }, [runId]);

  useEffect(() => {
    connect();
    const ping = setInterval(() => wsRef.current?.send("ping"), 30000);
    return () => {
      clearInterval(ping);
      wsRef.current?.close(1000);
    };
  }, [connect]);
}
