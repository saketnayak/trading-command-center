const DAYS = [
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
  { label: "Sun", value: 0 },
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function fmtTime(h: number, m: number) {
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${ampm}`;
}

export function CronLabel({
  cron,
  nextRunAt,
}: {
  cron: string | null;
  nextRunAt?: string | null;
}) {
  if (!cron) return <span className="text-muted text-xs">Manual only</span>;

  const daily = cron.match(/^(\d+) (\d+) \* \* \*$/);
  if (daily) {
    return (
      <span className="text-fg-secondary text-xs">
        Daily {fmtTime(Number(daily[2]), Number(daily[1]))}
        {nextRunAt && (
          <span className="block text-muted">Next: {new Date(nextRunAt).toLocaleString()}</span>
        )}
      </span>
    );
  }

  const wdays = cron.match(/^(\d+) (\d+) \* \* 1-5$/);
  if (wdays) {
    return (
      <span className="text-fg-secondary text-xs">
        Weekdays {fmtTime(Number(wdays[2]), Number(wdays[1]))}
        {nextRunAt && (
          <span className="block text-muted">Next: {new Date(nextRunAt).toLocaleString()}</span>
        )}
      </span>
    );
  }

  const weekly = cron.match(/^(\d+) (\d+) \* \* (\d)$/);
  if (weekly) {
    const day = DAYS.find((d) => d.value === Number(weekly[3]));
    return (
      <span className="text-fg-secondary text-xs">
        {day?.label ?? `Day ${weekly[3]}`} {fmtTime(Number(weekly[2]), Number(weekly[1]))}
        {nextRunAt && (
          <span className="block text-muted">Next: {new Date(nextRunAt).toLocaleString()}</span>
        )}
      </span>
    );
  }

  return (
    <span className="text-fg-secondary text-xs font-mono">
      {cron}
      {nextRunAt && (
        <span className="block text-muted font-sans">Next: {new Date(nextRunAt).toLocaleString()}</span>
      )}
    </span>
  );
}
