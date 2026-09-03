import { describe, expect, it } from "vitest";
import {
  allocateSequence,
  computeBurnRate,
  daysBetween,
  projectExhaust,
  recommendCard,
  rankCardsForCharge,
  planCharge,
  marginalRate,
  bonusPointsAvailable,
  splitAtCap,
  type CardPosition,
} from "./cap";

const CAP = 150_000;
const RATES = { bonusMultiplier: 4, baseMultiplier: 1 };

describe("splitAtCap", () => {
  it("earns the bonus rate entirely below the cap", () => {
    const split = splitAtCap({
      amount: 1000, usedBefore: 0, capAmount: CAP, countsTowardCap: true, ...RATES,
    });
    expect(split).toEqual({ amountAtBonus: 1000, amountAtBase: 0, points: 4000 });
  });

  it("splits a charge that straddles the cap boundary", () => {
    // 2,000 left under the cap, so 2,000 at 4x and 3,000 at 1x.
    const split = splitAtCap({
      amount: 5000, usedBefore: 148_000, capAmount: CAP, countsTowardCap: true, ...RATES,
    });
    expect(split.amountAtBonus).toBe(2000);
    expect(split.amountAtBase).toBe(3000);
    expect(split.points).toBe(2000 * 4 + 3000 * 1);
  });

  it("earns only the base rate once the cap is exhausted", () => {
    const split = splitAtCap({
      amount: 900, usedBefore: CAP, capAmount: CAP, countsTowardCap: true, ...RATES,
    });
    expect(split.amountAtBonus).toBe(0);
    expect(split.amountAtBase).toBe(900);
    expect(split.points).toBe(900);
  });

  it("never returns negative bonus when already past the cap", () => {
    const split = splitAtCap({
      amount: 100, usedBefore: 160_000, capAmount: CAP, countsTowardCap: true, ...RATES,
    });
    expect(split.amountAtBonus).toBe(0);
    expect(split.amountAtBase).toBe(100);
  });

  it("puts an ineligible charge entirely at the base rate and spends no cap", () => {
    const split = splitAtCap({
      amount: 500, usedBefore: 1000, capAmount: CAP, countsTowardCap: false, ...RATES,
    });
    expect(split).toEqual({ amountAtBonus: 0, amountAtBase: 500, points: 500 });
  });

  it("honours non-default multipliers", () => {
    const split = splitAtCap({
      amount: 200, usedBefore: 0, capAmount: CAP, countsTowardCap: true,
      bonusMultiplier: 3, baseMultiplier: 2,
    });
    expect(split.points).toBe(600);
  });
});

describe("allocateSequence", () => {
  const options = { openingCapUsed: 0, capAmount: CAP, ...RATES };

  it("carries the running total across charges", () => {
    const { allocations, totals } = allocateSequence(
      [
        { amount: 100_000, countsTowardCap: true },
        { amount: 60_000, countsTowardCap: true },
      ],
      options,
    );

    expect(allocations[0].usedBefore).toBe(0);
    expect(allocations[1].usedBefore).toBe(100_000);
    // The second charge crosses the cap: 50k at 4x, 10k at 1x.
    expect(allocations[1].amountAtBonus).toBe(50_000);
    expect(allocations[1].amountAtBase).toBe(10_000);

    expect(totals.capUsed).toBe(160_000);
    expect(totals.remainingRunway).toBe(0);
    expect(totals.spendPastCap).toBe(10_000);
    expect(totals.points).toBe(150_000 * 4 + 10_000);
  });

  it("starts from the opening cap already used", () => {
    const { totals } = allocateSequence(
      [{ amount: 10_000, countsTowardCap: true }],
      { ...options, openingCapUsed: 145_000 },
    );
    expect(totals.capUsed).toBe(155_000);
    expect(totals.spendPastCap).toBe(5_000);
    expect(totals.points).toBe(5_000 * 4 + 5_000);
  });

  it("ignores ineligible charges when advancing the cap", () => {
    const { totals } = allocateSequence(
      [
        { amount: 5_000, countsTowardCap: false },
        { amount: 1_000, countsTowardCap: true },
      ],
      options,
    );
    expect(totals.capUsed).toBe(1_000);
    expect(totals.eligibleSpend).toBe(1_000);
    expect(totals.points).toBe(5_000 + 4_000);
  });

  it("excludes refunded and declined charges, as the view does", () => {
    const { totals } = allocateSequence(
      [
        { amount: 1_000, countsTowardCap: true, status: "posted" },
        { amount: 400, countsTowardCap: true, status: "refunded" },
        { amount: 300, countsTowardCap: true, status: "declined" },
        { amount: 200, countsTowardCap: true, status: "pending" },
      ],
      options,
    );
    expect(totals.capUsed).toBe(1_200);
    expect(totals.points).toBe(1_200 * 4);
  });
});

