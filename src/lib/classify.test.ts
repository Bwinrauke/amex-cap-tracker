import { describe, expect, it } from "vitest";
import { classifyCharge } from "./classify";
import type { MerchantRuleRow } from "@/lib/database.types";

const rule = (
  pattern: string,
  merchant: string,
  category: string,
  priority: number,
): MerchantRuleRow => ({
  id: pattern, pattern, merchant, category,
  counts_toward_cap: true, priority, created_at: "",
});

const RULES: MerchantRuleRow[] = [
  rule("google\\s*(ads|adwords)", "Google Ads", "advertising", 10),
  rule("\\bups\\b|united parcel", "UPS", "shipping", 15),
];

describe("classifyCharge", () => {
  it("matches a merchant rule regardless of card", () => {
    const result = classifyCharge({ merchant: "UPS*1Z4A88", descriptor: null }, RULES);
    expect(result.merchant).toBe("UPS");
    expect(result.category).toBe("shipping");
  });

  it("counts shipping on a card that earns its bonus on shipping", () => {
    const result = classifyCharge(
      { merchant: "UPS*1Z4A88", descriptor: null }, RULES, ["shipping"],
    );
    expect(result.countsTowardCap).toBe(true);
  });

  it("does not count shipping on an advertising-only card", () => {
    // An Amex Gold whose selected category is advertising earns 1x on UPS,
    // so the charge must not consume its 4x cap.
    const result = classifyCharge(
      { merchant: "UPS*1Z4A88", descriptor: null }, RULES, ["advertising"],
    );
    expect(result.category).toBe("shipping");
    expect(result.countsTowardCap).toBe(false);
  });

  it("does not count advertising on a shipping-only card", () => {
    const result = classifyCharge(
      { merchant: "GOOGLE ADS 8829", descriptor: null }, RULES, ["shipping"],
    );
    expect(result.countsTowardCap).toBe(false);
  });

  it("trusts the rule alone when the card has no category list", () => {
    const result = classifyCharge(
      { merchant: "UPS*1Z4A88", descriptor: null }, RULES, null,
    );
    expect(result.countsTowardCap).toBe(true);
  });

  it("leaves an unmatched merchant ineligible", () => {
    const result = classifyCharge(
      { merchant: "SOME RANDOM VENDOR", descriptor: null }, RULES, ["shipping"],
    );
    expect(result.matchedPattern).toBeNull();
    expect(result.countsTowardCap).toBe(false);
  });
});
