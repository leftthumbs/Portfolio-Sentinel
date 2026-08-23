/**
 * Return Stream Analytics Engine
 *
 * Given a manager's periodic return stream (and optionally a benchmark stream),
 * produces the full analytical pack an investment committee needs to judge an
 * allocation: return generation, risk, risk-adjusted efficiency, distribution
 * shape, drawdown behaviour, benchmark-relative value-add, rolling stability,
 * forward-looking simulation, and — critically for hedge funds — return
 * smoothing / data-integrity diagnostics.
 *
 * Conventions used throughout:
 *   - All returns are periodic DECIMALS (0.0124 = +1.24%).
 *   - Annualisation uses the detected periods-per-year of the stream itself;
 *     nothing is hardcoded to 252. Applying a daily annualisation factor to a
 *     monthly hedge fund series overstates volatility by ~4.6x.
 *   - Annualised return is GEOMETRIC (CAGR), which is what a committee sees in
 *     a tear sheet, while Sharpe-family ratios use the arithmetic mean of
 *     periodic excess returns, which is the canonical definition.
 *   - Anything not computable from the available history returns null rather
 *     than a fabricated number.
 */

import {
  covariance,
  autocorrelation,
  chiSquareUpperTail,
  correlation,
  createRng,
  excessKurtosis,
  linearRegression,
  lowerPartialMoment,
  mean,
  normalCdf,
  normalInv,
  percentile,
  skewness,
  stdDev,
  variance,
  type Regression,
} from "./returnStreamStats";

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

export interface AnalyticsInput {
  /** ISO period-end dates, ascending, aligned 1:1 with returns. */
  dates: string[];
  /** Manager periodic decimal returns. */
  returns: number[];
  /** Optional benchmark periodic decimal returns, aligned to the same dates. */
  benchmarkReturns?: number[] | null;
  benchmarkName?: string | null;
  fundName?: string;
  /** Annualised risk-free rate as a decimal (0.0525 = 5.25%). */
  riskFreeRate?: number;
  /** Annualised minimum acceptable return for Sortino / Omega. */
  minimumAcceptableReturn?: number;
  periodsPerYear?: number;
  /** Forward simulation horizon in years. */
  simulationYears?: number;
  simulationPaths?: number;
}

export interface PeriodReturn {
  label: string;
  cumulative: number | null;
  annualized: number | null;
  benchmarkCumulative: number | null;
  benchmarkAnnualized: number | null;
  excess: number | null;
  periods: number;
  /** False when the window is shorter than the label implies. */
  complete: boolean;
}

/** The figure a tear sheet would headline: annualized past one year, else cumulative. */
export function headlinePeriodReturn(p: PeriodReturn): number | null {
  return p.annualized ?? p.cumulative;
}

export interface DrawdownEpisode {
  rank: number;
  depth: number;
  peakDate: string;
  troughDate: string;
  recoveryDate: string | null;
  declinePeriods: number;
  recoveryPeriods: number | null;
  totalPeriods: number;
  recovered: boolean;
}

export interface CalendarYearReturn {
  year: number;
  fund: number;
  benchmark: number | null;
  excess: number | null;
  periods: number;
  partial: boolean;
}

export interface MonthlyGridRow {
  year: number;
  months: (number | null)[];
  total: number | null;
}

export interface HistogramBin {
  label: string;
  lowerBound: number;
  upperBound: number;
  count: number;
  normalCount: number;
}

export interface RollingPoint {
  date: string;
  return: number | null;
  benchmarkReturn: number | null;
  volatility: number | null;
  sharpe: number | null;
  beta: number | null;
  correlation: number | null;
  alpha: number | null;
}

export interface WorstWindow {
  label: string;
  periods: number;
  worstReturn: number | null;
  startDate: string | null;
  endDate: string | null;
  benchmarkReturn: number | null;
}

export interface SimulationPercentiles {
  period: number;
  yearFraction: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

export interface DataQualityCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  value: string;
}

export type Analytics = ReturnType<typeof analyzeReturnStream>;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const EPS = 1e-12;

function compound(rs: number[]): number {
  return rs.reduce((acc, r) => acc * (1 + r), 1) - 1;
}

function annualizeCumulative(cumulative: number, periods: number, ppy: number): number | null {
  if (periods <= 0) return null;
  const growth = 1 + cumulative;
  // A total loss makes the geometric rate undefined rather than -100%/yr.
  if (growth <= 0) return null;
  return growth ** (ppy / periods) - 1;
}

/** Converts an annual rate into the equivalent geometric per-period rate. */
function perPeriodRate(annualRate: number, ppy: number): number {
  if (ppy <= 0) return 0;
  return (1 + annualRate) ** (1 / ppy) - 1;
}

function safeDiv(numerator: number, denominator: number): number | null {
  return Math.abs(denominator) < EPS ? null : numerator / denominator;
}

function isoYear(date: string): number {
  return parseInt(date.slice(0, 4), 10);
}

function isoMonth(date: string): number {
  return parseInt(date.slice(5, 7), 10) - 1;
}

// ---------------------------------------------------------------------------
// Drawdowns
// ---------------------------------------------------------------------------

export interface DrawdownAnalysis {
  series: { date: string; drawdown: number; wealth: number }[];
  maxDrawdown: number;
  maxDrawdownDate: string | null;
  episodes: DrawdownEpisode[];
  ulcerIndex: number;
  painIndex: number;
  /** Conditional drawdown at risk: mean of the worst 5% of drawdown readings. */
  conditionalDrawdown95: number;
  periodsUnderwater: number;
  percentTimeUnderwater: number;
  longestUnderwaterPeriods: number;
  currentDrawdown: number;
  currentUnderwaterPeriods: number;
  averageRecoveryPeriods: number | null;
}

