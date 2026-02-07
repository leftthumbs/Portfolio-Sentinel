interface RiskMetricsInput {
  portfolioReturns: number[];
  benchmarkReturns: number[];
  riskFreeRate: number;
  annualizedPortfolioReturn: number;
  annualizedBenchmarkReturn: number;
}

interface CalculatedRiskMetrics {
  beta: number | null;
  alpha: number | null;
  correlation: number | null;
  downsideCorrelation: number | null;
  trackingError: number | null;
  informationRatio: number | null;
  treynorRatio: number | null;
  upsideCapture: number | null;
  downsideCapture: number | null;
  tailRatio: number | null;
  var99: number | null;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function variance(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return arr.reduce((sum, x) => sum + Math.pow(x - m, 2), 0) / (arr.length - 1);
}

function stdDev(arr: number[]): number {
  return Math.sqrt(variance(arr));
}

function covariance(arr1: number[], arr2: number[]): number {
  if (arr1.length !== arr2.length || arr1.length < 2) return 0;
  const mean1 = mean(arr1);
  const mean2 = mean(arr2);
  let sum = 0;
  for (let i = 0; i < arr1.length; i++) {
    sum += (arr1[i] - mean1) * (arr2[i] - mean2);
  }
  return sum / (arr1.length - 1);
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export function calculateBenchmarkMetrics(input: RiskMetricsInput): CalculatedRiskMetrics {
  const { portfolioReturns, benchmarkReturns, riskFreeRate, annualizedPortfolioReturn, annualizedBenchmarkReturn } = input;

  if (portfolioReturns.length < 10 || benchmarkReturns.length < 10) {
    return {
      beta: null,
      alpha: null,
      correlation: null,
      downsideCorrelation: null,
      trackingError: null,
      informationRatio: null,
      treynorRatio: null,
      upsideCapture: null,
      downsideCapture: null,
      tailRatio: null,
      var99: null,
    };
  }

  const minLength = Math.min(portfolioReturns.length, benchmarkReturns.length);
  const pReturns = portfolioReturns.slice(-minLength);
  const bReturns = benchmarkReturns.slice(-minLength);

  const benchVariance = variance(bReturns);
  const portStdDev = stdDev(pReturns);
  const benchStdDev = stdDev(bReturns);
  const cov = covariance(pReturns, bReturns);

  let beta: number | null = null;
  if (benchVariance > 0) {
    beta = cov / benchVariance;
  }

  let correlation: number | null = null;
  if (portStdDev > 0 && benchStdDev > 0) {
    correlation = cov / (portStdDev * benchStdDev);
  }

  const downsideIndices: number[] = [];
  for (let i = 0; i < bReturns.length; i++) {
    if (bReturns[i] < 0) {
      downsideIndices.push(i);
    }
  }

  let downsideCorrelation: number | null = null;
  if (downsideIndices.length >= 5) {
    const downsidePortReturns = downsideIndices.map(i => pReturns[i]);
    const downsideBenchReturns = downsideIndices.map(i => bReturns[i]);
    const downCov = covariance(downsidePortReturns, downsideBenchReturns);
    const downPortStd = stdDev(downsidePortReturns);
    const downBenchStd = stdDev(downsideBenchReturns);
    if (downPortStd > 0 && downBenchStd > 0) {
      downsideCorrelation = downCov / (downPortStd * downBenchStd);
    }
  }

  let alpha: number | null = null;
  if (beta !== null) {
    const expectedReturn = riskFreeRate + beta * (annualizedBenchmarkReturn - riskFreeRate);
    alpha = annualizedPortfolioReturn - expectedReturn;
  }

  const excessReturns = pReturns.map((p, i) => p - bReturns[i]);
  const trackingError = stdDev(excessReturns) * Math.sqrt(252);

  let informationRatio: number | null = null;
  if (trackingError > 0 && alpha !== null) {
    informationRatio = alpha / trackingError;
  }

  let treynorRatio: number | null = null;
  if (beta !== null && Math.abs(beta) > 0.01) {
    // Treynor ratio can be calculated with negative beta (hedging assets)
    treynorRatio = (annualizedPortfolioReturn - riskFreeRate) / beta;
  }

  const upPeriods: { port: number; bench: number }[] = [];
  const downPeriods: { port: number; bench: number }[] = [];
  for (let i = 0; i < minLength; i++) {
    if (bReturns[i] > 0) {
      upPeriods.push({ port: pReturns[i], bench: bReturns[i] });
    } else if (bReturns[i] < 0) {
      downPeriods.push({ port: pReturns[i], bench: bReturns[i] });
    }
  }

  let upsideCapture: number | null = null;
  if (upPeriods.length >= 5) {
    const avgPortUp = mean(upPeriods.map(p => p.port));
    const avgBenchUp = mean(upPeriods.map(p => p.bench));
    if (avgBenchUp > 0) {
      upsideCapture = (avgPortUp / avgBenchUp);
    }
  }

  let downsideCapture: number | null = null;
  if (downPeriods.length >= 5) {
    const avgPortDown = mean(downPeriods.map(p => p.port));
    const avgBenchDown = mean(downPeriods.map(p => p.bench));
    if (avgBenchDown < 0) {
      downsideCapture = (avgPortDown / avgBenchDown);
    }
  }

  const pct5 = percentile(pReturns, 5);
  const pct95 = percentile(pReturns, 95);
  let tailRatio: number | null = null;
  if (pct5 !== 0) {
    tailRatio = pct95 / Math.abs(pct5);
  }

  const var99 = percentile(pReturns, 1);

  return {
    beta,
    alpha,
    correlation,
    downsideCorrelation,
    trackingError,
    informationRatio,
    treynorRatio,
    upsideCapture,
    downsideCapture,
    tailRatio,
    var99,
  };
}

export function generateSyntheticBenchmarkReturns(
  days: number,
  annualizedReturn: number = 0.10,
  annualizedVolatility: number = 0.16
): number[] {
  const dailyReturn = annualizedReturn / 252;
  const dailyVol = annualizedVolatility / Math.sqrt(252);

  const returns: number[] = [];
  for (let i = 0; i < days; i++) {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const dailyRet = dailyReturn + dailyVol * z;
    returns.push(dailyRet);
  }

  return returns;
}
