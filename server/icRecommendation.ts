/**
 * Investment Committee scoring and memo generation.
 *
 * Turns the raw analytics pack into the thing a committee actually votes on: a
 * transparent score, an explicit list of red flags, and a written memo.
 *
 * Two deliberate design choices:
 *
 *  1. Scoring is DETERMINISTIC and rule-based, not model-generated. A committee
 *     has to be able to ask "why did this score 62?" and get the same answer
 *     every time, with every threshold auditable. Each pillar exposes its own
 *     sub-scores and the value that drove them.
 *
 *  2. Data integrity is a PENALTY applied to the composite, not a pillar that
 *     can be averaged away. A fund whose returns are smoothed does not get to
 *     offset that against a flattering Sharpe — the smoothing is precisely what
 *     makes the Sharpe untrustworthy.
 *
 * The output is decision support, not a decision. The memo says so.
 */

import type { Analytics } from "./returnStreamAnalytics";

export type Verdict =
  | "Strong Recommend"
  | "Recommend"
  | "Recommend with Conditions"
  | "Further Diligence Required"
  | "Do Not Recommend";

export type FlagSeverity = "critical" | "high" | "medium" | "low";

export interface RedFlag {
  severity: FlagSeverity;
  category: string;
  title: string;
  detail: string;
  /** What the committee should ask the manager about this. */
  diligenceQuestion: string;
}

export interface ScoreDriver {
  label: string;
  value: string;
  score: number;
  weight: number;
  commentary: string;
}

export interface Pillar {
  id: string;
  name: string;
  description: string;
  score: number;
  /** Nominal weight before any pillar is excluded. */
  weight: number;
  /** Weight actually applied to the composite, renormalised across active pillars. */
  effectiveWeight: number;
  drivers: ScoreDriver[];
  /** Set when the pillar could not be assessed (e.g. no benchmark supplied). */
  unavailableReason?: string;
}

export interface ICAssessment {
  verdict: Verdict;
  verdictRationale: string;
  compositeScore: number;
  rawScore: number;
  integrityPenalty: number;
  confidence: "High" | "Moderate" | "Low";
  confidenceReason: string;
  pillars: Pillar[];
  redFlags: RedFlag[];
  strengths: string[];
  concerns: string[];
  diligenceAgenda: string[];
  memo: string;
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

/**
 * Maps a metric onto 0-100 by linear interpolation through calibrated
 * breakpoints. Breakpoints must be ascending in `value`.
 */
function scoreFromBands(
  value: number | null | undefined,
  bands: { value: number; score: number }[]
): number | null {
  if (value === null || value === undefined || !isFinite(value)) return null;
  if (value <= bands[0].value) return bands[0].score;
  const last = bands[bands.length - 1];
  if (value >= last.value) return last.score;
  for (let i = 1; i < bands.length; i++) {
    const lo = bands[i - 1];
    const hi = bands[i];
    if (value <= hi.value) {
      const t = (value - lo.value) / (hi.value - lo.value);
      return lo.score + t * (hi.score - lo.score);
    }
  }
  return last.score;
}

/** Averages the drivers that could be scored, renormalising their weights. */
function combineDrivers(drivers: ScoreDriver[]): number {
  const totalWeight = drivers.reduce((acc, d) => acc + d.weight, 0);
  if (totalWeight <= 0) return 50;
  return drivers.reduce((acc, d) => acc + d.score * d.weight, 0) / totalWeight;
}

function pct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !isFinite(v)) return "n/a";
  return `${(v * 100).toFixed(digits)}%`;
}

function num(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !isFinite(v)) return "n/a";
  return v.toFixed(digits);
}

function band(score: number): string {
  if (score >= 80) return "strong";
  if (score >= 65) return "good";
  if (score >= 50) return "adequate";
  if (score >= 35) return "weak";
  return "poor";
}

// ---------------------------------------------------------------------------
// Pillars
// ---------------------------------------------------------------------------

function returnGenerationPillar(a: Analytics): Pillar {
  const p = a.performance;
  const rel = a.relative;
  const drivers: ScoreDriver[] = [];

  const cagr = p.annualizedReturn;
  const cagrScore = scoreFromBands(cagr, [
    { value: -0.05, score: 0 },
    { value: 0, score: 20 },
    { value: 0.04, score: 40 },
    { value: 0.08, score: 65 },
    { value: 0.12, score: 82 },
    { value: 0.2, score: 95 },
    { value: 0.3, score: 100 },
  ]);
  if (cagrScore !== null) {
    drivers.push({
      label: "Annualized return (CAGR)",
      value: pct(cagr),
      score: cagrScore,
      weight: 40,
      commentary:
        cagr! >= 0.08
          ? "Absolute return generation is at or above what most committees underwrite for a growth allocation."
          : cagr! >= 0.04
            ? "Modest absolute return; the case rests on the risk taken to earn it."
            : "Absolute return is low; the allocation must be justified by diversification rather than return.",
    });
  }

  const excessOverCash = cagr !== null ? cagr - a.meta.riskFreeRate : null;
  const cashScore = scoreFromBands(excessOverCash, [
    { value: -0.03, score: 0 },
    { value: 0, score: 30 },
    { value: 0.02, score: 50 },
    { value: 0.05, score: 75 },
    { value: 0.1, score: 95 },
    { value: 0.15, score: 100 },
  ]);
  if (cashScore !== null) {
    drivers.push({
      label: "Return over cash",
      value: pct(excessOverCash),
      score: cashScore,
      weight: 25,
      commentary:
        excessOverCash! <= 0
          ? `The strategy has not beaten the ${pct(a.meta.riskFreeRate)} risk-free rate over the period. Cash is the honest comparison.`
          : `Earns ${pct(excessOverCash)} per year over cash before fees and taxes at the investor level.`,
    });
  }

  const hitScore = scoreFromBands(p.hitRate, [
    { value: 0.35, score: 10 },
    { value: 0.45, score: 35 },
    { value: 0.55, score: 60 },
    { value: 0.65, score: 82 },
    { value: 0.8, score: 100 },
  ]);
  if (hitScore !== null) {
    drivers.push({
      label: `Positive ${a.meta.periodLabel.toLowerCase()}s`,
      value: `${pct(p.hitRate, 1)} (${p.positivePeriods}/${a.meta.periods})`,
      score: hitScore,
      weight: 20,
      commentary: `Wins ${pct(p.hitRate, 0)} of ${a.meta.periodLabel.toLowerCase()}s, with an average gain of ${pct(p.averageGain)} against an average loss of ${pct(p.averageLoss)}.`,
    });
  }

  if (rel && rel.activePremium !== null) {
    const activeScore = scoreFromBands(rel.activePremium, [
      { value: -0.06, score: 0 },
      { value: -0.02, score: 25 },
      { value: 0, score: 45 },
      { value: 0.02, score: 65 },
      { value: 0.05, score: 88 },
      { value: 0.1, score: 100 },
    ]);
    if (activeScore !== null) {
      drivers.push({
        label: "Active premium vs benchmark",
        value: pct(rel.activePremium),
        score: activeScore,
        weight: 15,
        commentary:
          rel.activePremium >= 0
            ? `Outperformed ${a.meta.benchmarkName ?? "the benchmark"} by ${pct(rel.activePremium)} per year.`
            : `Trailed ${a.meta.benchmarkName ?? "the benchmark"} by ${pct(Math.abs(rel.activePremium))} per year.`,
      });
    }
  }

  return {
    id: "return",
    name: "Return Generation",
    description: "Absolute and relative return earned over the track record.",
    score: combineDrivers(drivers),
    weight: 25,
    effectiveWeight: 25,
    drivers,
  };
}

