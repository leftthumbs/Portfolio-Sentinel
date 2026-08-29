import { describe, expect, it } from "vitest";
import { runBacktest, type BacktestConfig } from "../backtester";

const item = (id: string, assetClass: string, weight: string, over: Record<string, unknown> = {}) =>
  ({
    id, customPortfolioId: "p", strategyId: null, ticker: null, name: id,
    strategyType: "investment", assetClass, weight,
    expectedReturn: null, volatility: null, ...over,
  }) as never;

const BASE: BacktestConfig = {
  items: [item("equity", "US Equity", "60"), item("bonds", "Fixed Income", "40")],
  startDate: new Date("2023-01-01"),
  endDate: new Date("2023-12-31"),
  initialValue: 1_000_000,
  numSimulations: 40,
};

describe("determinism", () => {
  // Backtest results are persisted and there is an audit export over them, so
  // a stored figure has to be re-derivable from its own inputs.
  it("returns the same result for the same config", () => {
    const a = runBacktest(BASE);
    const b = runBacktest(BASE);
    expect(a.finalValue).toBe(b.finalValue);
    expect(a.monteCarloStats).toEqual(b.monteCarloStats);
    expect(a.performanceData).toEqual(b.performanceData);
  });

  it("returns a different result for a different seed", () => {
    const a = runBacktest(BASE);
    const b = runBacktest({ ...BASE, seed: 4242 });
    expect(a.finalValue).not.toBe(b.finalValue);
  });
});

describe("degenerate inputs", () => {
  // Weights summing to zero previously divided by zero and carried NaN into
  // the persisted result.
  it("equal-weights rather than producing NaN when weights sum to zero", () => {
    const r = runBacktest({
      ...BASE,
      items: [item("a", "US Equity", "0"), item("b", "Cash", "0")],
    });
    expect(Number.isFinite(r.finalValue)).toBe(true);
    expect(Number.isNaN(r.totalReturn)).toBe(false);
  });

  it("survives a non-numeric weight", () => {
    const r = runBacktest({
      ...BASE,
      items: [item("a", "US Equity", "not-a-number"), item("b", "Cash", "50")],
    });
    expect(Number.isFinite(r.finalValue)).toBe(true);
  });

  it("runs at least one path when asked for zero simulations", () => {
    const r = runBacktest({ ...BASE, numSimulations: 0 });
    expect(Number.isFinite(r.finalValue)).toBe(true);
    expect(r.performanceData.length).toBeGreaterThan(0);
  });

  it("returns the initial value for an empty portfolio", () => {
    const r = runBacktest({ ...BASE, items: [] });
    expect(r.finalValue).toBe(1_000_000);
  });

  it("returns the initial value when the window is inverted", () => {
    const r = runBacktest({
      ...BASE, startDate: new Date("2024-01-01"), endDate: new Date("2023-01-01"),
    });
    expect(r.finalValue).toBe(1_000_000);
    expect(r.performanceData).toEqual([]);
  });
});

