"use client";
import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import type { AgentEventPayload } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export function getWebSocketBase() {
  const url = new URL(API_BASE, window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

  // REST may be proxied through /api, while FastAPI exposes WebSockets at /ws.
  const apiPath = url.pathname.replace(/\/+$/, "");
  const websocketPrefix = apiPath.endsWith("/api") ? apiPath.slice(0, -4) : apiPath;
  url.pathname = `${websocketPrefix}/ws`;
  url.search = "";
  url.hash = "";

  return url.toString().replace(/\/$/, "");
}

export function useAgentStream(runId: string, onEvent: (e: AgentEventPayload) => void) {
  const { data: session } = useSession();
  const token = (session as { accessToken?: string } | null)?.accessToken;
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!token) return;

    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(`${getWebSocketBase()}/runs/${runId}?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;
      ws.onmessage = (msg) => {
        try {
          onEventRef.current(JSON.parse(msg.data) as AgentEventPayload);
        } catch {}
      };
      ws.onclose = (e) => {
        if (!closed && e.code !== 1000) reconnectTimer = setTimeout(connect, 2000);
      };
    };

    connect();
    const ping = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send("ping");
    }, 30000);
    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearInterval(ping);
      wsRef.current?.close(1000);
    };
  }, [runId, token]);
}
