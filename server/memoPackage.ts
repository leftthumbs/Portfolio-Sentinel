/**
 * Builds a self-contained Markdown briefing for one portfolio: what it holds,
 * how it has performed, what the stress tests said, and which documents are
 * attached. The file is meant to be handed to an assistant that writes the
 * actual memo against a house template, so it carries the numbers and their
 * provenance rather than any prose.
 *
 * Two rules shape everything here.
 *
 * Risk figures are computed from `performance_history` on the way out, not
 * read from the `risk_metrics` table. That table is written only by the
 * seeder, so anything reading it gets fixed demo values -- a Sharpe of 1.42
 * regardless of what the portfolio actually did. `/api/risk` has always
 * computed live and ignored the table; this does the same.
 *
 * Every figure states what it was derived from, and anything that could not be
 * derived is listed as missing rather than dropped. A memo written from this
 * file should never be able to present an assumption as a measurement.
 */
import {
  calculateDrawdownSeries,
  historicalExpectedShortfall,
} from "./riskCalculations";
import type {
  DataRoomDocument,
  Holding,
  PerformanceHistory,
  Portfolio,
  StressTest,
} from "@shared/schema";

/**
 * Infers observation frequency from the gaps between dates, so that
 * annualization does not assume 252 trading days for what is monthly
 * fund-of-funds data. Shared with routes.ts, which had the only copy.
 */
export function detectPeriodsPerYear(dates: (string | Date)[]): number {
  if (dates.length < 2) return 12;
  const sorted = dates.map((d) => new Date(d).getTime()).sort((a, b) => a - b);
  const intervals: number[] = [];
  for (let i = 1; i < Math.min(sorted.length, 20); i++) {
    intervals.push((sorted[i] - sorted[i - 1]) / (1000 * 60 * 60 * 24));
  }
  const avgDays = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  if (avgDays > 60) return 4;
  if (avgDays > 15) return 12;
  return 252;
}

/** Below this, an annualized figure says more about the sample than the fund. */
export const MIN_OBSERVATIONS = 10;

export interface MemoPackageInput {
  portfolio: Portfolio;
  holdings: Holding[];
  performance: PerformanceHistory[];
  stressTests: StressTest[];
  documents: DataRoomDocument[];
  /** Annual decimal, e.g. 0.0428. Used for Sharpe and Sortino. */
  riskFreeRate: number;
  riskFreeRateSource: string;
  asOf?: Date;
}

export interface DerivedRisk {
  observations: number;
  periodsPerYear: number;
  periodLabel: string;
  firstDate: Date;
  lastDate: Date;
  years: number;
  totalReturn: number;
  annualizedReturn: number;
  annualizedVolatility: number;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  maxDrawdown: number;
  historicalVaR95: number;
  expectedShortfall95: number;
  bestPeriod: number;
  worstPeriod: number;
  positivePeriodShare: number;
}

const CADENCE_LABEL: Record<number, string> = {
  252: "daily",
  12: "monthly",
  4: "quarterly",
};

