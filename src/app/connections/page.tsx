import { Shell } from "@/components/Shell";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isPlaidEnabled } from "@/lib/plaid/client";
import { formatDate } from "@/lib/format";
import type { CardAccountRow, ImportBatchRow } from "@/lib/database.types";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const enabled = isPlaidEnabled();
  const viewer = await getViewer();
  const supabase = await createClient();

  const [{ data: batchData }, { data: accountData }, plaidAccountsResult] = await Promise.all([
    supabase
      .from("import_batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(15),
    supabase.from("card_accounts").select("id, nickname").order("sort_order"),
    // Readable by any member; empty when Plaid has never been connected.
    supabase.from("plaid_accounts").select("*"),
  ]);

  const batches = (batchData ?? []) as ImportBatchRow[];
  const accounts = (accountData ?? []) as Pick<CardAccountRow, "id" | "nickname">[];
  const accountName = new Map(accounts.map((a) => [a.id, a.nickname]));
  const plaidAccounts = plaidAccountsResult.data ?? [];

  return (
    <Shell
      title="Connections"
      subtitle="Where charge data comes from: CSV imports today, Plaid when it is switched on."
    >
      <section className="card mb-6 p-5">
        <header className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Plaid</h2>
            <p className="mt-0.5 text-sm text-ink-500">
              Automatic transaction sync from the card issuer.
            </p>
          </div>
          <span
            className={`rounded-md px-2 py-0.5 text-xs ${
              enabled ? "bg-accent-500/15 text-accent-400" : "bg-ink-800 text-ink-500"
            }`}
          >
            {enabled ? "enabled" : "disabled"}
          </span>
        </header>

        {enabled ? (
          plaidAccounts.length === 0 ? (
            <p className="text-sm text-ink-500">
              No institution is connected yet. An admin can link one from Plaid Link.
            </p>
          ) : (
            <ul className="divide-y divide-ink-850 text-sm">
              {plaidAccounts.map((account) => (
                <li key={account.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span>
                    {account.name ?? "Account"}
                    {account.mask ? ` ••••${account.mask}` : ""}
                  </span>
                  <span className="text-ink-500">
                    {account.card_account_id
                      ? `→ ${accountName.get(account.card_account_id) ?? "unknown"}`
                      : "not mapped"}
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : (
          <div className="rounded-lg border border-ink-800 bg-ink-950 p-4 text-sm text-ink-500">
            <p>
              Plaid is off by default. To turn it on, set <code className="text-ink-300">PLAID_ENABLED=true</code>{" "}
              along with <code className="text-ink-300">PLAID_CLIENT_ID</code>,{" "}
              <code className="text-ink-300">PLAID_SECRET</code>,{" "}
              <code className="text-ink-300">PLAID_TOKEN_ENCRYPTION_KEY</code> and{" "}
              <code className="text-ink-300">SUPABASE_SERVICE_ROLE_KEY</code>.
            </p>
            <p className="mt-2">
              Access tokens are encrypted with AES-256-GCM before they are stored, and the token
              table is unreadable except by the service role.
            </p>
          </div>
        )}
      </section>

      <section className="card p-5">
        <h2 className="font-semibold">Recent imports</h2>
        <p className="mt-0.5 mb-4 text-sm text-ink-500">
          Every committed batch keeps its raw rows, so an import can always be traced back to the
          file it came from.
        </p>

        {batches.length === 0 ? (
          <p className="text-sm text-ink-500">Nothing has been imported yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-ink-800 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="py-2 pr-4 font-medium">File</th>
                  <th className="py-2 pr-4 font-medium">Account</th>
                  <th className="py-2 pr-4 font-medium">When</th>
                  <th className="py-2 pr-4 text-right font-medium">Rows</th>
                  <th className="py-2 pr-4 text-right font-medium">Inserted</th>
                  <th className="py-2 pr-4 text-right font-medium">Duplicates</th>
                  <th className="py-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.id} className="border-b border-ink-850 last:border-0">
                    <td className="py-2.5 pr-4">
                      <span className="block max-w-[220px] truncate">
                        {batch.filename ?? "—"}
                      </span>
                      <span className="text-xs text-ink-500">{batch.source}</span>
                    </td>
                    <td className="py-2.5 pr-4 text-ink-300">
                      {batch.card_account_id
                        ? (accountName.get(batch.card_account_id) ?? "—")
                        : "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-ink-300 tabular">
                      {formatDate(batch.created_at.slice(0, 10))}
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular">{batch.raw_row_count}</td>
                    <td className="py-2.5 pr-4 text-right tabular text-accent-400">
                      {batch.inserted_count}
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular text-ink-500">
                      {batch.duplicate_count}
                    </td>
                    <td className="py-2.5 text-right">
                      <span
                        className={`rounded-md px-2 py-0.5 text-xs ${
                          batch.status === "committed"
                            ? "bg-accent-500/15 text-accent-400"
                            : batch.status === "discarded"
                              ? "bg-danger-400/15 text-danger-400"
                              : "bg-ink-800 text-ink-500"
                        }`}
                      >
                        {batch.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {viewer?.role !== "admin" ? (
        <p className="mt-5 text-xs text-ink-500">
          Connections are managed by an admin.
        </p>
      ) : null}
    </Shell>
  );
}
