import type { JevMeta } from "@/lib/jev/types";

function Column({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted">{title}</p>
      <ul className="mt-2 space-y-2">
        {rows.map(([desc, owner]) => (
          <li key={desc} className="text-xs text-fg-secondary">
            {desc}
            <span className="block font-mono text-[10px] text-muted">{owner}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The deterministic / probabilistic split the whole loop is built on. */
export function SplitExplainer({ meta }: { meta: JevMeta }) {
  return (
    <details className="rounded-lg border border-border bg-surface px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium text-fg">How the loop decides</summary>
      <p className="mt-2 text-xs text-muted">
        Code computes the state; Jev answers seven typed judgment questions about it in one call; code turns those
        answers into an action and a risk engine can veto anything. Jev is never asked to calculate or to trade.
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <Column title="Deterministic (our code)" rows={meta.split.deterministic} />
        <Column title="Probabilistic (Jev)" rows={meta.split.probabilistic} />
      </div>
    </details>
  );
}
