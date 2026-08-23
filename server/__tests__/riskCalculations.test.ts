import { describe, expect, it } from "vitest";
import {
  calculateAdvancedTailMetrics,
  calculateBenchmarkMetrics,
  calculateDrawdownSeries,
  cornishFisherVaR,
  historicalExpectedShortfall,
  ledoitWolfShrinkage,
  parametricExpectedShortfall,
} from "../riskCalculations";

/**
 * 24 monthly returns. Expected values below were derived independently rather
 * than by running this code, so they pin the maths and not the implementation.
 * The benchmark has 8 down months, clearing the >= 5 threshold that the
 * downside-correlation and capture branches require.
 */
const PORTFOLIO = [
  0.021, -0.014, 0.033, 0.008, -0.027, 0.041, 0.012, -0.006,
  0.019, 0.024, -0.038, 0.007, 0.030, -0.011, 0.016, 0.002,
  -0.022, 0.028, 0.009, -0.004, 0.035, 0.013, -0.019, 0.026,
];
const BENCHMARK = [
  0.018, -0.020, 0.029, 0.011, -0.031, 0.037, 0.006, -0.009,
  0.022, 0.017, -0.045, 0.004, 0.026, -0.015, 0.014, 0.005,
  -0.028, 0.031, 0.003, -0.007, 0.030, 0.010, -0.024, 0.021,
];

const INPUT = {
  portfolioReturns: PORTFOLIO,
  benchmarkReturns: BENCHMARK,
  riskFreeRate: 0.03,
  annualizedPortfolioReturn: 0.18,
  annualizedBenchmarkReturn: 0.15,
  periodsPerYear: 12,
};

describe("calculateBenchmarkMetrics", () => {
  const m = calculateBenchmarkMetrics(INPUT);

  it.each([
    ["beta", 0.9489703292977679],
    ["correlation", 0.9904834996595888],
    ["alpha", 0.03612356048426785],
    ["trackingError", 0.010918671682230756],
    ["informationRatio", 3.308420798388506],
    ["treynorRatio", 0.15806605893674153],
    ["upsideCapture", 1.1408450704225352],
    ["downsideCapture", 0.7877094972067038],
    ["downsideCorrelation", 0.9969531429928632],
    ["tailRatio", 1.321904761904762],
    ["var99", -0.03547],
  ] as const)("computes %s", (key, expected) => {
    expect(m[key]).toBeCloseTo(expected, 12);
  });

  it("annualizes tracking error by the cadence it is given", () => {
    const daily = calculateBenchmarkMetrics({ ...INPUT, periodsPerYear: 252 });
    // Same underlying dispersion, scaled by sqrt(252/12).
    expect(daily.trackingError! / m.trackingError!).toBeCloseTo(
      Math.sqrt(252 / 12),
      12,
    );
  });

  it.each(["beta", "correlation", "upsideCapture"] as const)(
    "leaves %s unaffected by cadence",
    (key) => {
      const daily = calculateBenchmarkMetrics({ ...INPUT, periodsPerYear: 252 });
      expect(daily[key]).toBeCloseTo(m[key]!, 12);
    },
  );

  it("returns nulls rather than noise below 10 observations", () => {
    const short = calculateBenchmarkMetrics({
      ...INPUT,
      portfolioReturns: PORTFOLIO.slice(0, 9),
      benchmarkReturns: BENCHMARK.slice(0, 9),
    });
    expect(Object.values(short).every((v) => v === null)).toBe(true);
  });

  it("aligns series of unequal length on their most recent overlap", () => {
    const trimmed = calculateBenchmarkMetrics({
      ...INPUT,
      benchmarkReturns: BENCHMARK.slice(-12),
    });
    const equivalent = calculateBenchmarkMetrics({
      ...INPUT,
      portfolioReturns: PORTFOLIO.slice(-12),
      benchmarkReturns: BENCHMARK.slice(-12),
    });
    expect(trimmed.beta).toBeCloseTo(equivalent.beta!, 12);
  });

  it("holds beta near 1 when the portfolio tracks the benchmark exactly", () => {
    const same = calculateBenchmarkMetrics({
      ...INPUT,
      portfolioReturns: BENCHMARK,
    });
    expect(same.beta).toBeCloseTo(1, 12);
    expect(same.correlation).toBeCloseTo(1, 12);
    expect(same.trackingError).toBeCloseTo(0, 12);
  });
});

