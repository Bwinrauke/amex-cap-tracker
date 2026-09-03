import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { CapMeter } from "@/components/CapMeter";
import { Kpi } from "@/components/Kpi";
import { MonthlyStrip } from "@/components/MonthlyStrip";
import { ChargePlanner } from "@/components/ChargePlanner";
import {
  bonusPointsAvailable,
  capYearWindow,
  computeBurnRate,
  projectExhaust,
  recommendCard,
  type CardPosition,
} from "@/lib/cap";
import { formatDate, formatMoney, formatNumber, todayIso } from "@/lib/format";
import type { CapRunwayRow, CardAccountRow, MonthlySpendRow } from "@/lib/database.types";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const params = await searchParams;
  const today = todayIso();
  const capYear = Number(params.year) || Number(today.slice(0, 4));

  const supabase = await createClient();

  // v_cap_runway is authoritative for every cap number on this page.
  const [{ data: runwayData, error }, { data: monthlyData }, { data: accountData }] =
    await Promise.all([
      supabase
        .from("v_cap_runway")
        .select("*")
        .eq("cap_year", capYear)
        .order("sort_order", { ascending: true }),
      supabase.from("v_monthly_spend").select("*").eq("cap_year", capYear),
      supabase
        .from("card_accounts")
        .select("id, product, cap_year_start_month, cap_year_start_day"),
    ]);

  const runway = (runwayData ?? []) as CapRunwayRow[];
  const monthly = (monthlyData ?? []) as MonthlySpendRow[];
  // Each card carries its own cap-year anchor: Amex runs on the calendar
  // year, Chase Ink on the cardmember anniversary.
  const accounts = new Map(
    (
      (accountData ?? []) as Pick<
        CardAccountRow,
        "id" | "product" | "cap_year_start_month" | "cap_year_start_day"
      >[]
    ).map((a) => [a.id, a]),
  );
  const windowFor = (cardAccountId: string, year: number) => {
    const account = accounts.get(cardAccountId);
    return capYearWindow(year, account?.cap_year_start_month ?? 1, account?.cap_year_start_day ?? 1);
  };

  const monthlyByAccount = new Map<string, Record<number, number>>();
  for (const row of monthly) {
    const current = monthlyByAccount.get(row.card_account_id) ?? {};
    current[row.month] = Number(row.eligible_spend ?? 0);
    monthlyByAccount.set(row.card_account_id, current);
  }

  // Each card carries its own rate and cap, so everything below works off
  // per-card figures rather than assuming any one product's terms.
  const positions: CardPosition[] = runway.map((row) => ({
    cardAccountId: row.card_account_id,
    nickname: row.nickname,
    product: accounts.get(row.card_account_id)?.product ?? "Card",
    accountStatus: row.account_status,
    capAmount: Number(row.cap_amount ?? 0),
    capUsed: Number(row.cap_used ?? 0),
    remainingRunway: Number(row.remaining_runway ?? 0),
    bonusMultiplier: Number(row.bonus_multiplier ?? 1),
    baseMultiplier: Number(row.base_multiplier ?? 1),
  }));

  const totals = runway.reduce(
    (acc, row) => ({
      capUsed: acc.capUsed + Number(row.cap_used ?? 0),
      remaining: acc.remaining + Number(row.remaining_runway ?? 0),
      points: acc.points + Number(row.points ?? 0),
      pastCap: acc.pastCap + Number(row.spend_past_cap ?? 0),
    }),
    { capUsed: 0, remaining: 0, points: 0, pastCap: 0 },
  );

  const recommendation = recommendCard(positions);

  // Bonus points still on the table: what the remaining runway is worth at
  // each card's uplift over its own base rate.
  const bonusAvailable = positions
    .filter((card) => card.accountStatus === "active")
    .reduce((sum, card) => sum + bonusPointsAvailable(card), 0);

  const portfolioBurn = runway.reduce((sum, row) => {
    const window = windowFor(row.card_account_id, row.cap_year);
    return (
      sum +
      computeBurnRate({
        windowStart: window.start,
        windowEnd: window.end,
        capUsed: Number(row.cap_used ?? 0),
        openingCounted: Number(row.opening_counted ?? 0),
        firstChargeOn: row.first_charge_on,
        asOf: today,
      }).perDay
    );
  }, 0);

  // Cards reset on different dates, so the portfolio view uses the soonest
  // window end rather than pretending they share one.
  const soonestWindowEnd = runway
    .map((row) => windowFor(row.card_account_id, row.cap_year).end)
    .sort()[0] ?? capYearWindow(capYear).end;

  const portfolioExhaust = projectExhaust({
    remainingRunway: totals.remaining,
    burnPerDay: portfolioBurn,
    asOf: today,
    windowEnd: soonestWindowEnd,
  });

  return (
    <Shell
      title="Points runway"
      subtitle={`Bonus-category spend against each card's cap for ${capYear}.`}
      actions={
        <div className="flex items-center gap-2 text-sm">
          <Link
            href={`/?year=${capYear - 1}`}
            className="rounded-lg border border-ink-700 px-2.5 py-1 text-ink-300 hover:border-ink-500"
          >
            ← {capYear - 1}
          </Link>
          <Link
            href={`/?year=${capYear + 1}`}
            className="rounded-lg border border-ink-700 px-2.5 py-1 text-ink-300 hover:border-ink-500"
          >
            {capYear + 1} →
          </Link>
        </div>
      }
    >
      {error ? (
        <p className="card mb-6 p-4 text-sm text-danger-400">
          Could not load cap runway: {error.message}
        </p>
      ) : null}

      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi
          label="Bonus points left"
          value={formatNumber(bonusAvailable)}
          hint="still capturable this year"
          tone={bonusAvailable > 0 ? "good" : "bad"}
        />
        <Kpi
          label="Runway left"
          value={formatMoney(totals.remaining)}
          hint={`across ${positions.length} card${positions.length === 1 ? "" : "s"}`}
        />
        <Kpi
          label="Points earned"
          value={formatNumber(totals.points)}
          hint={`${capYear} to date`}
        />
        <Kpi
          label="Spend past cap"
          value={formatMoney(totals.pastCap)}
          hint="earned the base rate"
          tone={totals.pastCap > 0 ? "warn" : "default"}
        />
        <Kpi
          label="Burn rate"
          value={`${formatMoney(portfolioBurn)}/day`}
          hint={
            portfolioExhaust.date && portfolioExhaust.withinCapYear
              ? `all caps full ${formatDate(portfolioExhaust.date)}`
              : portfolioExhaust.reason === "beyond_year"
                ? "caps reset before exhaustion"
                : "no spend logged yet"
          }
        />
      </section>

      <section className="card mb-6 flex flex-wrap items-center justify-between gap-4 border-accent-500/25 bg-accent-500/5 p-5">
        <div>
          <p className="text-xs uppercase tracking-wide text-accent-400">
            Route the next charge to
          </p>
          {recommendation.card ? (
            <>
              <p className="mt-1 text-xl font-semibold">{recommendation.card.nickname}</p>
              <p className="mt-0.5 text-sm text-ink-300">{recommendation.reason}</p>
            </>
          ) : (
            <>
              <p className="mt-1 text-xl font-semibold text-ink-300">No active card</p>
              <p className="mt-0.5 text-sm text-ink-500">{recommendation.reason}</p>
            </>
          )}
        </div>
        {recommendation.card ? (
          <div className="text-right">
            <p className="text-2xl font-semibold text-accent-400 tabular">
              {recommendation.rate}x
            </p>
            <p className="text-xs text-ink-500">on the next dollar</p>
          </div>
        ) : null}
      </section>

      <div className="mb-6">
        <ChargePlanner cards={positions} />
      </div>

      {runway.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-ink-300">No cap year is set up for {capYear}.</p>
          <p className="mt-1 text-sm text-ink-500">
            Cards appear here once they have a cap_years row for the year.
          </p>
        </div>
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {runway.map((row) => {
            const remaining = Number(row.remaining_runway ?? 0);
            const bonusRate = Number(row.bonus_multiplier ?? 1);
            const baseRate = Number(row.base_multiplier ?? 1);
            const window = windowFor(row.card_account_id, row.cap_year);
            const burn = computeBurnRate({
              windowStart: window.start,
              windowEnd: window.end,
              capUsed: Number(row.cap_used ?? 0),
              openingCounted: Number(row.opening_counted ?? 0),
              firstChargeOn: row.first_charge_on,
              asOf: today,
            });
            const exhaust = projectExhaust({
              remainingRunway: remaining,
              burnPerDay: burn.perDay,
              asOf: today,
              windowEnd: window.end,
            });
            const uplift = remaining * Math.max(0, bonusRate - baseRate);

            return (
              <article key={row.card_account_id} className="card flex flex-col gap-4 p-5">
                <header className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{row.nickname}</h2>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {accounts.get(row.card_account_id)?.product ?? "Card"}
                      {row.last4 ? ` · •••• ${row.last4}` : ""}
                      {row.entity ? ` · ${row.entity}` : ""}
                    </p>
                  </div>
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs ${
                      row.account_status === "active"
                        ? "bg-accent-500/15 text-accent-400"
                        : "bg-ink-800 text-ink-500"
                    }`}
                  >
                    {row.account_status}
                  </span>
                </header>

                <div>
                  <p className="text-3xl font-semibold tabular">{formatMoney(remaining)}</p>
                  <p className="text-xs text-ink-500">
                    remaining at {bonusRate}x
                    {uplift > 0 ? ` · ${formatNumber(uplift)} bonus points left` : ""}
                  </p>
                </div>

                <CapMeter
                  capUsed={Number(row.cap_used ?? 0)}
                  capAmount={Number(row.cap_amount ?? 0)}
                  spendPastCap={Number(row.spend_past_cap ?? 0)}
                />

                <dl className="grid grid-cols-2 gap-y-2 text-sm">
                  <dt className="text-ink-500">Cap year</dt>
                  <dd className="text-right tabular">
                    {formatDate(window.start)} – {formatDate(window.end)}
                  </dd>

                  <dt className="text-ink-500">Rates</dt>
                  <dd className="text-right tabular">
                    {bonusRate}x bonus / {baseRate}x base
                  </dd>

                  <dt className="text-ink-500">Burn rate</dt>
                  <dd className="text-right tabular">{formatMoney(burn.perDay)}/day</dd>

                  <dt className="text-ink-500">Projected exhaust</dt>
                  <dd className="text-right tabular">
                    {exhaust.reason === "already_exhausted" ? (
                      <span className="text-danger-400">cap reached</span>
                    ) : exhaust.reason === "no_burn" ? (
                      <span className="text-ink-500">—</span>
                    ) : exhaust.withinCapYear ? (
                      <span className={exhaust.daysRemaining! < 45 ? "text-warn-400" : ""}>
                        {formatDate(exhaust.date)}
                      </span>
                    ) : (
                      <span className="text-accent-400">not this year</span>
                    )}
                  </dd>

                  <dt className="text-ink-500">Points</dt>
                  <dd className="text-right tabular">{formatNumber(row.points)}</dd>

                  <dt className="text-ink-500">Charges</dt>
                  <dd className="text-right tabular">{formatNumber(row.charge_count)}</dd>
                </dl>

                {Number(row.opening_counted ?? 0) > 0 ? (
                  <p className="text-xs text-ink-500">
                    Includes {formatMoney(row.opening_counted)} opening balance
                    {row.opening_verified ? " (verified)" : " (unverified)"}.
                  </p>
                ) : row.opening_source === "suspected_duplicate" && !row.opening_verified ? (
                  <p className="text-xs text-warn-400">
                    Opening balance of {formatMoney(row.opening_cap_used)} is held out as a
                    suspected duplicate.
                  </p>
                ) : null}

                <MonthlyStrip byMonth={monthlyByAccount.get(row.card_account_id) ?? {}} />
              </article>
            );
          })}
        </section>
      )}
    </Shell>
  );
}
