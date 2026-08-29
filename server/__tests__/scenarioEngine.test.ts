import { describe, expect, it } from "vitest";
import {
  ASSET_CLASS_FACTOR_BETAS,
  DEFAULT_FACTORS,
  DEFAULT_FACTOR_CORRELATION,
  HISTORICAL_SCENARIOS,
  HYPOTHETICAL_SCENARIOS,
  ScenarioEngine,
  holdingsToPortfolioHoldings,
  type PortfolioHolding,
  type ScenarioDefinition,
} from "../scenarioEngine";

const engine = new ScenarioEngine();

/** A plain 60/40, the simplest book whose factor arithmetic can be checked by hand. */
const BOOK: PortfolioHolding[] = [
  { name: "Equity Sleeve", assetClass: "US Equity", weight: 0.6 },
  { name: "Bond Sleeve", assetClass: "Fixed Income", weight: 0.4 },
];

const scenario = (shocks: ScenarioDefinition["shocks"], over: Partial<ScenarioDefinition> = {}): ScenarioDefinition => ({
  name: "Test", description: "", category: "hypothetical", shocks, ...over,
});

describe("factor model arithmetic", () => {
  // r_i = sum_k beta_ik * shock_k. Expected values worked out by hand from
  // ASSET_CLASS_FACTOR_BETAS rather than by running the engine.
  const s = scenario({ equity: -0.20, rates: -0.01, credit: 0.03 });
  const result = engine.runScenario(BOOK, s, 1_000_000);

  it("applies each asset's betas to each shock", () => {
    const [eq, bond] = result.assetImpacts;
    expect(eq.impact).toBeCloseTo(-0.196, 12);
    expect(bond.impact).toBeCloseTo(0.079, 12);
  });

  it("aggregates to the weighted portfolio impact", () => {
    expect(result.totalImpact).toBeCloseTo(-0.086, 12);
  });

  it("converts impact to currency against the portfolio value", () => {
    expect(result.impactAmount).toBeCloseTo(-86_000, 6);
    expect(result.stressedValue).toBeCloseTo(914_000, 6);
  });

  it("decomposes the impact by factor", () => {
    expect(result.factorImpacts.equity).toBeCloseTo(-0.124, 12);
    expect(result.factorImpacts.rates).toBeCloseTo(0.0326, 12);
    expect(result.factorImpacts.credit).toBeCloseTo(0.0054, 12);
  });

  it("has factor contributions that sum back to the total", () => {
    const summed = DEFAULT_FACTORS.reduce((s, f) => s + result.factorImpacts[f.id], 0);
    expect(summed).toBeCloseTo(result.totalImpact, 12);
  });

  it("leaves unshocked factors contributing nothing", () => {
    for (const id of ["fx", "commodity", "volatility", "inflation", "liquidity"]) {
      expect(result.factorImpacts[id]).toBe(0);
    }
  });

  it("gives a zero shock a zero impact", () => {
    expect(engine.runScenario(BOOK, scenario({}), 1e6).totalImpact).toBe(0);
  });

  it("scales linearly in the shock", () => {
    const one = engine.runScenario(BOOK, scenario({ equity: -0.10 }), 1e6).totalImpact;
    const two = engine.runScenario(BOOK, scenario({ equity: -0.20 }), 1e6).totalImpact;
    expect(two).toBeCloseTo(2 * one, 12);
  });

  it("moves a bond sleeve the opposite way to a rate rise", () => {
    // Fixed Income carries a rates beta of -8, so a positive rate shock hurts.
    const up = engine.runScenario(
      [{ name: "B", assetClass: "Fixed Income", weight: 1 }], scenario({ rates: 0.01 }), 1e6);
    expect(up.totalImpact).toBeLessThan(0);
  });
});

describe("asset class resolution", () => {
  it("falls back to Other for an unrecognised class", () => {
    const known = engine.runScenario(
      [{ name: "X", assetClass: "Other", weight: 1 }], scenario({ equity: -0.3 }), 1e6);
    const unknown = engine.runScenario(
      [{ name: "X", assetClass: "Wildly Made Up", weight: 1 }], scenario({ equity: -0.3 }), 1e6);
    expect(unknown.totalImpact).toBeCloseTo(known.totalImpact, 12);
  });

  it("honours per-holding beta overrides", () => {
    const overridden = engine.runScenario(
      [{ name: "X", assetClass: "US Equity", weight: 1, factorBetas: { equity: 0.5 } }],
      scenario({ equity: -0.20 }), 1e6);
    expect(overridden.totalImpact).toBeCloseTo(-0.10, 12);
  });

  it("keeps unoverridden betas from the base class", () => {
    const r = engine.runScenario(
      [{ name: "X", assetClass: "US Equity", weight: 1, factorBetas: { equity: 0.5 } }],
      scenario({ equity: -0.20, credit: 0.10 }), 1e6);
    // credit beta stays at the US Equity value of 0.10.
    expect(r.factorImpacts.credit).toBeCloseTo(0.01, 12);
  });

  it("covers every default factor for every default asset class", () => {
    for (const [name, betas] of Object.entries(ASSET_CLASS_FACTOR_BETAS)) {
      for (const f of DEFAULT_FACTORS) {
        expect(typeof (betas as Record<string, number>)[f.id], `${name}.${f.id}`).toBe("number");
      }
    }
  });
});

