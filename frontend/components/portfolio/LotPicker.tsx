"use client";

import { useQuery } from "@tanstack/react-query";

import { getOpenLots } from "@/lib/api";
import { fmtMoney } from "@/lib/currency";
import { pickSummary, picksFromInputs, type OpenLot } from "@/lib/ledger";
import { FIELD_INPUT_SM_CLASS } from "@/lib/uiClasses";

interface Props {
  portfolioId: string;
  symbol: string;
  account: string;
  /** The sale date: lots still open then. */
  on: string;
  /** The sale being edited, left out of the lot list. */
  exclude?: string;
  saleQuantity: number;
  currency: string;
  inputs: Record<string, string>;
  onChange: (inputs: Record<string, string>) => void;
}

/** Choose which lots a sale closes, as brokers let you do; shares not chosen follow the cost-basis method. */
export function LotPicker({ portfolioId, symbol, account, on, exclude, saleQuantity, currency, inputs, onChange }: Props) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["portfolio-lots", portfolioId, symbol, account, on, exclude ?? ""],
    queryFn: () => getOpenLots(portfolioId, { symbol, on, account, exclude }),
    enabled: Boolean(symbol && on),
  });

  if (!symbol || !on) return <p className="text-xs text-muted">Enter the symbol and date to see its lots.</p>;
  if (isPending) return <p className="text-xs text-muted">Loading lots…</p>;
  if (isError) return <p className="text-xs text-red-600 dark:text-red-400" role="alert">{(error as Error).message}</p>;

  const lots: OpenLot[] = data.lots;
  if (lots.length === 0) return <p className="text-xs text-muted">{`No ${symbol} lots are open in ${account} on ${on}.`}</p>;
  const summary = pickSummary(picksFromInputs(inputs), saleQuantity, data.method, lots);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-xs tabular-nums">
          <thead className="text-muted">
            <tr>
              <th className="py-1 text-left font-medium">Bought</th>
              <th className="py-1 text-right font-medium">Open</th>
              <th className="py-1 text-right font-medium">Cost / share</th>
              <th className="py-1 pl-3 text-left font-medium">Held</th>
              <th className="py-1 text-right font-medium">Sell</th>
            </tr>
          </thead>
          <tbody>
            {lots.map((lot) => (
              <tr key={lot.buy_id} className="border-t border-border/60">
                <td className="py-1 text-fg-secondary">{lot.open_date}</td>
                <td className="py-1 text-right text-fg-secondary">{Number(lot.quantity.toFixed(6)).toLocaleString("en-US")}</td>
                <td className="py-1 text-right text-fg">{fmtMoney(lot.cost_per_share, currency)}</td>
                <td className="py-1 pl-3 text-fg-secondary">{lot.term === "long" ? "Long term" : "Short term"}</td>
                <td className="py-1 text-right">
                  <div className="ml-auto w-24">
                  <input
                    type="number" inputMode="decimal" step="any" min={0} max={lot.quantity}
                    aria-label={`Shares to sell from the lot bought ${lot.open_date}`}
                    value={inputs[lot.buy_id] ?? ""}
                    onChange={(e) => onChange({ ...inputs, [lot.buy_id]: e.target.value })}
                    className={`${FIELD_INPUT_SM_CLASS} text-right`}
                  />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={`text-xs ${summary.ok ? "text-muted" : "text-red-600 dark:text-red-400"}`} role="status">{summary.text}</p>
    </div>
  );
}

/** True when the picker's current choice can be saved. */
export function picksAreValid(inputs: Record<string, string>, saleQuantity: number, lots: OpenLot[] | undefined, method = "fifo"): boolean {
  return pickSummary(picksFromInputs(inputs), saleQuantity, method, lots ?? []).ok;
}
