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
    // Authenticated but no profile row (the handle_new_user trigger should
    // have made one). Treat as least privilege rather than failing open.
    return { userId: user.id, email: user.email ?? "", role: "viewer" };
  }

  return { userId: profile.id, email: profile.email, role: profile.role };
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
