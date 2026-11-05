"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";

import { checkAlertRule, deleteAlertRule, listAlertRules, updateAlertRule } from "@/lib/api";
import { ALERT_RULES_QUERY_KEY, CHANNEL_LABELS, describeRule, timeAgo, type AlertCheck, type AlertRule } from "@/lib/alerts";
import { IconButton } from "@/components/ui/IconButton";
import { BTN_SECONDARY_CLASS } from "@/lib/uiClasses";

export function AlertRuleList() {
  const { data: rules = [], isPending, isError } = useQuery({ queryKey: ALERT_RULES_QUERY_KEY, queryFn: listAlertRules });

  if (isPending) return <p className="text-sm text-muted">Loading alerts…</p>;
  if (isError) return <p className="text-sm text-muted">Alerts could not be loaded.</p>;
  if (rules.length === 0) {
    return <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">No alert rules yet.</p>;
  }
  return (
    <ul className="space-y-2">
      {rules.map((r) => (
        <RuleRow key={r.id} rule={r} />
      ))}
    </ul>
  );
}

function RuleRow({ rule }: { rule: AlertRule }) {
  const qc = useQueryClient();
  const [check, setCheck] = useState<AlertCheck | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ALERT_RULES_QUERY_KEY });

  const toggle = useMutation({ mutationFn: () => updateAlertRule(rule.id, { enabled: !rule.enabled }), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: () => deleteAlertRule(rule.id), onSuccess: invalidate });
  const runCheck = useMutation({ mutationFn: () => checkAlertRule(rule.id), onSuccess: setCheck });

  return (
    <li className={`rounded-lg border border-border bg-surface px-3 py-2.5 ${rule.enabled ? "" : "opacity-60"}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">{describeRule(rule)}</p>
          <p className="mt-0.5 text-[11px] text-muted">
            {rule.channels.map((c) => CHANNEL_LABELS[c]).join(" · ")}
            {rule.cooldown_hours ? ` · at most every ${rule.cooldown_hours} h` : ""}
            {" · "}last fired {timeAgo(rule.last_triggered_at)}
            {rule.portfolio_name && rule.ticker ? ` · webhook via ${rule.portfolio_name}` : ""}
            {rule.rerun_analysis ? " · re-runs the analysis" : ""}
          </p>
          {rule.last_error && <p className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">Last check: {rule.last_error}</p>}
        </div>
        <label className="inline-flex shrink-0 items-center gap-1 text-[11px] text-fg-secondary">
          <input type="checkbox" checked={rule.enabled} onChange={() => toggle.mutate()} disabled={toggle.isPending} />
          On
        </label>
        <IconButton icon={Trash2} label="Delete alert" tone="danger" onClick={() => remove.mutate()} disabled={remove.isPending} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className={BTN_SECONDARY_CLASS} onClick={() => runCheck.mutate()} disabled={runCheck.isPending}>
          {runCheck.isPending ? "Checking…" : "Check now"}
        </button>
        {check && (
          <span className="text-xs text-fg-secondary" role="status">
            {check.observed}
            {check.condition === true ? " · condition met" : check.condition === false ? " · not met" : ""}
            <span className="block text-[11px] text-muted">{check.note}</span>
          </span>
        )}
        {runCheck.isError && <span className="text-xs text-red-500">{(runCheck.error as Error).message}</span>}
      </div>
    </li>
  );
}
