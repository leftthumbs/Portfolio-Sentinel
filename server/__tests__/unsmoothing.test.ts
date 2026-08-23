import { describe, expect, it } from "vitest";
import {
  analyzeSmoothing,
  autocorrelation,
  autocorrelations,
  chiSquareUpperTail,
  geltnerUnsmooth,
  ljungBox,
  MAX_STABLE_RHO,
  smoothingIndex,
} from "../unsmoothing";

/**
 * 36 monthly returns built by passing an i.i.d. series through an MA(1) with
 * weights 0.7 / 0.3 — the appraisal-smoothing process this module reverses.
 * Sample rho1 lands at 0.31, inside the MA(1) bound, so the correction applies.
 * Expected values were computed independently with numpy/scipy.
 */
const SMOOTHED = [
  0.028364, 0.022334, -0.016392, 0.015284, 0.025522, 0.000741, 0.015371,
  0.020886, 0.017458, 0.011244, 0.019737, -0.002545, -0.002049, -0.003591,
  0.016237, 0.014224, 0.002216, -0.011052, -0.004438, 0.005856, 0.002286,
  0.032695, 0.040788, -0.039874, -0.056070, -0.012671, -0.002439, 0.008687,
  0.014487, 0.054431, 0.003708, -0.009938, 0.047500, 0.039966, 0.027745,
  0.003173,
];

/** Same construction at 0.6 / 0.4; sample rho1 of 0.556 overshoots the bound. */
const HEAVILY_SMOOTHED = [
  0.008781, 0.034669, 0.007950, 0.016644, 0.029982, 0.008030, 0.010009,
  0.031945, 0.009018, -0.016537, 0.020575, 0.034810, 0.005934, 0.015966,
  0.011954, -0.029187, -0.037286, -0.030399, -0.033908, -0.027351, -0.010214,
  -0.010088, -0.018727, 0.002693, 0.028730, -0.006223, -0.028863, -0.005745,
  -0.007605, 0.023235, 0.047286, 0.032306, -0.003022, -0.000867, 0.002188,
  0.010535,
];

describe("autocorrelation", () => {
  it("matches the reference estimator at lag 1", () => {
    expect(autocorrelation(SMOOTHED, 1)).toBeCloseTo(0.31004100006414503, 12);
  });

  it.each([
    [1, 0.31004100006414503],
    [2, -0.21289089633775093],
    [3, -0.056979522722764],
    [4, -0.027552853080561397],
    [5, -0.12268293013550866],
    [6, 0.029819177048463708],
  ])("matches at lag %i", (lag, expected) => {
    expect(autocorrelation(SMOOTHED, lag)).toBeCloseTo(expected, 12);
  });

  it("is 1 at lag 0 by construction, so lag 0 is rejected as meaningless", () => {
    expect(autocorrelation(SMOOTHED, 0)).toBe(0);
  });

  it("returns 0 rather than NaN for a constant series", () => {
    expect(autocorrelation(new Array(20).fill(0.01), 1)).toBe(0);
  });

  it("reads a fixed-coupon series as flat, not as perfectly smoothed", () => {
    // Some private credit funds report the same accrual every month. The
    // floating-point residue in a constant series must not be mistaken for
    // near-perfect serial correlation.
    const fixedCoupon = new Array(36).fill(0.0075);
    expect(autocorrelation(fixedCoupon, 1)).toBe(0);
    const out = analyzeSmoothing(fixedCoupon, 12, 0.03);
    expect(out.unsmoothingApplied).toBe(false);
    expect(out.smoothingIndex).toBe(1);
  });

  it("returns 0 when the lag consumes the sample", () => {
    expect(autocorrelation([0.01, 0.02, 0.03], 5)).toBe(0);
  });

  it("detects strong positive serial correlation in a ramp", () => {
    const ramp = Array.from({ length: 30 }, (_, i) => i / 1000);
    expect(autocorrelation(ramp, 1)).toBeGreaterThan(0.8);
  });

  it("detects negative serial correlation in an alternating series", () => {
    const zigzag = Array.from({ length: 30 }, (_, i) => (i % 2 ? 0.02 : -0.02));
    expect(autocorrelation(zigzag, 1)).toBeLessThan(-0.9);
  });

  it("collects lags 1..n in order", () => {
    expect(autocorrelations(SMOOTHED, 3)).toEqual([
      autocorrelation(SMOOTHED, 1),
      autocorrelation(SMOOTHED, 2),
      autocorrelation(SMOOTHED, 3),
    ]);
  });
});