describe("VaR and CVaR coherence", () => {
  // CVaR is the mean loss beyond VaR, so it can never be the milder number.
  // It previously was, in every preset scenario, because VaR ignored the
  // scenario impact while CVaR added it.
  it.each([...HISTORICAL_SCENARIOS, ...HYPOTHETICAL_SCENARIOS].map((s) => [s.name, s] as const))(
    "keeps CVaR at least as severe as VaR in %s",
    (_name, s) => {
      const r = engine.runScenario(BOOK, s, 1e6);
      expect(r.cvar95).toBeGreaterThanOrEqual(r.parametricVaR95);
      expect(r.cvar99).toBeGreaterThanOrEqual(r.parametricVaR99);
    },
  );

  it("makes the 99% level at least as severe as the 95%", () => {
    for (const s of HISTORICAL_SCENARIOS) {
      const r = engine.runScenario(BOOK, s, 1e6);
      expect(r.parametricVaR99).toBeGreaterThanOrEqual(r.parametricVaR95);
      expect(r.cvar99).toBeGreaterThanOrEqual(r.cvar95);
    }
  });

  // The failure that made the old numbers unusable: a deeper shock reported a
  // smaller tail loss, because the negative impact cancelled the tail term.
  it("reports a worse loss as the scenario deepens", () => {
    const losses = [-0.05, -0.20, -0.40, -0.60].map(
      (eq) => engine.runScenario(BOOK, scenario({ equity: eq }, { regime: "crisis" }), 1e6));
    for (let i = 1; i < losses.length; i++) {
      expect(losses[i].totalImpact).toBeLessThan(losses[i - 1].totalImpact);
      expect(losses[i].cvar95).toBeGreaterThan(losses[i - 1].cvar95);
      expect(losses[i].parametricVaR95).toBeGreaterThan(losses[i - 1].parametricVaR95);
    }
  });

  it("widens the tail under a crisis regime", () => {
    const calm = engine.runScenario(BOOK, scenario({ equity: -0.2 }), 1e6);
    const crisis = engine.runScenario(BOOK, scenario({ equity: -0.2 }, { regime: "crisis" }), 1e6);
    expect(crisis.parametricVaR95).toBeGreaterThan(calm.parametricVaR95);
  });

  it("orders the regime volatility multipliers", () => {
    const at = (regime?: ScenarioDefinition["regime"]) =>
      engine.runScenario(BOOK, scenario({ equity: -0.1 }, { regime }), 1e6).parametricVaR95;
    expect(at("crisis")).toBeGreaterThan(at("contraction"));
    expect(at("contraction")).toBeGreaterThan(at("expansion"));
  });
});

describe("preset scenarios", () => {
  it("ships eight historical and several hypothetical scenarios", () => {
    expect(HISTORICAL_SCENARIOS.length).toBeGreaterThanOrEqual(8);
    expect(HYPOTHETICAL_SCENARIOS.length).toBeGreaterThan(0);
  });

  it("loses money on every historical crisis for a 60/40", () => {
    for (const s of HISTORICAL_SCENARIOS) {
      expect(engine.runScenario(BOOK, s, 1e6).totalImpact, s.name).toBeLessThan(0);
    }
  });

  it("names 2008 the worst of the historical set", () => {
    const cmp = engine.compareScenarios(BOOK, HISTORICAL_SCENARIOS, 1e6);
    expect(cmp.worstCase.scenarioName).toMatch(/2008/);
  });

  it("gives every preset a category and a description", () => {
    for (const s of [...HISTORICAL_SCENARIOS, ...HYPOTHETICAL_SCENARIOS]) {
      expect(s.description.length, s.name).toBeGreaterThan(0);
      expect(["historical", "hypothetical"]).toContain(s.category);
    }
  });
});

