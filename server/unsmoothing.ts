/**
 * Return-smoothing diagnostics and correction.
 *
 * Illiquid holdings — private credit, real assets, fund-of-funds NAVs — are
 * marked from appraisals or stale prices rather than traded quotes. The
 * reported series is then a moving average of the true underlying returns,
 * which damps period-to-period variation. Measured volatility comes out too
 * low and Sharpe too high, and every downstream risk figure inherits the
 * error.
 *
 * Getmansky, Lo and Makarov (2004) model the reported return as
 *
 *     r_t^observed = θ₀·r_t + θ₁·r_{t-1} + … + θ_k·r_{t-k},   Σθ = 1, θ ≥ 0
 *
 * The tell is positive serial correlation: genuinely traded monthly returns
 * show little, while appraisal-based series routinely run ρ₁ of 0.3 or more.
 *
 * The correction here is the first-order (Geltner) reversal, which assumes an
 * MA(1). It is the standard practical choice: closed-form, no optimiser, and
 * it needs only ρ₁. A full MA(k) fit would estimate more θ's by maximum
 * likelihood; that is a bigger piece of machinery and is not implemented.
 */

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function sampleStdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(
    xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1),
  );
}

/** Natural log of the gamma function (Lanczos approximation, g = 7, n = 9). */
function lnGamma(z: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    // Reflection: Γ(z)Γ(1-z) = π / sin(πz)
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  }
  const zz = z - 1;
  let x = c[0];
  for (let i = 1; i < 9; i++) x += c[i] / (zz + i);
  const t = zz + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * Regularized lower incomplete gamma P(a, x), by series below the crossover
 * and by continued fraction above it — the standard split, since each form
 * converges quickly on only one side.
 */
function regularizedGammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (a <= 0) return 1;

  if (x < a + 1) {
    let term = 1 / a;
    let sum = term;
    for (let n = 1; n < 1000; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }

  // Continued fraction for Q(a, x) = 1 - P(a, x), modified Lentz.
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  const q = Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
  return 1 - q;
}

/** Upper-tail probability of a chi-square variate: P(X > x) with df degrees of freedom. */
export function chiSquareUpperTail(x: number, df: number): number {
  if (x <= 0) return 1;
  if (df <= 0) return 0;
  return 1 - regularizedGammaP(df / 2, x / 2);
}

/**
 * Above this, the 1/(1 − ρ) amplification is large enough that the correction
 * is dominated by estimation error in ρ itself. An MA(1) cannot produce ρ₁
 * above 0.5 in any case.
 */
export const MAX_STABLE_RHO = 0.5;

/**
 * Sample autocorrelation at `lag`.
 *
 * Uses the full-sample variance in the denominator (the standard "biased"
 * estimator). It shrinks estimates at long lags toward zero, which is the
 * behaviour wanted here: it keeps the autocorrelation function positive
 * semi-definite and avoids wild values at high lags on short return histories.
 */
export function autocorrelation(returns: number[], lag: number): number {
  const T = returns.length;
  if (lag < 1 || T <= lag + 1) return 0;

  const m = mean(returns);
  let denominator = 0;
  for (let t = 0; t < T; t++) denominator += (returns[t] - m) ** 2;

  // A flat series leaves a denominator that is tiny but not exactly zero, and
  // dividing one such residue by another yields a spurious correlation near 1.
  // This is not hypothetical: a fund quoting the same coupon every month
  // reports exactly this series, and it must read as "no autocorrelation"
  // rather than "heavily smoothed". Returns are of order 1e-2, so a standard
  // deviation below 1e-12 is arithmetic noise, not signal.
  if (Math.sqrt(denominator / T) < 1e-12) return 0;

  let numerator = 0;
  for (let t = lag; t < T; t++) {
    numerator += (returns[t] - m) * (returns[t - lag] - m);
  }
  return numerator / denominator;
}

/** Autocorrelations at lags 1..maxLag. */
export function autocorrelations(returns: number[], maxLag: number): number[] {
  return Array.from({ length: Math.max(0, maxLag) }, (_, i) =>
    autocorrelation(returns, i + 1),
  );
}

export interface LjungBoxResult {
  statistic: number;
  degreesOfFreedom: number;
  pValue: number;
  /** True when the joint null of no autocorrelation is rejected at 5%. */
  significant: boolean;
}

/**
 * Ljung-Box portmanteau test for serial correlation up to `lags`.
 *
 *     Q = T(T+2) · Σ ρ_k² / (T − k),   Q ~ χ²(lags) under the null
 *
 * A small p-value here is the statistical case that a series is smoothed
 * rather than merely appearing so.
 */
export function ljungBox(returns: number[], lags = 6): LjungBoxResult {
  const T = returns.length;
  const usableLags = Math.min(lags, T - 2);

  if (T < 4 || usableLags < 1) {
    return { statistic: 0, degreesOfFreedom: 0, pValue: 1, significant: false };
  }

  let q = 0;
  for (let k = 1; k <= usableLags; k++) {
    const rho = autocorrelation(returns, k);
    q += (rho * rho) / (T - k);
  }
  const statistic = T * (T + 2) * q;
  const pValue = chiSquareUpperTail(statistic, usableLags);

  return {
    statistic,
    degreesOfFreedom: usableLags,
    pValue,
    significant: pValue < 0.05,
  };
}

