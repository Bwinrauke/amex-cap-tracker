import { requireAdmin, authErrorResponse } from "@/lib/auth";
import { isPlaidEnabled, plaidDisabledResponse, plaidFetch } from "@/lib/plaid/client";
import { encryptToken } from "@/lib/crypto";
import { createServiceClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Swaps a Link public token for a long-lived access token and stores it
 * encrypted.
 *
 * plaid_items is deny-all under RLS, so this uses the service-role client —
 * only after requireAdmin() has confirmed the caller.
 */
export async function POST(request: Request) {
  try {
    if (!isPlaidEnabled()) return plaidDisabledResponse();
    await requireAdmin();

    const { publicToken } = (await request.json()) as { publicToken?: string };
    if (!publicToken) {
      return Response.json({ error: "A public token is required." }, { status: 400 });
    }

    const exchanged = await plaidFetch<{ access_token: string; item_id: string }>(
      "/item/public_token/exchange",
      { public_token: publicToken },
    );

    const institution = await plaidFetch<{
      item: { institution_id: string | null };
    }>("/item/get", { access_token: exchanged.access_token });

    const admin = createServiceClient();

    const { data: item, error: itemError } = await admin
      .from("plaid_items")
      .upsert(
        {
          item_id: exchanged.item_id,
          // The raw token never touches the database.
          access_token_encrypted: encryptToken(exchanged.access_token),
          institution_id: institution.item.institution_id,
          status: "good",
        },
        { onConflict: "item_id" },
      )
      .select()
      .single();

    if (itemError || !item) {
      return Response.json(
        { error: itemError?.message ?? "Could not store the connection." },
        { status: 500 },
      );
    }

    const accounts = await plaidFetch<{
      accounts: {
        account_id: string;
        name: string | null;
        mask: string | null;
        official_name: string | null;
        subtype: string | null;
      }[];
    }>("/accounts/get", { access_token: exchanged.access_token });

    if (accounts.accounts.length > 0) {
      const { error: accountsError } = await admin.from("plaid_accounts").upsert(
        accounts.accounts.map((account) => ({
          plaid_item_id: item.id,
          account_id: account.account_id,
          name: account.name,
          mask: account.mask,
          official_name: account.official_name,
          subtype: account.subtype,
        })),
        { onConflict: "account_id" },
      );

      if (accountsError) {
        return Response.json({ error: accountsError.message }, { status: 500 });
      }
    }

    return Response.json({ itemId: item.id, accounts: accounts.accounts.length });
  } catch (error) {
    const authFailure = authErrorResponse(error);
    if (authFailure) return authFailure;

    console.error("Plaid exchange failed", error);
    return Response.json({ error: "Could not complete the Plaid connection." }, { status: 500 });
  }
}
