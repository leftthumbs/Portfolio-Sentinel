/**
 * Portfolio-level liquidity ladder.
 *
 * Redemption terms are held per fund — lockups, notice periods, dealing
 * frequency, gates — but the question an allocator actually has is about the
 * book as a whole: how much of this can I turn into cash inside ninety days,
 * and how long would a full exit take? Answering it means combining terms that
 * interact in non-obvious ways.
 *
 * Two interactions drive most of the surprise:
 *
 *  - A notice period can cost a whole dealing window. A quarterly fund with 90
 *    days' notice is not a 90-day fund: miss the notice deadline for the next
 *    window and the money is six months out, not three.
 *  - A gate caps how much leaves per window, so full liquidation takes
 *    ceil(1/gate) windows however generous the dealing frequency looks. A 25%
 *    quarterly gate is a one-year exit at best.
 *
 * Everything here is terms-based. It says nothing about whether a manager will
 * actually meet redemptions under stress, which is a different question and
 * not one the documents answer.
 */

export type RedemptionFrequency =
  | "daily" | "weekly" | "monthly" | "quarterly"
  | "semi-annual" | "annual" | "none";

/** Nominal days per dealing window. */
const WINDOW_DAYS: Record<RedemptionFrequency, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
  quarterly: 91,
  "semi-annual": 182,
  annual: 365,
  none: Infinity,
};

export function parseRedemptionFrequency(
  value: string | null | undefined,
): RedemptionFrequency {
  if (!value) return "none";
  const v = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (v === "daily") return "daily";
  if (v === "weekly") return "weekly";
  if (v === "monthly") return "monthly";
  if (v === "quarterly") return "quarterly";
  if (v === "semi-annual" || v === "semiannual" || v === "semi-annually") return "semi-annual";
  if (v === "annual" || v === "annually" || v === "yearly") return "annual";
  return "none";
}

export interface LiquidityTerms {
  name: string;
  /** Market value; the ladder is value-weighted. */
  value: number;
  /** Remaining lockup in months. */
  lockupMonths?: number | null;
  redemptionFrequency?: string | null;
  redemptionNoticeDays?: number | null;
  /** Fraction redeemable per window, e.g. 0.25 for a 25% gate. */
  gateProvision?: number | null;
  /** Closed-end structures: no redemption, cash comes back at end of life. */
  fundLifeYears?: number | null;
  vintageYear?: number | null;
}

export interface HoldingLiquidity {
  name: string;
  value: number;
  /** Days until the first redemption proceeds are available. */
  daysToFirstRedemption: number;
  /** Days until the position could be fully realized, gates included. */
  daysToFullLiquidation: number;
  /** Windows needed to get everything out; > 1 only when gated. */
  windowsRequired: number;
  isClosedEnd: boolean;
  /** Terms were absent, so the holding was treated as illiquid. */
  assumed: boolean;
  /**
   * Set when a holding states both a wind-up date and ongoing redemption
   * terms, and the two disagree about when cash is available.
   */
  termsConflict: string | null;
}

const DAYS_PER_MONTH = 30;
const DAYS_PER_YEAR = 365;

/**
 * When terms are missing entirely we do not guess a liquid default. An unknown
 * fund treated as daily-liquid produces a ladder that reads better than the
 * book is, which is the one error worth ruling out here.
 */
export const UNKNOWN_TERMS_DAYS = 365;

