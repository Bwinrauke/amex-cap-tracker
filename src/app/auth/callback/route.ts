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

  const fail = (reason: string) =>
    NextResponse.redirect(
      `${origin}/auth/auth-code-error?reason=${encodeURIComponent(reason)}`,
    );

  // Supabase reports a refused or expired link by redirecting here with an
  // error rather than a code. Surfacing it beats a blank "didn't work".
  const providerError = searchParams.get("error_description") ?? searchParams.get("error");
  if (providerError) return fail(providerError);

  if (!code) {
    return fail(
      "The link carried no sign-in code. That usually means this URL is not in the " +
        "Supabase project's Redirect URLs, so the link was sent somewhere else.",
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) return fail(error.message);

  // Behind a proxy, honour the forwarded host so the redirect keeps the
  // user on the deployed domain rather than the internal one.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const isLocal = process.env.NODE_ENV === "development";
  const base = isLocal || !forwardedHost ? origin : `https://${forwardedHost}`;
  return NextResponse.redirect(`${base}${destination}`);
}