function riskControlPillar(a: Analytics): Pillar {
  const drivers: ScoreDriver[] = [];
  const dd = a.risk.drawdown;

  const maxDdScore = scoreFromBands(-dd.maxDrawdown, [
    { value: 0.02, score: 100 },
    { value: 0.05, score: 92 },
    { value: 0.1, score: 78 },
    { value: 0.2, score: 55 },
    { value: 0.35, score: 28 },
    { value: 0.5, score: 8 },
    { value: 0.7, score: 0 },
  ]);
  if (maxDdScore !== null) {
    drivers.push({
      label: "Maximum drawdown",
      value: pct(dd.maxDrawdown),
      score: maxDdScore,
      weight: 30,
      commentary: dd.maxDrawdownDate
        ? `Worst peak-to-trough loss was ${pct(dd.maxDrawdown)}, troughing ${dd.maxDrawdownDate}. ${
            dd.episodes[0]?.recovered
              ? `Recovered in ${dd.episodes[0].recoveryPeriods} ${a.meta.periodLabel.toLowerCase()}s.`
              : "The position has not yet recovered its prior high."
          }`
        : `Worst peak-to-trough loss was ${pct(dd.maxDrawdown)}.`,
    });
  }

  const volScore = scoreFromBands(-a.risk.annualizedVolatility, [
    { value: -0.4, score: 5 },
    { value: -0.25, score: 25 },
    { value: -0.18, score: 45 },
    { value: -0.12, score: 65 },
    { value: -0.07, score: 85 },
    { value: -0.03, score: 100 },
  ]);
  if (volScore !== null) {
    drivers.push({
      label: "Annualized volatility",
      value: pct(a.risk.annualizedVolatility),
      score: volScore,
      weight: 20,
      commentary: `Realized volatility of ${pct(a.risk.annualizedVolatility)}${
        a.smoothing.unsmoothed
          ? `, rising to ${pct(a.smoothing.unsmoothed.volatility)} once the reported series is unsmoothed.`
          : "."
      }`,
    });
  }

  const cvar = a.risk.var95.historicalCvar;
  const cvarScore = scoreFromBands(-cvar, [
    { value: 0.005, score: 100 },
    { value: 0.02, score: 82 },
    { value: 0.05, score: 58 },
    { value: 0.1, score: 30 },
    { value: 0.2, score: 5 },
  ]);
  if (cvarScore !== null) {
    drivers.push({
      label: `95% conditional VaR (${a.meta.periodLabel.toLowerCase()})`,
      value: pct(cvar),
      score: cvarScore,
      weight: 20,
      commentary: `In the worst 5% of ${a.meta.periodLabel.toLowerCase()}s the average loss was ${pct(cvar)}.`,
    });
  }

  const uwScore = scoreFromBands(-dd.percentTimeUnderwater, [
    { value: -0.9, score: 5 },
    { value: -0.75, score: 25 },
    { value: -0.6, score: 45 },
    { value: -0.45, score: 65 },
    { value: -0.25, score: 88 },
    { value: -0.1, score: 100 },
  ]);
  if (uwScore !== null) {
    drivers.push({
      label: "Time under water",
      value: pct(dd.percentTimeUnderwater, 1),
      score: uwScore,
      weight: 15,
      commentary: `Spent ${pct(dd.percentTimeUnderwater, 0)} of the track record below a prior high; the longest single stretch was ${dd.longestUnderwaterPeriods} ${a.meta.periodLabel.toLowerCase()}s.`,
    });
  }

  // Left-tail shape: negative skew plus fat tails is the profile that blows up.
  if (a.risk.skewness !== null && a.risk.excessKurtosis !== null) {
    const tailPenalty = a.risk.skewness - Math.max(a.risk.excessKurtosis, 0) / 4;
    const tailScore = scoreFromBands(tailPenalty, [
      { value: -3, score: 0 },
      { value: -1.5, score: 22 },
      { value: -0.5, score: 50 },
      { value: 0, score: 70 },
      { value: 0.5, score: 88 },
      { value: 1.5, score: 100 },
    ]);
    if (tailScore !== null) {
      drivers.push({
        label: "Tail shape (skew / kurtosis)",
        value: `skew ${num(a.risk.skewness)}, excess kurt ${num(a.risk.excessKurtosis)}`,
        score: tailScore,
        weight: 15,
        commentary:
          a.risk.skewness < -0.5 && a.risk.excessKurtosis > 1
            ? "Negatively skewed with fat tails — the return pattern of a strategy that collects small premiums and occasionally pays out large losses. Volatility understates the risk."
            : a.risk.skewness >= 0
              ? "Positively skewed: gains are the outliers rather than the losses, which is the desirable asymmetry."
              : "Mildly negative skew, within the normal range for a directional strategy.",
      });
    }
  }

  return {
    id: "risk",
    name: "Risk Control",
    description: "Loss magnitude, volatility, tail shape and time spent below high-water mark.",
    score: combineDrivers(drivers),
    weight: 22,
    effectiveWeight: 22,
    drivers,
  };
}