describe("compareScenarios", () => {
  const cmp = engine.compareScenarios(BOOK, HISTORICAL_SCENARIOS, 1e6);

  it("ranks from worst to best", () => {
    for (let i = 1; i < cmp.ranking.length; i++) {
      expect(cmp.ranking[i].impact).toBeGreaterThanOrEqual(cmp.ranking[i - 1].impact);
    }
    expect(cmp.ranking[0].rank).toBe(1);
  });

  it("agrees with its own ranking about the extremes", () => {
    expect(cmp.worstCase.scenarioName).toBe(cmp.ranking[0].name);
    expect(cmp.bestCase.scenarioName).toBe(cmp.ranking[cmp.ranking.length - 1].name);
  });

  it("reports a range equal to best minus worst", () => {
    expect(cmp.impactRange).toBeCloseTo(cmp.bestCase.totalImpact - cmp.worstCase.totalImpact, 12);
  });

  it("runs every preset when asked for all of them", () => {
    const all = engine.runAllPresets(BOOK, 1e6);
    expect(all.scenarios).toHaveLength(HISTORICAL_SCENARIOS.length + HYPOTHETICAL_SCENARIOS.length);
  });
});

describe("Monte Carlo", () => {
  const cfg = { numSimulations: 400 };

  // A stress figure an investment committee cannot reproduce is not one they
  // can act on. The draws were previously seeded from the clock.
  it("returns identical results for the same seed", () => {
    const a = engine.runMonteCarloScenario(BOOK, scenario({ equity: -0.2 }), 1e6, cfg);
    const b = engine.runMonteCarloScenario(BOOK, scenario({ equity: -0.2 }), 1e6, cfg);
    expect(a.monteCarloStats).toEqual(b.monteCarloStats);
    expect(a.totalImpact).toBe(b.totalImpact);
  });

  it("returns different results for a different seed", () => {
    const a = engine.runMonteCarloScenario(BOOK, scenario({ equity: -0.2 }), 1e6, cfg);
    const b = engine.runMonteCarloScenario(BOOK, scenario({ equity: -0.2 }), 1e6, { ...cfg, seed: 999 });
    expect(a.monteCarloStats!.meanImpact).not.toBe(b.monteCarloStats!.meanImpact);
  });

  it("centres the distribution near the deterministic impact", () => {
    const deterministic = engine.runScenario(BOOK, scenario({ equity: -0.2 }), 1e6).totalImpact;
    const mc = engine.runMonteCarloScenario(BOOK, scenario({ equity: -0.2 }), 1e6,
      { numSimulations: 3000, fatTails: false });
    expect(mc.monteCarloStats!.meanImpact).toBeCloseTo(deterministic, 1);
  });

  it("orders its percentiles", () => {
    const s = engine.runMonteCarloScenario(BOOK, scenario({ equity: -0.2 }), 1e6, cfg).monteCarloStats!;
    expect(s.percentile1).toBeLessThanOrEqual(s.percentile5);
    expect(s.percentile5).toBeLessThanOrEqual(s.medianImpact);
    expect(s.medianImpact).toBeLessThanOrEqual(s.percentile95);
  });

  it("produces fatter tails with Student-t than with normal draws", () => {
    const normal = engine.runMonteCarloScenario(BOOK, scenario({ equity: -0.2 }), 1e6,
      { numSimulations: 3000, fatTails: false });
    const fat = engine.runMonteCarloScenario(BOOK, scenario({ equity: -0.2 }), 1e6,
      { numSimulations: 3000, fatTails: true, degreesOfFreedom: 4 });
    expect(fat.monteCarloStats!.kurtosis).toBeGreaterThan(normal.monteCarloStats!.kurtosis);
  });

  it("widens the distribution over a longer horizon", () => {
    const short = engine.runMonteCarloScenario(BOOK, scenario({ equity: -0.2 }), 1e6,
      { numSimulations: 2000, fatTails: false, horizonDays: 21 });
    const long = engine.runMonteCarloScenario(BOOK, scenario({ equity: -0.2 }), 1e6,
      { numSimulations: 2000, fatTails: false, horizonDays: 252 });
    expect(long.monteCarloStats!.stdDevImpact).toBeGreaterThan(short.monteCarloStats!.stdDevImpact);
  });

  it("keeps expected shortfall at or beyond the 5th percentile", () => {
    const s = engine.runMonteCarloScenario(BOOK, scenario({ equity: -0.2 }), 1e6,
      { numSimulations: 2000 }).monteCarloStats!;
    expect(s.tailExpectedShortfall).toBeLessThanOrEqual(s.percentile5);
  });
});

