import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { formatDate, formatMoney, formatMoneyCents, formatNumber, todayIso } from "@/lib/format";
import type { CardAccountRow, ChargeAllocationRow } from "@/lib/database.types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function ChargesPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; account?: string; page?: string; eligible?: string }>;
}) {
  const params = await searchParams;
  const capYear = Number(params.year) || Number(todayIso().slice(0, 4));
  const page = Math.max(1, Number(params.page) || 1);
  const accountFilter = params.account ?? "";
  const eligibleOnly = params.eligible === "1";

  const supabase = await createClient();

  const { data: accountData } = await supabase
    .from("card_accounts")
    .select("id, nickname, last4")
    .order("sort_order");
  const accounts = (accountData ?? []) as Pick<CardAccountRow, "id" | "nickname" | "last4">[];

  // v_charge_allocation already carries the 4x/1x split per charge.
  let query = supabase
    .from("v_charge_allocation")
    .select("*", { count: "exact" })
    .eq("cap_year", capYear)
    .order("posted_on", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (accountFilter) query = query.eq("card_account_id", accountFilter);
  if (eligibleOnly) query = query.eq("counts_toward_cap", true);

  const { data, count, error } = await query;
  const charges = (data ?? []) as ChargeAllocationRow[];
  const accountName = new Map(accounts.map((a) => [a.id, a.nickname]));
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  const buildHref = (next: Record<string, string | number | undefined>) => {
    const search = new URLSearchParams();
    search.set("year", String(next.year ?? capYear));
    if (next.account ?? accountFilter) search.set("account", String(next.account ?? accountFilter));
    if (next.eligible ?? (eligibleOnly ? "1" : "")) {
      search.set("eligible", String(next.eligible ?? "1"));
    }
    if (next.page && Number(next.page) > 1) search.set("page", String(next.page));
    return `/charges?${search.toString()}`;
  };

  return (
    <Shell
      title="Charge log"
      subtitle={`Every ${capYear} charge with its 4x / 1x split, straight from v_charge_allocation.`}
    >
      <form className="card mb-5 flex flex-wrap items-end gap-3 p-4" method="get">
        <div>
          <label htmlFor="year" className="mb-1 block text-xs text-ink-500">
            Cap year
          </label>
          <input
            id="year"
            name="year"
            type="number"
            defaultValue={capYear}
            className="w-28 rounded-lg border border-ink-700 bg-ink-950 px-2.5 py-1.5 text-sm outline-none focus:border-brand-500"
          />
        </div>
        <div>
          <label htmlFor="account" className="mb-1 block text-xs text-ink-500">
            Account
          </label>
          <select
            id="account"
            name="account"
            defaultValue={accountFilter}
            className="rounded-lg border border-ink-700 bg-ink-950 px-2.5 py-1.5 text-sm outline-none focus:border-brand-500"
          >
            <option value="">All accounts</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.nickname}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 pb-1.5 text-sm text-ink-300">
          <input
            type="checkbox"
            name="eligible"
            value="1"
            defaultChecked={eligibleOnly}
            className="h-4 w-4 accent-green-500"
          />
          4x eligible only
        </label>
        <button
          type="submit"
          className="rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:border-ink-500 hover:text-ink-100"
        >
          Apply
        </button>
      </form>

      {error ? (
        <p className="card p-4 text-sm text-danger-400">Could not load charges: {error.message}</p>
      ) : charges.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-500">
          No charges for {capYear}.{" "}
          <Link href="/import" className="text-brand-400 hover:underline">
            Import a statement
          </Link>
          .
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-ink-800 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Merchant</th>
                  <th className="px-4 py-3 font-medium">Account</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 text-right font-medium">Amount</th>
                  <th className="px-4 py-3 text-right font-medium">At 4x</th>
                  <th className="px-4 py-3 text-right font-medium">At 1x</th>
                  <th className="px-4 py-3 text-right font-medium">Points</th>
                </tr>
              </thead>
              <tbody>
                {charges.map((charge) => (
                  <tr
                    key={charge.id}
                    className="border-b border-ink-850 last:border-0 hover:bg-ink-850/50"
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 text-ink-300 tabular">
                      {formatDate(charge.posted_on)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="block max-w-[240px] truncate" title={charge.descriptor ?? ""}>
                        {charge.merchant}
                      </span>
                      {charge.status !== "posted" ? (
                        <span className="text-xs text-warn-400">{charge.status}</span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-ink-300">
                      {accountName.get(charge.card_account_id) ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      {charge.counts_toward_cap ? (
                        <span className="rounded-md bg-accent-500/15 px-2 py-0.5 text-xs text-accent-400">
                          {charge.category ?? "eligible"}
                        </span>
                      ) : (
                        <span className="text-xs text-ink-500">{charge.category ?? "—"}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular">
                      {formatMoneyCents(charge.amount)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular text-accent-400">
                      {Number(charge.amount_at_bonus) > 0
                        ? formatMoneyCents(charge.amount_at_bonus)
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular text-ink-300">
                      {Number(charge.amount_at_base) > 0
                        ? formatMoneyCents(charge.amount_at_base)
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular">
                      {formatNumber(charge.points)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-ink-800 px-4 py-3 text-xs text-ink-500">
            <span>
              {formatNumber(count ?? 0)} charge{count === 1 ? "" : "s"} · page {page} of{" "}
              {totalPages}
            </span>
            <span className="flex gap-2">
              {page > 1 ? (
                <Link href={buildHref({ page: page - 1 })} className="text-brand-400 hover:underline">
                  ← Previous
                </Link>
              ) : null}
              {page < totalPages ? (
                <Link href={buildHref({ page: page + 1 })} className="text-brand-400 hover:underline">
                  Next →
                </Link>
              ) : null}
            </span>
          </div>
        </div>
      )}
    </Shell>
  );
}
