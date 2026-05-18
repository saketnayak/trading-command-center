"use client";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getBehavioralAlerts } from "@/lib/api";
import type { BehavioralAlert, BehavioralAlertsResponse } from "@/lib/types";

const SEVERITY_STYLES = {
  critical: {
    icon: "🔴",
    border: "border-red-800/50",
    bg: "bg-red-900/10",
    titleColor: "text-red-400",
    badge: "bg-red-500/20 text-red-400",
  },
  warning: {
    icon: "🟡",
    border: "border-yellow-800/50",
    bg: "bg-yellow-900/10",
    titleColor: "text-yellow-400",
    badge: "bg-yellow-500/20 text-yellow-400",
  },
  info: {
    icon: "🔵",
    border: "border-blue-800/50",
    bg: "bg-blue-900/10",
    titleColor: "text-blue-400",
    badge: "bg-blue-500/20 text-blue-400",
  },
} as const;

function AlertRow({ alert }: { alert: BehavioralAlert }) {
  const style = SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.info;
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border ${style.bg} ${style.border}`}>
      <span className="text-base shrink-0 mt-0.5">{style.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center flex-wrap gap-2 mb-1">
          <span className={`text-xs font-semibold ${style.titleColor}`}>{alert.title}</span>
          {alert.affected_tickers.slice(0, 4).map((t) => (
            <span key={t} className="text-xs font-mono px-1.5 py-0.5 bg-slate-800 rounded text-slate-300">
              {t}
            </span>
          ))}
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">{alert.description}</p>
        <p className="text-xs text-slate-500 mt-1 italic">{alert.suggested_action}</p>
      </div>
    </div>
  );
}

export function BehavioralAlerts({ portfolioId }: { portfolioId: string }) {
  const [expanded, setExpanded] = useState<boolean | null>(null);

  const { data, isLoading } = useQuery<BehavioralAlertsResponse>({
    queryKey: ["behavioralAlerts", portfolioId],
    queryFn: () => getBehavioralAlerts(portfolioId),
    staleTime: 1000 * 60 * 5,
  });

  // Set initial expanded state once data loads: expanded if any warning/critical
  useEffect(() => {
    if (data && expanded === null) {
      setExpanded(data.critical_count > 0 || data.warning_count > 0);
    }
  }, [data, expanded]);

  if (isLoading || !data || data.alert_count === 0) return null;

  const isExpanded = expanded ?? false;

  return (
    <div className="bg-slate-900/50 border border-slate-700 rounded-xl overflow-hidden mb-4">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/40 transition-colors text-left"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-slate-200">Behavioral Alerts</span>
          {data.critical_count > 0 && (
            <span className="text-xs px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded font-mono">
              {data.critical_count} critical
            </span>
          )}
          {data.warning_count > 0 && (
            <span className="text-xs px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded font-mono">
              {data.warning_count} warning
            </span>
          )}
          {data.info_count > 0 && (
            <span className="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded font-mono">
              {data.info_count} info
            </span>
          )}
        </div>
        <span className="text-slate-500 text-xs ml-4 shrink-0">{isExpanded ? "▲" : "▼"}</span>
      </button>
      {isExpanded && (
        <div className="px-4 pb-4 space-y-2">
          {data.alerts.map((alert, i) => (
            <AlertRow key={`${alert.type}-${i}`} alert={alert} />
          ))}
        </div>
      )}
    </div>
  );
}