function num(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pct(value: number | null, digits = 2): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(digits)}%`;
}

/** Allocation is stored as a percentage already; returns are stored as fractions. */
function allocationPct(value: string | null | undefined): string {
  const parsed = num(value);
  return parsed === null ? "n/a" : `${parsed.toFixed(2)}%`;
}

function ratio(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(2);
}

function money(value: string | number | null | undefined, currency: string): string {
  const parsed = typeof value === "number" ? value : num(value as string);
  if (parsed === null) return "n/a";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(parsed);
}

function isoDate(value: Date | string | null | undefined): string {
  if (!value) return "n/a";
  return new Date(value).toISOString().slice(0, 10);
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample standard deviation. n-1 because these are observations, not a population. */
function sampleStdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const ss = xs.reduce((sum, x) => sum + (x - m) ** 2, 0);
  return Math.sqrt(ss / (xs.length - 1));
}

/**
 * The 95% historical VaR: the 5th percentile of observed period returns, by
 * the same nearest-rank convention `historicalExpectedShortfall` uses for its
 * tail cutoff, so the two figures describe the same tail.
 */
function historicalVaR(returns: number[], confidence: number): number {
  const sorted = [...returns].sort((a, b) => a - b);
  const cutoff = Math.max(1, Math.floor(sorted.length * (1 - confidence)));
  return sorted[cutoff - 1];
}

/**
 * Derives the risk figures from the performance series. Returns null when
 * there is too little history for an annualized number to mean anything --
 * the caller reports that rather than printing a figure.
 */
export function deriveRisk(
  performance: PerformanceHistory[],
  riskFreeRate: number,
): DerivedRisk | null {
  const sorted = [...performance].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  const returns = sorted
    .map((p) => num(p.dailyReturn))
    .filter((r): r is number => r !== null);

  if (sorted.length < MIN_OBSERVATIONS || returns.length < MIN_OBSERVATIONS) {
    return null;
  }

  const periodsPerYear = detectPeriodsPerYear(sorted.map((p) => p.date));
  const years = returns.length / periodsPerYear;

  // Total return compounds the return series rather than comparing the first
  // and last portfolio values. Two reasons. Portfolio value moves on
  // subscriptions and redemptions as well as performance, so an endpoint
  // comparison reports the flows as if they were returns; compounding gives
  // the time-weighted return, which is the one a memo should quote. And the
  // endpoints span one interval fewer than there are observations, so pairing
  // them with `years = observations / periodsPerYear` annualizes over a period
  // that is one interval too long. (routes.ts does compare endpoints, so the
  // risk page can differ from this file on a book with flows -- the difference
  // is the flows.)
  const growth = returns.reduce((acc, r) => acc * (1 + r), 1);
  const totalReturn = growth - 1;
  const annualizedReturn =
    years > 0 && growth > 0 ? Math.pow(growth, 1 / years) - 1 : 0;

  const annualizedVolatility = sampleStdDev(returns) * Math.sqrt(periodsPerYear);

  // Downside deviation over the periods that actually lost money. Dividing by
  // the count of those periods (not of all periods) makes this the deviation
  // of the losses themselves, which is what the Sortino denominator wants.
  const negatives = returns.filter((r) => r < 0);
  const downsideDeviation =
    negatives.length > 0
      ? Math.sqrt(mean(negatives.map((r) => r ** 2))) * Math.sqrt(periodsPerYear)
      : 0;

  // Drawdown runs on a growth-of-1 index built from the returns, for the same
  // reason: a redemption is not a drawdown.
  let level = 1;
  const index = returns.map((r) => (level *= 1 + r));
  const { drawdowns } = calculateDrawdownSeries(index);
  const maxDrawdown = drawdowns.length > 0 ? Math.max(...drawdowns) : 0;

  return {
    observations: returns.length,
    periodsPerYear,
    periodLabel: CADENCE_LABEL[periodsPerYear] ?? `${periodsPerYear}/yr`,
    firstDate: new Date(sorted[0].date),
    lastDate: new Date(sorted[sorted.length - 1].date),
    years,
    totalReturn,
    annualizedReturn,
    annualizedVolatility,
    sharpeRatio:
      annualizedVolatility > 0
        ? (annualizedReturn - riskFreeRate) / annualizedVolatility
        : null,
    sortinoRatio:
      downsideDeviation > 0
        ? (annualizedReturn - riskFreeRate) / downsideDeviation
        : null,
    maxDrawdown,
    historicalVaR95: historicalVaR(returns, 0.95),
    expectedShortfall95: historicalExpectedShortfall(returns, 0.95),
    bestPeriod: Math.max(...returns),
    worstPeriod: Math.min(...returns),
    positivePeriodShare: returns.filter((r) => r > 0).length / returns.length,
  };
}

function holdingsSection(holdings: Holding[], currency: string): string {
  if (holdings.length === 0) {
    return "No holdings recorded for this portfolio.\n";
  }

  const rows = [...holdings]
    .sort((a, b) => (num(b.allocation) ?? 0) - (num(a.allocation) ?? 0))
    .map((h) => {
      const cells = [
        h.fundName,
        h.ticker || "—",
        h.assetClass,
        allocationPct(h.allocation),
        money(h.marketValue, currency),
        money(h.costBasis, currency),
        money(h.unrealizedGain, currency),
        pct(num(h.returnYtd)),
        pct(num(h.return1yr)),
        pct(num(h.return3yr)),
      ];
      return `| ${cells.join(" | ")} |`;
    });

  const allocationTotal = holdings.reduce(
    (sum, h) => sum + (num(h.allocation) ?? 0),
    0,
  );
  const marketValueTotal = holdings.reduce(
    (sum, h) => sum + (num(h.marketValue) ?? 0),
    0,
  );

  const header =
    "| Fund | Ticker | Asset class | Allocation | Market value | Cost basis | Unrealized | YTD | 1yr | 3yr |\n" +
    "|---|---|---|---|---|---|---|---|---|---|\n";

  let out = header + rows.join("\n") + "\n";
  out += `\nAllocations sum to ${allocationTotal.toFixed(2)}%. `;
  out += `Market values sum to ${money(marketValueTotal, currency)}.`;
  if (Math.abs(allocationTotal - 100) > 0.5) {
    out +=
      `\n\n> Allocations do not sum to 100%. Either a holding is missing or the` +
      ` stored weights are stale — check before quoting any weight in a memo.`;
  }
  return out + "\n";
}

function byAssetClass(holdings: Holding[], currency: string): string {
  if (holdings.length === 0) return "";
  const totals = new Map<string, { allocation: number; value: number }>();
  for (const h of holdings) {
    const key = h.assetClass || "Unclassified";
    const entry = totals.get(key) ?? { allocation: 0, value: 0 };
    entry.allocation += num(h.allocation) ?? 0;
    entry.value += num(h.marketValue) ?? 0;
    totals.set(key, entry);
  }
  const rows = Array.from(totals.entries())
    .sort((a, b) => b[1].allocation - a[1].allocation)
    .map(
      ([name, t]) =>
        `| ${name} | ${t.allocation.toFixed(2)}% | ${money(t.value, currency)} |`,
    );
  return (
    "\n### By asset class\n\n" +
    "| Asset class | Allocation | Market value |\n|---|---|---|\n" +
    rows.join("\n") +
    "\n"
  );
}

function riskSection(risk: DerivedRisk | null, input: MemoPackageInput): string {
  if (!risk) {
    const n = input.performance.length;
    return (
      `Not derived. The portfolio has ${n} performance observation${n === 1 ? "" : "s"}` +
      `, and at least ${MIN_OBSERVATIONS} are needed before an annualized figure` +
      ` describes the fund rather than the sample.\n\n` +
      `> Do not substitute a risk figure from elsewhere in the app for this.` +
      ` The stored \`risk_metrics\` table holds seeded demo values, not` +
      ` measurements of this portfolio.\n`
    );
  }

  const rows: [string, string, string][] = [
    ["Total return", pct(risk.totalReturn), `${isoDate(risk.firstDate)} to ${isoDate(risk.lastDate)}`],
    ["Annualized return", pct(risk.annualizedReturn), `geometric, over ${risk.years.toFixed(2)} years`],
    ["Annualized volatility", pct(risk.annualizedVolatility), `sample stdev × √${risk.periodsPerYear}`],
    ["Sharpe ratio", ratio(risk.sharpeRatio), `(ann. return − ${pct(input.riskFreeRate)}) ÷ ann. volatility`],
    ["Sortino ratio", ratio(risk.sortinoRatio), "downside deviation of losing periods only"],
    ["Maximum drawdown", pct(-risk.maxDrawdown), "peak-to-trough on the compounded return index"],
    ["VaR (95%, historical)", pct(risk.historicalVaR95), `5th percentile of ${risk.observations} ${risk.periodLabel} returns`],
    ["Expected shortfall (95%)", pct(risk.expectedShortfall95), "mean of the returns at or below that percentile"],
    ["Best period", pct(risk.bestPeriod), risk.periodLabel],
    ["Worst period", pct(risk.worstPeriod), risk.periodLabel],
    ["Positive periods", pct(risk.positivePeriodShare, 1), `${risk.observations} observations`],
  ];

  let out =
    "| Metric | Value | Derived from |\n|---|---|---|\n" +
    rows.map(([a, b, c]) => `| ${a} | ${b} | ${c} |`).join("\n") +
    "\n";

  out +=
    `\nAll of the above is computed from ${risk.observations} ${risk.periodLabel}` +
    ` observations in \`performance_history\`, annualized at ${risk.periodsPerYear}` +
    ` periods per year (inferred from the spacing of the dates, not assumed).` +
    ` Risk-free rate ${pct(input.riskFreeRate)} from ${input.riskFreeRateSource}.\n`;

  // The 95% tail is the worst 5% of observations, so on any realistic run of
  // monthly data it is one or two months. Saying which is the difference
  // between a reader treating the figure as an estimate and treating it as
  // the worst month, which is all it is.
  const tailSize = Math.max(1, Math.floor(risk.observations * 0.05));
  if (tailSize < 3) {
    out +=
      `\n> The 95% tail figures rest on the worst ${tailSize} of ${risk.observations}` +
      ` observations${tailSize === 1 ? `, so VaR and expected shortfall are both just the worst ${risk.periodLabel} period` : ""}.` +
      ` They describe what happened, not a distribution. Roughly ${60 * risk.periodsPerYear / 12} observations` +
      ` would be needed before the tail has three points under it.\n`;
  }

  return out;
}

