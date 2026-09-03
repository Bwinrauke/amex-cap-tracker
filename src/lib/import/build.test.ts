import { describe, expect, it } from "vitest";
import { buildPreview, computeFingerprint } from "./build";
import type { CapYearRow, MerchantRuleRow } from "@/lib/database.types";

/**
 * These expected values were produced by the live database's
 * charge_fingerprint() function. They pin the JS mirror to the SQL: if the
 * two ever drift, the import preview would mislabel duplicates.
 */
describe("computeFingerprint matches the database function", () => {
  it("hashes a natural key", () => {
    expect(
      computeFingerprint({
        postedOn: "2026-03-01", amount: 1500, descriptor: "GOOGLE *ADS 8829",
        reference: null, occurrence: 1,
      }),
    ).toBe("nat:a0cae94a07b28ee1698fd3fb493e75a8#1");
  });

  it("separates occurrences of an otherwise identical charge", () => {
    expect(
      computeFingerprint({
        postedOn: "2026-03-01", amount: 1500, descriptor: "GOOGLE *ADS 8829",
        reference: null, occurrence: 2,
      }),
    ).toBe("nat:a0cae94a07b28ee1698fd3fb493e75a8#2");
  });

  it("collapses whitespace without trimming, exactly as the SQL does", () => {
    expect(
      computeFingerprint({
        postedOn: "2026-03-01", amount: 0.5, descriptor: "Google   Ads  ",
        reference: null, occurrence: 1,
      }),
    ).toBe("nat:253cc640b4e8d0964543f0f95a0f78f8#1");
  });

  it("prefers the reference and lowercases it", () => {
    expect(
      computeFingerprint({
        postedOn: "2026-03-01", amount: 1500, descriptor: "X",
        reference: "  ABC123 ", occurrence: 1,
      }),
    ).toBe("ref:abc123");
  });

  it("formats large amounts the way to_char does", () => {
    expect(
      computeFingerprint({
        postedOn: "2026-12-31", amount: 1234567.89, descriptor: "meta platforms inc",
        reference: null, occurrence: 3,
      }),
    ).toBe("nat:f3f2800b5c81bf85f0472785145f6c1f#3");
  });
});

const RULES: MerchantRuleRow[] = [
  {
    id: "1", pattern: "google\\s*(ads|adwords)", merchant: "Google Ads",
    category: "advertising", counts_toward_cap: true, priority: 10, created_at: "",
  },
  {
    id: "2", pattern: "aws|azure", merchant: "Cloud hosting",
    category: "software", counts_toward_cap: false, priority: 50, created_at: "",
  },
];

const CAP_YEAR: CapYearRow = {
  id: "cy", card_account_id: "acct", year: 2026, cap_amount: 150_000,
  bonus_multiplier: 4, base_multiplier: 1, opening_cap_used: 0,
  opening_source: "declared", opening_verified: true, created_at: "", updated_at: "",
};

const CSV = [
  "Date,Description,Amount",
  "03/01/2026,GOOGLE ADS 8829,1500.00",
  "03/02/2026,AWS CLOUD,400.00",
].join("\n");

describe("buildPreview", () => {
  it("classifies rows against the merchant rules", () => {
    const preview = buildPreview({
      csvText: CSV, rules: RULES, existing: [],
      capYears: [CAP_YEAR], capUsedByYear: {},
    });

    expect(preview.rows).toHaveLength(2);
    expect(preview.rows[0]).toMatchObject({
      merchant: "Google Ads", category: "advertising", countsTowardCap: true,
      disposition: "new", points: 6000,
    });
    // AWS is not a bonus category, so it earns 1x and consumes no cap.
    expect(preview.rows[1]).toMatchObject({
      merchant: "Cloud hosting", countsTowardCap: false, amountAtBonus: 0, points: 400,
    });
    expect(preview.summary.eligibleNewSpend).toBe(1500);
  });

  it("marks a row already in the database as a duplicate", () => {
    const fingerprint = computeFingerprint({
      postedOn: "2026-03-01", amount: 1500, descriptor: "GOOGLE ADS 8829",
      reference: null, occurrence: 1,
    });

    const preview = buildPreview({
      csvText: CSV, rules: RULES,
      existing: [{ id: "existing-charge", fingerprint }],
      capYears: [CAP_YEAR], capUsedByYear: {},
    });

    expect(preview.rows[0].disposition).toBe("duplicate");
    expect(preview.rows[0].existingChargeId).toBe("existing-charge");
    expect(preview.summary.newCount).toBe(1);
    expect(preview.summary.duplicateCount).toBe(1);
  });

  it("splits a preview row across the cap using what is already used", () => {
    const preview = buildPreview({
      csvText: "Date,Description,Amount\n03/01/2026,GOOGLE ADS,5000.00",
      rules: RULES, existing: [], capYears: [CAP_YEAR],
      capUsedByYear: { 2026: 148_000 },
    });

    expect(preview.rows[0].amountAtBonus).toBe(2000);
    expect(preview.rows[0].amountAtBase).toBe(3000);
    expect(preview.rows[0].points).toBe(2000 * 4 + 3000);
  });

  it("does not let an already-stored row consume cap in the projection", () => {
    const fingerprint = computeFingerprint({
      postedOn: "2026-03-01", amount: 1500, descriptor: "GOOGLE ADS 8829",
      reference: null, occurrence: 1,
    });

    const preview = buildPreview({
      csvText: CSV, rules: RULES,
      existing: [{ id: "existing", fingerprint }],
      capYears: [CAP_YEAR], capUsedByYear: { 2026: 1500 },
    });

    // Only the AWS row is new, and it is not cap-eligible.
    expect(preview.summary.eligibleNewSpend).toBe(0);
  });
});
