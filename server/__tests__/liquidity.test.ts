import { describe, expect, it } from "vitest";
import {
  analyzeHoldingLiquidity,
  buildLiquidityLadder,
  fractionRealizableBy,
  parseRedemptionFrequency,
  UNKNOWN_TERMS_DAYS,
  type LiquidityTerms,
} from "../liquidity";

const AS_OF = new Date(Date.UTC(2026, 0, 1));

const terms = (over: Partial<LiquidityTerms> = {}): LiquidityTerms => ({
  name: "Fund", value: 100, ...over,
});

describe("parseRedemptionFrequency", () => {
  it.each([
    ["daily", "daily"], ["Daily", "daily"], ["MONTHLY", "monthly"],
    ["quarterly", "quarterly"], ["semi-annual", "semi-annual"],
    ["semiannual", "semi-annual"], ["Semi Annual", "semi-annual"],
    ["annually", "annual"], ["yearly", "annual"], ["weekly", "weekly"],
  ] as const)("maps %s", (input, expected) => {
    expect(parseRedemptionFrequency(input)).toBe(expected);
  });

  it.each([null, undefined, "", "whenever"])("treats %s as no redemption", (v) => {
    expect(parseRedemptionFrequency(v as string)).toBe("none");
  });
});

describe("analyzeHoldingLiquidity", () => {
  it("gives a daily fund next-day liquidity", () => {
    const h = analyzeHoldingLiquidity(terms({ redemptionFrequency: "daily" }), AS_OF);
    expect(h.daysToFirstRedemption).toBe(1);
    expect(h.daysToFullLiquidation).toBe(1);
  });

  it("makes an ungated quarterly fund wait for the next window", () => {
    const h = analyzeHoldingLiquidity(terms({ redemptionFrequency: "quarterly" }), AS_OF);
    expect(h.daysToFirstRedemption).toBe(91);
  });

  // The interaction people get wrong: notice can cost an entire window, but
  // only once it outruns one. The boundary is worth pinning in both
  // directions, because "90 days notice on a quarterly fund" sounds like it
  // should cost a window and does not.
  it("keeps a quarterly fund at the first window when notice fits inside it", () => {
    for (const notice of [30, 90]) {
      const h = analyzeHoldingLiquidity(
        terms({ redemptionFrequency: "quarterly", redemptionNoticeDays: notice }), AS_OF);
      expect(h.daysToFirstRedemption).toBe(91);
    }
  });

  it("pushes a quarterly fund to the second window once notice outruns the first", () => {
    const h = analyzeHoldingLiquidity(
      terms({ redemptionFrequency: "quarterly", redemptionNoticeDays: 100 }), AS_OF);
    expect(h.daysToFirstRedemption).toBe(182);
  });

  it("costs a monthly fund two windows at 45 days notice", () => {
    const h = analyzeHoldingLiquidity(
      terms({ redemptionFrequency: "monthly", redemptionNoticeDays: 45 }), AS_OF);
    expect(h.daysToFirstRedemption).toBe(60);
  });

  it("takes whichever of lockup and notice binds", () => {
    const lockupBinds = analyzeHoldingLiquidity(
      terms({ redemptionFrequency: "quarterly", lockupMonths: 12, redemptionNoticeDays: 30 }), AS_OF);
    // 360 days of lockup needs 4 quarterly windows.
    expect(lockupBinds.daysToFirstRedemption).toBe(364);

    const noticeBinds = analyzeHoldingLiquidity(
      terms({ redemptionFrequency: "quarterly", lockupMonths: 1, redemptionNoticeDays: 200 }), AS_OF);
    expect(noticeBinds.daysToFirstRedemption).toBe(273);
  });

  // The other one: a gate makes dealing frequency almost beside the point.
  it("turns a 25% quarterly gate into a one-year exit", () => {
    const h = analyzeHoldingLiquidity(
      terms({ redemptionFrequency: "quarterly", gateProvision: 0.25 }), AS_OF);
    expect(h.windowsRequired).toBe(4);
    expect(h.daysToFirstRedemption).toBe(91);
    expect(h.daysToFullLiquidation).toBe(91 + 3 * 91);
  });

  it("treats a 100% gate as no gate", () => {
    const h = analyzeHoldingLiquidity(
      terms({ redemptionFrequency: "monthly", gateProvision: 1 }), AS_OF);
    expect(h.windowsRequired).toBe(1);
  });

  it("rounds a gate that does not divide evenly up to a whole window", () => {
    const h = analyzeHoldingLiquidity(
      terms({ redemptionFrequency: "monthly", gateProvision: 0.3 }), AS_OF);
    expect(h.windowsRequired).toBe(4); // ceil(1 / 0.3)
  });

  it("returns cash at end of life for a closed-end fund", () => {
    const h = analyzeHoldingLiquidity(
      terms({ vintageYear: 2022, fundLifeYears: 10, redemptionFrequency: "quarterly" }), AS_OF);
    expect(h.isClosedEnd).toBe(true);
    // 2032-01-01 is six years past the as-of date.
    expect(h.daysToFirstRedemption).toBeGreaterThan(6 * 365 - 3);
    expect(h.daysToFirstRedemption).toBeLessThan(6 * 365 + 3);
  });

  it("gives a closed-end fund past its life immediate liquidity rather than a negative", () => {
    const h = analyzeHoldingLiquidity(
      terms({ vintageYear: 2010, fundLifeYears: 5 }), AS_OF);
    expect(h.daysToFirstRedemption).toBe(0);
  });

  // Guessing "liquid" for an unknown fund makes the book look better than it is.
  it("treats a holding with no stated terms as illiquid, and flags it", () => {
    const h = analyzeHoldingLiquidity(terms(), AS_OF);
    expect(h.daysToFirstRedemption).toBe(UNKNOWN_TERMS_DAYS);
    expect(h.assumed).toBe(true);
  });

  it("does not let partial terms shorten an unknown redemption frequency", () => {
    const h = analyzeHoldingLiquidity(terms({ lockupMonths: 1 }), AS_OF);
    expect(h.daysToFirstRedemption).toBeGreaterThanOrEqual(UNKNOWN_TERMS_DAYS);
  });

  it("honours a lockup longer than a year with no frequency stated", () => {
    const h = analyzeHoldingLiquidity(
      terms({ lockupMonths: 36, redemptionNoticeDays: 90 }), AS_OF);
    expect(h.daysToFirstRedemption).toBe(36 * 30 + 90);
  });
});

