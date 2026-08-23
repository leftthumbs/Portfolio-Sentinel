import { describe, expect, it } from "vitest";
import { optimizePortfolio } from "../optimizer";

const ITEMS = [
  { name: "Equity L/S", expectedReturn: 0.12, volatility: 0.14, weight: 25 },
  { name: "Equity L/S II", expectedReturn: 0.11, volatility: 0.13, weight: 25 },
  { name: "Managed Futures", expectedReturn: 0.08, volatility: 0.12, weight: 25 },
  { name: "Private Credit", expectedReturn: 0.09, volatility: 0.06, weight: 25 },
];

const weightsOf = (r: ReturnType<typeof optimizePortfolio>) =>
  r.weights.map((w) => w.weight);

/** Two near-identical strategies, one genuine diversifier. */
const REALISTIC = [
  [1.00, 0.92, 0.05, 0.30],
  [0.92, 1.00, 0.02, 0.28],
  [0.05, 0.02, 1.00, 0.10],
  [0.30, 0.28, 0.10, 1.00],
];

/** What the optimizer assumed before real correlations were available. */
const FLAT = ITEMS.map((_, i) => ITEMS.map((_, j) => (i === j ? 1 : 0.3)));

describe("determinism", () => {
  // An allocation recommendation that changes between runs cannot be
  // reproduced, reviewed, or defended to an investment committee.
  it.each(["max_sharpe", "max_convexity", "max_return"] as const)(
    "returns the same %s allocation on repeated runs",
    (goal) => {
      const a = optimizePortfolio(ITEMS, goal, REALISTIC);
      const b = optimizePortfolio(ITEMS, goal, REALISTIC);
      expect(weightsOf(a)).toEqual(weightsOf(b));
      expect(a.sharpeRatio).toBe(b.sharpeRatio);
    },
  );

  it("stays stable across many runs", () => {
    const first = weightsOf(optimizePortfolio(ITEMS, "max_sharpe", REALISTIC));
    for (let i = 0; i < 5; i++) {
      expect(weightsOf(optimizePortfolio(ITEMS, "max_sharpe", REALISTIC))).toEqual(first);
    }
  });
});

describe("correlation inputs", () => {
  it("changes the allocation when correlations change", () => {
    const flat = optimizePortfolio(ITEMS, "max_sharpe", FLAT);
    const real = optimizePortfolio(ITEMS, "max_sharpe", REALISTIC);
    expect(weightsOf(real)).not.toEqual(weightsOf(flat));
  });

  /** Equal-weight portfolio volatility under a given correlation matrix. */
  const equalWeightVol = (m: number[][]) => {
    const w = 0.25;
    let variance = 0;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        variance += w * w * ITEMS[i].volatility * ITEMS[j].volatility * m[i][j];
      }
    }
    return Math.sqrt(variance);
  };

  // The flat assumption is not merely imprecise, it errs in whichever
  // direction the book happens to lean — and a risk figure that is wrong in an
  // unknown direction is worse than one that is wrong by a known amount.
  it("understates risk when holdings are more correlated than assumed", () => {
    // Two of these four are nearly the same bet (0.92). That concentration
    // outweighs the one genuine diversifier, so a flat 0.3 flatters the book.
    expect(equalWeightVol(REALISTIC)).toBeGreaterThan(equalWeightVol(FLAT));
  });

  it("overstates risk when holdings are less correlated than assumed", () => {
    const allDiversifiers = ITEMS.map((_, i) =>
      ITEMS.map((_, j) => (i === j ? 1 : 0.05)),
    );
    expect(equalWeightVol(allDiversifiers)).toBeLessThan(equalWeightVol(FLAT));
  });

  it("falls back to the flat assumption when given no matrix", () => {
    expect(weightsOf(optimizePortfolio(ITEMS, "max_sharpe")))
      .toEqual(weightsOf(optimizePortfolio(ITEMS, "max_sharpe", FLAT)));
  });

  it("leaves max_return alone, which ignores risk by definition", () => {
    const a = optimizePortfolio(ITEMS, "max_return", REALISTIC);
    expect(weightsOf(a)).toEqual([100, 0, 0, 0]);
  });
});

describe("output shape", () => {
  it.each(["max_return", "max_sharpe", "max_convexity"] as const)(
    "returns weights summing to 100 for %s",
    (goal) => {
      const total = weightsOf(optimizePortfolio(ITEMS, goal, REALISTIC))
        .reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(100, 1);
    },
  );

  it.each(["max_return", "max_sharpe", "max_convexity"] as const)(
    "never allocates a negative weight for %s",
    (goal) => {
      for (const w of weightsOf(optimizePortfolio(ITEMS, goal, REALISTIC))) {
        expect(w).toBeGreaterThanOrEqual(0);
      }
    },
  );

  it("names every holding it was given", () => {
    const r = optimizePortfolio(ITEMS, "max_sharpe", REALISTIC);
    expect(r.weights.map((w) => w.name)).toEqual(ITEMS.map((i) => i.name));
  });

  it("produces finite metrics, not NaN", () => {
    const r = optimizePortfolio(ITEMS, "max_sharpe", REALISTIC);
    for (const v of [r.expectedReturn, r.volatility, r.sharpeRatio, r.convexity]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("handles a single holding", () => {
    const r = optimizePortfolio([ITEMS[0]], "max_sharpe", [[1]]);
    expect(weightsOf(r)).toEqual([100]);
  });

  it("rejects an unknown goal", () => {
    expect(() => optimizePortfolio(ITEMS, "nonsense" as never)).toThrow();
  });
});