export function analyzeHoldingLiquidity(
  terms: LiquidityTerms,
  asOf: Date = new Date(),
): HoldingLiquidity {
  const frequency = parseRedemptionFrequency(terms.redemptionFrequency);
  const lockupDays = Math.max(0, (terms.lockupMonths ?? 0) * DAYS_PER_MONTH);
  const noticeDays = Math.max(0, terms.redemptionNoticeDays ?? 0);

  // Closed-end: cash returns when the fund winds up.
  //
  // Funds routinely state both a wind-up date and ongoing redemption terms,
  // and the two disagree. Neither can be dismissed from the data alone — the
  // redemption terms may be a genuine early-exit facility or vestigial boiler-
  // plate — so take whichever date is later and flag the disagreement. Picking
  // the wind-up date unconditionally is not the conservative choice it looks
  // like: a lockup running past it makes the redemption path the slower one.
  if (terms.fundLifeYears && terms.vintageYear) {
    const endYear = terms.vintageYear + terms.fundLifeYears;
    const end = new Date(Date.UTC(endYear, 0, 1));
    const windUpDays = Math.max(0, Math.round((end.getTime() - asOf.getTime()) / 86400000));

    let days = windUpDays;
    let termsConflict: string | null = null;

    if (frequency !== "none") {
      const windowDays = WINDOW_DAYS[frequency];
      const threshold = Math.max(lockupDays, noticeDays);
      const redemptionDays = Math.max(1, Math.ceil(threshold / windowDays)) * windowDays;
      if (redemptionDays !== windUpDays) {
        days = Math.max(windUpDays, redemptionDays);
        termsConflict =
          `States a ${terms.fundLifeYears}-year life ending ${endYear} (${windUpDays}d) and ${terms.redemptionFrequency} redemption (${redemptionDays}d). Taking the later.`;
      }
    }

    return {
      name: terms.name,
      value: terms.value,
      daysToFirstRedemption: days,
      daysToFullLiquidation: days,
      windowsRequired: 1,
      isClosedEnd: true,
      assumed: false,
      termsConflict,
    };
  }

  if (frequency === "none") {
    const hasAnyTerms = terms.lockupMonths != null || terms.redemptionNoticeDays != null;
    const days = hasAnyTerms ? Math.max(lockupDays + noticeDays, UNKNOWN_TERMS_DAYS) : UNKNOWN_TERMS_DAYS;
    return {
      name: terms.name,
      value: terms.value,
      daysToFirstRedemption: days,
      daysToFullLiquidation: days,
      windowsRequired: 1,
      isClosedEnd: false,
      assumed: true,
      termsConflict: null,
    };
  }

  const windowDays = WINDOW_DAYS[frequency];

  // Notice must be served before a dealing date, so the binding constraint is
  // whichever of lockup and notice runs longer — and the money only comes out
  // on a window, so round up to one. At least one full window always passes.
  const threshold = Math.max(lockupDays, noticeDays);
  const windowsUntilFirst = Math.max(1, Math.ceil(threshold / windowDays));
  const daysToFirstRedemption = windowsUntilFirst * windowDays;

  // A gate caps the fraction leaving per window.
  const gate = terms.gateProvision != null && terms.gateProvision > 0 && terms.gateProvision < 1
    ? terms.gateProvision
    : 1;
  const windowsRequired = Math.ceil(1 / gate);
  const daysToFullLiquidation =
    daysToFirstRedemption + (windowsRequired - 1) * windowDays;

  return {
    name: terms.name,
    value: terms.value,
    daysToFirstRedemption,
    daysToFullLiquidation,
    windowsRequired,
    isClosedEnd: false,
    assumed: false,
    termsConflict: null,
  };
}

/**
 * Fraction of a holding realizable within `days`, stepping out one window at a
 * time as a gate releases each tranche.
 */
export function fractionRealizableBy(h: HoldingLiquidity, days: number): number {
  if (days < h.daysToFirstRedemption) return 0;
  if (days >= h.daysToFullLiquidation) return 1;

  const windowDays =
    h.windowsRequired > 1
      ? (h.daysToFullLiquidation - h.daysToFirstRedemption) / (h.windowsRequired - 1)
      : Infinity;
  const windowsElapsed = Math.floor((days - h.daysToFirstRedemption) / windowDays) + 1;
  return Math.min(1, windowsElapsed / h.windowsRequired);
}

export interface LiquidityBucket {
  label: string;
  /** Inclusive lower bound in days. */
  minDays: number;
  /** Exclusive upper bound in days; Infinity for the final bucket. */
  maxDays: number;
  value: number;
  weight: number;
}

export interface LiquidityLadder {
  totalValue: number;
  buckets: LiquidityBucket[];
  /** Cumulative realizable fraction at each standard horizon. */
  cumulative: { days: number; label: string; fraction: number; value: number }[];
  /** Value-weighted mean days to first redemption. */
  weightedAverageDaysToLiquidity: number;
  /** Longest full-liquidation horizon across holdings. */
  daysToFullPortfolioLiquidation: number;
  /** Fraction that cannot be realized inside a year. */
  illiquidFraction: number;
  /** Holdings whose terms were unknown and treated as illiquid. */
  assumedHoldings: string[];
  holdings: HoldingLiquidity[];
  warnings: string[];
}