describe("reverseStressTest", () => {
  it("finds a shock that produces roughly the requested loss", () => {
    const r = engine.reverseStressTest(BOOK, -0.25, 1e6);
    expect(r.achievedLoss).toBeCloseTo(-0.25, 2);
  });

  it("needs a larger shock for a larger loss", () => {
    const magnitude = (r: { requiredShocks: Record<string, number | undefined> }) =>
      Math.sqrt(Object.values(r.requiredShocks).reduce((s, v) => s + (v ?? 0) ** 2, 0));
    const mild = engine.reverseStressTest(BOOK, -0.10, 1e6);
    const severe = engine.reverseStressTest(BOOK, -0.30, 1e6);
    expect(magnitude(severe as never)).toBeGreaterThan(magnitude(mild as never));
  });

  it("returns the shocks that get there", () => {
    const r = engine.reverseStressTest(BOOK, -0.20, 1e6);
    expect(r.requiredShocks).toBeDefined();
    expect(Object.values(r.requiredShocks).some((v) => v !== 0)).toBe(true);
  });
});

describe("holdingsToPortfolioHoldings", () => {
  it("normalizes weights that are expressed as percentages", () => {
    const out = holdingsToPortfolioHoldings([
      { name: "A", assetClass: "US Equity", weight: "60" },
      { name: "B", assetClass: "Fixed Income", weight: "40" },
    ]);
    expect(out[0].weight).toBeCloseTo(0.6, 12);
    expect(out.reduce((s, h) => s + h.weight, 0)).toBeCloseTo(1, 12);
  });

  it("normalizes weights that do not already sum to a round number", () => {
    const out = holdingsToPortfolioHoldings([
      { name: "A", assetClass: "US Equity", weight: "30" },
      { name: "B", assetClass: "US Equity", weight: "30" },
    ]);
    expect(out.reduce((s, h) => s + h.weight, 0)).toBeCloseTo(1, 12);
  });

  it("accepts either weight or allocation, and either name field", () => {
    const out = holdingsToPortfolioHoldings([
      { fundName: "Legacy", assetClass: "Cash", allocation: "100" },
    ]);
    expect(out[0].name).toBe("Legacy");
    expect(out[0].weight).toBeCloseTo(1, 12);
  });

  it.each([
    ["US Equities", "US Equity"],
    ["Global Equities", "US Equity"],
    ["Public Equities", "US Equity"],
    ["Domestic Equities", "US Equity"],
    ["Domestic Equity", "US Equity"],
    ["International Developed", "International Equity"],
    ["Emerging Markets Debt", "Emerging Markets"],
    ["High Yield Credit", "High Yield"],
    ["Core Bond Fund", "Fixed Income"],
    ["Global REITs", "Real Estate"],
    ["Gold", "Commodities"],
    ["Private Equity Secondaries", "Private Equity"],
    ["Long/Short Equity", "Hedge Funds"],
    ["Money Market", "Cash"],
  ])("maps %s onto %s", (raw, expected) => {
    expect(holdingsToPortfolioHoldings([{ name: "x", assetClass: raw, weight: "1" }])[0].assetClass)
      .toBe(expected);
  });

  it("gives zero weights rather than NaN when nothing has a weight", () => {
    const out = holdingsToPortfolioHoldings([{ name: "A", assetClass: "Cash", weight: "0" }]);
    expect(out[0].weight).toBe(0);
  });
});

describe("factor configuration", () => {
  it("has a correlation matrix matching the factor count", () => {
    expect(DEFAULT_FACTOR_CORRELATION).toHaveLength(DEFAULT_FACTORS.length);
    for (const row of DEFAULT_FACTOR_CORRELATION) {
      expect(row).toHaveLength(DEFAULT_FACTORS.length);
    }
  });

  it("has a symmetric correlation matrix with a unit diagonal", () => {
    const R = DEFAULT_FACTOR_CORRELATION;
    for (let i = 0; i < R.length; i++) {
      expect(R[i][i]).toBe(1);
      for (let j = 0; j < R.length; j++) expect(R[i][j]).toBe(R[j][i]);
    }
  });

  it("keeps every correlation inside [-1, 1]", () => {
    for (const row of DEFAULT_FACTOR_CORRELATION) {
      for (const v of row) {
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  // Cholesky is what turns the correlation matrix into correlated draws; it
  // silently produces zeros on a non-positive-definite matrix, so the
  // simulation would quietly lose its correlation structure.
  it("has a correlation matrix the simulation can actually decompose", () => {
    const custom = new ScenarioEngine(DEFAULT_FACTORS, DEFAULT_FACTOR_CORRELATION);
    const mc = custom.runMonteCarloScenario(BOOK, scenario({ equity: -0.1 }), 1e6,
      { numSimulations: 500, fatTails: false });
    expect(mc.monteCarloStats!.stdDevImpact).toBeGreaterThan(0);
  });

  it("gives every factor a positive volatility", () => {
    for (const f of DEFAULT_FACTORS) expect(f.annualVol).toBeGreaterThan(0);
  });
});