describe("fractionRealizableBy", () => {
  const gated = analyzeHoldingLiquidity(
    terms({ redemptionFrequency: "quarterly", gateProvision: 0.25 }), AS_OF);

  it("is zero before the first window", () => {
    expect(fractionRealizableBy(gated, 90)).toBe(0);
  });

  it("releases one tranche per window", () => {
    expect(fractionRealizableBy(gated, 91)).toBeCloseTo(0.25, 10);
    expect(fractionRealizableBy(gated, 182)).toBeCloseTo(0.5, 10);
    expect(fractionRealizableBy(gated, 273)).toBeCloseTo(0.75, 10);
    expect(fractionRealizableBy(gated, 364)).toBeCloseTo(1, 10);
  });

  it("stays whole past full liquidation", () => {
    expect(fractionRealizableBy(gated, 5000)).toBe(1);
  });

  it("is all-or-nothing for an ungated holding", () => {
    const plain = analyzeHoldingLiquidity(terms({ redemptionFrequency: "monthly" }), AS_OF);
    expect(fractionRealizableBy(plain, 29)).toBe(0);
    expect(fractionRealizableBy(plain, 30)).toBe(1);
  });
});

describe("buildLiquidityLadder", () => {
  /** A realistic mixed book: liquid sleeve, hedge funds, a gated one, private credit. */
  const BOOK: LiquidityTerms[] = [
    { name: "Cash ETF", value: 200, redemptionFrequency: "daily" },
    { name: "Equity L/S", value: 300, redemptionFrequency: "monthly", redemptionNoticeDays: 30 },
    { name: "Macro", value: 200, redemptionFrequency: "quarterly", redemptionNoticeDays: 100 },
    { name: "Gated Credit", value: 100, redemptionFrequency: "quarterly", gateProvision: 0.25 },
    { name: "PC Fund II", value: 200, vintageYear: 2023, fundLifeYears: 8 },
  ];
  const ladder = buildLiquidityLadder(BOOK, AS_OF);

  it("weights by value and totals correctly", () => {
    expect(ladder.totalValue).toBe(1000);
    expect(ladder.buckets.reduce((s, b) => s + b.value, 0)).toBe(1000);
    expect(ladder.buckets.reduce((s, b) => s + b.weight, 0)).toBeCloseTo(1, 10);
  });

  it("places each holding in the bucket its first proceeds land in", () => {
    const byLabel = Object.fromEntries(ladder.buckets.map((b) => [b.label, b.value]));
    expect(byLabel["0-7 days"]).toBe(200);    // Cash ETF at 1 day
    expect(byLabel["8-30 days"]).toBe(300);   // Equity L/S at 30 days
    expect(byLabel["31-90 days"]).toBe(0);
    expect(byLabel["91-180 days"]).toBe(100); // Gated Credit, first tranche at 91
    expect(byLabel["181-365 days"]).toBe(200);// Macro: 100d notice overruns the 91d window
    expect(byLabel["1-3 years"]).toBe(0);
    expect(byLabel["Over 3 years"]).toBe(200);// PC Fund II
  });

  it("builds a cumulative curve that only ever rises", () => {
    for (let i = 1; i < ladder.cumulative.length; i++) {
      expect(ladder.cumulative[i].fraction).toBeGreaterThanOrEqual(
        ladder.cumulative[i - 1].fraction);
    }
  });

  it("counts a gated holding progressively, not all at once", () => {
    const q = ladder.cumulative.find((c) => c.days === 90)!;
    const oneEighty = ladder.cumulative.find((c) => c.days === 180)!;
    // At 90 days: Cash 200 + Equity 300 = 500. Gate has not opened.
    expect(q.value).toBeCloseTo(500, 6);
    // At 180: gate released one of four tranches (25 of 100). Macro still out.
    expect(oneEighty.value).toBeCloseTo(525, 6);
  });

  it("reports the fraction that cannot be reached inside a year", () => {
    // At 365 days everything but the closed-end fund is out: 800 of 1000.
    expect(ladder.cumulative.find((c) => c.days === 365)!.fraction).toBeCloseTo(0.8, 6);
    expect(ladder.illiquidFraction).toBeCloseTo(0.2, 6);
  });

  it("takes full liquidation from the slowest holding", () => {
    const pc = ladder.holdings.find((h) => h.name === "PC Fund II")!;
    expect(ladder.daysToFullPortfolioLiquidation).toBe(pc.daysToFullLiquidation);
  });

  it("computes a value-weighted average days to liquidity", () => {
    const expected =
      (200 * 1 + 300 * 30 + 200 * 182 + 100 * 91 + 200 * ladder.holdings[4].daysToFirstRedemption) / 1000;
    expect(ladder.weightedAverageDaysToLiquidity).toBeCloseTo(expected, 6);
  });

  it("warns about gates", () => {
    expect(ladder.warnings.join(" ")).toMatch(/carry a gate/);
  });

  it("warns when most of the book is beyond a year", () => {
    const illiquid = buildLiquidityLadder([
      { name: "PC", value: 700, vintageYear: 2024, fundLifeYears: 10 },
      { name: "Cash", value: 300, redemptionFrequency: "daily" },
    ], AS_OF);
    expect(illiquid.warnings.join(" ")).toMatch(/cannot be realized within a year/);
  });

  it("names holdings whose terms had to be assumed", () => {
    const withUnknown = buildLiquidityLadder([
      { name: "Mystery Fund", value: 100 },
      { name: "Cash", value: 100, redemptionFrequency: "daily" },
    ], AS_OF);
    expect(withUnknown.assumedHoldings).toEqual(["Mystery Fund"]);
    expect(withUnknown.warnings.join(" ")).toMatch(/no stated redemption terms/);
  });

  it("handles an empty portfolio", () => {
    const empty = buildLiquidityLadder([], AS_OF);
    expect(empty.totalValue).toBe(0);
    expect(empty.buckets.every((b) => b.value === 0)).toBe(true);
    expect(empty.illiquidFraction).toBe(0);
  });

  it("handles holdings carrying no value without dividing by zero", () => {
    const zero = buildLiquidityLadder([{ name: "A", value: 0, redemptionFrequency: "daily" }], AS_OF);
    expect(Number.isNaN(zero.weightedAverageDaysToLiquidity)).toBe(false);
    expect(zero.warnings.join(" ")).toMatch(/no market value/);
  });

  it("is stable regardless of holding order", () => {
    const reversed = buildLiquidityLadder([...BOOK].reverse(), AS_OF);
    expect(reversed.illiquidFraction).toBeCloseTo(ladder.illiquidFraction, 10);
    expect(reversed.weightedAverageDaysToLiquidity)
      .toBeCloseTo(ladder.weightedAverageDaysToLiquidity, 10);
  });
});
