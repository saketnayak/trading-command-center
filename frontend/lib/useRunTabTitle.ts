"use client";
import { useEffect, useRef } from "react";

const DEFAULT_TITLE = "AgentFloor";

type RunLikeStatus = "pending" | "running" | "completed" | "aborted" | "failed";

/**
 * Drives `document.title` based on a run's status:
 *   running/pending → "▶ TICKER · running — AgentFloor"
 *   completed       → "✓ TICKER completed — AgentFloor", pulses if tab hidden
 *   failed          → "✗ TICKER failed — AgentFloor", pulses if tab hidden
 *   aborted         → "⏹ TICKER aborted — AgentFloor"
 *
 * Pulsing stops as soon as the tab regains visibility. Title is restored on
 * unmount.
 */
export function useRunTabTitle(ticker: string | undefined, status: RunLikeStatus | undefined) {
  const previousStatus = useRef<RunLikeStatus | undefined>(undefined);
  const pulseTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!ticker || !status) return;

    const baseLabel = labelFor(status, ticker);
    document.title = baseLabel;

    // Detect a fresh terminal transition so we can pulse if backgrounded.
    const justFinished =
      previousStatus.current &&
      previousStatus.current !== status &&
      (status === "completed" || status === "failed");
    previousStatus.current = status;

    function stopPulse() {
      if (pulseTimer.current) {
        clearInterval(pulseTimer.current);
        pulseTimer.current = null;
      }
      document.title = labelFor(status!, ticker!);
    }

    if (justFinished && document.hidden) {
      let toggle = false;
      pulseTimer.current = setInterval(() => {
        toggle = !toggle;
        document.title = toggle ? `(!) ${baseLabel}` : baseLabel;
      }, 1200);

      const onVisibility = () => {
        if (!document.hidden) {
          stopPulse();
          document.removeEventListener("visibilitychange", onVisibility);
        }
      };
      document.addEventListener("visibilitychange", onVisibility);

      return () => {
        document.removeEventListener("visibilitychange", onVisibility);
        stopPulse();
      };
    }

    return () => {
      if (pulseTimer.current) {
        clearInterval(pulseTimer.current);
        pulseTimer.current = null;
      }
    };
  }, [ticker, status]);

  // Restore on unmount.
  useEffect(() => {
    const original = document.title;
    return () => {
      document.title = original;
    };
  }, []);
}

function labelFor(status: RunLikeStatus, ticker: string): string {
  switch (status) {
    case "pending":
    case "running":
      return `▶ ${ticker} · running — ${DEFAULT_TITLE}`;
    case "completed":
      return `✓ ${ticker} completed — ${DEFAULT_TITLE}`;
    case "failed":
      return `✗ ${ticker} failed — ${DEFAULT_TITLE}`;
    case "aborted":
      return `⏹ ${ticker} aborted — ${DEFAULT_TITLE}`;
  }
}
