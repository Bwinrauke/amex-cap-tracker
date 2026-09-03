import { Shell } from "@/components/Shell";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ImportWizard } from "./ImportWizard";
import type { CardAccountRow } from "@/lib/database.types";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const viewer = await getViewer();
  const supabase = await createClient();

  const { data } = await supabase
    .from("card_accounts")
    .select("id, nickname, last4")
    .neq("status", "closed")
    .order("sort_order");

  const accounts = (data ?? []) as Pick<CardAccountRow, "id" | "nickname" | "last4">[];

  return (
    <Shell
      title="Import charges"
      subtitle="Upload a card statement CSV. Nothing is written until you review the preview and commit."
    >
      {viewer?.role !== "admin" ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-ink-300">Importing requires an admin account.</p>
          <p className="mt-1 text-sm text-ink-500">
            You have read-only access, so you can view charges but not add them.
          </p>
        </div>
      ) : (
        <ImportWizard accounts={accounts} />
      )}
    </Shell>
  );
}
