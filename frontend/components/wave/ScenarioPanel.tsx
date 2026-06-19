"use client";

import { useState } from "react";

import { fmtMoney } from "@/lib/currency";
import type { ElliottScenario } from "@/lib/wave/types";

interface ScenarioPanelProps {
  scenarios: ElliottScenario[];
  currency?: string;
}

export function ScenarioPanel({ scenarios, currency = "USD" }: ScenarioPanelProps) {
  if (scenarios.length === 0) {
    return (
      <p className="rounded-md border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
        No Elliott scenarios detected.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-zinc-400">
            <tr>
              <th className="px-2 py-1">Pattern</th>
              <th className="px-2 py-1">Trend</th>
              <th className="px-2 py-1">Degree</th>
              <th className="px-2 py-1">Score</th>
              <th className="px-2 py-1">Invalidation ({currency})</th>
              <th className="px-2 py-1">Notes</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s, i) => (
              <tr key={i} className="border-t border-zinc-800 text-zinc-200">
                <td className="px-2 py-1">{s.pattern}</td>
                <td className="px-2 py-1">{s.trend}</td>
                <td className="px-2 py-1">{s.degree}</td>
                <td className="px-2 py-1">{s.score.toFixed(2)}</td>
                <td className="px-2 py-1 font-mono text-xs">
                  {s.invalidation_level != null ? fmtMoney(s.invalidation_level, currency) : "—"}
                </td>
                <td className="px-2 py-1 max-w-xs truncate" title={s.notes.join(" | ")}>
                  {s.notes.join(" | ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {scenarios.map((scenario, idx) => (
        <ScenarioExpander key={idx} index={idx + 1} scenario={scenario} currency={currency} />
      ))}
    </div>
  );
}

function ScenarioExpander({
  index,
  scenario,
  currency,
}: {
  index: number;
  scenario: ElliottScenario;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const title = `Scenario ${index}: ${scenario.pattern} / ${scenario.trend} / score=${scenario.score}`;

  return (
    <div className="rounded-lg border border-zinc-700/60">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-zinc-100 hover:bg-zinc-800/50"
      >
        {title}
        <span>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-zinc-800 px-3 py-2 text-sm text-zinc-300">
          <p className="font-medium text-zinc-200">Legs</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-zinc-500">
                <tr>
                  <th className="px-1 py-0.5">Label</th>
                  <th className="px-1 py-0.5">Start</th>
                  <th className="px-1 py-0.5">End</th>
                  <th className="px-1 py-0.5">Start ({currency})</th>
                  <th className="px-1 py-0.5">End ({currency})</th>
                </tr>
              </thead>
              <tbody>
                {scenario.legs.map((leg) => (
                  <tr key={leg.label + leg.start_idx} className="border-t border-zinc-800">
                    <td className="px-1 py-0.5">{leg.label}</td>
                    <td className="px-1 py-0.5">{leg.start_time}</td>
                    <td className="px-1 py-0.5">{leg.end_time}</td>
                    <td className="px-1 py-0.5 font-mono">{fmtMoney(leg.start_price, currency)}</td>
                    <td className="px-1 py-0.5 font-mono">{fmtMoney(leg.end_price, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="font-medium text-zinc-200">Notes</p>
          <ul className="list-disc pl-5">
            {scenario.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
