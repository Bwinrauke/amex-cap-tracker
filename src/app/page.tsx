import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { CapMeter } from "@/components/CapMeter";
import { Kpi } from "@/components/Kpi";
import { MonthlyStrip } from "@/components/MonthlyStrip";
import { computeBurnRate, projectExhaust, recommendRouting } from "@/lib/cap";
import { formatDate, formatMoney, formatNumber, todayIso } from "@/lib/format";
import type { CapRunwayRow, MonthlySpendRow } from "@/lib/database.types";

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
  const [{ data: runwayData, error }, { data: monthlyData }] = await Promise.all([
    supabase
      .from("v_cap_runway")
      .select("*")
      .eq("cap_year", capYear)
      .order("sort_order", { ascending: true }),
    supabase.from("v_monthly_spend").select("*").eq("cap_year", capYear),
  ]);

  const runway = (runwayData ?? []) as CapRunwayRow[];
  const monthly = (monthlyData ?? []) as MonthlySpendRow[];

  const monthlyByAccount = new Map<string, Record<number, number>>();
  for (const row of monthly) {
    const current = monthlyByAccount.get(row.card_account_id) ?? {};
    current[row.month] = Number(row.eligible_spend ?? 0);
    monthlyByAccount.set(row.card_account_id, current);
  }

  const totals = runway.reduce(
    (acc, row) => ({
      capUsed: acc.capUsed + Number(row.cap_used ?? 0),
      capAmount: acc.capAmount + Number(row.cap_amount ?? 0),
      remaining: acc.remaining + Number(row.remaining_runway ?? 0),
      points: acc.points + Number(row.points ?? 0),
      pastCap: acc.pastCap + Number(row.spend_past_cap ?? 0),
      charges: acc.charges + Number(row.charge_count ?? 0),
    }),
    { capUsed: 0, capAmount: 0, remaining: 0, points: 0, pastCap: 0, charges: 0 },
  );

  const recommendation = recommendRouting(
    runway.map((row) => ({
      cardAccountId: row.card_account_id,
      nickname: row.nickname,
      remainingRunway: Number(row.remaining_runway ?? 0),
      accountStatus: row.account_status,
    })),
  );

  const portfolioBurn = runway.reduce(
    (sum, row) =>
      sum +
      computeBurnRate({
        capYear,
        capUsed: Number(row.cap_used ?? 0),
        openingCounted: Number(row.opening_counted ?? 0),
        firstChargeOn: row.first_charge_on,
        asOf: today,
      }).perDay,
    0,
  );

  const portfolioExhaust = projectExhaust({
    remainingRunway: totals.remaining,
    burnPerDay: portfolioBurn,
    asOf: today,
    capYear,
  });

  return (
    <Shell
      title="Cap runway"
      subtitle={`Amex Business Gold 4x bonus spend for ${capYear}.`}
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
          label="Runway left"
          value={formatMoney(totals.remaining)}
          hint={`across ${runway.length} account${runway.length === 1 ? "" : "s"}`}
          tone={totals.remaining > 0 ? "good" : "bad"}
        />
        <Kpi
          label="4x spend used"
          value={formatMoney(totals.capUsed)}
          hint={`of ${formatMoney(totals.capAmount)} combined cap`}
        />
        <Kpi label="Points earned" value={formatNumber(totals.points)} hint={`${capYear} to date`} />
        <Kpi
          label="Spend past cap"
          value={formatMoney(totals.pastCap)}
          hint="earning 1x instead of 4x"
          tone={totals.pastCap > 0 ? "warn" : "default"}
        />
        <Kpi
          label="Burn rate"
          value={`${formatMoney(portfolioBurn)}/day`}
          hint={
            portfolioExhaust.date && portfolioExhaust.withinCapYear
              ? `all caps full ${formatDate(portfolioExhaust.date)}`
              : portfolioExhaust.reason === "beyond_year"
                ? "cap resets before exhaustion"
                : "no spend logged yet"
          }
        />
      </section>

      <section className="card mb-6 flex flex-wrap items-center justify-between gap-4 border-accent-500/25 bg-accent-500/5 p-5">
        <div>
          <p className="text-xs uppercase tracking-wide text-accent-400">Route the next charge to</p>
          {recommendation.account ? (
            <>
              <p className="mt-1 text-xl font-semibold">{recommendation.account.nickname}</p>
              <p className="mt-0.5 text-sm text-ink-300">{recommendation.reason}</p>
            </>
          ) : (
            <>
              <p className="mt-1 text-xl font-semibold text-ink-300">No account with runway</p>
              <p className="mt-0.5 text-sm text-ink-500">{recommendation.reason}</p>
            </>
          )}
        </div>
        {recommendation.account ? (
          <div className="text-right">
            <p className="text-2xl font-semibold text-accent-400 tabular">
              {formatMoney(recommendation.account.remainingRunway)}
            </p>
            <p className="text-xs text-ink-500">still at 4x</p>
          </div>
        ) : null}
      </section>

      {runway.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-ink-300">No cap year is set up for {capYear}.</p>
          <p className="mt-1 text-sm text-ink-500">
            Accounts appear here once they have a cap_years row for the year.
          </p>
        </div>
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {runway.map((row) => {
            const remaining = Number(row.remaining_runway ?? 0);
            const burn = computeBurnRate({
              capYear,
              capUsed: Number(row.cap_used ?? 0),
              openingCounted: Number(row.opening_counted ?? 0),
              firstChargeOn: row.first_charge_on,
              asOf: today,
            });
            const exhaust = projectExhaust({
              remainingRunway: remaining,
              burnPerDay: burn.perDay,
              asOf: today,
              capYear,
            });

            return (
              <article key={row.card_account_id} className="card flex flex-col gap-4 p-5">
                <header className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{row.nickname}</h2>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {row.last4 ? `•••• ${row.last4}` : "no last4"}
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
                  <p className="text-xs text-ink-500">remaining at {row.bonus_multiplier}x</p>
                </div>

                <CapMeter
                  capUsed={Number(row.cap_used ?? 0)}
                  capAmount={Number(row.cap_amount ?? 0)}
                  spendPastCap={Number(row.spend_past_cap ?? 0)}
                />

                <dl className="grid grid-cols-2 gap-y-2 text-sm">
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