function efficiencyPillar(a: Analytics): Pillar {
  const ra = a.riskAdjusted;
  const drivers: ScoreDriver[] = [];

  const sharpeScore = scoreFromBands(ra.sharpeRatio, [
    { value: -0.5, score: 0 },
    { value: 0, score: 18 },
    { value: 0.3, score: 38 },
    { value: 0.6, score: 58 },
    { value: 1.0, score: 78 },
    { value: 1.5, score: 92 },
    { value: 2.5, score: 100 },
  ]);
  if (sharpeScore !== null) {
    drivers.push({
      label: "Sharpe ratio",
      value: num(ra.sharpeRatio),
      score: sharpeScore,
      weight: 30,
      commentary: `Earns ${num(ra.sharpeRatio)} units of excess return per unit of volatility${
        ra.adjustedSharpe !== null && Math.abs(ra.adjustedSharpe - (ra.sharpeRatio ?? 0)) > 0.05
          ? `, falling to ${num(ra.adjustedSharpe)} once skew and kurtosis are penalised`
          : ""
      }.`,
    });
  }

  const sortinoScore = scoreFromBands(ra.sortinoRatio, [
    { value: -0.5, score: 0 },
    { value: 0, score: 18 },
    { value: 0.5, score: 40 },
    { value: 1.0, score: 62 },
    { value: 1.6, score: 82 },
    { value: 2.5, score: 95 },
    { value: 4, score: 100 },
  ]);
  if (sortinoScore !== null) {
    drivers.push({
      label: "Sortino ratio",
      value: num(ra.sortinoRatio),
      score: sortinoScore,
      weight: 20,
      commentary: "Return per unit of downside deviation, ignoring upside volatility the investor does not mind.",
    });
  }

  const calmarScore = scoreFromBands(ra.calmarRatio, [
    { value: -0.2, score: 0 },
    { value: 0, score: 20 },
    { value: 0.3, score: 42 },
    { value: 0.6, score: 62 },
    { value: 1.0, score: 82 },
    { value: 2.0, score: 96 },
    { value: 3.0, score: 100 },
  ]);
  if (calmarScore !== null) {
    drivers.push({
      label: "Calmar ratio",
      value: num(ra.calmarRatio),
      score: calmarScore,
      weight: 20,
      commentary: "Annualized return per unit of maximum drawdown — the ratio that matters when redemption pressure follows losses.",
    });
  }

  const omegaScore = scoreFromBands(ra.omegaRatio, [
    { value: 0.5, score: 0 },
    { value: 1.0, score: 30 },
    { value: 1.3, score: 55 },
    { value: 1.8, score: 78 },
    { value: 2.5, score: 92 },
    { value: 4, score: 100 },
  ]);
  if (omegaScore !== null) {
    drivers.push({
      label: "Omega ratio",
      value: num(ra.omegaRatio),
      score: omegaScore,
      weight: 15,
      commentary: "Probability-weighted gains divided by losses relative to the minimum acceptable return; uses the whole distribution rather than its first two moments.",
    });
  }

  // Statistical credibility of the Sharpe, given track length and non-normality.
  const psrScore = scoreFromBands(ra.probabilisticSharpe, [
    { value: 0.5, score: 0 },
    { value: 0.75, score: 25 },
    { value: 0.9, score: 50 },
    { value: 0.95, score: 72 },
    { value: 0.99, score: 92 },
    { value: 0.999, score: 100 },
  ]);
  if (psrScore !== null) {
    drivers.push({
      label: "Probabilistic Sharpe ratio",
      value: pct(ra.probabilisticSharpe, 1),
      score: psrScore,
      weight: 15,
      commentary:
        (ra.probabilisticSharpe ?? 0) >= 0.95
          ? "The track record is long and clean enough to be confident the true Sharpe is above zero."
          : `Only ${pct(ra.probabilisticSharpe, 0)} confidence that the true Sharpe exceeds zero. ${
              ra.minimumTrackRecordYears !== null
                ? `A ${num(ra.minimumTrackRecordYears, 1)}-year track record would be needed for 95% confidence at this Sharpe and distribution shape.`
                : ""
            }`,
    });
  }

  return {
    id: "efficiency",
    name: "Risk-Adjusted Efficiency",
    description: "How much return the manager extracts per unit of risk, and how credible that is statistically.",
    score: combineDrivers(drivers),
    weight: 25,
    effectiveWeight: 25,
    drivers,
  };
}

function benchmarkPillar(a: Analytics): Pillar {
  const rel = a.relative;
  if (!rel) {
    return {
      id: "benchmark",
      name: "Benchmark Value-Add",
      description: "Alpha, capture asymmetry and consistency of outperformance.",
      score: 50,
      weight: 0,
      effectiveWeight: 0,
      drivers: [],
      unavailableReason:
        "No benchmark was supplied. Alpha, beta, capture and information ratio cannot be assessed, and this pillar has been removed from the composite.",
    };
  }

  const drivers: ScoreDriver[] = [];

  const alphaScore = scoreFromBands(rel.alpha, [
    { value: -0.06, score: 0 },
    { value: -0.02, score: 22 },
    { value: 0, score: 45 },
    { value: 0.02, score: 65 },
    { value: 0.05, score: 88 },
    { value: 0.1, score: 100 },
  ]);
  if (alphaScore !== null) {
    drivers.push({
      label: "Jensen's alpha (annualized)",
      value: pct(rel.alpha),
      score: alphaScore,
      weight: 25,
      commentary: `Return earned beyond what beta of ${num(rel.beta)} to ${a.meta.benchmarkName ?? "the benchmark"} would predict.`,
    });
  }

  // An alpha you cannot distinguish from zero is not an alpha.
  const tScore = scoreFromBands(rel.alphaTStat, [
    { value: -2, score: 0 },
    { value: 0, score: 30 },
    { value: 1, score: 50 },
    { value: 1.96, score: 75 },
    { value: 3, score: 92 },
    { value: 4.5, score: 100 },
  ]);
  if (tScore !== null) {
    drivers.push({
      label: "Alpha t-statistic",
      value: num(rel.alphaTStat),
      score: tScore,
      weight: 25,
      commentary: rel.alphaIsSignificant
        ? `Alpha is statistically significant (p = ${num(rel.alphaPValue, 3)}); the outperformance is unlikely to be luck.`
        : `Alpha is not statistically distinguishable from zero (p = ${num(rel.alphaPValue, 3)}). Treat the outperformance as unproven.`,
    });
  }

  const irScore = scoreFromBands(rel.informationRatio, [
    { value: -1, score: 0 },
    { value: -0.25, score: 25 },
    { value: 0, score: 42 },
    { value: 0.25, score: 60 },
    { value: 0.5, score: 78 },
    { value: 1.0, score: 95 },
    { value: 1.5, score: 100 },
  ]);
  if (irScore !== null) {
    drivers.push({
      label: "Information ratio",
      value: num(rel.informationRatio),
      score: irScore,
      weight: 20,
      commentary: `Active return of ${pct(rel.activePremium)} against ${pct(rel.trackingError)} of tracking error.`,
    });
  }

  if (rel.captureSpread !== null) {
    const captureScore = scoreFromBands(rel.captureSpread, [
      { value: -0.6, score: 0 },
      { value: -0.2, score: 25 },
      { value: 0, score: 50 },
      { value: 0.2, score: 72 },
      { value: 0.5, score: 92 },
      { value: 1.0, score: 100 },
    ]);
    if (captureScore !== null) {
      drivers.push({
        label: "Capture spread (up − down)",
        value: `${num(rel.upCapture)} / ${num(rel.downCapture)}`,
        score: captureScore,
        weight: 20,
        commentary:
          rel.captureSpread > 0
            ? `Captures ${pct(rel.upCapture, 0)} of up markets while taking only ${pct(rel.downCapture, 0)} of down markets — the convexity a committee pays active fees for.`
            : `Takes ${pct(rel.downCapture, 0)} of the downside while capturing only ${pct(rel.upCapture, 0)} of the upside. The asymmetry runs the wrong way.`,
      });
    }
  }

  const battingScore = scoreFromBands(rel.battingAverage, [
    { value: 0.3, score: 5 },
    { value: 0.42, score: 32 },
    { value: 0.5, score: 55 },
    { value: 0.58, score: 78 },
    { value: 0.7, score: 100 },
  ]);
  if (battingScore !== null) {
    drivers.push({
      label: "Batting average",
      value: pct(rel.battingAverage, 1),
      score: battingScore,
      weight: 10,
      commentary: `Beat the benchmark in ${pct(rel.battingAverage, 0)} of ${a.meta.periodLabel.toLowerCase()}s.`,
    });
  }

  return {
    id: "benchmark",
    name: "Benchmark Value-Add",
    description: "Alpha, capture asymmetry and consistency of outperformance.",
    score: combineDrivers(drivers),
    weight: 15,
    effectiveWeight: 15,
    drivers,
  };
}

