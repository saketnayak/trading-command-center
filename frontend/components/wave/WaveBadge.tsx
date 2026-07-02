"use client";

import type { WaveSummary } from "@/lib/types";
import { signalToneBadgeClass } from "@/lib/uiClasses";

export function WaveBadge({ data }: { data: WaveSummary | undefined | null }) {
  if (!data?.top_scenario) return null;

  const dir = data.top_direction;
  const color =
    dir === "long"
      ? signalToneBadgeClass("success")
      : dir === "short"
        ? signalToneBadgeClass("danger")
        : signalToneBadgeClass("warning");

  return (
    <span
      className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${color}`}
      title={`Elliott/Fib: ${data.top_scenario}${data.confidence != null ? ` · confidence ${data.confidence.toFixed(0)}` : ""}`}
    >
      〜 {data.top_scenario}
    </span>
  );
}
