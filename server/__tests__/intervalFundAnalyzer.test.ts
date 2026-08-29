import { describe, expect, it } from "vitest";
import { analyzeIntervalFund, compareIntervalFunds } from "../intervalFundAnalyzer";
import { generateDataQualityReport, validateIntervalFund } from "../dataValidation";
import type { IntervalFund } from "@shared/schema";

/** A fund with every field populated and internally consistent. */
const fund = (over: Partial<Record<keyof IntervalFund, unknown>> = {}): IntervalFund =>
  ({
    id: "f1", name: "Test Interval Fund", ticker: "TIFX", fundManager: "Test LLC",
    description: "", assetClass: "Private Credit", strategyType: "Direct Lending",
    repurchaseFrequency: "Quarterly", repurchaseRate: "0.05", repurchaseNotice: 30,
    fundStructure: "Interval", navPerShare: "25.00", totalAum: "1500000000",
    minInvestment: "25000", managementFee: "0.0125", performanceFee: "0",
    expenseRatio: "0.0195", distributionRate: "0.08", distributionFrequency: "Quarterly",
    nav30dReturn: "0.006", nav90dReturn: "0.019", navYtdReturn: "0.055",
    nav1yrReturn: "0.082", nav3yrReturn: "0.071", nav5yrReturn: "0.068",
    inceptionReturn: "0.065", volatility: "0.045", sharpeRatio: "1.15",
    sortinoRatio: "1.60", maxDrawdown: "-0.062", beta: "0.35", alpha: "0.021",
    correlation: "0.30", topHoldingsPct: "0.22", numHoldings: 180,
    leverageRatio: "1.10", weightedAvgCoupon: "0.095", weightedAvgMaturity: "3.2",
    defaultRate: "0.012", inceptionDate: new Date("2018-01-01"),
    fundDomicile: "US", createdAt: new Date(), updatedAt: new Date(),
    ...over,
  }) as IntervalFund;

