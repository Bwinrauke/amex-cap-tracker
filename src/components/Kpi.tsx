export function Kpi({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneClass = {
    default: "text-ink-100",
    good: "text-accent-400",
    warn: "text-warn-400",
    bad: "text-danger-400",
  }[tone];

  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-ink-500">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold tabular ${toneClass}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-500">{hint}</p> : null}
    </div>
  );
}
