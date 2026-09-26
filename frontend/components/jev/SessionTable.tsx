import Link from "next/link";
import { fmtPrice, fmtQty, fmtUsd, pnlClass } from "@/lib/jev/format";
import type { JevSession } from "@/lib/jev/types";
import { ModeBadge, StatusBadge } from "./JevBadges";

export function SessionTable({ sessions }: { sessions: JevSession[] }) {
  if (sessions.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted">No sessions yet. Start one above; shadow mode never places an order.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="px-3 py-2 font-medium">Symbol</th>
            <th className="px-3 py-2 font-medium">Mode</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 text-right font-medium">Ticks</th>
            <th className="px-3 py-2 text-right font-medium">Last mid</th>
            <th className="px-3 py-2 text-right font-medium">Inventory</th>
            <th className="px-3 py-2 text-right font-medium">Realised P&amp;L</th>
            <th className="px-3 py-2 font-medium">Decider</th>
            <th className="px-3 py-2 font-medium">Started</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id} className="border-b border-border last:border-0 hover:bg-elevated">
              <td className="px-3 py-2">
                <Link href={`/jev/${s.id}`} className="font-mono font-medium text-link hover:text-link-hover">
                  {s.symbol}
                </Link>
              </td>
              <td className="px-3 py-2"><ModeBadge mode={s.mode} mock={s.force_mock} /></td>
              <td className="px-3 py-2">
                <StatusBadge status={s.status} />
                {s.status === "interrupted" && s.mode === "paper" && s.inventory !== 0 && (
                  <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-300">position open</span>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{s.tick_count.toLocaleString()}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtPrice(s.last_mid)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtQty(s.inventory)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${pnlClass(s.realised_pnl_usd)}`}>{fmtUsd(s.realised_pnl_usd)}</td>
              <td className="px-3 py-2 text-muted">{s.decision_route ?? "—"}</td>
              <td className="px-3 py-2 text-muted whitespace-nowrap">
                {s.started_at ? new Date(s.started_at).toLocaleString() : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
