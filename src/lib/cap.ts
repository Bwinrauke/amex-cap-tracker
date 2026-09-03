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

/**
 * The calendar window a cap year covers on a given card.
 *
 * Amex caps run on the calendar year; Chase Ink caps run from the cardmember
 * anniversary. Defaulting to 1 January makes a calendar-year card behave
 * exactly as before.
 */
export function capYearWindow(
  capYear: number,
  startMonth = 1,
  startDay = 1,
): { start: string; end: string } {
  const start = clampToMonth(capYear, startMonth, startDay);
  // The window closes the day before the next anniversary, so a 1 January
  // start still ends on 31 December.
  const end = addDays(clampToMonth(capYear + 1, startMonth, startDay), -1);
  return { start: toIsoDate(start), end: toIsoDate(end) };
}

/** Guards against anniversaries like the 31st in a 30-day month. */
function clampToMonth(year: number, month: number, day: number): Date {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1, Math.min(day, daysInMonth)));
}

export interface BurnRateInput {
  /** First day of this card's cap year. */
  windowStart: string;
  /** Last day of this card's cap year. */
  windowEnd: string;
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
 * The window opens at the start of the cap year when an opening balance is
 * carried (that spend happened earlier in the period, even though it is not
 * itemised), and otherwise on the first logged charge — dividing a
 * late-starting card's spend by the whole period would understate its burn.
 */
export function computeBurnRate(input: BurnRateInput): BurnRate {
  const { windowStart, windowEnd, capUsed, openingCounted, firstChargeOn, asOf } = input;

  const start = openingCounted > 0 || !firstChargeOn ? windowStart : firstChargeOn;
  const end = utcDate(asOf) > utcDate(windowEnd) ? windowEnd : asOf;

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
  /** False when the projected date falls after this cap year resets. */
  withinCapYear: boolean;
  reason: "projected" | "already_exhausted" | "no_burn" | "beyond_year";
}

/**
 * Projects when the remaining runway runs out at the current burn rate.
 *
 * A date past the end of the cap year is reported but flagged, because the
 * cap resets then — the card will not actually exhaust.
 */
export function projectExhaust(params: {
  remainingRunway: number;
  burnPerDay: number;
  asOf: string;
  /** Last day of this card's cap year. */
  windowEnd: string;
}): ExhaustProjection {
  const { remainingRunway, burnPerDay, asOf, windowEnd } = params;

  if (remainingRunway <= 0) {
    return { date: asOf, daysRemaining: 0, withinCapYear: true, reason: "already_exhausted" };
  }
  if (burnPerDay <= 0) {
    return { date: null, daysRemaining: null, withinCapYear: true, reason: "no_burn" };
  }

  const daysRemaining = Math.ceil(remainingRunway / burnPerDay);
  const projected = addDays(asOf, daysRemaining);
  const withinCapYear = projected <= utcDate(windowEnd);

  return {
    date: toIsoDate(projected),
    daysRemaining,
    withinCapYear,
    reason: withinCapYear ? "projected" : "beyond_year",
  };
}

/* -------------------------------------------------------------------------
 * Points maximisation
 *
 * Cards differ in both rate and cap: an Ink Cash earning 5x on a $25k cap is
 * a better home for the next $1,000 than a Business Gold earning 4x with
 * $150k of runway left. So the ranking below is driven by the *rate a charge
 * would actually earn*, never by how much runway a card has.
 * ---------------------------------------------------------------------- */

export interface CardPosition {
  cardAccountId: string;
  nickname: string;
  product: string;
  accountStatus: string;
  capAmount: number;
  capUsed: number;
  remainingRunway: number;
  bonusMultiplier: number;
  baseMultiplier: number;
}

/**
 * Points per dollar the very next eligible dollar would earn on this card:
 * the bonus rate while cap headroom remains, the base rate once it is gone.
 */
export function marginalRate(card: CardPosition): number {
  return card.remainingRunway > 0 ? card.bonusMultiplier : card.baseMultiplier;
}

/**
 * Bonus points still capturable on a card this year — the runway left times
 * the uplift of the bonus rate over the base rate.
 *
 * This is the number that actually matters when deciding where to send spend:
 * a card with runway but no uplift (a flat-rate Ink Unlimited, say) has
 * nothing left to capture, however much cap it nominally has.
 */
export function bonusPointsAvailable(card: CardPosition): number {
  return Math.max(0, card.remainingRunway) * Math.max(0, card.bonusMultiplier - card.baseMultiplier);
}

export interface CardEarning {
  card: CardPosition;
  amountAtBonus: number;
  amountAtBase: number;
  points: number;
  /** Blended points per dollar for this specific charge. */
  effectiveRate: number;
  /** Points given up by choosing this card over the best one. */
  pointsLostVsBest: number;
}

/**
 * Ranks every active card by what a charge of `amount` would actually earn
 * on it, straddling the cap where the charge is bigger than the runway left.
 */
export function rankCardsForCharge(cards: CardPosition[], amount: number): CardEarning[] {
  const ranked = cards
    .filter((card) => card.accountStatus === "active")
    .map((card) => {
      const split = splitAtCap({
        amount,
        usedBefore: card.capUsed,
        capAmount: card.capAmount,
        countsTowardCap: true,
        bonusMultiplier: card.bonusMultiplier,
        baseMultiplier: card.baseMultiplier,
      });

      return {
        card,
        amountAtBonus: split.amountAtBonus,
        amountAtBase: split.amountAtBase,
        points: split.points,
        effectiveRate: amount > 0 ? split.points / amount : marginalRate(card),
        pointsLostVsBest: 0,
      };
    })
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.card.remainingRunway - a.card.remainingRunway ||
        a.card.nickname.localeCompare(b.card.nickname),
    );

