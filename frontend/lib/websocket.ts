"use client";
import { useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import type { AgentEventPayload } from "./types";

const WS_BASE = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;

export function useAgentStream(runId: string, onEvent: (e: AgentEventPayload) => void) {
  const { data: session } = useSession();
  const token = (session as { accessToken?: string } | null)?.accessToken;
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    if (!token) return;
    const ws = new WebSocket(`${WS_BASE}/ws/runs/${runId}?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;
    ws.onmessage = (msg) => {
      try {
        onEventRef.current(JSON.parse(msg.data) as AgentEventPayload);
      } catch {}
    };
    ws.onclose = (e) => {
      if (e.code !== 1000) setTimeout(connect, 2000); // reconnect unless intentional close
    };
  }, [runId, token]);

  useEffect(() => {
    connect();
    const ping = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send("ping");
    }, 30000);
    return () => {
      clearInterval(ping);
      wsRef.current?.close(1000);
    };
  }, [connect]);
}
