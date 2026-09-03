import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Magic-link landing point. Exchanges the one-time code for a session and
 * drops the user where they were headed.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  // Only ever redirect within this app.
  const destination = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Behind a proxy, honour the forwarded host so the redirect keeps the
      // user on the deployed domain rather than the internal one.
      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocal = process.env.NODE_ENV === "development";
      const base = isLocal || !forwardedHost ? origin : `https://${forwardedHost}`;
      return NextResponse.redirect(`${base}${destination}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/auth-code-error`);
}