export function analyzeDrawdowns(dates: string[], returns: number[]): DrawdownAnalysis {
  const series: { date: string; drawdown: number; wealth: number }[] = [];
  let wealth = 1;
  let peak = 1;

  for (let i = 0; i < returns.length; i++) {
    wealth *= 1 + returns[i];
    if (wealth > peak) peak = wealth;
    series.push({ date: dates[i], drawdown: peak > 0 ? wealth / peak - 1 : 0, wealth });
  }

  const drawdowns = series.map((s) => s.drawdown);
  const maxDrawdown = drawdowns.length ? Math.min(...drawdowns) : 0;
  const maxIndex = drawdowns.indexOf(maxDrawdown);

  // Walk the wealth path and cut it into peak-to-recovery episodes.
  const episodes: Omit<DrawdownEpisode, "rank">[] = [];
  let runningPeak = 1;
  let peakIndex = -1;
  let troughValue = Infinity;
  let troughIndex = -1;
  let inDrawdown = false;

  for (let i = 0; i < series.length; i++) {
    const w = series[i].wealth;
    if (!inDrawdown) {
      if (w < runningPeak - EPS) {
        inDrawdown = true;
        troughValue = w;
        troughIndex = i;
      } else {
        runningPeak = w;
        peakIndex = i;
      }
      continue;
    }

    if (w < troughValue) {
      troughValue = w;
      troughIndex = i;
    }
    if (w >= runningPeak - EPS) {
      episodes.push({
        depth: troughValue / runningPeak - 1,
        peakDate: peakIndex >= 0 ? dates[peakIndex] : dates[0],
        troughDate: dates[troughIndex],
        recoveryDate: dates[i],
        declinePeriods: troughIndex - Math.max(peakIndex, 0),
        recoveryPeriods: i - troughIndex,
        totalPeriods: i - Math.max(peakIndex, 0),
        recovered: true,
      });
      inDrawdown = false;
      runningPeak = w;
      peakIndex = i;
      troughValue = Infinity;
      troughIndex = -1;
    }
  }

  if (inDrawdown && troughIndex >= 0) {
    episodes.push({
      depth: troughValue / runningPeak - 1,
      peakDate: peakIndex >= 0 ? dates[peakIndex] : dates[0],
      troughDate: dates[troughIndex],
      recoveryDate: null,
      declinePeriods: troughIndex - Math.max(peakIndex, 0),
      recoveryPeriods: null,
      totalPeriods: series.length - 1 - Math.max(peakIndex, 0),
      recovered: false,
    });
  }

  const ranked = episodes
    .sort((a, b) => a.depth - b.depth)
    .slice(0, 10)
    .map((e, i) => ({ rank: i + 1, ...e }));

  const squared = drawdowns.reduce((acc, d) => acc + d * d, 0);
  const ulcerIndex = drawdowns.length ? Math.sqrt(squared / drawdowns.length) : 0;
  const painIndex = drawdowns.length
    ? drawdowns.reduce((acc, d) => acc + Math.abs(d), 0) / drawdowns.length
    : 0;

  const sortedDd = [...drawdowns].sort((a, b) => a - b);
  const tailCount = Math.max(1, Math.ceil(sortedDd.length * 0.05));
  const conditionalDrawdown95 = mean(sortedDd.slice(0, tailCount));

  const periodsUnderwater = drawdowns.filter((d) => d < -EPS).length;

  let longestUnderwaterPeriods = 0;
  let run = 0;
  for (const d of drawdowns) {
    if (d < -EPS) {
      run++;
      longestUnderwaterPeriods = Math.max(longestUnderwaterPeriods, run);
    } else {
      run = 0;
    }
  }

  let currentUnderwaterPeriods = 0;
  for (let i = drawdowns.length - 1; i >= 0 && drawdowns[i] < -EPS; i--) currentUnderwaterPeriods++;

  const recoveries = episodes.filter((e) => e.recoveryPeriods !== null).map((e) => e.recoveryPeriods!);

  return {
    series,
    maxDrawdown,
    maxDrawdownDate: maxIndex >= 0 ? dates[maxIndex] : null,
    episodes: ranked,
    ulcerIndex,
    painIndex,
    conditionalDrawdown95,
    periodsUnderwater,
    percentTimeUnderwater: drawdowns.length ? periodsUnderwater / drawdowns.length : 0,
    longestUnderwaterPeriods,
    currentDrawdown: drawdowns.length ? drawdowns[drawdowns.length - 1] : 0,
    currentUnderwaterPeriods,
    averageRecoveryPeriods: recoveries.length ? mean(recoveries) : null,
  };
}

// ---------------------------------------------------------------------------
// Main engine
// ---------------------------------------------------------------------------

