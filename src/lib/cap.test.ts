import { describe, expect, it } from "vitest";
import {
  allocateSequence,
  computeBurnRate,
  daysBetween,
  projectExhaust,
  recommendRouting,
  splitAtCap,
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

describe("recommendRouting", () => {
  const account = (nickname: string, remainingRunway: number, accountStatus = "active") => ({
    cardAccountId: nickname, nickname, remainingRunway, accountStatus,
  });

  it("names the account with the most remaining runway", () => {
    const result = recommendRouting([
      account("Gold A", 12_000),
      account("Gold B", 90_000),
      account("Gold C", 45_000),
    ]);
    expect(result.account?.nickname).toBe("Gold B");
    expect(result.runnerUp?.nickname).toBe("Gold C");
    expect(result.totalRemaining).toBe(147_000);
  });

  it("ignores accounts that are not active", () => {
    const result = recommendRouting([
      account("Closed", 150_000, "closed"),
      account("Open", 1_000),
    ]);
    expect(result.account?.nickname).toBe("Open");
  });

  it("recommends nothing when every account is capped out", () => {
    const result = recommendRouting([account("A", 0), account("B", 0)]);
    expect(result.account).toBeNull();
    expect(result.reason).toMatch(/reached its 4x cap/i);
  });

  it("handles having no accounts at all", () => {
    expect(recommendRouting([]).account).toBeNull();
  });
});
