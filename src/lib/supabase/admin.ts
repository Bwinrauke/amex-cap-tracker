import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Service-role client. Bypasses RLS, so it is only used where RLS makes a
 * table unreachable by design: plaid_items has RLS on with no policies
 * (deny-all for anon and authenticated) because it holds bank credentials.
 *
 * Never import this into client code, and always check the caller's role
 * with requireAdmin() before using it.
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. It is required for Plaid, whose " +
        "token store is service-role only.",
    );
  }

  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
