import { createClient } from "@/lib/supabase/server";
import type { ProfileRow } from "@/lib/database.types";

export type Viewer = { userId: string; email: string; role: ProfileRow["role"] };

/**
 * Resolves the caller's profile row. Returns null when there is no session.
 *
 * The role is read from the database rather than the JWT so a role change
 * takes effect immediately, without waiting for the token to refresh.
 */
export async function getViewer(): Promise<Viewer | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    // Signed in but not on the allow-list: handle_new_user() deliberately
    // withholds a profile, and every RLS policy gates on having one. Grant
    // nothing rather than falling back to a viewer.
    return null;
  }

  return { userId: profile.id, email: profile.email, role: profile.role };
}

/**
 * The authenticated user, whether or not they are allowed in. Used only to
 * tell "never signed in" apart from "signed in but not permitted", so each
 * gets the right page instead of a redirect loop.
 */
export async function getAuthUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Gate for every write path. RLS already refuses non-admin writes, but
 * checking here means a viewer gets a clean 403 instead of a partially
 * applied batch failing halfway through.
 */
export async function requireAdmin(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) throw new AuthError("Not signed in.", 401);
  if (viewer.role !== "admin") {
    throw new AuthError("This action requires an admin account.", 403);
  }
  return viewer;
}

export function authErrorResponse(error: unknown): Response | null {
  if (error instanceof AuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return null;
}
