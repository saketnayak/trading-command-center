"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTickerRegime } from "@/lib/api";
import type { RegimeData } from "@/lib/types";
import { ChartQuickLook } from "@/components/ui/ChartQuickLook";
import {
  MarkovStationaryBars,
  MarkovTransitionMatrix,
} from "@/components/runs/confluence/MarkovGraphics";

interface Props {
  ticker: string;
  verdict: "buy" | "sell" | "hold" | null | undefined;
  variant?: "default" | "compact";
}

function regimeColor(regime: RegimeData["current_regime"]): string {
  if (regime === "Bull") return "text-green-400";
  if (regime === "Bear") return "text-red-400";
  return "text-yellow-400";
}

function MarkovGraphicsPanel({
  regime,
  compact = false,
  expanded = false,
}: {
  regime: RegimeData;
  compact?: boolean;
  expanded?: boolean;
}) {
  return (
    <div className={expanded ? "space-y-4" : compact ? "space-y-2" : "space-y-3"}>
      <div>
        {(!compact || expanded) && (
          <span
            className={`text-muted uppercase tracking-wide block mb-2 ${
              expanded ? "text-xs" : "text-[10px]"
            }`}
          >
            Transition matrix
          </span>
        )}
        <MarkovTransitionMatrix
          matrix={regime.transition_matrix}
          compact={compact}
          expanded={expanded}
        />
      </div>
      <MarkovStationaryBars
        stationary={regime.stationary}
        compact={compact && !expanded}
        expanded={expanded}
      />
    </div>
  );
}

export function MarkovConfirmation({ ticker, verdict, variant = "default" }: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);
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

  const agreementLabel = isConflict
    ? "Conflicts"
    : isNeutral
      ? "Neutral"
      : "Confirms";
  const agreementClass = isConflict
    ? "text-amber-400"
    : isNeutral
      ? "text-muted"
      : "text-green-400";

  if (variant === "compact") {
    const chevron = (
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted-surface text-base leading-none text-fg-secondary group-open:rotate-180 transition-transform duration-200">
        ▾
      </span>
    );

    return (
      <details
        open={detailsOpen}
        onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
        className={`bg-elevated border ${borderColor} rounded-lg text-xs group`}
      >
        <summary className="cursor-pointer list-none px-3 py-2 flex items-center justify-between gap-2">
          <span className="font-medium text-fg">Markov regime</span>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`font-semibold ${agreementClass}`}>{agreementLabel}</span>
            {chevron}
          </div>
        </summary>
        <div className="px-3 pb-3 pt-2 border-t border-input-border/50 space-y-2">
          <p className={`${regimeColor(regime.current_regime)} font-semibold`}>
            {regime.current_regime} · <span className={`font-mono ${signalColor}`}>{signStr}</span>
          </p>
          <div className="flex flex-wrap gap-3 text-[10px] text-muted">
            <span>Sharpe {regime.walk_forward.sharpe?.toFixed(2) ?? "—"}</span>
            <span>Persistence {(regime.persistence * 100).toFixed(0)}%</span>
          </div>
          <ChartQuickLook
            label="Markov regime charts"
            maxWidth={680}
            thumbnail={
              <div className="rounded-md border border-input-border/60 bg-page px-2 py-1.5">
                <MarkovGraphicsPanel regime={regime} compact />
              </div>
            }
            preview={<MarkovGraphicsPanel regime={regime} expanded />}
          />
        </div>
      </details>
    );
  }

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

      <div className="border-t border-input-border/50 pt-3 space-y-3">
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

        <div className="bg-page border border-input-border/60 rounded-md p-2">
          <MarkovGraphicsPanel regime={regime} />
        </div>
      </div>
    </div>
  );
}
