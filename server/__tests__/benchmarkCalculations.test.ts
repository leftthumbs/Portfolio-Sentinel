import { describe, expect, it } from "vitest";
import {
  aggregateReturns,
  calculateMetricsFromAggregated,
  determineCadence,
  redemptionFrequencyToCadence,
  type ReturnDataPoint,
} from "../benchmarkCalculations";

const pt = (date: string, returnValue: number): ReturnDataPoint =>
  ({ date, returnValue: String(returnValue) }) as ReturnDataPoint;

describe("aggregateReturns", () => {
  it("compounds daily returns within a month rather than summing them", () => {
    const out = aggregateReturns(
      [pt("2024-01-05", 0.01), pt("2024-01-19", 0.02), pt("2024-02-08", -0.01)],
      "monthly",
    );
    expect(out).toHaveLength(2);
    // 1.01 * 1.02 - 1 = 0.0302, not 0.03.
    expect(parseFloat(out[0].returnValue)).toBeCloseTo(0.0302, 12);
    expect(parseFloat(out[1].returnValue)).toBeCloseTo(-0.01, 12);
  });

  it("chains the cumulative return geometrically across periods", () => {
    const out = aggregateReturns(
      [pt("2024-01-31", 0.10), pt("2024-02-29", 0.10), pt("2024-03-31", -0.10)],
      "monthly",
    );
    // 1.1 * 1.1 * 0.9 - 1
    expect(parseFloat(out[2].cumulativeReturn)).toBeCloseTo(0.089, 12);
  });

  it("groups three months into one quarter", () => {
    const out = aggregateReturns(
      [pt("2024-01-31", 0.01), pt("2024-02-29", 0.01), pt("2024-03-31", 0.01),
       pt("2024-04-30", 0.02)],
      "quarterly",
    );
    expect(out).toHaveLength(2);
    expect(parseFloat(out[0].returnValue)).toBeCloseTo(1.01 ** 3 - 1, 12);
  });

  it("orders output chronologically regardless of input order", () => {
    const out = aggregateReturns(
      [pt("2024-03-31", 0.03), pt("2024-01-31", 0.01), pt("2024-02-29", 0.02)],
      "monthly",
    );
    // Compounding a single value round-trips through (1 + r) - 1, so compare
    // approximately rather than exactly.
    out.map((r) => parseFloat(r.returnValue)).forEach((v, i) => {
      expect(v).toBeCloseTo([0.01, 0.02, 0.03][i], 12);
    });
  });

  it("passes daily data through while still chaining the cumulative", () => {
    const out = aggregateReturns([pt("2024-01-02", 0.01), pt("2024-01-03", 0.02)], "daily");
    expect(out).toHaveLength(2);
    expect(out[0].cadence).toBe("daily");
    expect(parseFloat(out[1].cumulativeReturn)).toBeCloseTo(1.01 * 1.02 - 1, 12);
  });

  it("tags every row with the cadence it was aggregated to", () => {
    const rows = [pt("2024-01-31", 0.01), pt("2024-05-31", 0.01)];
    expect(aggregateReturns(rows, "monthly").every((r) => r.cadence === "monthly")).toBe(true);
    expect(aggregateReturns(rows, "quarterly").every((r) => r.cadence === "quarterly")).toBe(true);
  });

  it("handles an empty series", () => {
    expect(aggregateReturns([], "monthly")).toEqual([]);
  });
});

describe("calculateMetricsFromAggregated", () => {
  // Twelve monthly rows of +1% each: a full year, so annualized == total.
  const monthly = aggregateReturns(
    Array.from({ length: 12 }, (_, i) =>
      pt(`2024-${String(i + 1).padStart(2, "0")}-28`, 0.01)),
    "monthly",
  );

  it("annualizes off the cadence rather than a hardcoded 252", () => {
    const m = calculateMetricsFromAggregated(monthly);
    expect(m.periodCount).toBe(12);
    expect(m.totalReturn).toBeCloseTo(1.01 ** 12 - 1, 12);
    // Exactly one year of data, so CAGR equals the total return.
    expect(m.annualizedReturn).toBeCloseTo(m.totalReturn, 12);
  });

  it("reports zero volatility for a constant return stream", () => {
    expect(calculateMetricsFromAggregated(monthly).annualizedVolatility).toBeCloseTo(0, 12);
  });

  it("scales volatility by sqrt(periods per year) for the tagged cadence", () => {
    const rows = [0.02, -0.01, 0.03, 0.00, 0.01, -0.02, 0.04, 0.01, -0.03, 0.02, 0.00, 0.01];
    const asMonthly = aggregateReturns(
      rows.map((r, i) => pt(`2024-${String(i + 1).padStart(2, "0")}-28`, r)), "monthly");
    const asQuarterly = aggregateReturns(
      rows.map((r, i) => pt(`20${20 + i}-01-31`, r)), "quarterly");

    const mv = calculateMetricsFromAggregated(asMonthly).annualizedVolatility;
    const qv = calculateMetricsFromAggregated(asQuarterly).annualizedVolatility;
    // Same dispersion, different annualization factor: sqrt(12) vs sqrt(4).
    expect(mv / qv).toBeCloseTo(Math.sqrt(12 / 4), 12);
  });

  it("returns zeroes for an empty series instead of NaN", () => {
    expect(calculateMetricsFromAggregated([])).toEqual({
      totalReturn: 0, annualizedReturn: 0, annualizedVolatility: 0, periodCount: 0,
    });
  });
});

describe("determineCadence", () => {
  it("honours an explicit portfolio cadence over the period default", () => {
    expect(determineCadence("YTD", "quarterly")).toBe("quarterly");
    expect(determineCadence("10Y", "daily")).toBe("daily");
  });

  it.each([
    ["YTD", "daily"], ["LTM", "daily"], ["1Y", "daily"],
    ["3Y", "monthly"], ["5Y", "monthly"], ["10Y", "monthly"], ["SI", "monthly"],
  ] as const)("defaults %s to %s", (period, expected) => {
    expect(determineCadence(period)).toBe(expected);
  });
});

describe("redemptionFrequencyToCadence", () => {
  it.each([
    ["daily", "daily"], ["weekly", "daily"], ["monthly", "monthly"],
    ["quarterly", "quarterly"], ["semi-annual", "quarterly"], ["annual", "quarterly"],
  ] as const)("maps %s to %s", (freq, expected) => {
    expect(redemptionFrequencyToCadence(freq)).toBe(expected);
  });

  it("is case-insensitive", () => {
    expect(redemptionFrequencyToCadence("QUARTERLY")).toBe("quarterly");
  });

  it.each([null, undefined, "", "fortnightly"])(
    "returns undefined for %s so callers fall back to the period default",
    (freq) => {
      expect(redemptionFrequencyToCadence(freq as string)).toBeUndefined();
    },
  );
});