export function analyzeReturnStream(input: AnalyticsInput) {
  const {
    dates,
    returns,
    benchmarkName = null,
    fundName = "Uploaded Return Stream",
    riskFreeRate = 0,
    minimumAcceptableReturn = 0,
    simulationYears = 5,
    simulationPaths = 5000,
  } = input;

  if (dates.length !== returns.length) {
    throw new Error("Dates and returns must be the same length.");
  }
  if (returns.length < 6) {
    throw new Error("At least 6 periods of returns are required to compute meaningful analytics.");
  }

  const ppy = input.periodsPerYear && input.periodsPerYear > 0 ? input.periodsPerYear : 12;
  const n = returns.length;
  const rfPeriod = perPeriodRate(riskFreeRate, ppy);
  const marPeriod = perPeriodRate(minimumAcceptableReturn, ppy);

  const benchmark =
    input.benchmarkReturns && input.benchmarkReturns.length === n ? input.benchmarkReturns : null;

  // -- Return generation ----------------------------------------------------

  const cumulativeReturn = compound(returns);
  const annualizedReturn = annualizeCumulative(cumulativeReturn, n, ppy);
  const arithmeticMean = mean(returns);
  const arithmeticAnnualized = arithmeticMean * ppy;

  const wealthIndex: { date: string; fund: number; benchmark: number | null }[] = [];
  {
    let fundWealth = 100;
    let benchWealth = 100;
    for (let i = 0; i < n; i++) {
      fundWealth *= 1 + returns[i];
      if (benchmark) benchWealth *= 1 + benchmark[i];
      wealthIndex.push({ date: dates[i], fund: fundWealth, benchmark: benchmark ? benchWealth : null });
    }
  }

  const positive = returns.filter((r) => r > 0);
  const negative = returns.filter((r) => r < 0);
  const flat = returns.filter((r) => Math.abs(r) < EPS);

  // -- Risk -----------------------------------------------------------------

  const periodVolatility = stdDev(returns);
  const annualizedVolatility = periodVolatility * Math.sqrt(ppy);

  const downsideDeviationPeriod = Math.sqrt(lowerPartialMoment(returns, marPeriod, 2));
  const downsideDeviation = downsideDeviationPeriod * Math.sqrt(ppy);

  const upsideDeviation = Math.sqrt(
    returns.reduce((acc, r) => acc + Math.max(r - marPeriod, 0) ** 2, 0) / n
  ) * Math.sqrt(ppy);

  const skew = skewness(returns);
  const kurt = excessKurtosis(returns);

  // Jarque-Bera tests whether the return distribution is normal enough for
  // Gaussian VaR to be trusted.
  let jarqueBera: number | null = null;
  let jarqueBeraPValue: number | null = null;
  if (skew !== null && kurt !== null && n >= 8) {
    jarqueBera = (n / 6) * (skew ** 2 + (kurt ** 2) / 4);
    jarqueBeraPValue = chiSquareUpperTail(jarqueBera, 2);
  }

  const varLevels = [0.95, 0.99] as const;
  const tailRisk = varLevels.map((confidence) => {
    const alpha = 1 - confidence;
    const z = normalInv(alpha);
    const historicalVar = percentile(returns, alpha * 100);
    const parametricVar = arithmeticMean + z * periodVolatility;

    // Cornish-Fisher expands the Gaussian quantile for skew and fat tails, which
    // matters because hedge fund returns are rarely normal.
    let modifiedVar: number | null = null;
    if (skew !== null && kurt !== null) {
      const zcf =
        z +
        ((z * z - 1) * skew) / 6 +
        ((z ** 3 - 3 * z) * kurt) / 24 -
        ((2 * z ** 3 - 5 * z) * skew * skew) / 36;
      modifiedVar = arithmeticMean + zcf * periodVolatility;
    }

    const beyond = returns.filter((r) => r <= historicalVar);
    const historicalCvar = beyond.length ? mean(beyond) : historicalVar;

    // Closed-form Gaussian expected shortfall.
    const parametricCvar = arithmeticMean - periodVolatility * (Math.exp(-(z * z) / 2) / Math.sqrt(2 * Math.PI)) / alpha;

    return {
      confidence,
      historicalVar,
      parametricVar,
      modifiedVar,
      historicalCvar,
      parametricCvar,
      observationsInTail: beyond.length,
    };
  });

  const var95 = tailRisk[0];
  const var99 = tailRisk[1];

  // -- Drawdowns ------------------------------------------------------------

  const drawdown = analyzeDrawdowns(dates, returns);

  // -- Risk-adjusted --------------------------------------------------------

  const excessOverRf = returns.map((r) => r - rfPeriod);
  const meanExcess = mean(excessOverRf);
  const sharpePeriod = safeDiv(meanExcess, stdDev(excessOverRf));
  const sharpeRatio = sharpePeriod === null ? null : sharpePeriod * Math.sqrt(ppy);

  const sortinoRatio =
    downsideDeviationPeriod > EPS
      ? ((arithmeticMean - marPeriod) / downsideDeviationPeriod) * Math.sqrt(ppy)
      : null;

  const calmarRatio =
    annualizedReturn !== null && Math.abs(drawdown.maxDrawdown) > EPS
      ? annualizedReturn / Math.abs(drawdown.maxDrawdown)
      : null;

  // Sterling uses the average of the largest drawdowns rather than the single worst.
  const topDrawdowns = drawdown.episodes.slice(0, 3).map((e) => Math.abs(e.depth));
  const sterlingRatio =
    annualizedReturn !== null && topDrawdowns.length > 0 && mean(topDrawdowns) > EPS
      ? annualizedReturn / mean(topDrawdowns)
      : null;

  const burkeDenominator = Math.sqrt(
    drawdown.episodes.reduce((acc, e) => acc + e.depth ** 2, 0)
  );
  const burkeRatio =
    annualizedReturn !== null && burkeDenominator > EPS
      ? (annualizedReturn - riskFreeRate) / burkeDenominator
      : null;

  const martinRatio =
    annualizedReturn !== null && drawdown.ulcerIndex > EPS
      ? (annualizedReturn - riskFreeRate) / drawdown.ulcerIndex
      : null;

  const gainsAboveMar = returns.reduce((acc, r) => acc + Math.max(r - marPeriod, 0), 0);
  const lossesBelowMar = returns.reduce((acc, r) => acc + Math.max(marPeriod - r, 0), 0);
  const omegaRatio = safeDiv(gainsAboveMar, lossesBelowMar);

  const lpm3 = lowerPartialMoment(returns, marPeriod, 3);
  const kappaThree =
    lpm3 > EPS ? ((arithmeticMean - marPeriod) / Math.cbrt(lpm3)) * ppy ** (2 / 3) : null;

  const totalGain = positive.reduce((a, b) => a + b, 0);
  const totalLoss = Math.abs(negative.reduce((a, b) => a + b, 0));
  const gainToPainRatio = safeDiv(totalGain - totalLoss, totalLoss);

  const p95Return = percentile(returns, 95);
  const p5Return = percentile(returns, 5);
  const tailRatio = safeDiv(Math.abs(p95Return), Math.abs(p5Return));
  const commonSenseRatio =
    tailRatio !== null && gainToPainRatio !== null ? tailRatio * (gainToPainRatio + 1) : null;

  // Modified Sharpe replaces volatility with Cornish-Fisher VaR, penalising
  // strategies whose risk hides in the left tail (credit, vol-selling, etc.).
  const modifiedSharpe =
    var95.modifiedVar !== null && Math.abs(var95.modifiedVar) > EPS
      ? (meanExcess / Math.abs(var95.modifiedVar)) * Math.sqrt(ppy)
      : null;

  // Adjusted Sharpe (Pezier & White) discounts the Sharpe for negative skew and
  // excess kurtosis using a third-order Taylor expansion of expected utility.
  const adjustedSharpe =
    sharpeRatio !== null && skew !== null && kurt !== null
      ? sharpeRatio * (1 + (skew / 6) * sharpeRatio - (kurt / 24) * sharpeRatio ** 2)
      : null;

  // Probabilistic Sharpe: probability the TRUE Sharpe exceeds zero, given the
  // track length and the non-normality of the observed returns.
  let probabilisticSharpe: number | null = null;
  let minimumTrackRecordYears: number | null = null;
  if (sharpePeriod !== null && skew !== null && kurt !== null && n > 2) {
    const gamma3 = skew;
    const gamma4 = kurt + 3;
    const denominatorSq = 1 - gamma3 * sharpePeriod + ((gamma4 - 1) / 4) * sharpePeriod ** 2;
    if (denominatorSq > EPS) {
      const denominator = Math.sqrt(denominatorSq);
      probabilisticSharpe = normalCdf((sharpePeriod * Math.sqrt(n - 1)) / denominator);
      if (Math.abs(sharpePeriod) > EPS) {
        // Periods needed for 95% confidence that the true Sharpe beats zero.
        const requiredPeriods = 1 + denominatorSq * (normalInv(0.95) / sharpePeriod) ** 2;
        minimumTrackRecordYears = requiredPeriods / ppy;
      }
    }
  }

  // -- Return-smoothing diagnostics ----------------------------------------

  const autocorrelations = [1, 2, 3, 4, 5, 6]
    .filter((lag) => n > lag + 2)
    .map((lag) => ({ lag, value: autocorrelation(returns, lag) }));

  const rho1 = autocorrelations.find((a) => a.lag === 1)?.value ?? null;

  const ljungBoxLags = Math.min(6, Math.max(1, Math.floor(n / 5)));
  let ljungBox: number | null = null;
  let ljungBoxPValue: number | null = null;
  if (n > ljungBoxLags + 3) {
    let q = 0;
    let used = 0;
    for (let lag = 1; lag <= ljungBoxLags; lag++) {
      const rho = autocorrelation(returns, lag);
      if (rho === null) continue;
      q += (rho * rho) / (n - lag);
      used++;
    }
    if (used > 0) {
      ljungBox = n * (n + 2) * q;
      ljungBoxPValue = chiSquareUpperTail(ljungBox, used);
    }
  }

  // Geltner first-order unsmoothing backs out the "true" economic return from a
  // reported series that has been averaged/appraised, then re-measures risk.
  let unsmoothed: {
    rho: number;
    volatility: number;
    sharpe: number | null;
    maxDrawdown: number;
    volatilityUplift: number;
  } | null = null;

  if (rho1 !== null && rho1 > 0.05 && Math.abs(1 - rho1) > EPS) {
    const unsmoothedReturns: number[] = [];
    for (let i = 1; i < n; i++) {
      unsmoothedReturns.push((returns[i] - rho1 * returns[i - 1]) / (1 - rho1));
    }
    const uVol = stdDev(unsmoothedReturns) * Math.sqrt(ppy);
    const uExcess = unsmoothedReturns.map((r) => r - rfPeriod);
    const uSharpe = safeDiv(mean(uExcess), stdDev(uExcess));
    const uDrawdown = analyzeDrawdowns(dates.slice(1), unsmoothedReturns);
    unsmoothed = {
      rho: rho1,
      volatility: uVol,
      sharpe: uSharpe === null ? null : uSharpe * Math.sqrt(ppy),
      maxDrawdown: uDrawdown.maxDrawdown,
      volatilityUplift: annualizedVolatility > EPS ? uVol / annualizedVolatility - 1 : 0,
    };
  }

  // -- Benchmark-relative ---------------------------------------------------

  const relative = benchmark ? analyzeRelative(returns, benchmark, rfPeriod, ppy, riskFreeRate, n) : null;

  // -- Period, calendar, and rolling views ---------------------------------

  const periodReturns = buildPeriodReturns(dates, returns, benchmark, ppy);
  const calendarYears = buildCalendarYears(dates, returns, benchmark, ppy);
  const monthlyGrid = ppy >= 12 ? buildMonthlyGrid(dates, returns) : null;
  const rolling = buildRolling(dates, returns, benchmark, rfPeriod, ppy);
  const histogram = buildHistogram(returns, arithmeticMean, periodVolatility);
  const worstWindows = buildWorstWindows(dates, returns, benchmark, ppy);
  const scatter = benchmark
    ? dates.map((date, i) => ({ date, fund: returns[i], benchmark: benchmark[i] }))
    : null;

  // -- Forward-looking simulation ------------------------------------------

  const simulation = runBootstrapSimulation(returns, ppy, simulationYears, simulationPaths, rho1);

  // -- Data quality ---------------------------------------------------------

  const dataQuality = buildDataQualityChecks({
    dates,
    returns,
    ppy,
    n,
    rho1,
    ljungBoxPValue,
    flatCount: flat.length,
    benchmarkPeriods: benchmark ? benchmark.length : 0,
    periodVolatility,
    arithmeticMean,
  });

  const trackRecordYears = n / ppy;

  return {
    meta: {
      fundName,
      benchmarkName,
      periods: n,
      periodsPerYear: ppy,
      frequencyLabel: frequencyLabel(ppy),
      periodLabel: periodLabel(ppy),
      startDate: dates[0],
      endDate: dates[n - 1],
      trackRecordYears,
      riskFreeRate,
      minimumAcceptableReturn,
      hasBenchmark: benchmark !== null,
      generatedAt: new Date().toISOString(),
    },

    performance: {
      cumulativeReturn,
      annualizedReturn,
      arithmeticAnnualizedReturn: arithmeticAnnualized,
      bestPeriod: Math.max(...returns),
      bestPeriodDate: dates[returns.indexOf(Math.max(...returns))],
      worstPeriod: Math.min(...returns),
      worstPeriodDate: dates[returns.indexOf(Math.min(...returns))],
      positivePeriods: positive.length,
      negativePeriods: negative.length,
      flatPeriods: flat.length,
      hitRate: positive.length / n,
      averageGain: positive.length ? mean(positive) : 0,
      averageLoss: negative.length ? mean(negative) : 0,
      gainLossRatio: negative.length && positive.length ? safeDiv(mean(positive), Math.abs(mean(negative))) : null,
      longestWinStreak: longestStreak(returns, (r) => r > 0),
      longestLossStreak: longestStreak(returns, (r) => r < 0),
      wealthIndex,
      periodReturns,
      calendarYears,
      monthlyGrid,
    },

    risk: {
      annualizedVolatility,
      periodVolatility,
      downsideDeviation,
      upsideDeviation,
      volatilitySkewRatio: safeDiv(upsideDeviation, downsideDeviation),
      skewness: skew,
      excessKurtosis: kurt,
      jarqueBera,
      jarqueBeraPValue,
      isNormal: jarqueBeraPValue === null ? null : jarqueBeraPValue > 0.05,
      var95,
      var99,
      tailRisk,
      tailRatio,
      histogram,
      worstWindows,
      drawdown,
    },

    riskAdjusted: {
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      sterlingRatio,
      burkeRatio,
      martinRatio,
      omegaRatio,
      kappaThree,
      gainToPainRatio,
      modifiedSharpe,
      adjustedSharpe,
      commonSenseRatio,
      probabilisticSharpe,
      minimumTrackRecordYears,
    },

    smoothing: {
      autocorrelations,
      lag1Autocorrelation: rho1,
      ljungBox,
      ljungBoxPValue,
      ljungBoxLags,
      hasSerialDependence: ljungBoxPValue === null ? null : ljungBoxPValue < 0.05,
      unsmoothed,
    },

    relative,
    rolling,
    scatter,
    simulation,
    dataQuality,
  };
}

