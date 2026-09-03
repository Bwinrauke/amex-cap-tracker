import type { MerchantRuleRow } from "@/lib/database.types";

export interface Classification {
  merchant: string;
  category: string | null;
  countsTowardCap: boolean;
  /** The rule that matched, or null when nothing did. */
  matchedPattern: string | null;
}

/**
 * Applies merchant_rules to a charge.
 *
 * Rules are Postgres regexes stored in the database; lower `priority` wins,
 * matching how the rules were seeded (advertising at 10, catch-alls at 100).
 * Both the descriptor and the merchant text are tested, since which one
 * carries the recognisable name varies by CSV layout.
 */
export function classifyCharge(
  input: { merchant: string; descriptor: string | null; category?: string | null },
  rules: MerchantRuleRow[],
  /**
   * Categories the receiving card earns its bonus rate on. A rule saying a
   * category counts is not enough — the card has to earn the bonus on it.
   * Shipping is a bonus category on Chase Ink but not on an Amex Gold whose
   * selected category is advertising. Pass null to trust the rule alone.
   */
  cardBonusCategories: string[] | null = null,
): Classification {
  const haystack = `${input.descriptor ?? ""} ${input.merchant}`.toLowerCase();
  const ordered = [...rules].sort((a, b) => a.priority - b.priority || a.pattern.localeCompare(b.pattern));

  for (const rule of ordered) {
    let regex: RegExp;
    try {
      regex = new RegExp(rule.pattern, "i");
    } catch {
      // A pattern Postgres accepts but JS does not; skip rather than fail
      // the whole import.
      continue;
    }
    if (regex.test(haystack)) {
      const cardEarnsBonus =
        cardBonusCategories === null ||
        (rule.category !== null && cardBonusCategories.includes(rule.category));

      return {
        merchant: rule.merchant,
        category: rule.category,
        countsTowardCap: rule.counts_toward_cap && cardEarnsBonus,
        matchedPattern: rule.pattern,
      };
    }
  }

  return {
    merchant: input.merchant,
    category: input.category ?? null,
    // Nothing matched: default to not counting, so an unrecognised merchant
    // can never silently inflate the cap. The user can tick it manually.
    countsTowardCap: false,
    matchedPattern: null,
  };
}