describe("computeBurnRate", () => {
  it("measures from 1 January when an opening balance is carried", () => {
    const burn = computeBurnRate({
      capYear: 2026, capUsed: 31_000, openingCounted: 20_000,
      firstChargeOn: "2026-01-20", asOf: "2026-01-31",
    });
    expect(burn.windowStart).toBe("2026-01-01");
    expect(burn.elapsedDays).toBe(31);
    expect(burn.perDay).toBe(1000);
  });

  it("measures from the first charge when there is no opening balance", () => {
    const burn = computeBurnRate({
      capYear: 2026, capUsed: 5_000, openingCounted: 0,
      firstChargeOn: "2026-03-01", asOf: "2026-03-10",
    });
    expect(burn.windowStart).toBe("2026-03-01");
    expect(burn.elapsedDays).toBe(10);
    expect(burn.perDay).toBe(500);
  });

  it("clamps the window to the end of the cap year", () => {
    const burn = computeBurnRate({
      capYear: 2025, capUsed: 36_500, openingCounted: 1,
      firstChargeOn: "2025-01-01", asOf: "2026-06-01",
    });
    expect(burn.windowEnd).toBe("2025-12-31");
    expect(burn.elapsedDays).toBe(365);
    expect(burn.perDay).toBe(100);
  });

  it("never divides by zero on the first day", () => {
    const burn = computeBurnRate({
      capYear: 2026, capUsed: 900, openingCounted: 0,
      firstChargeOn: "2026-05-05", asOf: "2026-05-05",
    });
    expect(burn.elapsedDays).toBe(1);
    expect(burn.perDay).toBe(900);
  });
});

describe("projectExhaust", () => {
  it("projects a date from the remaining runway and burn rate", () => {
    const projection = projectExhaust({
      remainingRunway: 10_000, burnPerDay: 1_000, asOf: "2026-03-01", capYear: 2026,
    });
    expect(projection.daysRemaining).toBe(10);
    expect(projection.date).toBe("2026-03-11");
    expect(projection.withinCapYear).toBe(true);
    expect(projection.reason).toBe("projected");
  });

  it("flags a projection that lands after the cap resets", () => {
    const projection = projectExhaust({
      remainingRunway: 100_000, burnPerDay: 100, asOf: "2026-06-01", capYear: 2026,
    });
    expect(projection.withinCapYear).toBe(false);
    expect(projection.reason).toBe("beyond_year");
  });

  it("reports no projection when nothing is being spent", () => {
    const projection = projectExhaust({
      remainingRunway: 50_000, burnPerDay: 0, asOf: "2026-06-01", capYear: 2026,
    });
    expect(projection.date).toBeNull();
    expect(projection.reason).toBe("no_burn");
  });

  it("reports an already exhausted cap", () => {
    const projection = projectExhaust({
      remainingRunway: 0, burnPerDay: 900, asOf: "2026-06-01", capYear: 2026,
    });
    expect(projection.reason).toBe("already_exhausted");
    expect(projection.daysRemaining).toBe(0);
  });
});

describe("daysBetween", () => {
  it("counts across a leap day", () => {
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2);
  });
});