const BUCKETS: { label: string; minDays: number; maxDays: number }[] = [
  { label: "0-7 days", minDays: 0, maxDays: 8 },
  { label: "8-30 days", minDays: 8, maxDays: 31 },
  { label: "31-90 days", minDays: 31, maxDays: 91 },
  { label: "91-180 days", minDays: 91, maxDays: 181 },
  { label: "181-365 days", minDays: 181, maxDays: 366 },
  { label: "1-3 years", minDays: 366, maxDays: 1096 },
  { label: "Over 3 years", minDays: 1096, maxDays: Infinity },
];

const HORIZONS: { days: number; label: string }[] = [
  { days: 1, label: "1 day" },
  { days: 7, label: "1 week" },
  { days: 30, label: "1 month" },
  { days: 90, label: "1 quarter" },
  { days: 180, label: "6 months" },
  { days: 365, label: "1 year" },
  { days: 730, label: "2 years" },
  { days: 1095, label: "3 years" },
];

/**
 * Builds the ladder for a set of holdings.
 *
 * Buckets place each holding by when its first proceeds arrive; the cumulative
 * curve is gate-aware, so a gated holding contributes progressively rather
 * than all at once.
 */
export function buildLiquidityLadder(
  terms: LiquidityTerms[],
  asOf: Date = new Date(),
): LiquidityLadder {
  const holdings = terms.map((t) => analyzeHoldingLiquidity(t, asOf));
  const totalValue = holdings.reduce((s, h) => s + h.value, 0);
  const warnings: string[] = [];

  if (totalValue <= 0) {
    return {
      totalValue: 0,
      buckets: BUCKETS.map((b) => ({ ...b, value: 0, weight: 0 })),
      cumulative: HORIZONS.map((h) => ({ ...h, fraction: 0, value: 0 })),
      weightedAverageDaysToLiquidity: 0,
      daysToFullPortfolioLiquidation: 0,
      illiquidFraction: 0,
      assumedHoldings: [],
      holdings,
      warnings: totalValue === 0 && holdings.length > 0
        ? ["Holdings carry no market value, so the ladder cannot be weighted."]
        : [],
    };
  }

  const buckets = BUCKETS.map((b) => {
    const value = holdings
      .filter((h) => h.daysToFirstRedemption >= b.minDays && h.daysToFirstRedemption < b.maxDays)
      .reduce((s, h) => s + h.value, 0);
    return { ...b, value, weight: value / totalValue };
  });

  const cumulative = HORIZONS.map((h) => {
    const value = holdings.reduce(
      (s, hold) => s + hold.value * fractionRealizableBy(hold, h.days),
      0,
    );
    return { ...h, fraction: value / totalValue, value };
  });

  const weightedAverageDaysToLiquidity =
    holdings.reduce((s, h) => s + h.value * h.daysToFirstRedemption, 0) / totalValue;

  const daysToFullPortfolioLiquidation = Math.max(
    ...holdings.map((h) => h.daysToFullLiquidation),
  );

  const oneYear = cumulative.find((c) => c.days === 365)!;
  const illiquidFraction = 1 - oneYear.fraction;

  const assumedHoldings = holdings.filter((h) => h.assumed).map((h) => h.name);
  if (assumedHoldings.length > 0) {
    warnings.push(
      `${assumedHoldings.length} holding(s) have no stated redemption terms and were treated as illiquid for a year. The ladder is pessimistic by however much their real terms are better.`,
    );
  }

  if (illiquidFraction > 0.5) {
    warnings.push(
      `${(illiquidFraction * 100).toFixed(0)}% of the portfolio cannot be realized within a year.`,
    );
  }

  const conflicted = holdings.filter((h) => h.termsConflict);
  for (const h of conflicted) {
    warnings.push(`${h.name}: ${h.termsConflict}`);
  }

  const gated = holdings.filter((h) => h.windowsRequired > 1);
  if (gated.length > 0) {
    warnings.push(
      `${gated.length} holding(s) carry a gate, so a full exit needs multiple dealing windows regardless of stated frequency.`,
    );
  }

  return {
    totalValue,
    buckets,
    cumulative,
    weightedAverageDaysToLiquidity,
    daysToFullPortfolioLiquidation,
    illiquidFraction,
    assumedHoldings,
    holdings,
    warnings,
  };
}
