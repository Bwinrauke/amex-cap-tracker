import { createHash } from "node:crypto";
import { parseAmexCsv, normalizeDescriptor, type ParsedCharge } from "@/lib/csv/amex";
import { classifyCharge } from "@/lib/classify";
import { allocateSequence } from "@/lib/cap";
import type { CapYearRow, ChargeInsert, MerchantRuleRow } from "@/lib/database.types";

/**
 * Recreates the database's charge_fingerprint() in JS.
 *
 * The trigger owns the real value — nothing here is ever sent to the server.
 * This copy exists purely so preview can tell the user which rows already
 * exist before anything is written. It must track the SQL function exactly:
 *
 *   reference present -> 'ref:' || lower(btrim(reference))
 *   otherwise         -> 'nat:' || md5(date|amount|descriptor) || '#' || occurrence
 */
export function computeFingerprint(input: {
  postedOn: string;
  amount: number;
  descriptor: string;
  reference: string | null;
  occurrence: number;
}): string {
  const reference = (input.reference ?? "").trim();
  if (reference !== "") return `ref:${reference.toLowerCase()}`;

  const parts = [
    input.postedOn,
    input.amount.toFixed(2),
    normalizeDescriptor(input.descriptor),
  ].join("|");

  return `nat:${createHash("md5").update(parts).digest("hex")}#${input.occurrence}`;
}

export type RowDisposition = "new" | "duplicate";

export interface PreviewRow {
  lineNo: number;
  postedOn: string;
  merchant: string;
  descriptor: string;
  amount: number;
  status: "posted" | "refunded";
  reference: string | null;
  occurrence: number;
  fingerprint: string;
  category: string | null;
  countsTowardCap: boolean;
  matchedPattern: string | null;
  cardHint: string | null;
  disposition: RowDisposition;
  /** Set when this row already exists — the id of the charge it matches. */
  existingChargeId: string | null;
  /** Cap-year impact preview: 4x/1x split if this row were committed. */
  amountAtBonus: number;
  amountAtBase: number;
  points: number;
}

export interface PreviewSummary {
  rawRowCount: number;
  parsedCount: number;
  newCount: number;
  duplicateCount: number;
  skippedCount: number;
  eligibleNewSpend: number;
  newPoints: number;
  years: number[];
}

export interface ExistingCharge {
  id: string;
  fingerprint: string | null;
}

export interface BuildPreviewInput {
  csvText: string;
  rules: MerchantRuleRow[];
  existing: ExistingCharge[];
  /** Cap years for the account, keyed by year, used for the split preview. */
  capYears: CapYearRow[];
  /** Cap already used per year before this file, from v_cap_runway. */
  capUsedByYear: Record<number, number>;
  /**
   * Categories the receiving card earns its bonus rate on. Null trusts the
   * merchant rule alone.
   */
  cardBonusCategories?: string[] | null;
}

export interface BuildPreviewResult {
  rows: PreviewRow[];
  skipped: { lineNo: number; reason: string }[];
  rawRows: { lineNo: number; raw: Record<string, string>; parseError: string | null }[];
  summary: PreviewSummary;
  layout: ReturnType<typeof parseAmexCsv>["layout"];
}

/**
 * Parses, classifies and diffs a CSV without touching the database.
 *
 * Pure by design: both the preview and the commit route run it, so what the
 * user ticks is exactly what gets written.
 */
export function buildPreview(input: BuildPreviewInput): BuildPreviewResult {
  const parsed = parseAmexCsv(input.csvText);
  const existingFingerprints = new Map<string, string>();
  for (const charge of input.existing) {
    if (charge.fingerprint) existingFingerprints.set(charge.fingerprint, charge.id);
  }

  const rows: PreviewRow[] = parsed.charges.map((charge: ParsedCharge) => {
    const classification = classifyCharge(
      { merchant: charge.merchant, descriptor: charge.descriptor, category: charge.category },
      input.rules,
      input.cardBonusCategories ?? null,
    );

    const fingerprint = computeFingerprint({
      postedOn: charge.postedOn,
      amount: charge.amount,
      descriptor: charge.descriptor,
      reference: charge.reference,
      occurrence: charge.occurrence,
    });

    const existingChargeId = existingFingerprints.get(fingerprint) ?? null;

    return {
      lineNo: charge.lineNo,
      postedOn: charge.postedOn,
      merchant: classification.merchant,
      descriptor: charge.descriptor,
      amount: charge.amount,
      status: charge.status,
      reference: charge.reference,
      occurrence: charge.occurrence,
      fingerprint,
      category: classification.category,
      countsTowardCap: classification.countsTowardCap,
      matchedPattern: classification.matchedPattern,
      cardHint: charge.cardHint,
      disposition: existingChargeId ? ("duplicate" as const) : ("new" as const),
      existingChargeId,
      amountAtBonus: 0,
      amountAtBase: 0,
      points: 0,
    };
  });

  // Project the 4x/1x split for the new rows, year by year, starting from
  // where each cap year already stands. Refunds do not consume cap.
  const years = [...new Set(rows.map((r) => Number(r.postedOn.slice(0, 4))))].sort();

  for (const year of years) {
    const capYear = input.capYears.find((c) => c.year === year);
    const yearRows = rows.filter(
      (r) => Number(r.postedOn.slice(0, 4)) === year && r.disposition === "new",
    );
    yearRows.sort((a, b) => a.postedOn.localeCompare(b.postedOn) || a.lineNo - b.lineNo);

    const { allocations } = allocateSequence(
      yearRows.map((r) => ({
        amount: r.amount,
        countsTowardCap: r.countsTowardCap,
        status: r.status === "refunded" ? "refunded" : "posted",
      })),
      {
        openingCapUsed: input.capUsedByYear[year] ?? 0,
        capAmount: capYear?.cap_amount ?? 150_000,
        bonusMultiplier: capYear?.bonus_multiplier ?? 4,
        baseMultiplier: capYear?.base_multiplier ?? 1,
      },
    );

    for (const allocation of allocations) {
      const row = yearRows[allocation.index];
      row.amountAtBonus = allocation.amountAtBonus;
      row.amountAtBase = allocation.amountAtBase;
      row.points = allocation.points;
    }
  }

  const newRows = rows.filter((r) => r.disposition === "new");

  return {
    rows,
    skipped: parsed.skipped.map((s) => ({ lineNo: s.lineNo, reason: s.reason })),
    rawRows: parsed.rawRows,
    layout: parsed.layout,
    summary: {
      rawRowCount: parsed.rawRows.length,
      parsedCount: rows.length,
      newCount: newRows.length,
      duplicateCount: rows.length - newRows.length,
      skippedCount: parsed.skipped.length,
      eligibleNewSpend: newRows
        .filter((r) => r.countsTowardCap && r.status === "posted")
        .reduce((sum, r) => sum + r.amount, 0),
      newPoints: newRows.reduce((sum, r) => sum + r.points, 0),
      years,
    },
  };
}

/**
 * Turns a preview row into a charge insert.
 *
 * `fingerprint` is deliberately never included: the set_charge_fingerprint
 * trigger computes it, and that is what the upsert conflict target relies on.
 */
export function toChargeInsert(
  row: PreviewRow,
  cardAccountId: string,
  batchId: string,
): ChargeInsert {
  return {
    card_account_id: cardAccountId,
    posted_on: row.postedOn,
    merchant: row.merchant,
    descriptor: row.descriptor,
    amount: row.amount,
    category: row.category,
    counts_toward_cap: row.countsTowardCap,
    status: row.status,
    reference: row.reference,
    source: "csv",
    batch_id: batchId,
    occurrence: row.occurrence,
  };
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