/* ---------------------------------------------------------------------- */
/* Points maximisation across mixed products                               */
/* ---------------------------------------------------------------------- */

function card(overrides: Partial<CardPosition> & { nickname: string }): CardPosition {
  return {
    cardAccountId: overrides.nickname,
    product: "Business Gold",
    accountStatus: "active",
    capAmount: 150_000,
    capUsed: 0,
    remainingRunway: 150_000,
    bonusMultiplier: 4,
    baseMultiplier: 1,
    ...overrides,
  };
}

// The real portfolio this is built for.
const GOLD = card({
  nickname: "Amex Business Gold", capAmount: 150_000, capUsed: 149_000,
  remainingRunway: 1_000, bonusMultiplier: 4, baseMultiplier: 1,
});
const INK_CASH = card({
  nickname: "Ink Business Cash", product: "Chase Ink Cash", capAmount: 25_000,
  capUsed: 0, remainingRunway: 25_000, bonusMultiplier: 5, baseMultiplier: 1,
});
const INK_UNLIMITED = card({
  nickname: "Ink Business Unlimited", product: "Chase Ink Unlimited",
  capAmount: 99_999_999, capUsed: 0, remainingRunway: 99_999_999,
  bonusMultiplier: 1.5, baseMultiplier: 1.5,
});

describe("marginalRate", () => {
  it("pays the bonus rate while runway remains", () => {
    expect(marginalRate(INK_CASH)).toBe(5);
  });

  it("drops to the base rate once the cap is used up", () => {
    expect(marginalRate(card({ nickname: "Capped", remainingRunway: 0 }))).toBe(1);
  });
});

describe("bonusPointsAvailable", () => {
  it("values runway by the uplift over the base rate", () => {
    // 25,000 of runway at 5x versus a 1x base = 4 extra points per dollar.
    expect(bonusPointsAvailable(INK_CASH)).toBe(100_000);
  });

  it("is zero for a flat-rate card, however much cap it nominally has", () => {
    expect(bonusPointsAvailable(INK_UNLIMITED)).toBe(0);
  });
});

describe("recommendCard", () => {
  it("prefers the higher rate over the larger runway", () => {
    // The old runway-based rule would have picked the Gold here and lost points.
    const gold = card({ nickname: "Gold", remainingRunway: 150_000, bonusMultiplier: 4 });
    const result = recommendCard([gold, INK_CASH]);

    expect(result.card?.nickname).toBe("Ink Business Cash");
    expect(result.rate).toBe(5);
  });

  it("falls through to the next card once the best one is capped", () => {
    const capped = card({ nickname: "Capped 5x", bonusMultiplier: 5, remainingRunway: 0 });
    const result = recommendCard([capped, GOLD]);

    expect(result.card?.nickname).toBe("Amex Business Gold");
    expect(result.rate).toBe(4);
  });

  it("breaks a tie on rate using remaining runway", () => {
    const small = card({ nickname: "Small", remainingRunway: 1_000 });
    const large = card({ nickname: "Large", remainingRunway: 90_000 });

    expect(recommendCard([small, large]).card?.nickname).toBe("Large");
  });

  it("totals the bonus points still capturable", () => {
    const result = recommendCard([GOLD, INK_CASH]);
    // Gold: 1,000 x 3 uplift = 3,000. Ink Cash: 25,000 x 4 = 100,000.
    expect(result.bonusPointsAvailable).toBe(103_000);
  });

  it("says so when no bonus rate is left anywhere", () => {
    const result = recommendCard([card({ nickname: "Done", remainingRunway: 0 })]);
    expect(result.bonusPointsAvailable).toBe(0);
    expect(result.reason).toMatch(/no bonus rate is left/i);
  });

  it("ignores inactive cards", () => {
    const closed = card({ nickname: "Closed 5x", bonusMultiplier: 5, accountStatus: "closed" });
    expect(recommendCard([closed, GOLD]).card?.nickname).toBe("Amex Business Gold");
  });

  it("handles having no cards", () => {
    expect(recommendCard([]).card).toBeNull();
  });
});