describe("analyzeIntervalFund", () => {
  const out = analyzeIntervalFund({ fund: fund(), riskFreeRate: 0.04 });

  it("scores every dimension inside its stated range", () => {
    for (const s of [out.liquidity.liquidityScore, out.fees.feeScore,
                     out.yield.incomeScore, out.risk.riskScore,
                     out.portfolioFit.suitabilityScore]) {
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(10);
    }
  });

  it("keeps the composite inside 0-100", () => {
    expect(out.overallScore).toBeGreaterThanOrEqual(0);
    expect(out.overallScore).toBeLessThanOrEqual(100);
  });

  it("composites the five dimensions on their stated weights", () => {
    const expected = Math.round(
      out.liquidity.liquidityScore * 1.5 + out.fees.feeScore * 2 +
      out.yield.incomeScore * 2.5 + out.risk.riskScore * 2.5 +
      out.portfolioFit.suitabilityScore * 1.5);
    expect(out.overallScore).toBe(expected);
  });

  it("produces a rating and a recommendation that mention each other", () => {
    expect(out.overallRating.length).toBeGreaterThan(0);
    expect(out.recommendation).toContain(out.overallRating);
  });

  it("computes annual liquidity access from rate and frequency", () => {
    // 5% quarterly = 20% a year.
    expect(out.liquidity.annualLiquidityAccess).toBeCloseTo(0.20, 10);
  });

  it("caps annual access at 100%", () => {
    const generous = analyzeIntervalFund({
      fund: fund({ repurchaseRate: "0.50", repurchaseFrequency: "Monthly" }), riskFreeRate: 0.04 });
    expect(generous.liquidity.annualLiquidityAccess).toBe(1);
  });

  it("rates more frequent repurchase as more liquid", () => {
    const score = (f: string) => analyzeIntervalFund({
      fund: fund({ repurchaseFrequency: f }), riskFreeRate: 0.04 }).liquidity.liquidityScore;
    expect(score("Monthly")).toBeGreaterThan(score("Quarterly"));
    expect(score("Quarterly")).toBeGreaterThan(score("Annually"));
  });

  it("rates a longer notice period as less liquid", () => {
    const short = analyzeIntervalFund({ fund: fund({ repurchaseNotice: 15 }), riskFreeRate: 0.04 });
    const long = analyzeIntervalFund({ fund: fund({ repurchaseNotice: 120 }), riskFreeRate: 0.04 });
    expect(long.liquidity.liquidityScore).toBeLessThan(short.liquidity.liquidityScore);
  });

  it("penalises a heavier fee load", () => {
    const cheap = analyzeIntervalFund({ fund: fund({ expenseRatio: "0.009" }), riskFreeRate: 0.04 });
    const dear = analyzeIntervalFund({ fund: fund({ expenseRatio: "0.045" }), riskFreeRate: 0.04 });
    expect(dear.fees.feeScore).toBeLessThan(cheap.fees.feeScore);
  });

  it("flags a distribution rate high enough to suggest return of capital", () => {
    const out = analyzeIntervalFund({ fund: fund({ distributionRate: "0.18" }), riskFreeRate: 0.04 });
    expect(out.risks.join(" ")).toMatch(/return of capital/i);
  });

  it("flags elevated leverage", () => {
    const out = analyzeIntervalFund({ fund: fund({ leverageRatio: "2.5" }), riskFreeRate: 0.04 });
    expect(out.risks.join(" ")).toMatch(/leverage/i);
  });

  it("flags a deep historical drawdown", () => {
    const out = analyzeIntervalFund({ fund: fund({ maxDrawdown: "-0.35" }), riskFreeRate: 0.04 });
    expect(out.risks.join(" ")).toMatch(/drawdown/i);
  });

  it("flags negative alpha", () => {
    const out = analyzeIntervalFund({ fund: fund({ alpha: "-0.04" }), riskFreeRate: 0.04 });
    expect(out.risks.join(" ")).toMatch(/alpha/i);
  });

  it("survives a fund with every optional field null", () => {
    const bare = analyzeIntervalFund({
      fund: fund({
        repurchaseRate: null, repurchaseNotice: null, managementFee: null,
        performanceFee: null, expenseRatio: null, distributionRate: null,
        nav1yrReturn: null, volatility: null, sharpeRatio: null, maxDrawdown: null,
        beta: null, alpha: null, leverageRatio: null, topHoldingsPct: null,
      }),
      riskFreeRate: 0.04,
    });
    expect(Number.isFinite(bare.overallScore)).toBe(true);
    expect(bare.overallScore).toBeGreaterThanOrEqual(0);
  });

  it("returns no peer comparison below two peers", () => {
    expect(analyzeIntervalFund({ fund: fund(), riskFreeRate: 0.04 }).peerComparison).toBeNull();
    expect(analyzeIntervalFund({
      fund: fund(), riskFreeRate: 0.04, peerFunds: [fund({ id: "p1" })] }).peerComparison).toBeNull();
  });

  it("ranks against peers once there are enough of them", () => {
    const peers = [fund({ id: "a" }), fund({ id: "b" }), fund({ id: "c" })];
    const out = analyzeIntervalFund({ fund: fund(), riskFreeRate: 0.04, peerFunds: peers });
    expect(out.peerComparison).not.toBeNull();
  });

  it("analyses every fund in a comparison set", () => {
    const funds = [fund({ id: "a" }), fund({ id: "b" }), fund({ id: "c" })];
    const all = compareIntervalFunds(funds, 0.04);
    expect(all).toHaveLength(3);
    expect(all.map((a) => a.fundId)).toEqual(["a", "b", "c"]);
  });

  it("is deterministic", () => {
    const a = analyzeIntervalFund({ fund: fund(), riskFreeRate: 0.04 });
    const b = analyzeIntervalFund({ fund: fund(), riskFreeRate: 0.04 });
    expect(a).toEqual(b);
  });
});

