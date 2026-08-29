import { describe, expect, it } from "vitest";
import {
  buildMemoPackage,
  deriveRisk,
  detectPeriodsPerYear,
  memoPackageFilename,
  MIN_OBSERVATIONS,
  type MemoPackageInput,
} from "../memoPackage";
import type {
  DataRoomDocument,
  Holding,
  PerformanceHistory,
  Portfolio,
  StressTest,
} from "@shared/schema";

/**
 * Twenty-four monthly returns with a four-month drawdown in months 9-12.
 * Every expected value below was computed from this array in Python
 * (statistics.stdev for the sample deviation, math for the rest) rather than
 * by running the module -- otherwise the tests would pin whatever the code
 * currently does instead of what it should do.
 */
const MONTHLY_RETURNS = [
  0.021, -0.008, 0.014, 0.032, -0.011, 0.019, 0.007, 0.025,
  -0.043, -0.028, -0.019, -0.036, 0.012, 0.041, 0.018, -0.005,
  0.029, 0.011, 0.023, -0.014, 0.016, 0.033, 0.009, 0.027,
];

const RISK_FREE = 0.0428;

/**
 * Portfolio values here deliberately do NOT track the returns: the series
 * grows 18.1% while the values fall, standing in for a book that took large
 * redemptions. Anything derived from the values rather than the returns would
 * come out negative, so these fixtures also pin the time-weighted choice.
 */
function monthlyPerformance(
  returns: number[] = MONTHLY_RETURNS,
): PerformanceHistory[] {
  return returns.map((r, i) => ({
    id: `p${i}`,
    portfolioId: "pf1",
    date: new Date(Date.UTC(2024, i, 1)),
    portfolioValue: String(1_000_000 - i * 10_000),
    dailyReturn: String(r),
    cumulativeReturn: null,
    benchmarkValue: null,
    benchmarkReturn: null,
  }));
}

const holding = (over: Partial<Holding> = {}): Holding => ({
  id: "h1",
  portfolioId: "pf1",
  fundName: "Example Fund",
  ticker: null,
  assetClass: "Hedge Fund",
  allocation: "50.00",
  marketValue: "500000",
  costBasis: "400000",
  unrealizedGain: "100000",
  returnYtd: "0.0523",
  return1yr: null,
  return3yr: null,
  ...over,
});

const portfolio: Portfolio = {
  id: "pf1",
  name: "Core Book",
  description: "Test",
  totalValue: "1000000",
  currency: "USD",
  createdAt: new Date(Date.UTC(2024, 0, 1)),
};

function input(over: Partial<MemoPackageInput> = {}): MemoPackageInput {
  return {
    portfolio,
    holdings: [holding(), holding({ id: "h2", fundName: "Second Fund" })],
    performance: monthlyPerformance(),
    stressTests: [],
    documents: [],
    riskFreeRate: RISK_FREE,
    riskFreeRateSource: "FRED",
    asOf: new Date(Date.UTC(2026, 7, 29)),
    ...over,
  };
}

describe("detectPeriodsPerYear", () => {
  it("reads month-spaced dates as 12, not 252", () => {
    const dates = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(2024, i, 1)));
    expect(detectPeriodsPerYear(dates)).toBe(12);
  });

  it("reads day-spaced dates as 252", () => {
    const dates = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(2024, 0, i + 1)));
    expect(detectPeriodsPerYear(dates)).toBe(252);
  });

  it("reads quarter-spaced dates as 4", () => {
    const dates = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(2024, i * 3, 1)));
    expect(detectPeriodsPerYear(dates)).toBe(4);
  });

  it("assumes monthly when there is only one date to go on", () => {
    expect(detectPeriodsPerYear([new Date()])).toBe(12);
  });
});

