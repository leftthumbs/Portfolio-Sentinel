/**
 * Shared statistical primitives for return-stream analytics.
 *
 * Kept separate from the analytics engine so the distribution maths can be
 * unit-checked in isolation and reused by the IC scoring module.
 */

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample variance (n-1 denominator), which is what fund reporting uses. */
export function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1);
}

export function stdDev(xs: number[]): number {
  return Math.sqrt(variance(xs));
}

export function covariance(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let acc = 0;
  for (let i = 0; i < n; i++) acc += (xs[i] - mx) * (ys[i] - my);
  return acc / (n - 1);
}

export function correlation(xs: number[], ys: number[]): number | null {
  const sx = stdDev(xs);
  const sy = stdDev(ys);
  if (sx === 0 || sy === 0) return null;
  return covariance(xs, ys) / (sx * sy);
}

/** Linear-interpolated percentile, p expressed 0-100. */
export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (rank - lo) * (sorted[hi] - sorted[lo]);
}

/** Fisher-Pearson sample skewness (the adjusted g1 that Excel's SKEW reports). */
export function skewness(xs: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const s = stdDev(xs);
  if (s === 0) return null;
  const m = mean(xs);
  const sum = xs.reduce((acc, x) => acc + ((x - m) / s) ** 3, 0);
  return (n / ((n - 1) * (n - 2))) * sum;
}

/** Sample EXCESS kurtosis (Excel's KURT); 0 for a normal distribution. */
export function excessKurtosis(xs: number[]): number | null {
  const n = xs.length;
  if (n < 4) return null;
  const s = stdDev(xs);
  if (s === 0) return null;
  const m = mean(xs);
  const sum = xs.reduce((acc, x) => acc + ((x - m) / s) ** 4, 0);
  const a = (n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3));
  const b = (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
  return a * sum - b;
}

/** Abramowitz & Stegun 26.2.23 inverse normal CDF; accurate to ~4.5e-4. */
export function normalInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const tail = p < 0.5 ? p : 1 - p;
  const t = Math.sqrt(-2 * Math.log(tail));
  const c = [2.515517, 0.802853, 0.010328];
  const d = [1.432788, 0.189269, 0.001308];
  const num = c[0] + c[1] * t + c[2] * t * t;
  const den = 1 + d[0] * t + d[1] * t * t + d[2] * t * t * t;
  const z = t - num / den;
  return p < 0.5 ? -z : z;
}

/** Standard normal CDF via the Abramowitz & Stegun 7.1.26 error function. */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/** Upper-tail probability of a chi-square variate, used for Jarque-Bera / Ljung-Box. */
export function chiSquareUpperTail(x: number, df: number): number {
  if (x <= 0) return 1;
  if (df <= 0) return 1;
  if (df === 2) return Math.exp(-x / 2);

  // Regularised upper incomplete gamma Q(df/2, x/2) via series or continued fraction.
  const a = df / 2;
  const z = x / 2;
  const lnGammaA = logGamma(a);

  if (z < a + 1) {
    // Series expansion for the lower tail, then complement.
    let term = 1 / a;
    let sum = term;
    for (let n = 1; n < 500; n++) {
      term *= z / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
    }
    const lower = sum * Math.exp(-z + a * Math.log(z) - lnGammaA);
    return Math.min(1, Math.max(0, 1 - lower));
  }

  // Lentz's continued fraction for the upper tail.
  const tiny = 1e-300;
  let b = z + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-14) break;
  }
  const upper = h * Math.exp(-z + a * Math.log(z) - lnGammaA);
  return Math.min(1, Math.max(0, upper));
}

/** Lanczos approximation to log Γ(x). */
export function logGamma(x: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const z = x - 1;
  let a = 0.99999999999980993;
  const t = z + 7.5;
  for (let i = 0; i < g.length; i++) a += g[i] / (z + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Two-sided p-value for a t statistic, via the incomplete beta function. */
export function tDistTwoSidedP(t: number, df: number): number {
  if (df <= 0) return 1;
  const x = df / (df + t * t);
  return Math.min(1, Math.max(0, regularizedIncompleteBeta(x, df / 2, 0.5)));
}

function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnBeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lnBeta);
  // Continued fraction converges quickly on the correct side of the mean.
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(x, a, b)) / a;
  }
  return 1 - (Math.exp(b * Math.log(1 - x) + a * Math.log(x) - lnBeta) * betaContinuedFraction(1 - x, b, a)) / b;
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let numerator = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + numerator * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + numerator / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;

    numerator = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + numerator * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + numerator / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-12) break;
  }
  return h;
}

/** Autocorrelation of the series at the given lag. */
export function autocorrelation(xs: number[], lag: number): number | null {
  const n = xs.length;
  if (lag <= 0 || n <= lag + 2) return null;
  const m = mean(xs);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    den += (xs[i] - m) ** 2;
    if (i >= lag) num += (xs[i] - m) * (xs[i - lag] - m);
  }
  return den === 0 ? null : num / den;
}

/** Lower partial moment of order n about a threshold. */
export function lowerPartialMoment(xs: number[], threshold: number, order: number): number {
  if (xs.length === 0) return 0;
  const acc = xs.reduce((sum, x) => sum + Math.max(threshold - x, 0) ** order, 0);
  return acc / xs.length;
}

/** Ordinary least squares of y on x with inference-grade standard errors. */
export interface Regression {
  intercept: number;
  slope: number;
  rSquared: number;
  interceptStdError: number;
  slopeStdError: number;
  interceptTStat: number;
  slopeTStat: number;
  interceptPValue: number;
  residuals: number[];
  residualStdDev: number;
  observations: number;
}

export function linearRegression(xs: number[], ys: number[]): Regression | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;

  const x = xs.slice(0, n);
  const y = ys.slice(0, n);
  const mx = mean(x);
  const my = mean(y);

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) ** 2;
    sxy += (x[i] - mx) * (y[i] - my);
    syy += (y[i] - my) ** 2;
  }
  if (sxx === 0) return null;

  const slope = sxy / sxx;
  const intercept = my - slope * mx;

  const residuals = y.map((yi, i) => yi - (intercept + slope * x[i]));
  const sse = residuals.reduce((acc, r) => acc + r * r, 0);
  const dof = n - 2;
  const residualVar = dof > 0 ? sse / dof : 0;
  const residualStdDev = Math.sqrt(residualVar);

  const slopeStdError = Math.sqrt(residualVar / sxx);
  const interceptStdError = Math.sqrt(residualVar * (1 / n + (mx * mx) / sxx));
  const slopeTStat = slopeStdError > 0 ? slope / slopeStdError : 0;
  const interceptTStat = interceptStdError > 0 ? intercept / interceptStdError : 0;

  return {
    intercept,
    slope,
    rSquared: syy === 0 ? 0 : 1 - sse / syy,
    interceptStdError,
    slopeStdError,
    interceptTStat,
    slopeTStat,
    interceptPValue: dof > 0 ? tDistTwoSidedP(interceptTStat, dof) : 1,
    residuals,
    residualStdDev,
    observations: n,
  };
}

/**
 * Mulberry32 — a small deterministic PRNG.
 *
 * Monte Carlo results must be reproducible: the same upload analysed twice has
 * to produce the same fan chart, or the IC cannot rely on the numbers.
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