describe("simulation output", () => {
  const r = runBacktest(BASE);

  it("walks weekdays only", () => {
    for (const p of r.performanceData) {
      const day = new Date(`${p.date}T00:00:00Z`).getUTCDay();
      expect(day).not.toBe(0);
      expect(day).not.toBe(6);
    }
    // A calendar year is around 260 weekdays.
    expect(r.performanceData.length).toBeGreaterThan(250);
    expect(r.performanceData.length).toBeLessThan(266);
  });

  it("keeps the performance path internally consistent", () => {
    for (const p of r.performanceData) {
      expect(p.cumulativeReturn).toBeCloseTo((p.value - 1_000_000) / 1_000_000, 9);
    }
  });

  it("compounds the value forward from the daily returns", () => {
    const pts = r.performanceData;
    for (let i = 1; i < Math.min(pts.length, 40); i++) {
      expect(pts[i].value).toBeCloseTo(pts[i - 1].value * (1 + pts[i].dailyReturn), 6);
    }
  });

  it("orders the Monte Carlo percentiles", () => {
    const s = r.monteCarloStats!;
    expect(s.percentile5).toBeLessThanOrEqual(s.percentile25);
    expect(s.percentile25).toBeLessThanOrEqual(s.medianFinalValue);
    expect(s.medianFinalValue).toBeLessThanOrEqual(s.percentile75);
    expect(s.percentile75).toBeLessThanOrEqual(s.percentile95);
  });

  it("keeps expected shortfall at least as severe as VaR", () => {
    const s = r.monteCarloStats!;
    expect(s.expectedShortfall).toBeGreaterThanOrEqual(s.valueAtRisk95);
  });

  it("returns one simulation result per path", () => {
    expect(r.allSimulationReturns).toHaveLength(40);
    expect(r.simulationFinalValues).toHaveLength(40);
  });

  it("produces finite metrics throughout", () => {
    for (const v of [r.finalValue, r.totalReturn, r.annualizedReturn, r.volatility, r.sharpeRatio, r.maxDrawdown]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("reports a drawdown between 0 and 1", () => {
    expect(r.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(r.maxDrawdown).toBeLessThanOrEqual(1);
  });
});

describe("inputs that should move the answer", () => {
  it("grows a higher-return book faster", () => {
    const cash = runBacktest({ ...BASE, items: [item("c", "Cash", "100")] });
    const pe = runBacktest({ ...BASE, items: [item("p", "Private Equity", "100")] });
    expect(pe.monteCarloStats!.meanAnnualizedReturn)
      .toBeGreaterThan(cash.monteCarloStats!.meanAnnualizedReturn);
  });

  it("gives a riskier book a wider outcome spread", () => {
    const cash = runBacktest({ ...BASE, items: [item("c", "Cash", "100")] });
    const pe = runBacktest({ ...BASE, items: [item("p", "Private Equity", "100")] });
    const spread = (s: { percentile95: number; percentile5: number }) => s.percentile95 - s.percentile5;
    expect(spread(pe.monteCarloStats!)).toBeGreaterThan(spread(cash.monteCarloStats!));
  });

  it("honours per-item expected return and volatility over the asset-class default", () => {
    const dflt = runBacktest({ ...BASE, items: [item("x", "Cash", "100")] });
    const override = runBacktest({
      ...BASE,
      items: [item("x", "Cash", "100", { expectedReturn: "0.30", volatility: "0.02" })],
    });
    expect(override.monteCarloStats!.meanAnnualizedReturn)
      .toBeGreaterThan(dflt.monteCarloStats!.meanAnnualizedReturn);
  });

  it("lowers Sharpe when the risk-free rate rises", () => {
    const low = runBacktest({ ...BASE, riskFreeRate: 0.0 });
    const high = runBacktest({ ...BASE, riskFreeRate: 0.20 });
    expect(high.monteCarloStats!.meanSharpeRatio)
      .toBeLessThan(low.monteCarloStats!.meanSharpeRatio);
  });

  it("scales results with the initial value", () => {
    const small = runBacktest({ ...BASE, initialValue: 1_000 });
    const large = runBacktest({ ...BASE, initialValue: 1_000_000 });
    // Same seed, same path — only the scale differs.
    expect(large.totalReturn).toBeCloseTo(small.totalReturn, 9);
    expect(large.finalValue / small.finalValue).toBeCloseTo(1000, 3);
  });

  it("prefers a supplied historical series over the modelled distribution", () => {
    // A series of flat 1% days should compound far past any modelled default.
    const history = new Map<string, number[]>([["equity", new Array(50).fill(0.01)]]);
    const r = runBacktest({
      ...BASE, items: [item("equity", "US Equity", "100")], historicalReturns: history, numSimulations: 5,
    });
    expect(r.totalReturn).toBeGreaterThan(1);
  });

  it("falls back to the Other profile for an unknown asset class", () => {
    const r = runBacktest({ ...BASE, items: [item("x", "Nonexistent Class", "100")] });
    expect(Number.isFinite(r.monteCarloStats!.meanAnnualizedReturn)).toBe(true);
  });
});