  const best = ranked[0]?.points ?? 0;
  for (const entry of ranked) entry.pointsLostVsBest = best - entry.points;

  return ranked;
}

export interface ChargeLeg {
  card: CardPosition;
  amount: number;
  rate: number;
  points: number;
}

export interface ChargePlan {
  legs: ChargeLeg[];
  totalPoints: number;
  /** Points from putting the whole charge on the single best card. */
  singleCardPoints: number;
  /** What splitting the charge gains over using one card. */
  pointsGainedBySplitting: number;
  /** True when the charge does not fit in one card's bonus headroom. */
  requiresSplit: boolean;
}

/**
 * Works out the highest-earning way to place a charge, splitting it across
 * cards when that earns more.
 *
 * Filling the highest rate first is provably optimal here: each card's bonus
 * headroom is independent and its rate is fixed, so this is the fractional
 * knapsack case where the greedy choice is the best one.
 */
export function planCharge(cards: CardPosition[], amount: number): ChargePlan {
  const active = cards.filter((card) => card.accountStatus === "active");

  const singleCardPoints = rankCardsForCharge(active, amount)[0]?.points ?? 0;

  // Every bonus bucket, richest rate first, then any base-rate capacity.
  const buckets = active
    .map((card) => ({
      card,
      capacity: Math.max(0, Math.min(card.remainingRunway, card.capAmount)),
      rate: card.bonusMultiplier,
    }))
    .filter((bucket) => bucket.capacity > 0)
    .sort((a, b) => b.rate - a.rate || b.capacity - a.capacity);

  const legs: ChargeLeg[] = [];
  let left = amount;

  for (const bucket of buckets) {
    if (left <= 0) break;
    const take = Math.min(left, bucket.capacity);
    if (take <= 0) continue;
    legs.push({ card: bucket.card, amount: take, rate: bucket.rate, points: take * bucket.rate });
    left -= take;
  }

  // Anything left over earns the best base rate available.
  if (left > 0 && active.length > 0) {
    const fallback = [...active].sort((a, b) => b.baseMultiplier - a.baseMultiplier)[0];
    const existing = legs.find((leg) => leg.card.cardAccountId === fallback.cardAccountId);
    const points = left * fallback.baseMultiplier;

    if (existing && existing.rate === fallback.baseMultiplier) {
      existing.amount += left;
      existing.points += points;
    } else {
      legs.push({
        card: fallback,
        amount: left,
        rate: fallback.baseMultiplier,
        points,
      });
    }
    left = 0;
  }

  const totalPoints = legs.reduce((sum, leg) => sum + leg.points, 0);

  return {
    legs,
    totalPoints,
    singleCardPoints,
    pointsGainedBySplitting: Math.max(0, totalPoints - singleCardPoints),
    requiresSplit: legs.length > 1,
  };
}

export interface CardRecommendation {
  card: CardPosition | null;
  runnerUp: CardPosition | null;
  /** Rate the recommended card earns on the next eligible dollar. */
  rate: number;
  /** Bonus points still capturable across every active card. */
  bonusPointsAvailable: number;
  reason: string;
}

/**
 * Names the card the next eligible charge should go on.
 *
 * Ranked by the rate the next dollar earns, not by remaining runway — with
 * mixed products those disagree, and the rate is the one that earns points.
 * Runway only breaks ties between cards paying the same rate.
 */
export function recommendCard(cards: CardPosition[]): CardRecommendation {
  const active = cards
    .filter((card) => card.accountStatus === "active")
    .sort(
      (a, b) =>
        marginalRate(b) - marginalRate(a) ||
        b.remainingRunway - a.remainingRunway ||
        a.nickname.localeCompare(b.nickname),
    );

  const totalBonusAvailable = active.reduce((sum, card) => sum + bonusPointsAvailable(card), 0);

  if (active.length === 0) {
    return {
      card: null, runnerUp: null, rate: 0, bonusPointsAvailable: 0,
      reason: "No active card accounts.",
    };
  }

  const [best, second = null] = active;
  const rate = marginalRate(best);

  if (bonusPointsAvailable(best) <= 0) {
    return {
      card: best,
      runnerUp: second,
      rate,
      bonusPointsAvailable: totalBonusAvailable,
      reason:
        totalBonusAvailable > 0
          ? `Every bonus category is capped out; ${best.nickname} pays the best remaining rate at ${rate}x.`
          : `No bonus rate is left this year — ${best.nickname} earns ${rate}x flat.`,
    };
  }

  const detail =
    second && marginalRate(second) === rate
      ? `${formatShortMoney(best.remainingRunway)} of runway at ${rate}x, tied on rate with ${second.nickname}.`
      : second
        ? `Earns ${rate}x versus ${marginalRate(second)}x on ${second.nickname}, with ${formatShortMoney(best.remainingRunway)} of runway left.`
        : `Earns ${rate}x with ${formatShortMoney(best.remainingRunway)} of runway left.`;

  return { card: best, runnerUp: second, rate, bonusPointsAvailable: totalBonusAvailable, reason: detail };
}

function formatShortMoney(value: number): string {
  if (Math.abs(value) >= 1000) return `$${Math.round(value / 1000)}k`;
  return `$${Math.round(value)}`;
}