// ---------------------------------------------------------------------------
// Benchmark-relative analytics
// ---------------------------------------------------------------------------

function analyzeRelative(
  returns: number[],
  benchmark: number[],
  rfPeriod: number,
  ppy: number,
  riskFreeRate: number,
  n: number
) {
  const fundExcess = returns.map((r) => r - rfPeriod);
  const benchExcess = benchmark.map((r) => r - rfPeriod);

  // CAPM regression of excess fund return on excess benchmark return.
  const capm: Regression | null = linearRegression(benchExcess, fundExcess);

  const beta = capm ? capm.slope : null;
  // Compound the periodic intercept so alpha is quoted on the same geometric
  // basis as the annualised returns beside it.
  const alphaAnnual = capm ? (1 + capm.intercept) ** ppy - 1 : null;
  const alphaTStat = capm ? capm.interceptTStat : null;
  const alphaPValue = capm ? capm.interceptPValue : null;

  const corr = correlation(returns, benchmark);
  const rSquared = capm ? capm.rSquared : null;

  const activeReturns = returns.map((r, i) => r - benchmark[i]);
  const trackingError = stdDev(activeReturns) * Math.sqrt(ppy);

  const fundCumulative = compound(returns);
  const benchCumulative = compound(benchmark);
  const fundAnnual = annualizeCumulative(fundCumulative, n, ppy);
  const benchAnnual = annualizeCumulative(benchCumulative, n, ppy);
  const activePremium = fundAnnual !== null && benchAnnual !== null ? fundAnnual - benchAnnual : null;

  const informationRatio =
    activePremium !== null && trackingError > EPS ? activePremium / trackingError : null;

  const treynorRatio =
    fundAnnual !== null && beta !== null && Math.abs(beta) > 0.01
      ? (fundAnnual - riskFreeRate) / beta
      : null;

  // Up / down market conditioning.
  const upIdx: number[] = [];
  const downIdx: number[] = [];
  for (let i = 0; i < n; i++) {
    if (benchmark[i] > 0) upIdx.push(i);
    else if (benchmark[i] < 0) downIdx.push(i);
  }

  const geometricCapture = (idx: number[]): number | null => {
    if (idx.length < 3) return null;
    const f = compound(idx.map((i) => returns[i]));
    const b = compound(idx.map((i) => benchmark[i]));
    const fa = annualizeCumulative(f, idx.length, ppy);
    const ba = annualizeCumulative(b, idx.length, ppy);
    if (fa === null || ba === null || Math.abs(ba) < EPS) return null;
    return fa / ba;
  };

  const upCapture = geometricCapture(upIdx);
  const downCapture = geometricCapture(downIdx);

  const conditionalBeta = (idx: number[]): number | null => {
    if (idx.length < 5) return null;
    const reg = linearRegression(idx.map((i) => benchExcess[i]), idx.map((i) => fundExcess[i]));
    return reg ? reg.slope : null;
  };

  const upBeta = conditionalBeta(upIdx);
  const downBeta = conditionalBeta(downIdx);

  const downsideIdx = benchmark.map((b, i) => (b < 0 ? i : -1)).filter((i) => i >= 0);
  const downsideCorrelation =
    downsideIdx.length >= 5
      ? correlation(downsideIdx.map((i) => returns[i]), downsideIdx.map((i) => benchmark[i]))
      : null;

  const battingAverage = returns.filter((r, i) => r > benchmark[i]).length / n;
  const upPeriodRatio = upIdx.length
    ? upIdx.filter((i) => returns[i] > 0).length / upIdx.length
    : null;
  const downPeriodRatio = downIdx.length
    ? downIdx.filter((i) => returns[i] > benchmark[i]).length / downIdx.length
    : null;

  const fundVol = stdDev(returns) * Math.sqrt(ppy);
  const benchVol = stdDev(benchmark) * Math.sqrt(ppy);
  const fundSharpePeriod = safeDiv(mean(fundExcess), stdDev(fundExcess));
  const m2 =
    fundSharpePeriod !== null ? riskFreeRate + fundSharpePeriod * Math.sqrt(ppy) * benchVol : null;
  const m2Alpha = m2 !== null && benchAnnual !== null ? m2 - benchAnnual : null;

  const appraisalRatio =
    capm && alphaAnnual !== null && capm.residualStdDev > EPS
      ? alphaAnnual / (capm.residualStdDev * Math.sqrt(ppy))
      : null;

  const activeCumulative: number[] = [];
  {
    let fundGrowth = 1;
    let benchGrowth = 1;
    for (let i = 0; i < n; i++) {
      fundGrowth *= 1 + returns[i];
      benchGrowth *= 1 + benchmark[i];
      activeCumulative.push(Math.abs(benchGrowth) < EPS ? 0 : fundGrowth / benchGrowth - 1);
    }
  }

  return {
    beta,
    upBeta,
    downBeta,
    betaAsymmetry: upBeta !== null && downBeta !== null ? upBeta - downBeta : null,
    alpha: alphaAnnual,
    alphaTStat,
    alphaPValue,
    alphaIsSignificant: alphaPValue === null ? null : alphaPValue < 0.05,
    correlation: corr,
    downsideCorrelation,
    rSquared,
    trackingError,
    informationRatio,
    treynorRatio,
    activePremium,
    upCapture,
    downCapture,
    captureSpread: upCapture !== null && downCapture !== null ? upCapture - downCapture : null,
    battingAverage,
    upPeriodRatio,
    downPeriodRatio,
    upPeriods: upIdx.length,
    downPeriods: downIdx.length,
    m2,
    m2Alpha,
    appraisalRatio,
    residualVolatility: capm ? capm.residualStdDev * Math.sqrt(ppy) : null,
    benchmarkAnnualizedReturn: benchAnnual,
    benchmarkCumulativeReturn: benchCumulative,
    benchmarkVolatility: benchVol,
    fundVolatility: fundVol,
    activeCumulative,
    observations: n,
  };
}