function consistencyPillar(a: Analytics): Pillar {
  const drivers: ScoreDriver[] = [];
  const rollingReturns = a.rolling.points.map((p) => p.return).filter((r): r is number => r !== null);

  if (rollingReturns.length >= 3) {
    const positiveShare = rollingReturns.filter((r) => r > 0).length / rollingReturns.length;
    const rollScore = scoreFromBands(positiveShare, [
      { value: 0.3, score: 5 },
      { value: 0.5, score: 30 },
      { value: 0.7, score: 58 },
      { value: 0.85, score: 82 },
      { value: 1.0, score: 100 },
    ]);
    if (rollScore !== null) {
      drivers.push({
        label: `Positive ${a.rolling.windowLabel.toLowerCase()} windows`,
        value: pct(positiveShare, 1),
        score: rollScore,
        weight: 30,
        commentary: `${pct(positiveShare, 0)} of overlapping ${a.rolling.windowLabel.toLowerCase()} windows finished positive.`,
      });
    }

    const worstRolling = Math.min(...rollingReturns);
    const worstScore = scoreFromBands(worstRolling, [
      { value: -0.4, score: 0 },
      { value: -0.25, score: 20 },
      { value: -0.12, score: 45 },
      { value: -0.05, score: 68 },
      { value: 0, score: 85 },
      { value: 0.05, score: 100 },
    ]);
    if (worstScore !== null) {
      drivers.push({
        label: `Worst ${a.rolling.windowLabel.toLowerCase()} window`,
        value: pct(worstRolling),
        score: worstScore,
        weight: 25,
        commentary: "The loss an investor who bought at the worst moment would have carried for a full year.",
      });
    }
  }

  const gpScore = scoreFromBands(a.riskAdjusted.gainToPainRatio, [
    { value: -0.5, score: 0 },
    { value: 0, score: 28 },
    { value: 0.3, score: 50 },
    { value: 0.7, score: 72 },
    { value: 1.2, score: 90 },
    { value: 2.0, score: 100 },
  ]);
  if (gpScore !== null) {
    drivers.push({
      label: "Gain-to-pain ratio",
      value: num(a.riskAdjusted.gainToPainRatio),
      score: gpScore,
      weight: 25,
      commentary: "Net return earned for every unit of cumulative loss endured along the way.",
    });
  }

  // Dispersion of calendar-year results: a manager who alternates +40/-25 is
  // harder to hold than one who compounds steadily to the same place.
  const fullYears = a.performance.calendarYears.filter((y) => !y.partial);
  if (fullYears.length >= 3) {
    const yearReturns = fullYears.map((y) => y.fund);
    const yearMean = yearReturns.reduce((x, y) => x + y, 0) / yearReturns.length;
    const yearSd = Math.sqrt(
      yearReturns.reduce((acc, r) => acc + (r - yearMean) ** 2, 0) / (yearReturns.length - 1)
    );
    const negativeYears = yearReturns.filter((r) => r < 0).length;
    const dispersionScore = scoreFromBands(-yearSd, [
      { value: -0.4, score: 8 },
      { value: -0.25, score: 30 },
      { value: -0.15, score: 55 },
      { value: -0.08, score: 78 },
      { value: -0.04, score: 100 },
    ]);
    if (dispersionScore !== null) {
      drivers.push({
        label: "Calendar-year dispersion",
        value: `σ ${pct(yearSd)}, ${negativeYears} down year${negativeYears === 1 ? "" : "s"}`,
        score: dispersionScore,
        weight: 20,
        commentary: `Across ${fullYears.length} full calendar years the spread of outcomes was ${pct(yearSd)}, with ${negativeYears} negative year${negativeYears === 1 ? "" : "s"}.`,
      });
    }
  }

  return {
    id: "consistency",
    name: "Consistency & Persistence",
    description: "Whether the result repeats across windows and years, or rests on a few periods.",
    score: combineDrivers(drivers),
    weight: 13,
    effectiveWeight: 13,
    drivers,
  };
}

// ---------------------------------------------------------------------------
// Red flags
// ---------------------------------------------------------------------------