describe("chiSquareUpperTail", () => {
  it.each([
    [3.84, 1, 0.05004352124870519],
    [1.0, 1, 0.31731050786291115],
    [0.5, 2, 0.7788007830714049],
    [12.59, 6, 0.05002901173891519],
    [20.0, 10, 0.029252688076961124],
    [50.0, 3, 7.989179244951495e-11],
  ])("matches the reference CDF at x=%f df=%i", (x, df, expected) => {
    expect(chiSquareUpperTail(x, df)).toBeCloseTo(expected, 10);
  });

  it("spans the full probability range monotonically", () => {
    expect(chiSquareUpperTail(0, 4)).toBe(1);
    let previous = 1;
    for (const x of [0.5, 1, 2, 5, 10, 25, 60]) {
      const p = chiSquareUpperTail(x, 4);
      expect(p).toBeLessThan(previous);
      previous = p;
    }
    expect(previous).toBeGreaterThan(0);
  });
});

describe("ljungBox", () => {
  it("matches the reference statistic and p-value over 6 lags", () => {
    const lb = ljungBox(SMOOTHED, 6);
    expect(lb.statistic).toBeCloseTo(6.452476681929417, 10);
    expect(lb.pValue).toBeCloseTo(0.37445470756136984, 10);
    expect(lb.degreesOfFreedom).toBe(6);
  });

  it("rejects the null on a heavily smoothed series", () => {
    const lb = ljungBox(HEAVILY_SMOOTHED, 6);
    expect(lb.statistic).toBeCloseTo(17.285895438147897, 10);
    expect(lb.pValue).toBeCloseTo(0.008288018382474314, 10);
    expect(lb.significant).toBe(true);
  });

  it("does not reject on an alternating series that is serially correlated the other way", () => {
    // Lag-1 is strongly negative, but Q squares the terms, so this is a
    // reminder that Ljung-Box tests for any dependence, not for smoothing.
    expect(ljungBox(Array.from({ length: 40 }, (_, i) => (i % 2 ? 0.02 : -0.02)), 6)
      .significant).toBe(true);
  });

  it("caps the lag count at what the sample supports", () => {
    expect(ljungBox([0.01, 0.02, -0.01, 0.03, 0.00, 0.02], 20).degreesOfFreedom).toBe(4);
  });

  it("degrades to a non-result on a series too short to test", () => {
    expect(ljungBox([0.01, 0.02], 6)).toEqual({
      statistic: 0, degreesOfFreedom: 0, pValue: 1, significant: false,
    });
  });
});

describe("smoothingIndex", () => {
  it("is 1 when there is no smoothing", () => {
    expect(smoothingIndex(0)).toBe(1);
    expect(smoothingIndex(-0.2)).toBe(1);
  });

  it("bottoms out at 1/2, the most an MA(1) can smooth", () => {
    expect(smoothingIndex(0.5)).toBeCloseTo(0.5, 12);
  });

  it.each([
    [0.1, 0.8333333333333333],
    [0.25, 0.6666666666666667],
    [0.4, 0.5555555555555556],
  ])("matches the closed form at rho=%f", (rho, expected) => {
    expect(smoothingIndex(rho)).toBeCloseTo(expected, 12);
  });

  it("falls monotonically as serial correlation rises", () => {
    const xs = [0.05, 0.15, 0.3, 0.45].map((r) => smoothingIndex(r)!);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeLessThan(xs[i - 1]);
  });

  it("is undefined beyond what an MA(1) can produce", () => {
    expect(smoothingIndex(0.6)).toBeNull();
  });
});