describe("tail risk", () => {
  it("computes Cornish-Fisher VaR at 95%", () => {
    expect(cornishFisherVaR(PORTFOLIO, 0.95)).toBeCloseTo(-0.03026519606458556, 12);
  });

  it("falls back to a plain percentile below 20 observations", () => {
    const few = PORTFOLIO.slice(0, 15);
    const sorted = [...few].sort((a, b) => a - b);
    const i = (5 / 100) * (sorted.length - 1);
    const lo = Math.floor(i);
    const expected = sorted[lo] + (sorted[lo + 1] - sorted[lo]) * (i - lo);
    expect(cornishFisherVaR(few, 0.95)).toBeCloseTo(expected, 12);
  });

  it("computes historical expected shortfall at 95%", () => {
    expect(historicalExpectedShortfall(PORTFOLIO, 0.95)).toBeCloseTo(-0.038, 12);
  });

  it("computes parametric expected shortfall at 95%", () => {
    expect(parametricExpectedShortfall(PORTFOLIO, 0.95)).toBeCloseTo(
      -0.03643010372425607,
      12,
    );
  });

  it("computes parametric expected shortfall at 99%", () => {
    expect(parametricExpectedShortfall(PORTFOLIO, 0.99)).toBeCloseTo(
      -0.04929823626025098,
      12,
    );
  });

  // Expected shortfall is the mean loss beyond VaR, so it can never be the
  // milder of the two, and a loss measure can never come back positive on a
  // series that contains losses. A sign slip here reads as a plausible number
  // on the risk page, which is why it is asserted rather than assumed.
  it.each([0.95, 0.99] as const)(
    "reports expected shortfall as a loss at least as severe as VaR (%s)",
    (confidence) => {
      const es = parametricExpectedShortfall(PORTFOLIO, confidence);
      expect(es).toBeLessThan(0);
      expect(es).toBeLessThanOrEqual(cornishFisherVaR(PORTFOLIO, confidence));
    },
  );

  it("keeps parametric and historical shortfall on the same side of zero", () => {
    expect(
      Math.sign(parametricExpectedShortfall(PORTFOLIO, 0.95)),
    ).toBe(Math.sign(historicalExpectedShortfall(PORTFOLIO, 0.95)));
  });

  it("surfaces both shortfall flavours through the advanced metrics", () => {
    const t = calculateAdvancedTailMetrics(PORTFOLIO, [], 0.03, 12);
    expect(t.parametricES95).toBeLessThan(0);
    expect(t.parametricES99).toBeLessThan(t.parametricES95);
    expect(t.historicalES95).toBeLessThan(0);
  });
});

describe("calculateDrawdownSeries", () => {
  it("measures depth from the running peak", () => {
    const { drawdowns } = calculateDrawdownSeries([100, 110, 88, 99, 121]);
    expect(drawdowns).toEqual([0, 0, 0.2, 0.1, 0]);
  });

  it("closes a period once the prior peak is regained", () => {
    const { periods } = calculateDrawdownSeries([100, 80, 90, 100, 120]);
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({ start: 1, end: 3, duration: 2, recovered: true });
    expect(periods[0].depth).toBeCloseTo(0.2, 12);
  });

  it("marks a drawdown still open at the end as unrecovered", () => {
    const { periods } = calculateDrawdownSeries([100, 120, 90]);
    expect(periods).toHaveLength(1);
    expect(periods[0].recovered).toBe(false);
    expect(periods[0].depth).toBeCloseTo(0.25, 12);
  });

  it("reports no drawdown for a monotonically rising series", () => {
    const { drawdowns, periods } = calculateDrawdownSeries([1, 2, 3, 4]);
    expect(periods).toEqual([]);
    expect(drawdowns.every((d) => d === 0)).toBe(true);
  });

  it("handles an empty series", () => {
    expect(calculateDrawdownSeries([])).toEqual({ drawdowns: [], periods: [] });
  });
});

describe("ledoitWolfShrinkage", () => {
  const rows = Array.from({ length: 60 }, (_, t) => [
    Math.sin(t / 3) / 50,
    Math.cos(t / 4) / 40,
    Math.sin(t / 5 + 1) / 60,
  ]);

  it("returns a square matrix matching the asset count", () => {
    const cov = ledoitWolfShrinkage(rows);
    expect(cov).toHaveLength(3);
    expect(cov.every((r) => r.length === 3)).toBe(true);
  });

  it("is symmetric", () => {
    const cov = ledoitWolfShrinkage(rows);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect(cov[i][j]).toBeCloseTo(cov[j][i], 12);
      }
    }
  });

  it("keeps variances non-negative on the diagonal", () => {
    for (const d of ledoitWolfShrinkage(rows).map((r, i) => r[i])) {
      expect(d).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns empty for degenerate input", () => {
    expect(ledoitWolfShrinkage([])).toEqual([]);
    expect(ledoitWolfShrinkage([[0.1]])).toEqual([]);
  });
});