function buildRedFlags(a: Analytics): RedFlag[] {
  const flags: RedFlag[] = [];
  const rel = a.relative;

  if (a.meta.trackRecordYears < 3) {
    flags.push({
      severity: a.meta.trackRecordYears < 2 ? "critical" : "high",
      category: "Track record",
      title: `Only ${a.meta.trackRecordYears.toFixed(1)} years of history`,
      detail:
        "Below the three-year minimum most committees require. Every statistic in this pack carries wide confidence intervals, and the track record has almost certainly not spanned a full market cycle.",
      diligenceQuestion:
        "Can the manager provide a longer track record from a prior firm or a predecessor vehicle, and is that record verifiable and carve-out free?",
    });
  }

  const rho = a.smoothing.lag1Autocorrelation;
  if (rho !== null && rho > 0.3) {
    flags.push({
      severity: rho > 0.45 ? "critical" : "high",
      category: "Valuation integrity",
      title: `Return smoothing detected (lag-1 autocorrelation ${rho.toFixed(2)})`,
      detail: a.smoothing.unsmoothed
        ? `Serial correlation of this magnitude is the signature of appraisal-based or stale marks. Unsmoothing the series lifts volatility from ${pct(a.risk.annualizedVolatility)} to ${pct(a.smoothing.unsmoothed.volatility)} (+${pct(a.smoothing.unsmoothed.volatilityUplift, 0)}) and cuts the Sharpe from ${num(a.riskAdjusted.sharpeRatio)} to ${num(a.smoothing.unsmoothed.sharpe)}. The reported risk figures understate the economic risk.`
        : "Serial correlation of this magnitude is the signature of appraisal-based or stale marks; reported volatility understates economic risk.",
      diligenceQuestion:
        "Who values the illiquid positions, how often, and is there an independent third-party valuation agent? What share of NAV is level 3?",
    });
  } else if (rho !== null && rho > 0.2) {
    flags.push({
      severity: "medium",
      category: "Valuation integrity",
      title: `Moderate return smoothing (lag-1 autocorrelation ${rho.toFixed(2)})`,
      detail:
        "Some evidence of mark smoothing or stale pricing. Reported volatility and Sharpe are likely flattered, though not severely.",
      diligenceQuestion: "What proportion of the portfolio is marked to model rather than to market?",
    });
  }

  if (a.risk.skewness !== null && a.risk.skewness < -1 && (a.risk.excessKurtosis ?? 0) > 3) {
    flags.push({
      severity: "high",
      category: "Tail risk",
      title: "Negatively skewed with fat tails",
      detail: `Skew of ${num(a.risk.skewness)} with excess kurtosis of ${num(a.risk.excessKurtosis)}. This is the return signature of a short-optionality strategy: many small gains punctuated by rare large losses. Volatility and Gaussian VaR materially understate the true exposure — Cornish-Fisher 95% VaR is ${pct(a.risk.var95.modifiedVar)} against a Gaussian estimate of ${pct(a.risk.var95.parametricVar)}.`,
      diligenceQuestion:
        "Is the strategy structurally short volatility, credit or liquidity? What is the worst-case loss under a 2008 or March-2020 repeat, and what hedges are in place?",
    });
  }

  if (a.risk.drawdown.maxDrawdown < -0.3) {
    flags.push({
      severity: a.risk.drawdown.maxDrawdown < -0.45 ? "high" : "medium",
      category: "Drawdown",
      title: `Maximum drawdown of ${pct(a.risk.drawdown.maxDrawdown)}`,
      detail: `A loss of this size tests investor patience and often triggers redemptions at the worst moment. ${
        a.risk.drawdown.episodes[0]?.recovered
          ? `Recovery took ${a.risk.drawdown.episodes[0].recoveryPeriods} ${a.meta.periodLabel.toLowerCase()}s.`
          : "The fund has not recovered its prior high-water mark."
      }`,
      diligenceQuestion:
        "What changed in risk management after the drawdown, and did the investor base remain stable through it?",
    });
  }

  if (a.risk.drawdown.currentDrawdown < -0.1) {
    flags.push({
      severity: a.risk.drawdown.currentDrawdown < -0.25 ? "high" : "medium",
      category: "Drawdown",
      title: `Currently ${pct(a.risk.drawdown.currentDrawdown)} below high-water mark`,
      detail: `The fund has been under water for ${a.risk.drawdown.currentUnderwaterPeriods} ${a.meta.periodLabel.toLowerCase()}s. On a high-water-mark fee structure this affects both manager economics and key-person retention.`,
      diligenceQuestion:
        "How far below the high-water mark is the incentive fee, and what is the risk of team departures before it is re-earned?",
    });
  }

  const psr = a.riskAdjusted.probabilisticSharpe;
  if (psr !== null && psr < 0.95) {
    flags.push({
      severity: psr < 0.8 ? "high" : "medium",
      category: "Statistical significance",
      title: "Sharpe ratio is not statistically established",
      detail: `Probabilistic Sharpe of ${pct(psr, 1)} means there is a ${pct(1 - psr, 1)} chance the true Sharpe is at or below zero, after adjusting for track length, skew and kurtosis.${
        a.riskAdjusted.minimumTrackRecordYears !== null
          ? ` A track record of ${num(a.riskAdjusted.minimumTrackRecordYears, 1)} years would be required for 95% confidence.`
          : ""
      }`,
      diligenceQuestion:
        "What evidence beyond the return stream — process, capacity, attribution — supports the view that this Sharpe is repeatable?",
    });
  }

  if (a.smoothing.hasSerialDependence === true && (rho === null || rho <= 0.3)) {
    flags.push({
      severity: "medium",
      category: "Valuation integrity",
      title: "Returns fail the Ljung-Box independence test",
      detail: `Ljung-Box p-value of ${num(a.smoothing.ljungBoxPValue, 3)} rejects the hypothesis that returns are serially independent. Statistics that assume independent observations — including the annualization of volatility — are biased.`,
      diligenceQuestion: "What drives the period-to-period dependence in reported returns?",
    });
  }

  if (rel) {
    if (rel.downCapture !== null && rel.upCapture !== null && rel.downCapture > rel.upCapture) {
      flags.push({
        severity: "high",
        category: "Benchmark",
        title: "Downside capture exceeds upside capture",
        detail: `Takes ${pct(rel.downCapture, 0)} of benchmark losses while capturing only ${pct(rel.upCapture, 0)} of benchmark gains. Over a full cycle this asymmetry destroys value relative to simply holding the benchmark.`,
        diligenceQuestion:
          "Is the manager structurally long beta in rallies and slow to de-risk in selloffs? What is the de-grossing discipline?",
      });
    }
    if (rel.alphaIsSignificant === false && (rel.alpha ?? 0) > 0) {
      flags.push({
        severity: "medium",
        category: "Benchmark",
        title: "Alpha is positive but not statistically significant",
        detail: `Alpha of ${pct(rel.alpha)} carries a t-statistic of ${num(rel.alphaTStat)} (p = ${num(rel.alphaPValue, 3)}). The outperformance cannot be distinguished from chance at conventional confidence levels.`,
        diligenceQuestion: "What is the repeatable source of this alpha, and can the manager show attribution supporting it?",
      });
    }
    if (rel.rSquared !== null && rel.rSquared > 0.9 && (rel.alpha ?? 0) < 0.02) {
      flags.push({
        severity: "medium",
        category: "Benchmark",
        title: "Return stream is largely explained by benchmark beta",
        detail: `R² of ${num(rel.rSquared)} against ${a.meta.benchmarkName ?? "the benchmark"} with alpha of only ${pct(rel.alpha)}. Most of the return is index exposure that can be replicated cheaply.`,
        diligenceQuestion: "What justifies an active fee when the exposure is available passively?",
      });
    }
  } else {
    flags.push({
      severity: "medium",
      category: "Data",
      title: "No benchmark supplied",
      detail:
        "Without a benchmark the pack cannot separate skill from market exposure. Alpha, beta, capture and information ratio are all unavailable, and the composite score has been reweighted accordingly.",
      diligenceQuestion: "What is the appropriate benchmark or peer universe for this strategy?",
    });
  }

  // Surface any failing data-integrity check that has not already been raised.
  for (const check of a.dataQuality) {
    if (check.status !== "fail") continue;
    if (["smoothing", "serialDependence", "trackLength", "benchmarkCoverage"].includes(check.id)) continue;
    flags.push({
      severity: "medium",
      category: "Data integrity",
      title: check.label,
      detail: `${check.detail} (observed: ${check.value})`,
      diligenceQuestion: "Can the administrator provide an independently verified return series for the full period?",
    });
  }

  const order: Record<FlagSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return flags.sort((x, y) => order[x.severity] - order[y.severity]);
}

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