/**
 * Reverses first-order smoothing:  r_t = (r_t^obs − ρ·r_{t-1}^obs) / (1 − ρ)
 *
 * Returns one fewer observation than it was given — the first period has no
 * predecessor to unwind against.
 *
 * When ρ is not in (0, 1) the series is returned unchanged (minus that first
 * period, so callers get a consistent length either way). Negative ρ means
 * mean reversion rather than smoothing, and unwinding it would *inflate*
 * volatility on a series that was never smoothed. ρ at or above the stability
 * bound would divide by something at or below zero.
 */
export function geltnerUnsmooth(returns: number[], rho?: number): number[] {
  if (returns.length < 3) return [];

  const r = rho ?? autocorrelation(returns, 1);
  if (!(r > 0) || r >= MAX_STABLE_RHO) return returns.slice(1);

  const out: number[] = [];
  for (let t = 1; t < returns.length; t++) {
    out.push((returns[t] - r * returns[t - 1]) / (1 - r));
  }
  return out;
}

/**
 * Getmansky-Lo-Makarov smoothing index ξ = Σθ_j², recovered from ρ₁ under an
 * MA(1).
 *
 * With θ₀ = 1 − θ and θ₁ = θ, ρ₁ = θ(1−θ) / ((1−θ)² + θ²), which rearranges to
 *
 *     (1 + 2ρ₁)θ² − (1 + 2ρ₁)θ + ρ₁ = 0
 *
 * Taking the root with θ ≤ ½ (most weight on the current period) gives
 * ξ = (1−θ)² + θ². ξ = 1 means no smoothing; ξ = ½ is the maximum an MA(1)
 * admits, at θ₀ = θ₁ = ½. Lower ξ means more smoothing.
 */
export function smoothingIndex(rho1: number): number | null {
  if (!(rho1 > 0)) return 1;
  if (rho1 > MAX_STABLE_RHO) return null;

  const a = 1 + 2 * rho1;
  const discriminant = a * (1 - 2 * rho1);
  if (discriminant < 0) return null;

  const theta = (a - Math.sqrt(discriminant)) / (2 * a);
  return (1 - theta) ** 2 + theta ** 2;
}

export interface SmoothingAnalysis {
  /** First-order autocorrelation of the reported series. */
  rho1: number;
  /** Autocorrelations at lags 1..6, for inspection. */
  autocorrelations: number[];
  ljungBox: LjungBoxResult;
  /** Getmansky-Lo-Makarov ξ; null when ρ₁ exceeds what an MA(1) can produce. */
  smoothingIndex: number | null;
  /** Whether the correction was actually applied. */
  unsmoothingApplied: boolean;
  /** Why not, when it wasn't. */
  reason: string | null;

  observedVolatility: number;
  unsmoothedVolatility: number;
  /** How much annualized volatility the smoothing was hiding, as a multiple. */
  volatilityRatio: number;

  observedSharpe: number | null;
  unsmoothedSharpe: number | null;

  unsmoothedReturns: number[];
}

/**
 * Full smoothing report for a return series.
 *
 * Annualized figures use `periodsPerYear`, so callers must pass the cadence
 * their data actually has — monthly fund data annualized at 252 is exactly the
 * error this module exists to surface.
 */
export function analyzeSmoothing(
  returns: number[],
  periodsPerYear: number,
  riskFreeRate = 0,
): SmoothingAnalysis {
  const empty: SmoothingAnalysis = {
    rho1: 0,
    autocorrelations: [],
    ljungBox: { statistic: 0, degreesOfFreedom: 0, pValue: 1, significant: false },
    smoothingIndex: 1,
    unsmoothingApplied: false,
    reason: "Not enough observations to estimate autocorrelation",
    observedVolatility: 0,
    unsmoothedVolatility: 0,
    volatilityRatio: 1,
    observedSharpe: null,
    unsmoothedSharpe: null,
    unsmoothedReturns: [],
  };

  if (returns.length < 12) return empty;

  const rho1 = autocorrelation(returns, 1);
  const annualize = (xs: number[]) => sampleStdDev(xs) * Math.sqrt(periodsPerYear);

  let reason: string | null = null;
  if (rho1 <= 0) {
    reason = "No positive serial correlation — nothing to unwind";
  } else if (rho1 >= MAX_STABLE_RHO) {
    reason = `First-order autocorrelation of ${rho1.toFixed(2)} exceeds the MA(1) bound of ${MAX_STABLE_RHO}; the correction would be dominated by estimation error`;
  }

  const unsmoothedReturns = geltnerUnsmooth(returns, rho1);
  const unsmoothingApplied = reason === null;

  const observedVolatility = annualize(returns);
  const unsmoothedVolatility = annualize(unsmoothedReturns);

  const sharpe = (xs: number[]) => {
    const vol = annualize(xs);
    if (vol === 0) return null;
    return (mean(xs) * periodsPerYear - riskFreeRate) / vol;
  };

  return {
    rho1,
    autocorrelations: autocorrelations(returns, 6),
    ljungBox: ljungBox(returns, 6),
    smoothingIndex: smoothingIndex(rho1),
    unsmoothingApplied,
    reason,
    observedVolatility,
    unsmoothedVolatility,
    volatilityRatio:
      observedVolatility > 0 ? unsmoothedVolatility / observedVolatility : 1,
    observedSharpe: sharpe(returns),
    unsmoothedSharpe: sharpe(unsmoothedReturns),
    unsmoothedReturns,
  };
}
