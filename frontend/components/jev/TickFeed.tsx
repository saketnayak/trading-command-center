import { actionTone, fmtPrice, TONE_FILL } from "@/lib/jev/format";
import type { JevTick } from "@/lib/jev/types";

function ordersText(t: JevTick): string {
  if (!t.orders.length) return "—";
  return t.orders
    .map((o) => `${o.status === "shadow" ? "would " : ""}${o.side} ${o.qty}${o.limit_price ? ` @ ${fmtPrice(o.limit_price)}` : " mkt"}${o.status === "rejected" ? " (rejected)" : ""}`)
    .join(", ");
}

/** Newest-first log of what each tick decided and did. */
export function TickFeed({ ticks }: { ticks: JevTick[] }) {
  const rows = [...ticks].reverse().slice(0, 40);
  return (
    <div className="max-h-[360px] overflow-auto">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-border text-left text-muted">
            <th className="px-2 py-1.5 font-medium">#</th>
            <th className="px-2 py-1.5 font-medium">Time</th>
            <th className="px-2 py-1.5 font-medium">Action</th>
            <th className="px-2 py-1.5 font-medium">Rung</th>
            <th className="px-2 py-1.5 font-medium">Why</th>
            <th className="px-2 py-1.5 font-medium">Orders</th>
            <th className="px-2 py-1.5 font-medium">Fills / notes</th>
            <th className="px-2 py-1.5 text-right font-medium">Jev ms</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.tick} className="border-b border-border last:border-0 align-top">
              <td className="px-2 py-1.5 tabular-nums text-muted">{t.tick}</td>
              <td className="px-2 py-1.5 whitespace-nowrap text-muted">{new Date(t.ts * 1000).toLocaleTimeString()}</td>
              <td className="px-2 py-1.5 whitespace-nowrap">
                <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: TONE_FILL[actionTone(t.action)] }} aria-hidden />
                <span className="font-mono text-fg">{t.action}</span>
                {t.direction_leg && <span className="ml-1 text-muted">+{t.direction_leg} leg</span>}
              </td>
              <td className="px-2 py-1.5 font-mono text-fg-secondary">{t.rung}</td>
              <td className="max-w-[15rem] px-2 py-1.5 text-fg-secondary">
                <span className="line-clamp-2" title={t.action_reason ?? undefined}>{t.action_reason ?? "—"}</span>
              </td>
              <td className="min-w-[6rem] px-2 py-1.5 text-fg-secondary">{ordersText(t)}</td>
              <td className="min-w-[7rem] max-w-[12rem] px-2 py-1.5 text-fg-secondary">
                <span className="line-clamp-2" title={t.fill && t.fill !== "-" ? t.fill : undefined}>{t.fill && t.fill !== "-" ? t.fill : "—"}</span>
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-muted">{t.latency_ms != null ? Math.round(t.latency_ms) : "late"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