describe("validateIntervalFund", () => {
  it("passes a clean, internally consistent fund", () => {
    const r = validateIntervalFund(fund());
    expect(r.status).toBe("clean");
    expect(r.validationScore).toBe(100);
    expect(r.recommendations.join(" ")).toMatch(/passed/i);
  });

  it("keeps the score inside 0-100 whatever the input", () => {
    for (const f of [fund(), fund({ navPerShare: null }), fund({ navPerShare: "-5" })]) {
      const r = validateIntervalFund(f);
      expect(r.validationScore).toBeGreaterThanOrEqual(0);
      expect(r.validationScore).toBeLessThanOrEqual(100);
    }
  });

  it.each([
    ["missing NAV", { navPerShare: null }],
    ["negative NAV", { navPerShare: "-1" }],
    ["implausible NAV", { navPerShare: "50000" }],
  ])("marks %s invalid", (_label, over) => {
    const r = validateIntervalFund(fund(over as never));
    expect(r.fieldValidations.find((f) => f.field === "navPerShare")!.isValid).toBe(false);
    expect(r.status).not.toBe("clean");
  });

  it("treats a management fee above the expense ratio as a conflict", () => {
    // The total expense ratio contains the management fee, so this cannot hold.
    const r = validateIntervalFund(fund({ managementFee: "0.03", expenseRatio: "0.01" }));
    expect(r.status).toBe("conflict");
    expect(r.crossFieldChecks.find((c) => c.name === "Fee Consistency")!.passed).toBe(false);
  });

  it("flags a repurchase rate below the SEC 5% minimum", () => {
    const r = validateIntervalFund(fund({ repurchaseRate: "0.02" }));
    expect(r.fieldValidations.find((f) => f.field === "repurchaseRate")!.isValid).toBe(false);
  });

  it("flags a distribution rate far above the fund's own return", () => {
    const r = validateIntervalFund(fund({ distributionRate: "0.30", nav1yrReturn: "0.05" }));
    const check = r.crossFieldChecks.find((c) => c.name === "Distribution vs Return")!;
    expect(check.passed).toBe(false);
    expect(check.detail).toMatch(/return of capital/i);
  });

  it("flags a reported Sharpe that its own return and volatility do not support", () => {
    const r = validateIntervalFund(fund({ sharpeRatio: "9.5", nav1yrReturn: "0.05", volatility: "0.10" }));
    expect(r.crossFieldChecks.find((c) => c.name === "Sharpe Ratio Consistency")!.passed).toBe(false);
  });

  it("escalates to conflict once more than two fields fail", () => {
    const r = validateIntervalFund(fund({
      navPerShare: null, totalAum: null, expenseRatio: "-1", distributionRate: "-1",
    }));
    expect(r.status).toBe("conflict");
  });

  it("lowers the score as failures accumulate", () => {
    const clean = validateIntervalFund(fund()).validationScore;
    const one = validateIntervalFund(fund({ navPerShare: null })).validationScore;
    const many = validateIntervalFund(fund({
      navPerShare: null, totalAum: null, expenseRatio: "-1" })).validationScore;
    expect(one).toBeLessThan(clean);
    expect(many).toBeLessThan(one);
  });
});

describe("generateDataQualityReport", () => {
  it("counts funds by status", () => {
    const r = generateDataQualityReport([
      fund({ id: "clean1" }),
      fund({ id: "clean2" }),
      fund({ id: "warn", repurchaseRate: "0.02" }),
      fund({ id: "conflict", managementFee: "0.05", expenseRatio: "0.01" }),
    ]);
    expect(r.totalFunds).toBe(4);
    expect(r.cleanFunds).toBe(2);
    expect(r.warningFunds).toBe(1);
    expect(r.conflictFunds).toBe(1);
    expect(r.cleanFunds + r.warningFunds + r.conflictFunds).toBe(r.totalFunds);
  });

  it("averages the score across funds", () => {
    const funds = [fund({ id: "a" }), fund({ id: "b", navPerShare: null })];
    const r = generateDataQualityReport(funds);
    const expected = Math.round(
      r.fundResults.reduce((s, f) => s + f.validationScore, 0) / funds.length);
    expect(r.overallScore).toBe(expected);
  });

  it("ranks common issues by frequency", () => {
    const r = generateDataQualityReport([
      fund({ id: "a", navPerShare: null }),
      fund({ id: "b", navPerShare: null }),
      fund({ id: "c", repurchaseRate: "0.01" }),
    ]);
    expect(r.commonIssues[0].count).toBeGreaterThanOrEqual(r.commonIssues[1]?.count ?? 0);
    expect(r.commonIssues.some((i) => /NAV per share is missing/.test(i.issue))).toBe(true);
  });

  it("groups issues that differ only in their numbers", () => {
    // The report normalizes percentages and dollar amounts out of issue text so
    // the same problem across funds counts once rather than N times.
    const r = generateDataQualityReport([
      fund({ id: "a", expenseRatio: "-0.11" }),
      fund({ id: "b", expenseRatio: "-0.22" }),
    ]);
    const expenseIssues = r.commonIssues.filter((i) => /expense/i.test(i.issue));
    expect(expenseIssues).toHaveLength(1);
    expect(expenseIssues[0].count).toBe(2);
  });

  it("reports a perfect score for an empty set rather than NaN", () => {
    const r = generateDataQualityReport([]);
    expect(r.overallScore).toBe(100);
    expect(r.totalFunds).toBe(0);
    expect(Number.isNaN(r.overallScore)).toBe(false);
  });
});