// ---------------------------------------------------------------------------
// Period / calendar views
// ---------------------------------------------------------------------------

function buildPeriodReturns(
  dates: string[],
  returns: number[],
  benchmark: number[] | null,
  ppy: number
): PeriodReturn[] {
  const n = returns.length;
  const endDate = dates[n - 1];
  const out: PeriodReturn[] = [];

  const make = (label: string, startIndex: number, complete: boolean, annualize: boolean) => {
    const slice = returns.slice(startIndex);
    if (slice.length === 0) return;
    const cum = compound(slice);
    const bSlice = benchmark ? benchmark.slice(startIndex) : null;
    const bCum = bSlice ? compound(bSlice) : null;
    // Annualising a partial year overstates it, so sub-annual windows report
    // cumulative only and `annualized` stays null.
    const ann = annualize ? annualizeCumulative(cum, slice.length, ppy) : null;
    const bAnn = annualize && bCum !== null ? annualizeCumulative(bCum, slice.length, ppy) : null;
    const headline = ann ?? cum;
    const bHeadline = bAnn ?? bCum;
    out.push({
      label,
      cumulative: cum,
      annualized: ann,
      benchmarkCumulative: bCum,
      benchmarkAnnualized: bAnn,
      excess: bHeadline === null ? null : headline - bHeadline,
      periods: slice.length,
      complete,
    });
  };

  // Year to date.
  const currentYear = isoYear(endDate);
  const ytdStart = dates.findIndex((d) => isoYear(d) === currentYear);
  if (ytdStart >= 0) make("YTD", ytdStart, true, false);

  // Trailing windows, annualised beyond one year.
  const windows: { label: string; years: number }[] = [
    { label: "1 Year", years: 1 },
    { label: "3 Years", years: 3 },
    { label: "5 Years", years: 5 },
    { label: "7 Years", years: 7 },
    { label: "10 Years", years: 10 },
  ];

  for (const w of windows) {
    const need = Math.round(w.years * ppy);
    if (n < Math.max(2, Math.round(need * 0.5))) continue;
    const complete = n >= need;
    const start = Math.max(0, n - need);
    // An incomplete window that reaches back to inception just restates
    // "Since Inception", so drop it rather than printing the number twice.
    if (!complete && start === 0) continue;
    make(w.label, start, complete, w.years > 1);
  }

  make("Since Inception", 0, true, true);
  return out;
}

