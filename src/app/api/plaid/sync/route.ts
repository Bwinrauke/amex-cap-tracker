import { requireAdmin, authErrorResponse } from "@/lib/auth";
import { accessTokenFor, isPlaidEnabled, plaidDisabledResponse, plaidFetch } from "@/lib/plaid/client";
import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { classifyCharge } from "@/lib/classify";
import type { ChargeInsert, MerchantRuleRow } from "@/lib/database.types";

export const runtime = "nodejs";

interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  date: string;
  name: string;
  merchant_name: string | null;
  /** Positive when money leaves the account; negative for a refund. */
  amount: number;
  pending: boolean;
}

/**
 * Pulls new transactions for every connected item and files them as charges.
 *
 * Idempotent for the same reason the CSV import is: the Plaid transaction id
 * goes in `reference`, so the fingerprint trigger derives a stable
 * `ref:<id>` key and the upsert ignores anything already stored.
 */
export async function POST() {
  try {
    if (!isPlaidEnabled()) return plaidDisabledResponse();
    await requireAdmin();

    const admin = createServiceClient();
    const supabase = await createClient();

    const [{ data: items }, { data: plaidAccounts }, { data: rulesData }] = await Promise.all([
      admin.from("plaid_items").select("*"),
      admin.from("plaid_accounts").select("account_id, card_account_id"),
      supabase.from("merchant_rules").select("*"),
    ]);

    const rules = (rulesData ?? []) as MerchantRuleRow[];
    const cardAccountFor = new Map(
      (plaidAccounts ?? [])
        .filter((a) => a.card_account_id)
        .map((a) => [a.account_id, a.card_account_id as string]),
    );

    let inserted = 0;
    let unmapped = 0;
    const errors: string[] = [];

    for (const item of items ?? []) {
      try {
        let cursor = item.sync_cursor ?? undefined;
        let hasMore = true;
        const added: PlaidTransaction[] = [];

        while (hasMore) {
          const page = await plaidFetch<{
            added: PlaidTransaction[];
            next_cursor: string;
            has_more: boolean;
          }>("/transactions/sync", {
            access_token: accessTokenFor(item),
            cursor,
            count: 500,
          });

          added.push(...page.added);
          cursor = page.next_cursor;
          hasMore = page.has_more;
        }

        const payload: ChargeInsert[] = [];
        for (const transaction of added) {
          const cardAccountId = cardAccountFor.get(transaction.account_id);
          if (!cardAccountId) {
            unmapped++;
            continue;
          }

          const merchant = transaction.merchant_name ?? transaction.name;
          const classification = classifyCharge(
            { merchant, descriptor: transaction.name },
            rules,
          );

          payload.push({
            card_account_id: cardAccountId,
            posted_on: transaction.date,
            merchant: classification.merchant,
            descriptor: transaction.name,
            // charges.amount is positive; the direction lives in status.
            amount: Math.abs(transaction.amount),
            category: classification.category,
            counts_toward_cap: classification.countsTowardCap,
            status:
              transaction.amount < 0 ? "refunded" : transaction.pending ? "pending" : "posted",
            reference: transaction.transaction_id,
            source: "plaid",
            batch_id: null,
            occurrence: 1,
            plaid_transaction_id: transaction.transaction_id,
          });
        }

        for (let i = 0; i < payload.length; i += 500) {
          const { data, error } = await supabase
            .from("charges")
            .upsert(payload.slice(i, i + 500), {
              onConflict: "card_account_id,fingerprint",
              ignoreDuplicates: true,
            })
            .select("id");

          if (error) throw new Error(error.message);
          inserted += data?.length ?? 0;
        }

        await admin
          .from("plaid_items")
          .update({
            sync_cursor: cursor,
            last_synced_at: new Date().toISOString(),
            status: "good",
            last_error: null,
          })
          .eq("id", item.id);
      } catch (itemError) {
        const message = itemError instanceof Error ? itemError.message : "Sync failed.";
        errors.push(`${item.institution_name ?? item.item_id}: ${message}`);
        await admin
          .from("plaid_items")
          .update({ status: "error", last_error: message })
          .eq("id", item.id);
      }
    }

    return Response.json({ inserted, unmapped, errors });
  } catch (error) {
    const authFailure = authErrorResponse(error);
    if (authFailure) return authFailure;

    console.error("Plaid sync failed", error);
    return Response.json({ error: "Sync failed." }, { status: 500 });
  }
}