export function assessForCommittee(a: Analytics): ICAssessment {
  const pillars = [
    returnGenerationPillar(a),
    riskControlPillar(a),
    efficiencyPillar(a),
    benchmarkPillar(a),
    consistencyPillar(a),
  ];

  // Drop zero-weight pillars from the composite and renormalise the rest.
  const active = pillars.filter((p) => p.weight > 0);
  const totalWeight = active.reduce((acc, p) => acc + p.weight, 0);
  const rawScore = totalWeight > 0 ? active.reduce((acc, p) => acc + p.score * p.weight, 0) / totalWeight : 50;

  // Renormalise so the displayed weights of the pillars actually used sum to 100%.
  for (const p of pillars) {
    p.effectiveWeight = p.weight > 0 && totalWeight > 0 ? (p.weight / totalWeight) * 100 : 0;
  }

  const redFlags = buildRedFlags(a);

  // Data integrity is a deduction, not an averaged pillar: smoothed or short
  // data undermines every other number rather than trading off against it.
  let integrityPenalty = 0;
  for (const flag of redFlags) {
    if (flag.category === "Valuation integrity" || flag.category === "Data integrity" || flag.category === "Track record") {
      integrityPenalty += flag.severity === "critical" ? 15 : flag.severity === "high" ? 9 : 4;
    }
  }
  if (a.dataQuality.some((c) => c.id === "continuity" && c.status === "fail")) integrityPenalty += 4;
  integrityPenalty = Math.min(integrityPenalty, 35);

  const compositeScore = Math.max(0, Math.min(100, rawScore - integrityPenalty));

  const criticalCount = redFlags.filter((f) => f.severity === "critical").length;
  const highCount = redFlags.filter((f) => f.severity === "high").length;

  let verdict: Verdict;
  if (criticalCount > 0) {
    verdict = compositeScore >= 55 ? "Further Diligence Required" : "Do Not Recommend";
  } else if (compositeScore >= 78 && highCount === 0) {
    verdict = "Strong Recommend";
  } else if (compositeScore >= 66 && highCount <= 1) {
    verdict = "Recommend";
  } else if (compositeScore >= 55) {
    verdict = "Recommend with Conditions";
  } else if (compositeScore >= 42) {
    verdict = "Further Diligence Required";
  } else {
    verdict = "Do Not Recommend";
  }

  const verdictRationale = buildVerdictRationale(a, verdict, compositeScore, rawScore, integrityPenalty, criticalCount, highCount);

  // Confidence is about how much weight the numbers can bear, independent of
  // whether they look good.
  let confidence: ICAssessment["confidence"] = "High";
  let confidenceReason = `${a.meta.trackRecordYears.toFixed(1)} years of ${a.meta.frequencyLabel.toLowerCase()} data with no material integrity concerns.`;
  if (a.meta.trackRecordYears < 3 || criticalCount > 0) {
    confidence = "Low";
    confidenceReason =
      a.meta.trackRecordYears < 3
        ? `Only ${a.meta.trackRecordYears.toFixed(1)} years of data; confidence intervals around every statistic are wide.`
        : "Critical data-integrity findings mean the reported statistics cannot be taken at face value.";
  } else if (a.meta.trackRecordYears < 5 || integrityPenalty >= 8 || !a.meta.hasBenchmark) {
    confidence = "Moderate";
    confidenceReason = !a.meta.hasBenchmark
      ? "No benchmark supplied, so market exposure cannot be separated from skill."
      : integrityPenalty >= 8
        ? "Data-integrity findings reduce the reliability of the reported risk statistics."
        : `${a.meta.trackRecordYears.toFixed(1)} years of data covers a limited range of market conditions.`;
  }

  const strengths = buildStrengths(a, pillars);
  const concerns = buildConcerns(a, pillars, redFlags);
  const diligenceAgenda = buildDiligenceAgenda(a, redFlags);

  const assessment: Omit<ICAssessment, "memo"> = {
    verdict,
    verdictRationale,
    compositeScore,
    rawScore,
    integrityPenalty,
    confidence,
    confidenceReason,
    pillars,
    redFlags,
    strengths,
    concerns,
    diligenceAgenda,
  };

  return { ...assessment, memo: buildMemo(a, assessment) };
}

function buildVerdictRationale(
  a: Analytics,
  verdict: Verdict,
  composite: number,
  raw: number,
  penalty: number,
  criticalCount: number,
  highCount: number
): string {
  const parts: string[] = [];
  parts.push(
    `Composite score of ${composite.toFixed(0)}/100${
      penalty > 0 ? ` (${raw.toFixed(0)} on analytics, less a ${penalty.toFixed(0)}-point data-integrity deduction)` : ""
    }.`
  );

  if (criticalCount > 0) {
    parts.push(
      `${criticalCount} critical finding${criticalCount === 1 ? "" : "s"} must be resolved before capital is committed, regardless of the quantitative result.`
    );
  } else if (highCount > 0) {
    parts.push(`${highCount} high-severity finding${highCount === 1 ? "" : "s"} require${highCount === 1 ? "s" : ""} an answer from the manager.`);
  }

  switch (verdict) {
    case "Strong Recommend":
      parts.push("The return stream is efficient, consistent and statistically credible across the full track record.");
      break;
    case "Recommend":
      parts.push("The quantitative case supports an allocation, subject to the standard operational and legal workstreams.");
      break;
    case "Recommend with Conditions":
      parts.push("The strategy earns its place only if the conditions below are met; a reduced initial ticket with a review date is the sensible structure.");
      break;
    case "Further Diligence Required":
      parts.push("The data supports neither approval nor rejection. The open questions below determine the outcome.");
      break;
    case "Do Not Recommend":
      parts.push("The return stream does not support an allocation on the evidence presented.");
      break;
  }

  return parts.join(" ");
}

function buildStrengths(a: Analytics, pillars: Pillar[]): string[] {
  const out: string[] = [];
  const rel = a.relative;
  const ra = a.riskAdjusted;

  if ((ra.sharpeRatio ?? 0) >= 1) {
    out.push(`Sharpe ratio of ${num(ra.sharpeRatio)} over ${a.meta.trackRecordYears.toFixed(1)} years — efficient conversion of risk into return.`);
  }
  if ((ra.sortinoRatio ?? 0) >= 1.5) {
    out.push(`Sortino ratio of ${num(ra.sortinoRatio)}: the volatility the fund does take is predominantly upside.`);
  }
  if (a.risk.drawdown.maxDrawdown > -0.1) {
    out.push(`Maximum drawdown contained to ${pct(a.risk.drawdown.maxDrawdown)}, well inside typical tolerance.`);
  }
  if ((ra.calmarRatio ?? 0) >= 1) {
    out.push(`Calmar ratio of ${num(ra.calmarRatio)} — annual return exceeds the worst drawdown ever suffered.`);
  }
  if (rel?.alphaIsSignificant && (rel.alpha ?? 0) > 0) {
    out.push(`Statistically significant alpha of ${pct(rel.alpha)} per year (t = ${num(rel.alphaTStat)}) against ${a.meta.benchmarkName ?? "the benchmark"}.`);
  }
  if (rel && (rel.captureSpread ?? 0) > 0.15) {
    out.push(`Convex capture profile: ${pct(rel.upCapture, 0)} of upside against ${pct(rel.downCapture, 0)} of downside.`);
  }
  if ((rel?.correlation ?? 1) < 0.5) {
    out.push(`Correlation of only ${num(rel!.correlation)} to ${a.meta.benchmarkName ?? "the benchmark"}, offering genuine portfolio diversification.`);
  }
  if (a.performance.hitRate >= 0.6) {
    out.push(`Positive in ${pct(a.performance.hitRate, 0)} of ${a.meta.periodLabel.toLowerCase()}s.`);
  }
  if ((ra.probabilisticSharpe ?? 0) >= 0.99) {
    out.push(`Probabilistic Sharpe of ${pct(ra.probabilisticSharpe, 1)}: the track record is long and clean enough for the result to be statistically established.`);
  }
  if ((a.risk.skewness ?? -1) > 0.2) {
    out.push(`Positive skew of ${num(a.risk.skewness)} — the outliers are gains rather than losses.`);
  }

  const best = [...pillars].filter((p) => p.weight > 0).sort((x, y) => y.score - x.score)[0];
  if (out.length === 0 && best) {
    out.push(`Strongest dimension is ${best.name} at ${best.score.toFixed(0)}/100, though no individual metric stands out.`);
  }
  return out;
}

