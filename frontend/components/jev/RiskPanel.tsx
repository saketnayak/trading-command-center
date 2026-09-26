import { fmtPct, fmtQty, fmtUsd, pnlClass } from "@/lib/jev/format";
import type { JevSession, JevTick } from "@/lib/jev/types";

function Gauge({ label, value, limit, format }: { label: string; value: number; limit: number; format: (v: number) => string }) {
  const pct = Math.max(0, Math.min(100, (value / limit) * 100));
  const tone = pct >= 90 ? "bg-red-500" : pct >= 60 ? "bg-amber-500" : "bg-green-500";
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-fg-secondary">{label}</span>
        <span className="tabular-nums text-fg">
          {format(value)} <span className="text-muted">/ {format(limit)}</span>
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-elevated" role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={limit}>
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Position, P&L and the hard limits the risk engine enforces. */
export function RiskPanel({ session, latest, limits }: { session: JevSession; latest: JevTick | undefined; limits: Record<string, number> }) {
  const mid = latest?.mid ?? session.last_mid ?? 0;
  const inventory = latest?.inventory ?? session.inventory;
  const unrealised = latest?.unrealised_pnl_usd ?? 0;
  const realised = latest?.realised_pnl_usd ?? session.realised_pnl_usd;
  const dailyLoss = Math.max(0, -(realised ?? 0) - (unrealised ?? 0));
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted">Inventory</dt>
          <dd className="tabular-nums text-fg">{fmtQty(inventory)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted">Unrealised / realised</dt>
          <dd className="tabular-nums">
            <span className={pnlClass(unrealised)}>{fmtUsd(unrealised, 4)}</span>
            <span className="text-muted"> / </span>
            <span className={pnlClass(realised)}>{fmtUsd(realised, 4)}</span>
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted">Orders sent / rejected / fills</dt>
          <dd className="tabular-nums text-fg">
            {session.orders_submitted} / {session.orders_rejected} / {session.fills}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted">Jev cost</dt>
          <dd className="tabular-nums text-fg">{fmtUsd(session.cost_usd, 4)}</dd>
        </div>
      </dl>
      <Gauge label="Position" value={Math.abs(inventory) * mid} limit={limits.max_position_usd} format={(v) => fmtUsd(v)} />
      <Gauge label="Loss today" value={dailyLoss} limit={limits.max_daily_loss_usd} format={(v) => fmtUsd(v)} />
      <Gauge label="Drawdown" value={latest?.drawdown_pct ?? 0} limit={limits.max_drawdown_pct} format={(v) => fmtPct(v)} />
    </div>
  );
}