describe("rankCardsForCharge", () => {
  it("ranks by what the charge actually earns, not by rate alone", () => {
    // $10,000 charge. Gold has only $1,000 of runway at 4x, so it earns
    // 1,000x4 + 9,000x1 = 13,000. Ink Cash takes the lot at 5x = 50,000.
    const ranked = rankCardsForCharge([GOLD, INK_CASH], 10_000);

    expect(ranked[0].card.nickname).toBe("Ink Business Cash");
    expect(ranked[0].points).toBe(50_000);
    expect(ranked[1].points).toBe(13_000);
    expect(ranked[1].pointsLostVsBest).toBe(37_000);
  });

  it("reports the blended rate for a charge that straddles the cap", () => {
    const ranked = rankCardsForCharge([GOLD], 2_000);
    // 1,000 at 4x + 1,000 at 1x = 5,000 points over 2,000 spent.
    expect(ranked[0].points).toBe(5_000);
    expect(ranked[0].effectiveRate).toBe(2.5);
  });

  it("can prefer a lower headline rate that fits the charge", () => {
    const tiny5x = card({
      nickname: "Tiny 5x", bonusMultiplier: 5, capAmount: 100,
      capUsed: 0, remainingRunway: 100,
    });
    const big3x = card({
      nickname: "Big 3x", bonusMultiplier: 3, capAmount: 150_000,
      capUsed: 0, remainingRunway: 150_000,
    });

    // 10,000 charge: Tiny earns 500 + 9,900 = 10,400; Big earns 30,000.
    const ranked = rankCardsForCharge([tiny5x, big3x], 10_000);
    expect(ranked[0].card.nickname).toBe("Big 3x");
  });
});

describe("planCharge", () => {
  it("fills the richest rate first", () => {
    const plan = planCharge([GOLD, INK_CASH], 20_000);

    expect(plan.legs[0].card.nickname).toBe("Ink Business Cash");
    expect(plan.legs[0].rate).toBe(5);
    expect(plan.legs[0].amount).toBe(20_000);
    expect(plan.requiresSplit).toBe(false);
  });

  it("splits across cards when one cannot hold the whole charge", () => {
    // 30,000: Ink Cash takes 25,000 at 5x, Gold takes 1,000 at 4x,
    // and the last 4,000 falls to a base rate.
    const plan = planCharge([GOLD, INK_CASH], 30_000);

    expect(plan.requiresSplit).toBe(true);
    expect(plan.legs[0]).toMatchObject({ amount: 25_000, rate: 5 });
    expect(plan.legs[1]).toMatchObject({ amount: 1_000, rate: 4 });
    expect(plan.totalPoints).toBe(25_000 * 5 + 1_000 * 4 + 4_000 * 1);
  });

  it("beats putting everything on one card", () => {
    const plan = planCharge([GOLD, INK_CASH], 30_000);
    expect(plan.pointsGainedBySplitting).toBeGreaterThan(0);
    expect(plan.totalPoints).toBeGreaterThan(plan.singleCardPoints);
  });

  it("gains nothing from splitting when one card can absorb it all", () => {
    const plan = planCharge([GOLD, INK_CASH], 5_000);
    expect(plan.pointsGainedBySplitting).toBe(0);
  });

  it("places the whole charge even with no bonus capacity left", () => {
    const capped = card({ nickname: "Capped", remainingRunway: 0, baseMultiplier: 1 });
    const plan = planCharge([capped], 2_000);

    expect(plan.legs).toHaveLength(1);
    expect(plan.totalPoints).toBe(2_000);
    expect(plan.legs[0].amount).toBe(2_000);
  });

  it("accounts for every dollar of the charge", () => {
    const plan = planCharge([GOLD, INK_CASH, INK_UNLIMITED], 40_000);
    const placed = plan.legs.reduce((sum, leg) => sum + leg.amount, 0);
    expect(placed).toBe(40_000);
  });
});
