import { requireAdmin, authErrorResponse } from "@/lib/auth";
import {
  isPlaidEnabled,
  plaidDisabledResponse,
  plaidFetch,
  plaidRedirectUri,
} from "@/lib/plaid/client";

export const runtime = "nodejs";

/** Creates a short-lived Link token for the browser to open Plaid Link with. */
export async function POST() {
  try {
    if (!isPlaidEnabled()) return plaidDisabledResponse();
    const viewer = await requireAdmin();

    /*
     * Banks that use OAuth — Chase and Amex among them — send the user to
     * their own site and back. Plaid requires redirect_uri on every Link
     * session for those, and it must match a URI registered in the Plaid
     * dashboard exactly, which is why it comes from configuration rather than
     * from the request host: the vercel.app and custom domains would differ.
     */
    const redirectUri = plaidRedirectUri();

    const data = await plaidFetch<{ link_token: string; expiration: string }>(
      "/link/token/create",
      {
        user: { client_user_id: viewer.userId },
        client_name: "4x Cap Runway",
        products: ["transactions"],
        country_codes: ["US"],
        language: "en",
        ...(redirectUri ? { redirect_uri: redirectUri } : {}),
      },
    );

    return Response.json({ linkToken: data.link_token, expiration: data.expiration });
  } catch (error) {
    const authFailure = authErrorResponse(error);
    if (authFailure) return authFailure;

    console.error("Plaid link token failed", error);
    return Response.json({ error: "Could not start a Plaid link session." }, { status: 500 });
  }
}