function buildConcerns(a: Analytics, pillars: Pillar[], flags: RedFlag[]): string[] {
  const out: string[] = [];
  for (const f of flags.filter((x) => x.severity === "critical" || x.severity === "high")) {
    out.push(`${f.title}. ${f.detail}`);
  }

  const weakest = [...pillars].filter((p) => p.weight > 0).sort((x, y) => x.score - y.score)[0];
  if (weakest && weakest.score < 50) {
    const worstDriver = [...weakest.drivers].sort((x, y) => x.score - y.score)[0];
    out.push(
      `${weakest.name} scores ${weakest.score.toFixed(0)}/100, the weakest dimension${
        worstDriver ? `, driven by ${worstDriver.label.toLowerCase()} of ${worstDriver.value}` : ""
      }.`
    );
  }

  if (out.length === 0) out.push("No high-severity concerns were identified in the return stream.");
  return out;
}

function buildDiligenceAgenda(a: Analytics, flags: RedFlag[]): string[] {
  const agenda = flags.slice(0, 8).map((f) => f.diligenceQuestion);

  // Questions the return stream can never answer, but the committee still needs.
  agenda.push(
    "Confirm the return series is net of all fees and expenses at the share class being offered, and that it is administrator-verified rather than manager-reported."
  );
  agenda.push(
    "Establish whether the track record represents an actual fund, a carve-out, or a backtest, and whether it is continuous or spliced across vehicles."
  );
  agenda.push(
    `Match liquidity terms to the observed drawdown profile: a ${pct(a.risk.drawdown.maxDrawdown)} drawdown lasting ${
      a.risk.drawdown.longestUnderwaterPeriods
    } ${a.meta.periodLabel.toLowerCase()}s must be survivable within the gate, notice and lock-up terms.`
  );
  agenda.push("Review capacity, current AUM and the flows the strategy has absorbed since inception.");

  return Array.from(new Set(agenda));
}

// ---------------------------------------------------------------------------
// Memo
// ---------------------------------------------------------------------------

