"use client";
import { useQuery } from "@tanstack/react-query";
import { getTickerRegime } from "@/lib/api";
import type { RegimeData } from "@/lib/types";

interface Props {
  ticker: string;
  verdict: "buy" | "sell" | "hold" | null | undefined;
}

function regimeColor(regime: RegimeData["current_regime"]): string {
  if (regime === "Bull") return "text-green-400";
  if (regime === "Bear") return "text-red-400";
  return "text-yellow-400";
}

export function MarkovConfirmation({ ticker, verdict }: Props) {
  const { data: regime, isLoading } = useQuery<RegimeData | null>({
    queryKey: ["ticker-regime", ticker],
    queryFn: () => getTickerRegime(ticker),
    staleTime: 1000 * 60 * 60 * 4,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="bg-elevated border border-input-border rounded-lg p-4 text-xs text-muted">
        Loading regime analysis…
      </div>
    );
  }

  if (!regime) return null;

  const isConflict =
    verdict != null &&
    verdict !== "hold" &&
    ((verdict === "buy" && regime.signal < 0) || (verdict === "sell" && regime.signal > 0));
  const isNeutral = !verdict || verdict === "hold" || regime.current_regime === "Sideways";

  const signStr = regime.signal >= 0 ? `+${regime.signal.toFixed(2)}` : regime.signal.toFixed(2);
  const signalColor = regime.signal >= 0.3 ? "text-green-400" : regime.signal <= -0.3 ? "text-red-400" : "text-yellow-400";
  const borderColor = isConflict ? "border-amber-500/40" : !isNeutral ? "border-green-500/40" : "border-input-border";

  const statRows: Array<{ label: string; value: number; color: string }> = [
    { label: "Bull", value: regime.stationary.bull, color: "bg-green-500" },
    { label: "Sidew.", value: regime.stationary.sideways, color: "bg-yellow-500" },
    { label: "Bear", value: regime.stationary.bear, color: "bg-red-500" },
  ];

  return (
    <div className={`bg-elevated border ${borderColor} rounded-lg p-4 space-y-3`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg">Markov Regime Check</h3>
        <span className="text-[10px] text-muted uppercase tracking-wide">yfinance · 10y daily</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div>
          <span className="text-muted uppercase text-[10px] tracking-wide block">AI Verdict</span>
          <span className="text-fg font-semibold uppercase">{verdict ?? "—"}</span>
        </div>
        <div>
          <span className="text-muted uppercase text-[10px] tracking-wide block">Markov Regime</span>
          <span className={`font-semibold ${regimeColor(regime.current_regime)}`}>
            ● {regime.current_regime}{" "}
            <span className={`font-mono ${signalColor}`}>{signStr}</span>
          </span>
        </div>
        <div className="col-span-2">
          <span className="text-muted uppercase text-[10px] tracking-wide block">Agreement</span>
          {isConflict ? (
            <span className="text-amber-400 font-semibold">
              ⚠ Conflicts — regime is {regime.current_regime} (signal {signStr})
            </span>
          ) : isNeutral ? (
            <span className="text-muted">— Neutral</span>
          ) : (
            <span className="text-green-400 font-semibold">✓ Confirms</span>
          )}
        </div>
      </div>

      <div className="border-t border-input-border/50 pt-3 space-y-2">
        <div className="flex flex-wrap gap-4 text-xs">
          <div>
            <span className="text-muted text-[10px] uppercase tracking-wide block">Persistence</span>
            <span className="font-mono text-fg-secondary">{(regime.persistence * 100).toFixed(0)}% stay {regime.current_regime}</span>
          </div>
          <div>
            <span className="text-muted text-[10px] uppercase tracking-wide block">Walk-fwd Sharpe</span>
            <span className={`font-mono ${(regime.walk_forward.sharpe ?? 0) > 0.5 ? "text-green-400" : "text-fg-secondary"}`}>
              {regime.walk_forward.sharpe != null ? regime.walk_forward.sharpe.toFixed(2) : "—"}
            </span>
          </div>
          <div>
            <span className="text-muted text-[10px] uppercase tracking-wide block">Max DD</span>
            <span className="font-mono text-fg-secondary">
              {regime.walk_forward.max_drawdown != null
                ? `${(regime.walk_forward.max_drawdown * 100).toFixed(1)}%`
                : "—"}
            </span>
          </div>
        </div>

        <div>
          <span className="text-[10px] text-muted uppercase tracking-wide block mb-1">Long-run distribution</span>
          <div className="space-y-0.5">
            {statRows.map((b) => (
              <div key={b.label} className="flex items-center gap-2">
                <span className="text-[10px] text-muted w-10">{b.label}</span>
                <div className="flex-1 bg-muted-surface rounded h-1.5">
                  <div
                    className={`h-1.5 rounded ${b.color}`}
                    style={{ width: `${(b.value * 100).toFixed(0)}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-fg-secondary w-8 text-right">
                  {(b.value * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