function buildCalendarYears(
  dates: string[],
  returns: number[],
  benchmark: number[] | null,
  ppy: number
): CalendarYearReturn[] {
  const byYear = new Map<number, number[]>();
  const benchByYear = new Map<number, number[]>();

  for (let i = 0; i < returns.length; i++) {
    const y = isoYear(dates[i]);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(returns[i]);
    if (benchmark) {
      if (!benchByYear.has(y)) benchByYear.set(y, []);
      benchByYear.get(y)!.push(benchmark[i]);
    }
  }

  return Array.from(byYear.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([year, rs]) => {
      const fund = compound(rs);
      const bench = benchmark ? compound(benchByYear.get(year) ?? []) : null;
      return {
        year,
        fund,
        benchmark: bench,
        excess: bench === null ? null : fund - bench,
        periods: rs.length,
        // A year is partial if it holds fewer observations than a full year should.
        partial: ppy >= 1 && rs.length < Math.round(ppy * 0.9),
      };
    });
}

function buildMonthlyGrid(dates: string[], returns: number[]): MonthlyGridRow[] {
  // Compound sub-monthly data up to calendar months so the grid works for
  // daily and weekly streams too.
  const byYearMonth = new Map<string, number[]>();
  for (let i = 0; i < returns.length; i++) {
    const key = dates[i].slice(0, 7);
    if (!byYearMonth.has(key)) byYearMonth.set(key, []);
    byYearMonth.get(key)!.push(returns[i]);
  }

  const years = Array.from(new Set(Array.from(byYearMonth.keys()).map((k) => parseInt(k.slice(0, 4), 10)))).sort(
    (a, b) => a - b
  );

  return years.map((year) => {
    const months: (number | null)[] = [];
    for (let m = 0; m < 12; m++) {
      const key = `${year}-${String(m + 1).padStart(2, "0")}`;
      const rs = byYearMonth.get(key);
      months.push(rs && rs.length ? compound(rs) : null);
    }
    const present = months.filter((v): v is number => v !== null);
    return { year, months, total: present.length ? compound(present) : null };
  });
}

function buildHistogram(returns: number[], mu: number, sigma: number): HistogramBin[] {
  const min = Math.min(...returns);
  const max = Math.max(...returns);
  if (max - min < EPS) return [];

  const binCount = Math.min(24, Math.max(8, Math.ceil(Math.sqrt(returns.length) * 1.5)));
  const width = (max - min) / binCount;
  const bins: HistogramBin[] = [];

  for (let i = 0; i < binCount; i++) {
    const lower = min + i * width;
    const upper = i === binCount - 1 ? max : lower + width;
    const count = returns.filter((r) => (i === binCount - 1 ? r >= lower && r <= upper : r >= lower && r < upper)).length;

    // Expected count under a fitted normal, for the overlay curve.
    const normalCount =
      sigma > EPS ? returns.length * (normalCdf((upper - mu) / sigma) - normalCdf((lower - mu) / sigma)) : 0;

    bins.push({
      label: `${(lower * 100).toFixed(1)}%`,
      lowerBound: lower,
      upperBound: upper,
      count,
      normalCount,
    });
  }
  return bins;
}

function buildWorstWindows(
  dates: string[],
  returns: number[],
  benchmark: number[] | null,
  ppy: number
): WorstWindow[] {
  const specs: { label: string; months: number }[] = [
    { label: "Worst 1 Month", months: 1 },
    { label: "Worst 3 Months", months: 3 },
    { label: "Worst 6 Months", months: 6 },
    { label: "Worst 12 Months", months: 12 },
    { label: "Worst 24 Months", months: 24 },
  ];

  return specs
    .map(({ label, months }) => {
      const window = Math.max(1, Math.round((months / 12) * ppy));
      if (returns.length < window) {
        return { label, periods: window, worstReturn: null, startDate: null, endDate: null, benchmarkReturn: null };
      }
      let worst = Infinity;
      let worstStart = 0;
      for (let i = 0; i + window <= returns.length; i++) {
        const cum = compound(returns.slice(i, i + window));
        if (cum < worst) {
          worst = cum;
          worstStart = i;
        }
      }
      return {
        label,
        periods: window,
        worstReturn: worst,
        startDate: dates[worstStart],
        endDate: dates[worstStart + window - 1],
        benchmarkReturn: benchmark ? compound(benchmark.slice(worstStart, worstStart + window)) : null,
      };
    })
    .filter((w) => w.worstReturn !== null);
}

