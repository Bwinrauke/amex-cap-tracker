import { Shell } from "@/components/Shell";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { plaidReadiness } from "@/lib/plaid/client";
import { formatDate } from "@/lib/format";
import { PlaidPanel } from "@/components/PlaidPanel";
import type { CardAccountRow, ImportBatchRow } from "@/lib/database.types";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const readiness = plaidReadiness();
  const enabled = readiness.ready;
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
            {enabled ? "enabled" : readiness.enabled ? "misconfigured" : "disabled"}
          </span>
        </header>

        {enabled ? (
          <PlaidPanel
            plaidAccounts={plaidAccounts}
            cardAccounts={accounts}
            isAdmin={viewer?.role === "admin"}
          />
        ) : (
          <div className="space-y-3 rounded-lg border border-ink-800 bg-ink-950 p-4 text-sm text-ink-500">
            {!readiness.enabled ? (
              <p>
                <code className="text-ink-300">PLAID_ENABLED</code> is not set to{" "}
                <code className="text-ink-300">true</code> in this deployment. Set it, then
                redeploy — environment changes do not apply to an existing build.
              </p>
            ) : null}

            {readiness.missing.length > 0 ? (
              <div>
                <p className="text-ink-300">Not set in this deployment:</p>
                <ul className="mt-1 list-inside list-disc">
                  {readiness.missing.map((name) => (
                    <li key={name}>
                      <code>{name}</code>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {readiness.invalid.length > 0 ? (
              <div>
                <p className="text-danger-400">Set but unusable:</p>
                <ul className="mt-1 list-inside list-disc text-danger-400">
                  {readiness.invalid.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p>
              Access tokens are encrypted with AES-256-GCM before storage, and the token table is
              unreadable except by the service role — which is why{" "}
              <code className="text-ink-300">SUPABASE_SERVICE_ROLE_KEY</code> is required. Keep it
              server-side; never give it a <code className="text-ink-300">NEXT_PUBLIC_</code> prefix.
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