function buildMemo(a: Analytics, s: Omit<ICAssessment, "memo">): string {
  const rel = a.relative;
  const ra = a.riskAdjusted;
  const L = a.meta.periodLabel.toLowerCase();
  const lines: string[] = [];

  const asOf = new Date(a.meta.generatedAt).toISOString().split("T")[0];

  lines.push(`# Investment Committee Memorandum`);
  lines.push("");
  lines.push(`**Subject:** ${a.meta.fundName}`);
  lines.push(`**Prepared:** ${asOf}`);
  lines.push(`**Basis:** Quantitative review of the manager-supplied return stream`);
  lines.push(`**Period analysed:** ${a.meta.startDate} to ${a.meta.endDate} (${a.meta.periods} ${a.meta.frequencyLabel.toLowerCase()} observations, ${a.meta.trackRecordYears.toFixed(1)} years)`);
  if (a.meta.benchmarkName) lines.push(`**Benchmark:** ${a.meta.benchmarkName}`);
  lines.push(`**Risk-free rate applied:** ${pct(a.meta.riskFreeRate)}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  lines.push(`## 1. Recommendation`);
  lines.push("");
  lines.push(`**${s.verdict.toUpperCase()}** — composite score ${s.compositeScore.toFixed(0)}/100, confidence: ${s.confidence.toLowerCase()}.`);
  lines.push("");
  lines.push(s.verdictRationale);
  lines.push("");
  lines.push(`*Confidence rationale:* ${s.confidenceReason}`);
  lines.push("");

  lines.push(`## 2. Performance Summary`);
  lines.push("");
  // Only render a benchmark column when there is a benchmark to put in it.
  const row = (label: string, fund: string, bench?: string) =>
    rel ? `| ${label} | ${fund} | ${bench ?? "—"} |` : `| ${label} | ${fund} |`;
  lines.push(rel ? `| Metric | ${a.meta.fundName} | ${a.meta.benchmarkName ?? "Benchmark"} |` : `| Metric | ${a.meta.fundName} |`);
  lines.push(rel ? `| --- | ---: | ---: |` : `| --- | ---: |`);
  lines.push(row("Cumulative return", pct(a.performance.cumulativeReturn), rel ? pct(rel.benchmarkCumulativeReturn) : undefined));
  lines.push(row("Annualized return", pct(a.performance.annualizedReturn), rel ? pct(rel.benchmarkAnnualizedReturn) : undefined));
  lines.push(row("Annualized volatility", pct(a.risk.annualizedVolatility), rel ? pct(rel.benchmarkVolatility) : undefined));
  lines.push(row("Sharpe ratio", num(ra.sharpeRatio)));
  lines.push(row("Sortino ratio", num(ra.sortinoRatio)));
  lines.push(row("Maximum drawdown", pct(a.risk.drawdown.maxDrawdown)));
  lines.push(row("Calmar ratio", num(ra.calmarRatio)));
  lines.push(row(`Best ${L}`, pct(a.performance.bestPeriod)));
  lines.push(row(`Worst ${L}`, pct(a.performance.worstPeriod)));
  lines.push(row(`Positive ${L}s`, pct(a.performance.hitRate, 1)));
  if (rel) {
    lines.push(row("Beta", num(rel.beta), "1.00"));
    lines.push(row("Alpha (annualized)", pct(rel.alpha)));
    lines.push(row("Information ratio", num(rel.informationRatio)));
    lines.push(row("Up / down capture", `${num(rel.upCapture)} / ${num(rel.downCapture)}`));
    lines.push(row("Correlation", num(rel.correlation), "1.00"));
  }
  lines.push("");

  lines.push(`## 3. Scorecard`);
  lines.push("");
  lines.push(`| Pillar | Weight | Score |`);
  lines.push(`| --- | ---: | ---: |`);
  for (const p of s.pillars) {
    if (p.weight === 0) {
      lines.push(`| ${p.name} | excluded | n/a |`);
      continue;
    }
    lines.push(`| ${p.name} | ${p.effectiveWeight.toFixed(0)}% | ${p.score.toFixed(0)} (${band(p.score)}) |`);
  }
  lines.push(`| **Analytics subtotal** | **100%** | **${s.rawScore.toFixed(0)}** |`);
  if (s.integrityPenalty > 0) {
    lines.push(`| Data-integrity deduction | — | −${s.integrityPenalty.toFixed(0)} |`);
  }
  lines.push(`| **Composite** | | **${s.compositeScore.toFixed(0)}/100** |`);
  lines.push("");

  lines.push(`## 4. Strengths`);
  lines.push("");
  for (const st of s.strengths) lines.push(`- ${st}`);
  lines.push("");

  lines.push(`## 5. Concerns and Red Flags`);
  lines.push("");
  if (s.redFlags.length === 0) {
    lines.push("No red flags were raised by the quantitative screen.");
  } else {
    for (const f of s.redFlags) {
      lines.push(`**[${f.severity.toUpperCase()}] ${f.title}** *(${f.category})*`);
      lines.push("");
      lines.push(f.detail);
      lines.push("");
    }
  }

  lines.push(`## 6. Risk Profile`);
  lines.push("");
  lines.push(
    `Volatility of ${pct(a.risk.annualizedVolatility)} understates the picture on its own. The distribution has skew of ${num(a.risk.skewness)} and excess kurtosis of ${num(a.risk.excessKurtosis)}, and the Jarque-Bera test ${
      a.risk.isNormal === true ? "does not reject" : a.risk.isNormal === false ? "rejects" : "could not evaluate"
    } normality${a.risk.jarqueBeraPValue !== null ? ` (p = ${num(a.risk.jarqueBeraPValue, 3)})` : ""}. ` +
      `At 95% confidence the ${L} loss threshold is ${pct(a.risk.var95.historicalVar)} historically and ${pct(a.risk.var95.modifiedVar)} on a Cornish-Fisher basis that accounts for the tail shape; conditional loss beyond that point averages ${pct(a.risk.var95.historicalCvar)}.`
  );
  lines.push("");
  lines.push(
    `The worst drawdown was ${pct(a.risk.drawdown.maxDrawdown)}${a.risk.drawdown.maxDrawdownDate ? ` (trough ${a.risk.drawdown.maxDrawdownDate})` : ""}. ` +
      `The fund spent ${pct(a.risk.drawdown.percentTimeUnderwater, 0)} of its life below a prior high, with the longest continuous stretch running ${a.risk.drawdown.longestUnderwaterPeriods} ${L}s. ` +
      `Ulcer index is ${pct(a.risk.drawdown.ulcerIndex)} and conditional drawdown at 95% is ${pct(a.risk.drawdown.conditionalDrawdown95)}.` +
      (a.risk.drawdown.currentDrawdown < -0.001
        ? ` The fund is currently ${pct(a.risk.drawdown.currentDrawdown)} below its high-water mark.`
        : " The fund is currently at or near its high-water mark.")
  );
  lines.push("");

  const worst12 = a.risk.worstWindows.find((w) => w.label === "Worst 12 Months");
  if (worst12?.worstReturn !== null && worst12 !== undefined) {
    lines.push(
      `Worst rolling twelve months: ${pct(worst12.worstReturn)} (${worst12.startDate} to ${worst12.endDate})${
        worst12.benchmarkReturn !== null ? `, against ${pct(worst12.benchmarkReturn)} for the benchmark over the same window` : ""
      }.`
    );
    lines.push("");
  }

  lines.push(`## 7. Data Integrity`);
  lines.push("");
  lines.push(`| Check | Result | Status |`);
  lines.push(`| --- | --- | --- |`);
  for (const c of a.dataQuality) {
    lines.push(`| ${c.label} | ${c.value} | ${c.status.toUpperCase()} |`);
  }
  lines.push("");
  if (a.smoothing.unsmoothed) {
    lines.push(
      `**Unsmoothing adjustment.** Lag-1 autocorrelation of ${num(a.smoothing.lag1Autocorrelation, 3)} indicates the reported series is smoothed. Applying a first-order Geltner correction raises annualized volatility from ${pct(a.risk.annualizedVolatility)} to ${pct(a.smoothing.unsmoothed.volatility)}, deepens maximum drawdown to ${pct(a.smoothing.unsmoothed.maxDrawdown)}, and reduces the Sharpe ratio from ${num(ra.sharpeRatio)} to ${num(a.smoothing.unsmoothed.sharpe)}. The committee should underwrite the unsmoothed figures.`
    );
    lines.push("");
  }

  lines.push(`## 8. Forward-Looking Simulation`);
  lines.push("");
  lines.push(
    `A stationary block bootstrap of the realised return distribution (${a.simulation.paths.toLocaleString()} paths, ${a.simulation.horizonYears}-year horizon, mean block length ${a.simulation.meanBlockLength} ${L}s to preserve serial dependence) produces the following annualized outcomes:`
  );
  lines.push("");
  lines.push(`| Percentile | Annualized return over ${a.simulation.horizonYears} years |`);
  lines.push(`| --- | ---: |`);
  lines.push(`| 5th (poor) | ${pct(a.simulation.terminalAnnualized.p5)} |`);
  lines.push(`| 25th | ${pct(a.simulation.terminalAnnualized.p25)} |`);
  lines.push(`| Median | ${pct(a.simulation.terminalAnnualized.p50)} |`);
  lines.push(`| 75th | ${pct(a.simulation.terminalAnnualized.p75)} |`);
  lines.push(`| 95th (strong) | ${pct(a.simulation.terminalAnnualized.p95)} |`);
  lines.push("");
  lines.push(
    `Probability of a loss over the full horizon: ${pct(a.simulation.probabilityOfLossOverHorizon, 1)}. Median simulated maximum drawdown along the way: ${pct(a.simulation.expectedMaxDrawdown.p50)}, with a 5% chance of exceeding ${pct(a.simulation.expectedMaxDrawdown.p95)}.`
  );
  lines.push("");
  lines.push(
    `*This simulation resamples history. It assumes the future distribution resembles the past, which is exactly the assumption a committee should interrogate rather than accept.*`
  );
  lines.push("");

  lines.push(`## 9. Diligence Agenda`);
  lines.push("");
  s.diligenceAgenda.forEach((q, i) => lines.push(`${i + 1}. ${q}`));
  lines.push("");

  lines.push(`## 10. Basis and Limitations`);
  lines.push("");
  lines.push(
    `This memorandum is derived solely from the ${a.meta.periods}-observation return stream supplied. It contains no assessment of the manager's people, process, operations, counterparties, service providers, legal terms, fee structure, capacity or liquidity, all of which require separate diligence. Returns are assumed to be net of fees as supplied; if they are gross, every return and ratio above is overstated.`
  );
  lines.push("");
  lines.push(
    `Statistics are annualized from ${a.meta.frequencyLabel.toLowerCase()} data using ${a.meta.periodsPerYear} periods per year. Past performance does not predict future results, and a track record of ${a.meta.trackRecordYears.toFixed(1)} years is a limited sample from which to infer skill.`
  );

  return lines.join("\n");
}