function buildRolling(
  dates: string[],
  returns: number[],
  benchmark: number[] | null,
  rfPeriod: number,
  ppy: number
): { window: number; windowLabel: string; points: RollingPoint[] } {
  // One-year rolling windows are the committee standard; for very short streams
  // fall back to half the history so the chart still says something.
  const window = returns.length >= Math.round(ppy) + 3 ? Math.round(ppy) : Math.max(4, Math.floor(returns.length / 2));
  const points: RollingPoint[] = [];

  for (let i = window - 1; i < returns.length; i++) {
    const slice = returns.slice(i - window + 1, i + 1);
    const bSlice = benchmark ? benchmark.slice(i - window + 1, i + 1) : null;

    const vol = stdDev(slice) * Math.sqrt(ppy);
    const excess = slice.map((r) => r - rfPeriod);
    const sharpePeriod = safeDiv(mean(excess), stdDev(excess));

    let beta: number | null = null;
    let corr: number | null = null;
    let alpha: number | null = null;
    if (bSlice) {
      const bVar = variance(bSlice);
      if (bVar > EPS) {
        beta = covariance(bSlice, slice) / bVar;
        const fundAnn = annualizeCumulative(compound(slice), slice.length, ppy);
        const benchAnn = annualizeCumulative(compound(bSlice), bSlice.length, ppy);
        if (fundAnn !== null && benchAnn !== null) {
          const rfAnn = (1 + rfPeriod) ** ppy - 1;
          alpha = fundAnn - (rfAnn + beta * (benchAnn - rfAnn));
        }
      }
      corr = correlation(slice, bSlice);
    }

    points.push({
      date: dates[i],
      return: compound(slice),
      benchmarkReturn: bSlice ? compound(bSlice) : null,
      volatility: vol,
      sharpe: sharpePeriod === null ? null : sharpePeriod * Math.sqrt(ppy),
      beta,
      correlation: corr,
      alpha,
    });
  }

  const windowYears = window / ppy;
  const windowLabel =
    Math.abs(windowYears - 1) < 0.05 ? "12-Month Rolling" : `${window}-${periodLabel(ppy)} Rolling`;

  return { window, windowLabel, points };
}

// ---------------------------------------------------------------------------
// Forward-looking simulation
// ---------------------------------------------------------------------------

/**
 * Stationary block bootstrap of the realised return distribution.
 *
 * Blocks (rather than single draws) preserve the serial dependence that hedge
 * fund returns exhibit — resampling one period at a time would understate the
 * chance of an extended drawdown. Block length scales with the measured lag-1
 * autocorrelation. The RNG is seeded so results are reproducible across runs.
 */
export function runBootstrapSimulation(
  returns: number[],
  ppy: number,
  years: number,
  paths: number,
  rho1: number | null
) {
  const horizon = Math.max(1, Math.round(years * ppy));
  const pathCount = Math.min(Math.max(paths, 500), 20000);

  const persistence = rho1 !== null ? Math.min(Math.max(rho1, 0), 0.9) : 0;
  const meanBlockLength = Math.max(1, Math.round(1 + persistence * ppy));
  const restartProbability = 1 / meanBlockLength;

  const rng = createRng(0x5eed1234);
  const n = returns.length;

  // Wealth (indexed to 1.0) for every path at every step.
  const wealthByStep: number[][] = Array.from({ length: horizon }, () => new Array(pathCount));
  const terminal = new Array<number>(pathCount);
  const pathMaxDrawdown = new Array<number>(pathCount);

  for (let p = 0; p < pathCount; p++) {
    let wealth = 1;
    let peak = 1;
    let maxDd = 0;
    let cursor = Math.floor(rng() * n);

    for (let t = 0; t < horizon; t++) {
      if (t > 0 && rng() < restartProbability) {
        cursor = Math.floor(rng() * n);
      } else if (t > 0) {
        cursor = (cursor + 1) % n;
      }
      wealth *= 1 + returns[cursor];
      if (wealth > peak) peak = wealth;
      const dd = peak > 0 ? wealth / peak - 1 : 0;
      if (dd < maxDd) maxDd = dd;
      wealthByStep[t][p] = wealth;
    }
    terminal[p] = wealth;
    pathMaxDrawdown[p] = maxDd;
  }

  const percentiles: SimulationPercentiles[] = [];
  const step = Math.max(1, Math.floor(horizon / 60));
  for (let t = 0; t < horizon; t++) {
    if (t % step !== 0 && t !== horizon - 1) continue;
    const slice = wealthByStep[t];
    percentiles.push({
      period: t + 1,
      yearFraction: (t + 1) / ppy,
      p5: percentile(slice, 5) - 1,
      p25: percentile(slice, 25) - 1,
      p50: percentile(slice, 50) - 1,
      p75: percentile(slice, 75) - 1,
      p95: percentile(slice, 95) - 1,
    });
  }

  const annualizedTerminal = terminal.map((w) => (w > 0 ? w ** (1 / years) - 1 : -1));

  // Probability of ending below water at each anniversary.
  const lossProbabilities: { years: number; probabilityOfLoss: number; medianReturn: number }[] = [];
  for (let y = 1; y <= years; y++) {
    const idx = Math.min(horizon, Math.round(y * ppy)) - 1;
    if (idx < 0) continue;
    const slice = wealthByStep[idx];
    lossProbabilities.push({
      years: y,
      probabilityOfLoss: slice.filter((w) => w < 1).length / pathCount,
      medianReturn: percentile(slice, 50) - 1,
    });
  }

  return {
    horizonYears: years,
    horizonPeriods: horizon,
    paths: pathCount,
    meanBlockLength,
    percentiles,
    lossProbabilities,
    terminalAnnualized: {
      p5: percentile(annualizedTerminal, 5),
      p25: percentile(annualizedTerminal, 25),
      p50: percentile(annualizedTerminal, 50),
      p75: percentile(annualizedTerminal, 75),
      p95: percentile(annualizedTerminal, 95),
      mean: mean(annualizedTerminal),
    },
    expectedMaxDrawdown: {
      p50: percentile(pathMaxDrawdown, 50),
      p95: percentile(pathMaxDrawdown, 5),
      worst: Math.min(...pathMaxDrawdown),
    },
    probabilityOfLossOverHorizon: terminal.filter((w) => w < 1).length / pathCount,
  };
}

// ---------------------------------------------------------------------------
// Data quality
// ---------------------------------------------------------------------------

