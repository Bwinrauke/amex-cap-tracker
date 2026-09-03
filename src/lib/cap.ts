/**
 * Cap-split math.
 *
 * The database is authoritative for anything already stored — v_cap_runway
 * and v_charge_allocation are read as-is and never recomputed here. These
 * functions exist for the two cases the views cannot cover:
 *
 *  1. Import preview, where rows are not in the database yet and the user
 *     needs to see what they would earn before committing. The allocation
 *     below mirrors v_charge_allocation exactly.
 *  2. Forward projections — burn rate and exhaust date — which are estimates
 *     about the future, not stored facts.
 */

export interface CapSplit {
  amountAtBonus: number;
  amountAtBase: number;
  points: number;
}

/**
 * Splits one charge across the cap boundary.
 *
 * Mirrors v_charge_allocation: a charge that does not count toward the cap
 * earns the base rate on its whole amount and consumes no cap; an eligible
 * charge earns the bonus rate up to the cap and the base rate beyond it.
 */
export function splitAtCap(params: {
  amount: number;
  usedBefore: number;
  capAmount: number;
  countsTowardCap: boolean;
  bonusMultiplier: number;
  baseMultiplier: number;
}): CapSplit {
  const { amount, usedBefore, capAmount, countsTowardCap, bonusMultiplier, baseMultiplier } = params;

  if (!countsTowardCap) {
    return { amountAtBonus: 0, amountAtBase: amount, points: amount * baseMultiplier };
  }

  const headroom = capAmount - usedBefore;
  const amountAtBonus = Math.max(0, Math.min(amount, headroom));
  const amountAtBase = amount - amountAtBonus;

  return {
    amountAtBonus,
    amountAtBase,
    points: amountAtBonus * bonusMultiplier + amountAtBase * baseMultiplier,
  };
}

export interface AllocatableCharge {
  amount: number;
  countsTowardCap: boolean;
  /** Charges outside pending/posted are excluded, matching the view. */
  status?: string;
}

export interface AllocatedCharge extends CapSplit {
  index: number;
  usedBefore: number;
}

export interface AllocationTotals {
  capUsed: number;
  remainingRunway: number;
  points: number;
  spendPastCap: number;
  eligibleSpend: number;
}

/**
 * Runs a sequence of charges through the cap in order, the way the view's
 * running window does. Charges must already be ordered by posted date.
 */
export function allocateSequence(
  charges: AllocatableCharge[],
  options: {
    openingCapUsed: number;
    capAmount: number;
    bonusMultiplier: number;
    baseMultiplier: number;
  },
): { allocations: AllocatedCharge[]; totals: AllocationTotals } {
  const { openingCapUsed, capAmount, bonusMultiplier, baseMultiplier } = options;

  let used = openingCapUsed;
  let points = 0;
  let spendPastCap = 0;
  let eligibleSpend = 0;
  const allocations: AllocatedCharge[] = [];

  charges.forEach((charge, index) => {
    // v_charge_allocation only counts pending and posted rows.
    if (charge.status !== undefined && charge.status !== "pending" && charge.status !== "posted") {
      return;
    }

    const split = splitAtCap({
      amount: charge.amount,
      usedBefore: used,
      capAmount,
      countsTowardCap: charge.countsTowardCap,
      bonusMultiplier,
      baseMultiplier,
    });

    allocations.push({ index, usedBefore: used, ...split });
    points += split.points;

    if (charge.countsTowardCap) {
      used += charge.amount;
      eligibleSpend += charge.amount;
      spendPastCap += split.amountAtBase;
    }
  });

  return {
    allocations,
    totals: {
      capUsed: used,
      remainingRunway: Math.max(0, capAmount - used),
      points,
      spendPastCap,
      eligibleSpend,
    },
  };
}

/* -------------------------------------------------------------------------
 * Projections
 * ---------------------------------------------------------------------- */

const MS_PER_DAY = 86_400_000;