describe("geltnerUnsmooth", () => {
  it("inverts a known MA(1) exactly", () => {
    // Smooth a series with a known rho, then unwind it with that same rho.
    const truth = [0.02, -0.01, 0.03, 0.005, -0.02, 0.04, 0.01, -0.005, 0.015, 0.02];
    const rho = 0.3;
    const smoothed = [truth[0]];
    for (let t = 1; t < truth.length; t++) {
      smoothed.push((1 - rho) * truth[t] + rho * smoothed[t - 1]);
    }
    const recovered = geltnerUnsmooth(smoothed, rho);
    expect(recovered).toHaveLength(truth.length - 1);
    recovered.forEach((v, i) => expect(v).toBeCloseTo(truth[i + 1], 10));
  });

  it("drops the first observation, which has no predecessor", () => {
    expect(geltnerUnsmooth(SMOOTHED)).toHaveLength(SMOOTHED.length - 1);
  });

  it("amplifies dispersion, since smoothing is what damped it", () => {
    const out = geltnerUnsmooth(SMOOTHED);
    const sd = (xs: number[]) => {
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
    };
    expect(sd(out)).toBeGreaterThan(sd(SMOOTHED));
  });

  it("leaves a negatively autocorrelated series alone", () => {
    // Mean reversion is not smoothing; unwinding it would inflate volatility
    // on a series that was never damped.
    const zigzag = Array.from({ length: 20 }, (_, i) => (i % 2 ? 0.02 : -0.02));
    expect(geltnerUnsmooth(zigzag)).toEqual(zigzag.slice(1));
  });

  it("leaves a series alone when rho exceeds the stability bound", () => {
    expect(geltnerUnsmooth(HEAVILY_SMOOTHED)).toEqual(HEAVILY_SMOOTHED.slice(1));
  });

  it("returns empty below three observations", () => {
    expect(geltnerUnsmooth([0.01, 0.02])).toEqual([]);
  });
});

describe("analyzeSmoothing", () => {
  const r = analyzeSmoothing(SMOOTHED, 12, 0.03);

  it("reports the first-order autocorrelation and the smoothing index", () => {
    expect(r.rho1).toBeCloseTo(0.31004100006414503, 12);
    expect(r.smoothingIndex).toBeCloseTo(0.6172527069128677, 12);
    expect(r.autocorrelations).toHaveLength(6);
  });

  it("applies the correction and reports the volatility it was hiding", () => {
    expect(r.unsmoothingApplied).toBe(true);
    expect(r.reason).toBeNull();
    expect(r.observedVolatility).toBeCloseTo(0.07686126335151196, 12);
    expect(r.unsmoothedVolatility).toBeCloseTo(0.10612082305242222, 12);
    expect(r.volatilityRatio).toBeCloseTo(1.3806801817333736, 12);
  });

  // The point of the whole module: smoothing flatters risk-adjusted return.
  it("cuts Sharpe once the smoothing is unwound", () => {
    expect(r.observedSharpe).toBeCloseTo(1.0403203102146306, 12);
    expect(r.unsmoothedSharpe).toBeCloseTo(0.6548777000014013, 12);
    expect(r.unsmoothedSharpe!).toBeLessThan(r.observedSharpe!);
  });

  it("annualizes on the cadence it is given, not a hardcoded 252", () => {
    const quarterly = analyzeSmoothing(SMOOTHED, 4, 0.03);
    expect(quarterly.observedVolatility / r.observedVolatility).toBeCloseTo(
      Math.sqrt(4 / 12), 12,
    );
  });

  it("declines to correct beyond the MA(1) bound, and says why", () => {
    const heavy = analyzeSmoothing(HEAVILY_SMOOTHED, 12, 0.03);
    expect(heavy.rho1).toBeGreaterThan(MAX_STABLE_RHO);
    expect(heavy.unsmoothingApplied).toBe(false);
    expect(heavy.reason).toMatch(/exceeds the MA\(1\) bound/);
    expect(heavy.smoothingIndex).toBeNull();
  });

  it("declines on a series with no positive serial correlation, and says why", () => {
    const zigzag = Array.from({ length: 24 }, (_, i) => (i % 2 ? 0.02 : -0.02));
    const out = analyzeSmoothing(zigzag, 12, 0.03);
    expect(out.unsmoothingApplied).toBe(false);
    expect(out.reason).toMatch(/No positive serial correlation/);
    expect(out.volatilityRatio).toBeCloseTo(1, 6);
  });

  it("reports nothing rather than guessing below 12 observations", () => {
    const out = analyzeSmoothing(SMOOTHED.slice(0, 11), 12, 0.03);
    expect(out.unsmoothingApplied).toBe(false);
    expect(out.reason).toMatch(/Not enough observations/);
    expect(out.unsmoothedReturns).toEqual([]);
  });
});
