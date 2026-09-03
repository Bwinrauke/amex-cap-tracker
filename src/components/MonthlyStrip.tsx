import { formatMoney } from "@/lib/format";

const MONTH_LABELS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

/** Twelve-month eligible-spend strip for one account. */
export function MonthlyStrip({ byMonth }: { byMonth: Record<number, number> }) {
  const peak = Math.max(...Object.values(byMonth), 0);

  return (
    <div className="flex items-end gap-1" aria-hidden={peak === 0}>
      {MONTH_LABELS.map((label, index) => {
        const month = index + 1;
        const value = byMonth[month] ?? 0;
        const height = peak > 0 ? Math.max(2, (value / peak) * 28) : 2;
        return (
          <div key={month} className="flex flex-1 flex-col items-center gap-1">
            <div
              className={`w-full rounded-sm ${value > 0 ? "bg-brand-500/70" : "bg-ink-800"}`}
              style={{ height: `${height}px` }}
              title={`${label}: ${formatMoney(value)} eligible`}
            />
            <span className="text-[9px] leading-none text-ink-500">{label}</span>
          </div>
        );
      })}
    </div>
  );
}
