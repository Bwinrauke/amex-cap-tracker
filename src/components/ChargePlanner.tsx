"use client";

import { useMemo, useState } from "react";
import { planCharge, rankCardsForCharge, type CardPosition } from "@/lib/cap";
import { formatMoney, formatNumber } from "@/lib/format";

/**
 * "Where should this charge go?" — ranks every active card by what a charge
 * of a given size would actually earn, and shows the best split when no
 * single card can absorb it all at its bonus rate.
 */
export function ChargePlanner({ cards }: { cards: CardPosition[] }) {
  const [amountText, setAmountText] = useState("10000");
  const amount = Math.max(0, Number(amountText.replace(/[^0-9.]/g, "")) || 0);

  const ranked = useMemo(() => rankCardsForCharge(cards, amount), [cards, amount]);
  const plan = useMemo(() => planCharge(cards, amount), [cards, amount]);

  if (cards.length === 0) return null;

  return (
    <section className="card p-5">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold">Where should the next charge go?</h2>
          <p className="mt-0.5 text-sm text-ink-500">
            Ranked by points actually earned, allowing for each card&apos;s cap.
          </p>
        </div>
        <div>
          <label htmlFor="amount" className="mb-1 block text-xs text-ink-500">
            Charge amount
          </label>
          <div className="flex items-center gap-1 rounded-lg border border-ink-700 bg-ink-950 px-3 py-1.5 focus-within:border-brand-500">
            <span className="text-ink-500">$</span>
            <input
              id="amount"
              inputMode="decimal"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              className="w-28 bg-transparent text-sm outline-none tabular"
            />
          </div>
        </div>
      </header>

      {amount <= 0 ? (
        <p className="text-sm text-ink-500">Enter an amount to compare cards.</p>
      ) : (
        <>
          <ol className="space-y-2">
            {ranked.map((entry, index) => (
              <li
                key={entry.card.cardAccountId}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${
                  index === 0
                    ? "border-accent-500/40 bg-accent-500/5"
                    : "border-ink-800 bg-ink-950"
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {index === 0 ? "★ " : `${index + 1}. `}
                    {entry.card.nickname}
                  </p>
                  <p className="text-xs text-ink-500">
                    {entry.amountAtBase > 0 && entry.amountAtBonus > 0
                      ? `${formatMoney(entry.amountAtBonus)} at ${entry.card.bonusMultiplier}x, then ${formatMoney(entry.amountAtBase)} at ${entry.card.baseMultiplier}x`
                      : entry.amountAtBonus > 0
                        ? `all of it at ${entry.card.bonusMultiplier}x`
                        : `all of it at ${entry.card.baseMultiplier}x — cap used up`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular">{formatNumber(entry.points)} pts</p>
                  <p className="text-xs text-ink-500 tabular">
                    {entry.pointsLostVsBest > 0
                      ? `−${formatNumber(entry.pointsLostVsBest)} vs best`
                      : `${entry.effectiveRate.toFixed(2)}x blended`}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          {plan.pointsGainedBySplitting > 0 ? (
            <div className="mt-4 rounded-lg border border-brand-500/30 bg-brand-500/5 p-4">
              <p className="text-sm font-medium text-brand-400">
                Splitting this charge earns {formatNumber(plan.pointsGainedBySplitting)} more
                points
              </p>
              <ul className="mt-2 space-y-1 text-sm text-ink-300">
                {plan.legs.map((leg, index) => (
                  <li key={`${leg.card.cardAccountId}-${index}`} className="flex justify-between gap-3">
                    <span className="truncate">
                      {formatMoney(leg.amount)} on {leg.card.nickname}
                    </span>
                    <span className="tabular text-ink-500">
                      {leg.rate}x · {formatNumber(leg.points)} pts
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