describe("deriveRisk", () => {
  const risk = deriveRisk(monthlyPerformance(), RISK_FREE)!;

  it("derives every figure from the 24-month series", () => {
    expect(risk).not.toBeNull();
    expect(risk.observations).toBe(24);
    expect(risk.periodsPerYear).toBe(12);
    expect(risk.periodLabel).toBe("monthly");
    expect(risk.years).toBe(2);
  });

  // Expected values from Python over MONTHLY_RETURNS:
  //   growth = prod(1+r) = 1.1810817017627744
  it("compounds returns for total return", () => {
    expect(risk.totalReturn).toBeCloseTo(0.18108170176277438, 12);
  });

  //   growth ** (1/2) - 1
  it("annualizes geometrically over the two years the data spans", () => {
    expect(risk.annualizedReturn).toBeCloseTo(0.08677582866144684, 12);
  });

  //   statistics.stdev(r) * sqrt(12)   -- sample (n-1) deviation
  it("annualizes the sample deviation at the detected cadence", () => {
    expect(risk.annualizedVolatility).toBeCloseTo(0.07892745706191774, 12);
  });

  //   (0.08677582866144684 - 0.0428) / 0.07892745706191774
  it("computes Sharpe against the supplied risk-free rate", () => {
    expect(risk.sharpeRatio).toBeCloseTo(0.5571676866131425, 12);
  });

  //   sqrt(mean(neg^2)) * sqrt(12) over the 7 losing months
  it("computes Sortino from the losing months only", () => {
    expect(risk.sortinoRatio).toBeCloseTo(0.5239675099788885, 12);
  });

  //   peak-to-trough on the growth-of-1 index across months 9-12
  it("finds the drawdown on the return index", () => {
    expect(risk.maxDrawdown).toBeCloseTo(0.12032096046399994, 12);
  });

  //   floor(24 * 0.05) = 1, so both sit on the single worst month
  it("puts the 95% tail on the worst month at this sample size", () => {
    expect(risk.historicalVaR95).toBeCloseTo(-0.043, 12);
    expect(risk.expectedShortfall95).toBeCloseTo(-0.043, 12);
  });

  it("reports the extremes and the hit rate", () => {
    expect(risk.bestPeriod).toBeCloseTo(0.041, 12);
    expect(risk.worstPeriod).toBeCloseTo(-0.043, 12);
    expect(risk.positivePeriodShare).toBeCloseTo(16 / 24, 12);
  });

  it("ignores portfolio value, so redemptions are not read as losses", () => {
    // The fixture's values fall from 1,000,000 to 770,000 across the series.
    // An endpoint-based total return would be -23%; the returns compound to
    // +18.1%. The positive figure is the one that describes the manager.
    expect(risk.totalReturn).toBeGreaterThan(0);
  });

  it("returns null rather than annualizing too short a series", () => {
    const short = monthlyPerformance(MONTHLY_RETURNS.slice(0, MIN_OBSERVATIONS - 1));
    expect(deriveRisk(short, RISK_FREE)).toBeNull();
  });

  it("derives figures at exactly the minimum", () => {
    const atMin = monthlyPerformance(MONTHLY_RETURNS.slice(0, MIN_OBSERVATIONS));
    expect(deriveRisk(atMin, RISK_FREE)).not.toBeNull();
  });

  it("leaves Sharpe null rather than dividing by a zero deviation", () => {
    const flat = monthlyPerformance(new Array(12).fill(0));
    const r = deriveRisk(flat, RISK_FREE)!;
    expect(r.annualizedVolatility).toBe(0);
    expect(r.sharpeRatio).toBeNull();
  });

  it("leaves Sortino null when nothing lost money", () => {
    const allUp = monthlyPerformance(new Array(12).fill(0.01));
    expect(deriveRisk(allUp, RISK_FREE)!.sortinoRatio).toBeNull();
  });

  it("sorts an out-of-order series before deriving anything", () => {
    const shuffled = [...monthlyPerformance()].reverse();
    const r = deriveRisk(shuffled, RISK_FREE)!;
    expect(r.totalReturn).toBeCloseTo(0.18108170176277438, 12);
    expect(r.firstDate.getTime()).toBe(Date.UTC(2024, 0, 1));
  });
});