function buildDataQualityChecks(args: {
  dates: string[];
  returns: number[];
  ppy: number;
  n: number;
  rho1: number | null;
  ljungBoxPValue: number | null;
  flatCount: number;
  benchmarkPeriods: number;
  periodVolatility: number;
  arithmeticMean: number;
}): DataQualityCheck[] {
  const { dates, returns, ppy, n, rho1, ljungBoxPValue, flatCount, periodVolatility, arithmeticMean } = args;
  const checks: DataQualityCheck[] = [];
  const years = n / ppy;

  checks.push({
    id: "trackLength",
    label: "Track record length",
    status: years >= 5 ? "pass" : years >= 3 ? "warn" : "fail",
    value: `${years.toFixed(1)} yrs (${n} periods)`,
    detail:
      years >= 5
        ? "Long enough to span more than one market regime."
        : years >= 3
          ? "Meets a common three-year minimum but has likely seen only one regime."
          : "Below the three-year minimum most committees require; statistics are unstable.",
  });

  // Gaps in the date sequence suggest missing months, which silently bias every
  // compounded figure.
  const gaps: string[] = [];
  const expectedDays = 365.25 / ppy;
  for (let i = 1; i < dates.length; i++) {
    const delta = (new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime()) / 86400000;
    if (delta > expectedDays * 1.8) gaps.push(`${dates[i - 1]} → ${dates[i]}`);
  }
  checks.push({
    id: "continuity",
    label: "Period continuity",
    status: gaps.length === 0 ? "pass" : gaps.length <= 2 ? "warn" : "fail",
    value: gaps.length === 0 ? "No gaps" : `${gaps.length} gap${gaps.length === 1 ? "" : "s"}`,
    detail:
      gaps.length === 0
        ? "Dates form an unbroken sequence at the detected frequency."
        : `Missing periods detected: ${gaps.slice(0, 3).join(", ")}${gaps.length > 3 ? ", …" : ""}. Compounded figures assume no return in the gap.`,
  });

  const rhoAbs = rho1 === null ? 0 : Math.abs(rho1);
  checks.push({
    id: "smoothing",
    label: "Return smoothing (lag-1 autocorrelation)",
    status: rhoAbs < 0.2 ? "pass" : rhoAbs < 0.35 ? "warn" : "fail",
    value: rho1 === null ? "n/a" : rho1.toFixed(3),
    detail:
      rhoAbs < 0.2
        ? "Low serial correlation; reported volatility is credible."
        : rhoAbs < 0.35
          ? "Moderate serial correlation. Some mark smoothing or stale pricing is likely; true volatility is higher than reported."
          : "High serial correlation, the classic signature of appraisal-based or illiquid marks. Reported volatility, Sharpe and drawdown all understate the real risk.",
  });

  checks.push({
    id: "serialDependence",
    label: "Ljung-Box serial independence",
    status: ljungBoxPValue === null ? "warn" : ljungBoxPValue > 0.05 ? "pass" : "fail",
    value: ljungBoxPValue === null ? "n/a" : `p = ${ljungBoxPValue.toFixed(3)}`,
    detail:
      ljungBoxPValue === null
        ? "Too few observations to test."
        : ljungBoxPValue > 0.05
          ? "Cannot reject independence; returns behave like genuine period-by-period marks."
          : "Rejects independence at 95%. Returns are serially dependent, consistent with smoothed or modelled pricing.",
  });

  // Identical consecutive returns almost never occur in genuinely marked series.
  let repeats = 0;
  for (let i = 1; i < returns.length; i++) {
    if (Math.abs(returns[i] - returns[i - 1]) < 1e-9) repeats++;
  }
  const repeatShare = n > 1 ? repeats / (n - 1) : 0;
  checks.push({
    id: "staleMarks",
    label: "Repeated / stale marks",
    status: repeatShare < 0.02 ? "pass" : repeatShare < 0.08 ? "warn" : "fail",
    value: `${repeats} repeat${repeats === 1 ? "" : "s"} (${(repeatShare * 100).toFixed(1)}%)`,
    detail:
      repeatShare < 0.02
        ? "Effectively no identical consecutive returns."
        : "Identical consecutive returns suggest carried-forward or modelled marks rather than independent valuations.",
  });

  const zeroShare = n > 0 ? flatCount / n : 0;
  checks.push({
    id: "zeroReturns",
    label: "Zero-return periods",
    status: zeroShare < 0.03 ? "pass" : zeroShare < 0.1 ? "warn" : "fail",
    value: `${flatCount} (${(zeroShare * 100).toFixed(1)}%)`,
    detail:
      zeroShare < 0.03
        ? "Negligible number of flat periods."
        : "A material share of periods show exactly zero return, which usually means the fund was not marked in those periods.",
  });

  // Extreme observations distort every moment-based statistic.
  const outliers = periodVolatility > EPS
    ? returns.filter((r) => Math.abs((r - arithmeticMean) / periodVolatility) > 5).length
    : 0;
  checks.push({
    id: "outliers",
    label: "Extreme observations (>5σ)",
    status: outliers === 0 ? "pass" : outliers <= 1 ? "warn" : "fail",
    value: `${outliers}`,
    detail:
      outliers === 0
        ? "No observations beyond five standard deviations."
        : "Extreme observations dominate volatility, skew and kurtosis. Confirm they are real returns and not data errors or restatements.",
  });

  checks.push({
    id: "benchmarkCoverage",
    label: "Benchmark coverage",
    status: args.benchmarkPeriods === 0 ? "warn" : args.benchmarkPeriods >= n ? "pass" : "warn",
    value: args.benchmarkPeriods === 0 ? "None" : `${args.benchmarkPeriods}/${n} periods`,
    detail:
      args.benchmarkPeriods === 0
        ? "No benchmark supplied, so alpha, beta, capture and information ratio cannot be assessed."
        : args.benchmarkPeriods >= n
          ? "Benchmark aligns with the full manager history."
          : "Benchmark covers only part of the manager history; relative statistics use the overlapping window only.",
  });

  return checks;
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

function longestStreak(returns: number[], predicate: (r: number) => boolean): number {
  let best = 0;
  let run = 0;
  for (const r of returns) {
    if (predicate(r)) {
      run++;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return best;
}

export function frequencyLabel(ppy: number): string {
  if (ppy >= 200) return "Daily";
  if (ppy >= 40) return "Weekly";
  if (ppy >= 10) return "Monthly";
  if (ppy >= 3) return "Quarterly";
  return "Annual";
}

export function periodLabel(ppy: number): string {
  if (ppy >= 200) return "Day";
  if (ppy >= 40) return "Week";
  if (ppy >= 10) return "Month";
  if (ppy >= 3) return "Quarter";
  return "Year";
}