function utcDate(value: string | Date): Date {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function daysBetween(from: string | Date, to: string | Date): number {
  return Math.round((utcDate(to).getTime() - utcDate(from).getTime()) / MS_PER_DAY);
}

export function addDays(date: string | Date, days: number): Date {
  return new Date(utcDate(date).getTime() + days * MS_PER_DAY);
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface BurnRateInput {
  capYear: number;
  capUsed: number;
  openingCounted: number;
  firstChargeOn: string | null;
  asOf: string;
}

export interface BurnRate {
  /** Eligible dollars per day across the measured window. */
  perDay: number;
  windowStart: string;
  windowEnd: string;
  elapsedDays: number;
}

/**
 * Average eligible spend per day so far this cap year.
 *
 * The window opens on 1 January when an opening balance is carried (that
 * spend happened earlier in the year, even though it is not itemised), and
 * otherwise on the first logged charge — dividing a late-starting account's
 * spend by the whole year would understate its burn.
 */
export function computeBurnRate(input: BurnRateInput): BurnRate {
  const { capYear, capUsed, openingCounted, firstChargeOn, asOf } = input;

  const yearStart = `${capYear}-01-01`;
  const yearEnd = `${capYear}-12-31`;

  const start = openingCounted > 0 || !firstChargeOn ? yearStart : firstChargeOn;
  const today = utcDate(asOf);
  const end = today > utcDate(yearEnd) ? yearEnd : asOf;

  // Inclusive of both endpoints, and never zero, so a single day of spend
  // does not divide by zero.
  const elapsedDays = Math.max(1, daysBetween(start, end) + 1);

  return {
    perDay: capUsed / elapsedDays,
    windowStart: start,
    windowEnd: toIsoDate(utcDate(end)),
    elapsedDays,
  };
}

export interface ExhaustProjection {
  /** ISO date the cap is projected to be reached, or null if it never is. */
  date: string | null;
  daysRemaining: number | null;
  /** False when the projected date falls after the cap year resets. */
  withinCapYear: boolean;
  reason: "projected" | "already_exhausted" | "no_burn" | "beyond_year";
}

/**
 * Projects when the remaining runway runs out at the current burn rate.
 *
 * A date past 31 December is reported but flagged, because the cap resets on
 * 1 January — the account will not actually exhaust.
 */
export function projectExhaust(params: {
  remainingRunway: number;
  burnPerDay: number;
  asOf: string;
  capYear: number;
}): ExhaustProjection {
  const { remainingRunway, burnPerDay, asOf, capYear } = params;

  if (remainingRunway <= 0) {
    return { date: asOf, daysRemaining: 0, withinCapYear: true, reason: "already_exhausted" };
  }
  if (burnPerDay <= 0) {
    return { date: null, daysRemaining: null, withinCapYear: true, reason: "no_burn" };
  }

  const daysRemaining = Math.ceil(remainingRunway / burnPerDay);
  const projected = addDays(asOf, daysRemaining);
  const yearEnd = utcDate(`${capYear}-12-31`);
  const withinCapYear = projected <= yearEnd;

  return {
    date: toIsoDate(projected),
    daysRemaining,
    withinCapYear,
    reason: withinCapYear ? "projected" : "beyond_year",
  };
}

export interface RoutingCandidate {
  cardAccountId: string;
  nickname: string;
  remainingRunway: number;
  accountStatus: string;
}

export interface RoutingRecommendation {
  account: RoutingCandidate | null;
  runnerUp: RoutingCandidate | null;
  /** Total runway across every active account. */
  totalRemaining: number;
  reason: string;
}

/**
 * Picks the account the next 4x charge should go to: the active account with
 * the most remaining runway, so the bonus rate is used before any account is
 * pushed past its cap.
 */
export function recommendRouting(candidates: RoutingCandidate[]): RoutingRecommendation {
  const active = candidates
    .filter((c) => c.accountStatus === "active")
    .sort((a, b) => b.remainingRunway - a.remainingRunway || a.nickname.localeCompare(b.nickname));

  const totalRemaining = active.reduce((sum, c) => sum + c.remainingRunway, 0);

  if (active.length === 0) {
    return { account: null, runnerUp: null, totalRemaining: 0, reason: "No active card accounts." };
  }

  const [best, second = null] = active;

  if (best.remainingRunway <= 0) {
    return {
      account: null,
      runnerUp: null,
      totalRemaining,
      reason: "Every active account has reached its 4x cap for the year.",
    };
  }

  const reason = second && second.remainingRunway > 0
    ? `${formatShortMoney(best.remainingRunway)} of runway left, ${formatShortMoney(best.remainingRunway - second.remainingRunway)} more than ${second.nickname}.`
    : `${formatShortMoney(best.remainingRunway)} of runway left — the only account with room.`;

  return { account: best, runnerUp: second, totalRemaining, reason };
}

function formatShortMoney(value: number): string {
  if (Math.abs(value) >= 1000) return `$${Math.round(value / 1000)}k`;
  return `$${Math.round(value)}`;
}
