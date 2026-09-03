import { formatMoney } from "@/lib/format";

/**
 * Cap position as a single bar: bonus-rate spend, then any spend that has
 * already spilled past the cap to the base rate.
 */
export function CapMeter({
  capUsed,
  capAmount,
  spendPastCap,
}: {
  capUsed: number;
  capAmount: number;
  spendPastCap: number;
}) {
  const withinCap = Math.min(capUsed, capAmount);
  const usedPercent = capAmount > 0 ? Math.min(100, (withinCap / capAmount) * 100) : 0;
  const overflow = Math.max(0, capUsed - capAmount);

  const tone =
    usedPercent >= 95 ? "bg-danger-400" : usedPercent >= 75 ? "bg-warn-400" : "bg-accent-500";

  return (
    <div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-ink-800">
        <div
          className={`h-full rounded-full transition-all ${tone}`}
          style={{ width: `${usedPercent}%` }}
        />
      </div>
      <div className="mt-2 flex items-baseline justify-between text-xs text-ink-500">
        <span className="tabular">
          {formatMoney(capUsed)} of {formatMoney(capAmount)} used
        </span>
        <span className="tabular">{usedPercent.toFixed(usedPercent >= 10 ? 0 : 1)}%</span>
      </div>
      {overflow > 0 || spendPastCap > 0 ? (
        <p className="mt-1 text-xs text-warn-400 tabular">
          {formatMoney(spendPastCap || overflow)} already earning 1x past the cap
        </p>
      ) : null}
    </div>
  );
}
