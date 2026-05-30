"use client";

export type DateRangePreset = "" | "24h" | "7d" | "30d" | "90d";

interface FilterValues {
  ticker: string;
  status: string;
  verdict: string;
  dateRange: DateRangePreset;
}

interface RunFiltersProps {
  value: FilterValues;
  onChange: (v: FilterValues) => void;
}

const inputClass =
  "w-full min-w-0 bg-surface border border-border rounded-sm px-3 py-2 text-sm text-fg focus:outline-hidden focus:border-blue-500";

export function RunFilters({ value, onChange }: RunFiltersProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-input rounded-sm px-4 py-3 mb-4">
      <input
        type="text"
        placeholder="TICKER"
        value={value.ticker}
        onChange={(e) => onChange({ ...value, ticker: e.target.value })}
        className={inputClass}
        data-run-filter-ticker
      />
      <select
        value={value.status}
        onChange={(e) => onChange({ ...value, status: e.target.value })}
        className={inputClass}
      >
        <option value="">All statuses</option>
        <option value="pending">pending</option>
        <option value="running">running</option>
        <option value="completed">completed</option>
        <option value="aborted">aborted</option>
        <option value="failed">failed</option>
      </select>
      <select
        value={value.verdict}
        onChange={(e) => onChange({ ...value, verdict: e.target.value })}
        className={inputClass}
      >
        <option value="">All verdicts</option>
        <option value="buy">buy</option>
        <option value="sell">sell</option>
        <option value="hold">hold</option>
      </select>
      <select
        value={value.dateRange}
        onChange={(e) => onChange({ ...value, dateRange: e.target.value as DateRangePreset })}
        className={inputClass}
        aria-label="Date range"
      >
        <option value="">All time</option>
        <option value="24h">Last 24h</option>
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
        <option value="90d">Last 90 days</option>
      </select>
    </div>
  );
}

export function dateRangeToFrom(preset: DateRangePreset): string | undefined {
  if (!preset) return undefined;
  const now = Date.now();
  const ms: Record<Exclude<DateRangePreset, "">, number> = {
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000,
  };
  return new Date(now - ms[preset]).toISOString();
}
