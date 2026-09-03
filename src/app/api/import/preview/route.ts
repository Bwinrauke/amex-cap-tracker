import { createClient } from "@/lib/supabase/server";
import { requireAdmin, authErrorResponse } from "@/lib/auth";
import { buildPreview, sha256 } from "@/lib/import/build";
import { readImportForm, loadImportContext } from "../shared";

export const runtime = "nodejs";

/**
 * Phase one of the import: parse, classify and diff.
 *
 * Writes nothing at all — not the batch, not the raw rows, not the charges.
 * The user sees exactly what would land before anything does.
 */
export async function POST(request: Request) {
  try {
    await requireAdmin();

    const form = await readImportForm(request);
    if ("error" in form) return form.error;

    const supabase = await createClient();
    const context = await loadImportContext(supabase, form.cardAccountId);
    if ("error" in context) return context.error;

    const preview = buildPreview({
      csvText: form.csvText,
      rules: context.rules,
      existing: context.existing,
      capYears: context.capYears,
      capUsedByYear: context.capUsedByYear,
      cardBonusCategories: context.cardAccount.bonus_categories,
    });

    return Response.json({
      cardAccount: context.cardAccount,
      filename: form.filename,
      fileSha256: sha256(form.csvText),
      layout: preview.layout,
      rows: preview.rows,
      skipped: preview.skipped,
      summary: preview.summary,
    });
  } catch (error) {
    const authFailure = authErrorResponse(error);
    if (authFailure) return authFailure;

    console.error("Import preview failed", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not read that file." },
      { status: 500 },
    );
  }
}
