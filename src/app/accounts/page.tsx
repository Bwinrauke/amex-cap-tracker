import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/auth";
import { Shell } from "@/components/Shell";
import { CapMeter } from "@/components/CapMeter";
import { formatDate, formatMoney, formatNumber, todayIso } from "@/lib/format";
import type { CapRunwayRow, CapYearRow, CardAccountRow, EntityRow } from "@/lib/database.types";

export const dynamic = "force-dynamic";

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const params = await searchParams;
  const capYear = Number(params.year) || Number(todayIso().slice(0, 4));

  const supabase = await createClient();
  const viewer = await getViewer();

  const [accountsResult, entitiesResult, capYearsResult, runwayResult] = await Promise.all([
    supabase.from("card_accounts").select("*").order("sort_order"),
    supabase.from("entities").select("*"),
    supabase.from("cap_years").select("*").eq("year", capYear),
    supabase.from("v_cap_runway").select("*").eq("cap_year", capYear),
  ]);

  const accounts = (accountsResult.data ?? []) as CardAccountRow[];
  const entities = (entitiesResult.data ?? []) as EntityRow[];
  const capYears = (capYearsResult.data ?? []) as CapYearRow[];
  const runway = (runwayResult.data ?? []) as CapRunwayRow[];

  const entityName = new Map(entities.map((e) => [e.id, e.name]));
  const capByAccount = new Map(capYears.map((c) => [c.card_account_id, c]));
  const runwayByAccount = new Map(runway.map((r) => [r.card_account_id, r]));

  return (
    <Shell
      title="Card accounts"
      subtitle={`Cap configuration for ${capYear}. Each card carries its own bonus rate and annual cap.`}
    >
      {viewer?.role !== "admin" ? (
        <p className="card mb-5 p-3 text-xs text-ink-500">
          You have read-only access. Account and cap settings are managed by an admin.
        </p>
      ) : null}

      {accounts.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-500">
          No card accounts are set up yet.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {accounts.map((account) => {
            const cap = capByAccount.get(account.id);
            const position = runwayByAccount.get(account.id);

            return (
              <article key={account.id} className="card p-5">
                <header className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{account.nickname}</h2>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {account.product}
                      {account.last4 ? ` · •••• ${account.last4}` : ""}
                      {account.entity_id ? ` · ${entityName.get(account.entity_id) ?? "—"}` : ""}
                    </p>
                  </div>
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs ${
                      account.status === "active"
                        ? "bg-accent-500/15 text-accent-400"
                        : "bg-ink-800 text-ink-500"
                    }`}
                  >
                    {account.status}
                  </span>
                </header>

                {position ? (
                  <div className="mb-4">
                    <CapMeter
                      capUsed={Number(position.cap_used ?? 0)}
                      capAmount={Number(position.cap_amount ?? 0)}
                      spendPastCap={Number(position.spend_past_cap ?? 0)}
                    />
                  </div>
                ) : (
                  <p className="mb-4 text-xs text-warn-400">
                    No cap year configured for {capYear}, so this account is not tracked yet.
                  </p>
                )}

                <dl className="grid grid-cols-2 gap-y-2 text-sm">
                  <dt className="text-ink-500">Cap</dt>
                  <dd className="text-right tabular">
                    {cap ? formatMoney(cap.cap_amount) : "—"}
                  </dd>

                  <dt className="text-ink-500">Multipliers</dt>
                  <dd className="text-right tabular">
                    {cap ? `${cap.bonus_multiplier}x / ${cap.base_multiplier}x` : "—"}
                  </dd>

                  <dt className="text-ink-500">Opening cap used</dt>
                  <dd className="text-right tabular">
                    {cap ? formatMoney(cap.opening_cap_used) : "—"}
                    {cap && cap.opening_cap_used > 0 ? (
                      <span className="ml-1 text-xs text-ink-500">({cap.opening_source})</span>
                    ) : null}
                  </dd>

                  <dt className="text-ink-500">Opening verified</dt>
                  <dd className="text-right">
                    {cap ? (
                      cap.opening_verified ? (
                        <span className="text-accent-400">yes</span>
                      ) : (
                        <span className="text-warn-400">no</span>
                      )
                    ) : (
                      "—"
                    )}
                  </dd>

                  <dt className="text-ink-500">Statement closes</dt>
                  <dd className="text-right tabular">
                    {account.statement_close_day ? `day ${account.statement_close_day}` : "—"}
                  </dd>

                  <dt className="text-ink-500">Opened</dt>
                  <dd className="text-right tabular">{formatDate(account.opened_on)}</dd>

                  <dt className="text-ink-500">Charges logged</dt>
                  <dd className="text-right tabular">
                    {position ? formatNumber(position.charge_count) : "0"}
                  </dd>
                </dl>

                {account.notes ? (
                  <p className="mt-4 border-t border-ink-800 pt-3 text-xs text-ink-500">
                    {account.notes}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
