import { STATUS_STYLES } from "@/lib/jev/format";
import type { JevMode } from "@/lib/jev/types";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_STYLES[status] ?? "bg-elevated text-muted"}`}>
      {status}
    </span>
  );
}

export function ModeBadge({ mode, mock }: { mode: JevMode; mock?: boolean }) {
  if (mock) {
    return (
      <span className="inline-block rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-300">
        Shadow · mock Jev
      </span>
    );
  }
  return mode === "paper" ? (
    <span className="inline-block rounded border border-green-500/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-green-600 dark:text-green-300">
      Paper
    </span>
  ) : (
    <span className="inline-block rounded border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-secondary">
      Shadow
    </span>
  );
}
