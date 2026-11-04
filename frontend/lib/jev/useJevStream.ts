"use client";
import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { getWebSocketBase } from "@/lib/websocket";
import type { JevStreamMessage } from "./types";

/** Live ticks and status changes for one JEV Lab session (same protocol as useAgentStream). */
export function useJevStream(sessionId: string, enabled: boolean, onMessage: (m: JevStreamMessage) => void) {
  const { data: session } = useSession();
  const token = (session as { accessToken?: string } | null)?.accessToken;
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!token || !enabled) return;
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(`${getWebSocketBase()}/jev/${sessionId}?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;
      ws.onmessage = (msg) => {
        try {
          onMessageRef.current(JSON.parse(msg.data) as JevStreamMessage);
        } catch {}
      };
      ws.onclose = (e) => {
        if (!closed && e.code !== 1000 && e.code !== 4004) reconnectTimer = setTimeout(connect, 2000);
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
  }, [sessionId, token, enabled]);
}