function stressSection(stressTests: StressTest[], currency: string): string {
  if (stressTests.length === 0) {
    return "No stress tests have been run for this portfolio.\n";
  }
  const rows = stressTests.map((s) => {
    const cells = [
      s.scenarioName,
      s.scenarioType || "—",
      pct(num(s.portfolioImpact)),
      money(s.impactAmount, currency),
      pct(num(s.parametricVaR95)),
      pct(num(s.cvar95)),
      isoDate(s.runDate),
    ];
    return `| ${cells.join(" | ")} |`;
  });
  return (
    "| Scenario | Type | Impact | Amount | VaR 95% | CVaR 95% | Run |\n" +
    "|---|---|---|---|---|---|---|\n" +
    rows.join("\n") +
    "\n"
  );
}

function documentsSection(documents: DataRoomDocument[]): string {
  if (documents.length === 0) {
    return "No documents are attached to this portfolio.\n";
  }
  const rows = documents.map((d) => {
    const extracted = d.extractedContent
      ? `${d.extractedContent.length.toLocaleString()} chars`
      : "not extracted";
    return `| ${d.fileName} | ${d.documentType || "—"} | ${extracted} | ${isoDate(d.uploadedAt)} |`;
  });
  const notExtracted = documents.filter((d) => !d.extractedContent).length;
  let out =
    "| File | Type | Extracted text | Uploaded |\n|---|---|---|---|\n" +
    rows.join("\n") +
    "\n";
  if (notExtracted > 0) {
    out +=
      `\n> ${notExtracted} of ${documents.length} document${documents.length === 1 ? "" : "s"}` +
      ` ha${notExtracted === 1 ? "s" : "ve"} no extracted text, so nothing from` +
      ` inside ${notExtracted === 1 ? "it" : "them"} is included below.` +
      ` Attach the original${notExtracted === 1 ? "" : "s"} alongside this file` +
      ` if the memo needs to draw on ${notExtracted === 1 ? "it" : "them"}.\n`;
  }
  return out;
}

