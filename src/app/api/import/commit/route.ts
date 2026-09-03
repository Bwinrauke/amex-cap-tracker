import { createClient } from "@/lib/supabase/server";
import { requireAdmin, authErrorResponse } from "@/lib/auth";
import { buildPreview, sha256, toChargeInsert } from "@/lib/import/build";
import { readImportForm, loadImportContext } from "../shared";

export const runtime = "nodejs";

/**
 * Phase two: write only the rows the user ticked.
 *
 * The file is re-parsed here rather than trusting a payload round-tripped
 * through the browser, so what lands is exactly what the parser produced.
 * The client only gets to say which line numbers it wants, plus category and
 * eligibility overrides.
 */
export async function POST(request: Request) {
  try {
    const viewer = await requireAdmin();

    const form = await readImportForm(request);
    if ("error" in form) return form.error;
    if (form.selected === null) {
      return Response.json({ error: "Nothing was selected to import." }, { status: 400 });
    }

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

    const wanted = new Set(form.selected);
    const chosen = preview.rows.filter((row) => wanted.has(row.lineNo));

    if (chosen.length === 0) {
      return Response.json(
        { error: "None of the selected rows are in this file." },
        { status: 400 },
      );
    }

    // Apply the user's corrections to classification before writing.
    for (const row of chosen) {
      const override = form.overrides[String(row.lineNo)];
      if (!override) continue;
      if (typeof override.countsTowardCap === "boolean") {
        row.countsTowardCap = override.countsTowardCap;
      }
      if (override.category !== undefined) row.category = override.category;
    }

    const { data: batch, error: batchError } = await supabase
      .from("import_batches")
      .insert({
        card_account_id: form.cardAccountId,
        source: "csv",
        filename: form.filename,
        file_sha256: sha256(form.csvText),
        uploaded_by: viewer.userId,
        raw_row_count: preview.summary.rawRowCount,
        parsed_count: preview.summary.parsedCount,
        skipped_count: preview.summary.skippedCount,
        status: "pending",
      })
      .select()
      .single();

    if (batchError || !batch) {
      return Response.json(
        { error: batchError?.message ?? "Could not open an import batch." },
        { status: 500 },
      );
    }

    // Full audit trail: every non-empty line of the file, parsed or not.
    if (preview.rawRows.length > 0) {
      const importRows = preview.rawRows.map((row) => ({
        batch_id: batch.id,
        line_no: row.lineNo,
        raw: row.raw,
        parse_error: row.parseError,
      }));

      for (let i = 0; i < importRows.length; i += 500) {
        const { error } = await supabase.from("import_rows").insert(importRows.slice(i, i + 500));
        if (error) {
          await supabase
            .from("import_batches")
            .update({ status: "discarded", notes: `Failed to store raw rows: ${error.message}` })
            .eq("id", batch.id);
          return Response.json({ error: error.message }, { status: 500 });
        }
      }
    }

    /*
     * The upsert is what makes re-imports idempotent: the fingerprint the
     * trigger computes collides with any charge already stored for this
     * account, and ignoreDuplicates turns that into a no-op rather than an
     * error. Only genuinely new rows come back from .select().
     */
    const inserted: string[] = [];
    for (let i = 0; i < chosen.length; i += 500) {
      const payload = chosen
        .slice(i, i + 500)
        .map((row) => toChargeInsert(row, form.cardAccountId, batch.id));

      const { data, error } = await supabase
        .from("charges")
        .upsert(payload, {
          onConflict: "card_account_id,fingerprint",
          ignoreDuplicates: true,
        })
        .select("id");

      if (error) {
        await supabase
          .from("import_batches")
          .update({ status: "discarded", notes: `Insert failed: ${error.message}` })
          .eq("id", batch.id);
        return Response.json({ error: error.message }, { status: 500 });
      }

      for (const row of data ?? []) inserted.push(row.id);
    }

    const insertedCount = inserted.length;
    const duplicateCount = chosen.length - insertedCount;

    const { error: finalizeError } = await supabase
      .from("import_batches")
      .update({
        status: "committed",
        committed_at: new Date().toISOString(),
        inserted_count: insertedCount,
        duplicate_count: duplicateCount,
      })
      .eq("id", batch.id);

    if (finalizeError) {
      return Response.json({ error: finalizeError.message }, { status: 500 });
    }

    return Response.json({
      batchId: batch.id,
      selectedCount: chosen.length,
      insertedCount,
      duplicateCount,
      skippedCount: preview.summary.skippedCount,
    });
  } catch (error) {
    const authFailure = authErrorResponse(error);
    if (authFailure) return authFailure;

    console.error("Import commit failed", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Import failed." },
      { status: 500 },
    );
  }
}
