"use client";

import { orderCurrencies } from "@/lib/displayCurrency";

type DisplayCurrencyPickerProps = {
  value: string;
  /** Currencies the holdings trade in; listed first. */
  held?: string[];
  supported: string[];
  onChange: (code: string) => void;
  saveError?: boolean;
};

export function DisplayCurrencyPicker({ value, held = [], supported, onChange, saveError }: DisplayCurrencyPickerProps) {
  const groups = orderCurrencies(supported, held);
  const option = (code: string) => (
    <option key={code} value={code}>
      {code}
    </option>
  );
  return (
    <span className="inline-flex flex-col items-end align-baseline">
      <select
        aria-label="Display currency"
        title="Show values in another currency"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer rounded border border-input-border bg-input px-1 py-0 text-xs text-fg transition-colors hover:border-border-strong focus:border-blue-500 focus:outline-hidden"
      >
        {groups.held.length > 0 && <optgroup label="In this portfolio">{groups.held.map(option)}</optgroup>}
        <optgroup label={groups.held.length > 0 ? "All currencies" : "Currencies"}>{groups.others.map(option)}</optgroup>
      </select>
      {saveError && <span className="text-[10px] text-amber-400">Not saved, so this resets on reload</span>}
    </span>
  );
}