function extractedText(documents: DataRoomDocument[]): string {
  const withText = documents.filter((d) => d.extractedContent);
  if (withText.length === 0) return "";
  const blocks = withText.map(
    (d) =>
      `### ${d.fileName}\n\n${d.extractedContent}\n`,
  );
  return `\n---\n\n## Document contents\n\n${blocks.join("\n")}`;
}

/**
 * Renders the whole briefing. Deterministic given its input: no timestamps
 * beyond the caller-supplied `asOf`, so re-running it on unchanged data
 * produces a byte-identical file.
 */
export function buildMemoPackage(input: MemoPackageInput): string {
  const { portfolio, holdings, stressTests, documents } = input;
  const currency = portfolio.currency || "USD";
  const asOf = input.asOf ?? new Date();
  const risk = deriveRisk(input.performance, input.riskFreeRate);

  const missing: string[] = [];
  if (holdings.length === 0) missing.push("holdings");
  if (!risk) missing.push("performance history sufficient for risk metrics");
  if (stressTests.length === 0) missing.push("stress tests");
  if (documents.length === 0) missing.push("documents");

  const parts: string[] = [];

  parts.push(`# ${portfolio.name} — memo source data\n`);
  parts.push(
    `Exported ${isoDate(asOf)} from InvestIQ. Everything here is data;` +
      ` none of it is prose for a memo. Figures state what they were derived` +
      ` from so that nothing assumed can be quoted as measured.\n`,
  );

  parts.push(`\n## Portfolio\n`);
  parts.push(
    `| Field | Value |\n|---|---|\n` +
      `| Name | ${portfolio.name} |\n` +
      `| Description | ${portfolio.description || "—"} |\n` +
      `| Total value | ${money(portfolio.totalValue, currency)} |\n` +
      `| Currency | ${currency} |\n` +
      `| Holdings | ${holdings.length} |\n` +
      `| Created | ${isoDate(portfolio.createdAt)} |\n`,
  );

  parts.push(`\n## Holdings\n\n${holdingsSection(holdings, currency)}`);
  parts.push(byAssetClass(holdings, currency));
  parts.push(`\n## Risk and performance\n\n${riskSection(risk, input)}`);
  parts.push(`\n## Stress tests\n\n${stressSection(stressTests, currency)}`);
  parts.push(`\n## Attached documents\n\n${documentsSection(documents)}`);

  parts.push(`\n## What is not in this file\n`);
  if (missing.length === 0) {
    parts.push(
      `\nEvery section above has data. Nothing was omitted for want of it.\n`,
    );
  } else {
    parts.push(
      `\nThe portfolio has no ${missing.join(", no ")}.` +
        ` Those sections say so above rather than being left out silently.` +
        ` A memo written from this file should not fill those gaps with` +
        ` estimates unless it labels them as such.\n`,
    );
  }
  parts.push(
    `\nNot exported at all: fee terms, liquidity and redemption terms,` +
      ` manager background, and anything else held outside this portfolio's` +
      ` own records. Source those separately.\n`,
  );

  parts.push(extractedText(documents));

  return parts.join("");
}

/** Filesystem-safe, sorts by portfolio then date. */
export function memoPackageFilename(portfolioName: string, asOf: Date): string {
  const slug = portfolioName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "portfolio";
  return `${slug}-memo-data-${isoDate(asOf)}.md`;
}
