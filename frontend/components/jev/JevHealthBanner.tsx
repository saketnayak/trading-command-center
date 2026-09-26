import type { JevHealth } from "@/lib/jev/insights";

export function JevHealthBanner({ health }: { health: JevHealth }) {
  const tone =
    health.level === "down"
      ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
      : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return (
    <div role="status" className={`rounded-md border px-3 py-2 text-xs ${tone}`}>
      {health.message}
    </div>
  );
}
