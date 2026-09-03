import { requireAdmin, authErrorResponse } from "@/lib/auth";
import { isPlaidEnabled, plaidDisabledResponse } from "@/lib/plaid/client";
import { createServiceClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Points a connected Plaid account at one of our card accounts. */
export async function POST(request: Request) {
  try {
    if (!isPlaidEnabled()) return plaidDisabledResponse();
    await requireAdmin();

    const { plaidAccountId, cardAccountId } = (await request.json()) as {
      plaidAccountId?: string;
      cardAccountId?: string | null;
    };

    if (!plaidAccountId) {
      return Response.json({ error: "A Plaid account is required." }, { status: 400 });
    }

    const { error } = await createServiceClient()
      .from("plaid_accounts")
      .update({ card_account_id: cardAccountId || null })
      .eq("id", plaidAccountId);

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  } catch (error) {
    const authFailure = authErrorResponse(error);
    if (authFailure) return authFailure;
    return Response.json({ error: "Could not update the mapping." }, { status: 500 });
  }
}