describe("buildMemoPackage", () => {
  it("prints the figures at the precision a memo would quote", () => {
    const md = buildMemoPackage(input());
    expect(md).toContain("| Annualized return | 8.68% |");
    expect(md).toContain("| Annualized volatility | 7.89% |");
    expect(md).toContain("| Sharpe ratio | 0.56 |");
    expect(md).toContain("| Maximum drawdown | -12.03% |");
  });

  it("says what each figure was derived from", () => {
    const md = buildMemoPackage(input());
    expect(md).toContain("24 monthly observations in `performance_history`");
    expect(md).toContain("annualized at 12 periods per year");
    expect(md).toContain("Risk-free rate 4.28% from FRED");
  });

  it("warns that the 95% tail is a single month", () => {
    const md = buildMemoPackage(input());
    expect(md).toContain("worst 1 of 24 observations");
    expect(md).toContain("VaR and expected shortfall are both just the worst monthly period");
  });

  it("names what is missing instead of omitting the section", () => {
    const md = buildMemoPackage(input({ holdings: [], stressTests: [], documents: [] }));
    expect(md).toContain("No holdings recorded");
    expect(md).toContain("No stress tests have been run");
    expect(md).toContain("No documents are attached");
    expect(md).toContain("## What is not in this file");
    expect(md).toContain("no holdings, no stress tests, no documents");
  });

  it("refuses to print risk figures it could not derive, and says why", () => {
    const md = buildMemoPackage(input({ performance: monthlyPerformance(MONTHLY_RETURNS.slice(0, 4)) }));
    expect(md).toContain("4 performance observations");
    expect(md).toContain(`at least ${MIN_OBSERVATIONS} are needed`);
    expect(md).not.toContain("Sharpe ratio |");
  });

  it("warns off the seeded risk_metrics table when it cannot derive", () => {
    const md = buildMemoPackage(input({ performance: [] }));
    expect(md).toContain("seeded demo values");
  });

  it("treats allocation as a percentage and returns as fractions", () => {
    const md = buildMemoPackage(
      input({ holdings: [holding({ allocation: "12.50", returnYtd: "0.0523" })] }),
    );
    expect(md).toContain("| 12.50% |");
    expect(md).toContain("| 5.23% |");
  });

  it("flags allocations that do not sum to 100", () => {
    const md = buildMemoPackage(input({ holdings: [holding({ allocation: "40.00" })] }));
    expect(md).toContain("Allocations sum to 40.00%");
    expect(md).toContain("do not sum to 100%");
  });

  it("stays quiet when the allocations do add up", () => {
    const md = buildMemoPackage(input());
    expect(md).toContain("Allocations sum to 100.00%");
    expect(md).not.toContain("do not sum to 100%");
  });

  it("groups holdings by asset class", () => {
    const md = buildMemoPackage(
      input({
        holdings: [
          holding({ assetClass: "Hedge Fund", allocation: "30.00" }),
          holding({ id: "h2", assetClass: "Private Credit", allocation: "45.00" }),
          holding({ id: "h3", assetClass: "Hedge Fund", allocation: "25.00" }),
        ],
      }),
    );
    expect(md).toContain("| Hedge Fund | 55.00% |");
    expect(md).toContain("| Private Credit | 45.00% |");
  });

  it("counts documents whose text was never extracted", () => {
    const docs: DataRoomDocument[] = [
      {
        id: "d1", portfolioId: "pf1", fileName: "deck.pdf", fileType: "pdf",
        fileSize: 100, extractedContent: "Fund overview text", documentType: "Deck",
        folderId: null, uploadedAt: new Date(Date.UTC(2026, 0, 5)), lastModified: null,
      },
      {
        id: "d2", portfolioId: "pf1", fileName: "terms.pdf", fileType: "pdf",
        fileSize: 200, extractedContent: null, documentType: null,
        folderId: null, uploadedAt: new Date(Date.UTC(2026, 0, 6)), lastModified: null,
      },
    ];
    const md = buildMemoPackage(input({ documents: docs }));
    expect(md).toContain("1 of 2 documents has no extracted text");
    expect(md).toContain("Fund overview text");
    expect(md).toContain("### deck.pdf");
    expect(md).not.toContain("### terms.pdf\n\nnull");
  });

  it("includes stress test results when they exist", () => {
    const st: StressTest[] = [{
      id: "s1", portfolioId: "pf1", scenarioName: "2008 Crisis", scenarioType: "historical",
      description: null, equityShock: "-0.40", rateShock: null, creditSpreadShock: null,
      fxShock: null, portfolioImpact: "-0.185", impactAmount: "-185000",
      runDate: new Date(Date.UTC(2026, 0, 2)), regime: null, scenarioCategory: null,
      commodityShock: null, volatilityShock: null, inflationShock: null,
      liquidityShock: null, parametricVaR95: "-0.062", parametricVaR99: null,
      cvar95: "-0.081", cvar99: null, stressedValue: "815000",
      factorDecomposition: null, assetImpacts: null, componentVaR: null,
      monteCarloStats: null,
    }];
    const md = buildMemoPackage(input({ stressTests: st }));
    expect(md).toContain("| 2008 Crisis | historical | -18.50% |");
    expect(md).toContain("-8.10%"); // CVaR below VaR, as it must be
  });

  it("is deterministic given the same input", () => {
    expect(buildMemoPackage(input())).toBe(buildMemoPackage(input()));
  });
});

describe("memoPackageFilename", () => {
  it("slugs the portfolio name and dates the file", () => {
    expect(memoPackageFilename("Core Book", new Date(Date.UTC(2026, 7, 29))))
      .toBe("core-book-memo-data-2026-08-29.md");
  });

  it("strips punctuation rather than emitting it into a filename", () => {
    expect(memoPackageFilename("Smith & Co. / Fund II", new Date(Date.UTC(2026, 0, 1))))
      .toBe("smith-co-fund-ii-memo-data-2026-01-01.md");
  });

  it("falls back to a name when there is nothing to slug", () => {
    expect(memoPackageFilename("///", new Date(Date.UTC(2026, 0, 1))))
      .toBe("portfolio-memo-data-2026-01-01.md");
  });
});
