import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, CapYearRow, CardAccountRow, MerchantRuleRow } from "@/lib/database.types";

export const MAX_FILE_BYTES = 8 * 1024 * 1024;

type Client = SupabaseClient<Database>;

export interface ImportForm {
  csvText: string;
  filename: string;
  cardAccountId: string;
  selected: number[] | null;
  overrides: Record<string, { countsTowardCap?: boolean; category?: string | null }>;
}

function bad(message: string, status = 400) {
  return { error: Response.json({ error: message }, { status }) };
}

/** Pulls the uploaded CSV and the user's selections out of the form body. */
export async function readImportForm(
  request: Request,
): Promise<ImportForm | { error: Response }> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad("Expected a multipart form upload.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return bad("No file was uploaded.");
  if (file.size === 0) return bad("That file is empty.");
  if (file.size > MAX_FILE_BYTES) {
    return bad(`That file is larger than ${MAX_FILE_BYTES / 1024 / 1024}MB.`);
  }

  const cardAccountId = String(form.get("cardAccountId") ?? "").trim();
  if (!cardAccountId) return bad("Choose a card account to import into.");

  const csvText = await file.text();

  let selected: number[] | null = null;
  const selectedRaw = form.get("selected");
  if (typeof selectedRaw === "string" && selectedRaw.trim() !== "") {
    try {
      const parsed = JSON.parse(selectedRaw);
      if (!Array.isArray(parsed)) return bad("`selected` must be an array of line numbers.");
      selected = parsed.map(Number).filter((n) => Number.isFinite(n));
    } catch {
      return bad("`selected` was not valid JSON.");
    }
  }

  let overrides: ImportForm["overrides"] = {};
  const overridesRaw = form.get("overrides");
  if (typeof overridesRaw === "string" && overridesRaw.trim() !== "") {
    try {
      const parsed = JSON.parse(overridesRaw);
      if (parsed && typeof parsed === "object") overrides = parsed;
    } catch {
      return bad("`overrides` was not valid JSON.");
    }
  }

  return { csvText, filename: file.name || "upload.csv", cardAccountId, selected, overrides };
}

export interface ImportContext {
  cardAccount: Pick<CardAccountRow, "id" | "nickname" | "last4" | "bonus_categories">;
  rules: MerchantRuleRow[];
  capYears: CapYearRow[];
  existing: { id: string; fingerprint: string | null }[];
  capUsedByYear: Record<number, number>;
}

/** Everything the parser needs to classify and diff against what is stored. */
export async function loadImportContext(
  supabase: Client,
  cardAccountId: string,
): Promise<ImportContext | { error: Response }> {
  const { data: cardAccount, error: accountError } = await supabase
    .from("card_accounts")
    .select("id, nickname, last4, bonus_categories")
    .eq("id", cardAccountId)
    .maybeSingle();

  if (accountError) return bad(accountError.message, 500);
  if (!cardAccount) return bad("That card account does not exist.", 404);

  const [rulesResult, capYearsResult, existingResult, runwayResult] = await Promise.all([
    supabase.from("merchant_rules").select("*"),
    supabase.from("cap_years").select("*").eq("card_account_id", cardAccountId),
    // Only the fingerprints are needed for the diff, so this stays cheap even
    // on an account with a long history.
    supabase
      .from("charges")
      .select("id, fingerprint")
      .eq("card_account_id", cardAccountId)
      .limit(50_000),
    supabase
      .from("v_cap_runway")
      .select("cap_year, cap_used")
      .eq("card_account_id", cardAccountId),
  ]);

  if (rulesResult.error) return bad(rulesResult.error.message, 500);
  if (capYearsResult.error) return bad(capYearsResult.error.message, 500);
  if (existingResult.error) return bad(existingResult.error.message, 500);
  if (runwayResult.error) return bad(runwayResult.error.message, 500);

  const capUsedByYear: Record<number, number> = {};
  for (const row of runwayResult.data ?? []) {
    capUsedByYear[row.cap_year] = Number(row.cap_used ?? 0);
  }

  return {
    cardAccount,
    rules: (rulesResult.data ?? []) as MerchantRuleRow[],
    capYears: (capYearsResult.data ?? []) as CapYearRow[],
    existing: existingResult.data ?? [],
    capUsedByYear,
  };
}
