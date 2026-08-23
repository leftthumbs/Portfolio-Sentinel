interface RiskMetricsInput {
  portfolioReturns: number[];
  benchmarkReturns: number[];
  riskFreeRate: number;
  annualizedPortfolioReturn: number;
  annualizedBenchmarkReturn: number;
  periodsPerYear?: number;
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

export interface ComponentRiskResult {
  name: string;
  assetClass: string;
  weight: number;
  marginalContribution: number;
  componentContribution: number;
  percentContribution: number;
}

export interface AdvancedTailMetrics {
  cornishFisherVaR95: number;
  cornishFisherVaR99: number;
  parametricES95: number;
  parametricES99: number;
  historicalES95: number;
  historicalES99: number;
  modifiedSharpe: number;
  excessKurtosisAdjustedVol: number;
  maxDrawdownDuration: number;
  averageDrawdownDuration: number;
  currentDrawdown: number;
  drawdownRecoveryDays: number | null;
  conditionalDrawdown95: number;
}

export interface MonteCarloStressPath {
  pathId: number;
  cumulativeReturns: number[];
  finalReturn: number;
  maxDrawdown: number;
  var95: number;
}

export interface MonteCarloStressResult {
  scenarioName: string;
  numPaths: number;
  horizon: number;
  paths: MonteCarloStressPath[];
  percentiles: {
    p5: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
  };
  expectedReturn: number;
  expectedVol: number;
  expectedMaxDrawdown: number;
  probabilityOfLoss: number;
  expectedShortfall: number;
}

export interface FactorDecomposition {
  systematicRisk: number;
  idiosyncraticRisk: number;
  totalRisk: number;
  systematicPct: number;
  idiosyncraticPct: number;
  rSquared: number;
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

function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function normalCDFInverse(p: number): number {
  const a1 = -3.969683028665376e+01;
  const a2 =  2.209460984245205e+02;
  const a3 = -2.759285104469687e+02;
  const a4 =  1.383577518672690e+02;
  const a5 = -3.066479806614716e+01;
  const a6 =  2.506628277459239e+00;

  const b1 = -5.447609879822406e+01;
  const b2 =  1.615858368580409e+02;
  const b3 = -1.556989798598866e+02;
  const b4 =  6.680131188771972e+01;
  const b5 = -1.328068155288572e+01;

  const c1 = -7.784894002430293e-03;
  const c2 = -3.223964580411365e-01;
  const c3 = -2.400758277161838e+00;
  const c4 = -2.549732539343734e+00;
  const c5 =  4.374664141464968e+00;
  const c6 =  2.938163982698783e+00;

  const d1 =  7.784695709041462e-03;
  const d2 =  3.224671290700398e-01;
  const d3 =  2.445134137142996e+00;
  const d4 =  3.754408661907416e+00;

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  let q: number, r: number;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c1*q+c2)*q+c3)*q+c4)*q+c5)*q+c6) / ((((d1*q+d2)*q+d3)*q+d4)*q+1);
  } else if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a1*r+a2)*r+a3)*r+a4)*r+a5)*r+a6)*q / (((((b1*r+b2)*r+b3)*r+b4)*r+b5)*r+1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c1*q+c2)*q+c3)*q+c4)*q+c5)*q+c6) / ((((d1*q+d2)*q+d3)*q+d4)*q+1);
  }
}

export function calculateBenchmarkMetrics(input: RiskMetricsInput): CalculatedRiskMetrics {
  const { portfolioReturns, benchmarkReturns, riskFreeRate, annualizedPortfolioReturn, annualizedBenchmarkReturn, periodsPerYear = 252 } = input;

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
  const trackingError = stdDev(excessReturns) * Math.sqrt(periodsPerYear);

  let informationRatio: number | null = null;
  if (trackingError > 0 && alpha !== null) {
    informationRatio = alpha / trackingError;
  }

  let treynorRatio: number | null = null;
  if (beta !== null && Math.abs(beta) > 0.01) {
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
  periods: number,
  annualizedReturn: number = 0.10,
  annualizedVolatility: number = 0.16,
  periodsPerYear: number = 252
): number[] {
  const periodReturn = annualizedReturn / periodsPerYear;
  const periodVol = annualizedVolatility / Math.sqrt(periodsPerYear);

  const returns: number[] = [];
  for (let i = 0; i < periods; i++) {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const ret = periodReturn + periodVol * z;
    returns.push(ret);
  }

  return returns;
}


export function cornishFisherVaR(returns: number[], confidence: number): number {
  if (returns.length < 20) return percentile(returns, (1 - confidence) * 100);

  const mu = mean(returns);
  const sigma = stdDev(returns);
  if (sigma === 0) return 0;

  const n = returns.length;
  const standardized = returns.map(r => (r - mu) / sigma);

  const s = standardized.reduce((sum, x) => sum + Math.pow(x, 3), 0) / n;
  const k = standardized.reduce((sum, x) => sum + Math.pow(x, 4), 0) / n - 3;

  const zAlpha = normalCDFInverse(1 - confidence);
  const zCF = zAlpha
    + (1/6) * (zAlpha * zAlpha - 1) * s
    + (1/24) * (Math.pow(zAlpha, 3) - 3 * zAlpha) * k
    - (1/36) * (2 * Math.pow(zAlpha, 3) - 5 * zAlpha) * s * s;

  return mu + sigma * zCF;
}

export function parametricExpectedShortfall(returns: number[], confidence: number): number {
  if (returns.length < 20) {
    const sorted = [...returns].sort((a, b) => a - b);
    const cutoff = Math.floor(sorted.length * (1 - confidence));
    if (cutoff === 0) return sorted[0] || 0;
    const tailReturns = sorted.slice(0, cutoff);
    return mean(tailReturns);
  }

  const mu = mean(returns);
  const sigma = stdDev(returns);
  if (sigma === 0) return 0;

  const zAlpha = normalCDFInverse(1 - confidence);
  const esGaussian = mu - sigma * normalPDF(zAlpha) / (1 - confidence);

  return esGaussian;
}

export function historicalExpectedShortfall(returns: number[], confidence: number): number {
  const sorted = [...returns].sort((a, b) => a - b);
  const cutoff = Math.max(1, Math.floor(sorted.length * (1 - confidence)));
  const tailReturns = sorted.slice(0, cutoff);
  return mean(tailReturns);
}

export function ledoitWolfShrinkage(returns: number[][]): number[][] {
  const n = returns.length;
  if (n === 0 || returns[0].length < 2) return [];

  const p = returns[0].length;
  const T = n;

  const means = new Array(p).fill(0);
  for (let j = 0; j < p; j++) {
    for (let t = 0; t < T; t++) {
      means[j] += returns[t][j];
    }
    means[j] /= T;
  }

  const sampleCov: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let i = 0; i < p; i++) {
    for (let j = i; j < p; j++) {
      let sum = 0;
      for (let t = 0; t < T; t++) {
        sum += (returns[t][i] - means[i]) * (returns[t][j] - means[j]);
      }
      sampleCov[i][j] = sum / (T - 1);
      sampleCov[j][i] = sampleCov[i][j];
    }
  }

  let traceS = 0;
  for (let i = 0; i < p; i++) {
    traceS += sampleCov[i][i];
  }
  const muTarget = traceS / p;

  const target: number[][] = Array.from({ length: p }, (_, i) =>
    Array.from({ length: p }, (_, j) => (i === j ? muTarget : 0))
  );

  let sum1 = 0;
  let sum2 = 0;
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      const diff = sampleCov[i][j] - target[i][j];
      sum2 += diff * diff;

      let sumK = 0;
      for (let t = 0; t < T; t++) {
        const xij = (returns[t][i] - means[i]) * (returns[t][j] - means[j]) - sampleCov[i][j];
        sumK += xij * xij;
      }
      sum1 += sumK / T;
    }
  }

  const delta = sum1 / (T * sum2);
  const shrinkageIntensity = Math.max(0, Math.min(1, delta));

  const shrunkCov: number[][] = Array.from({ length: p }, (_, i) =>
    Array.from({ length: p }, (_, j) =>
      shrinkageIntensity * target[i][j] + (1 - shrinkageIntensity) * sampleCov[i][j]
    )
  );

  return shrunkCov;
}

export interface HoldingInfo {
  name: string;
  assetClass: string;
  weight: number;
  returns: number[];
}

export function calculateComponentRisk(
  holdings: HoldingInfo[],
  portfolioReturns: number[],
  periodsPerYear: number = 252
): ComponentRiskResult[] {
  if (holdings.length === 0 || portfolioReturns.length < 10) return [];

  const portfolioVol = stdDev(portfolioReturns) * Math.sqrt(periodsPerYear);
  if (portfolioVol === 0) return [];

  const results: ComponentRiskResult[] = [];

  for (const holding of holdings) {
    const holdingReturns = holding.returns.length > 0 ? holding.returns : portfolioReturns;
    const minLen = Math.min(holdingReturns.length, portfolioReturns.length);
    const hRet = holdingReturns.slice(-minLen);
    const pRet = portfolioReturns.slice(-minLen);

    const cov = covariance(hRet, pRet);
    const portVar = variance(pRet);

    const marginalContribution = portVar > 0
      ? (cov / Math.sqrt(portVar)) * Math.sqrt(periodsPerYear)
      : 0;

    const componentContribution = holding.weight * marginalContribution;
    const percentContribution = portfolioVol > 0 ? componentContribution / portfolioVol : 0;

    results.push({
      name: holding.name,
      assetClass: holding.assetClass,
      weight: holding.weight,
      marginalContribution,
      componentContribution,
      percentContribution,
    });
  }

  const totalPct = results.reduce((sum, r) => sum + Math.abs(r.percentContribution), 0);
  if (totalPct > 0) {
    for (const r of results) {
      r.percentContribution = r.percentContribution / totalPct;
    }
  }

  return results;
}

export function calculateFactorDecomposition(
  portfolioReturns: number[],
  benchmarkReturns: number[],
  periodsPerYear: number = 252
): FactorDecomposition {
  if (portfolioReturns.length < 20 || benchmarkReturns.length < 20) {
    return {
      systematicRisk: 0,
      idiosyncraticRisk: 0,
      totalRisk: 0,
      systematicPct: 0,
      idiosyncraticPct: 0,
      rSquared: 0,
    };
  }

  const minLen = Math.min(portfolioReturns.length, benchmarkReturns.length);
  const pRet = portfolioReturns.slice(-minLen);
  const bRet = benchmarkReturns.slice(-minLen);

  const benchVar = variance(bRet);
  const portVar = variance(pRet);
  const cov = covariance(pRet, bRet);

  const beta = benchVar > 0 ? cov / benchVar : 0;
  const rSquared = portVar > 0 && benchVar > 0
    ? Math.pow(cov, 2) / (portVar * benchVar)
    : 0;

  const totalRisk = Math.sqrt(portVar) * Math.sqrt(periodsPerYear);
  const systematicVariance = beta * beta * benchVar;
  const idiosyncraticVariance = Math.max(0, portVar - systematicVariance);

  const systematicRisk = Math.sqrt(systematicVariance) * Math.sqrt(periodsPerYear);
  const idiosyncraticRisk = Math.sqrt(idiosyncraticVariance) * Math.sqrt(periodsPerYear);

  const totalVariance = systematicVariance + idiosyncraticVariance;
  const systematicPct = totalVariance > 0 ? systematicVariance / totalVariance : 0;
  const idiosyncraticPct = totalVariance > 0 ? idiosyncraticVariance / totalVariance : 0;

  return {
    systematicRisk,
    idiosyncraticRisk,
    totalRisk,
    systematicPct,
    idiosyncraticPct,
    rSquared,
  };
}

export function calculateAdvancedTailMetrics(
  portfolioReturns: number[],
  portfolioValues: number[],
  riskFreeRate: number,
  periodsPerYear: number = 252
): AdvancedTailMetrics {
  const cfVaR95 = cornishFisherVaR(portfolioReturns, 0.95);
  const cfVaR99 = cornishFisherVaR(portfolioReturns, 0.99);
  const pES95 = parametricExpectedShortfall(portfolioReturns, 0.95);
  const pES99 = parametricExpectedShortfall(portfolioReturns, 0.99);
  const hES95 = historicalExpectedShortfall(portfolioReturns, 0.95);
  const hES99 = historicalExpectedShortfall(portfolioReturns, 0.99);

  const mu = mean(portfolioReturns);
  const sigma = stdDev(portfolioReturns);
  const n = portfolioReturns.length;

  let skew = 0;
  let kurt = 0;
  if (n > 3 && sigma > 0) {
    const standardized = portfolioReturns.map(r => (r - mu) / sigma);
    skew = standardized.reduce((sum, x) => sum + Math.pow(x, 3), 0) / n;
    kurt = standardized.reduce((sum, x) => sum + Math.pow(x, 4), 0) / n - 3;
  }

  const adjustedVol = sigma * Math.sqrt(1 + (kurt / 4));
  const excessKurtosisAdjustedVol = adjustedVol * Math.sqrt(periodsPerYear);

  const annualizedReturn = mu * periodsPerYear;
  const annualizedVol = sigma * Math.sqrt(periodsPerYear);
  let modifiedSharpe = 0;
  if (annualizedVol > 0) {
    const zc = normalCDFInverse(0.95);
    const mVaR = zc + (1/6) * (zc*zc - 1) * skew
      + (1/24) * (Math.pow(zc, 3) - 3*zc) * kurt
      - (1/36) * (2 * Math.pow(zc, 3) - 5*zc) * skew * skew;
    if (mVaR !== 0) {
      modifiedSharpe = (annualizedReturn - riskFreeRate) / (annualizedVol * mVaR / zc);
    }
  }

  let maxDrawdownDuration = 0;
  let averageDrawdownDuration = 0;
  let currentDrawdown = 0;
  let drawdownRecoveryDays: number | null = null;
  let conditionalDrawdown95 = 0;

  if (portfolioValues.length > 1) {
    let peak = portfolioValues[0];
    let drawdownStart = -1;
    const drawdownDurations: number[] = [];
    const allDrawdowns: number[] = [];
    let currentDDDuration = 0;

    for (let i = 0; i < portfolioValues.length; i++) {
      const val = portfolioValues[i];
      if (val >= peak) {
        if (drawdownStart >= 0) {
          drawdownDurations.push(i - drawdownStart);
          drawdownStart = -1;
        }
        peak = val;
        currentDDDuration = 0;
      } else {
        if (drawdownStart < 0) drawdownStart = i;
        currentDDDuration = i - drawdownStart + 1;
      }
      const dd = peak > 0 ? (peak - val) / peak : 0;
      allDrawdowns.push(dd);
    }

    if (drawdownStart >= 0) {
      drawdownDurations.push(portfolioValues.length - drawdownStart);
    }

    maxDrawdownDuration = drawdownDurations.length > 0
      ? Math.max(...drawdownDurations)
      : 0;
    averageDrawdownDuration = drawdownDurations.length > 0
      ? mean(drawdownDurations)
      : 0;

    const lastVal = portfolioValues[portfolioValues.length - 1];
    currentDrawdown = peak > 0 ? (peak - lastVal) / peak : 0;

    if (currentDrawdown > 0) {
      drawdownRecoveryDays = null;
    } else {
      let lastRecoveryDays = 0;
      let recovering = false;
      let recPeak = portfolioValues[0];
      for (let i = 0; i < portfolioValues.length; i++) {
        if (portfolioValues[i] >= recPeak) {
          if (recovering) {
            lastRecoveryDays = i;
            recovering = false;
          }
          recPeak = portfolioValues[i];
        } else {
          if (!recovering) recovering = true;
        }
      }
      drawdownRecoveryDays = lastRecoveryDays > 0 ? lastRecoveryDays : null;
    }

    const sortedDrawdowns = [...allDrawdowns].sort((a, b) => b - a);
    const cutoff95 = Math.max(1, Math.floor(sortedDrawdowns.length * 0.05));
    conditionalDrawdown95 = mean(sortedDrawdowns.slice(0, cutoff95));
  }

  return {
    cornishFisherVaR95: cfVaR95,
    cornishFisherVaR99: cfVaR99,
    parametricES95: pES95,
    parametricES99: pES99,
    historicalES95: hES95,
    historicalES99: hES99,
    modifiedSharpe,
    excessKurtosisAdjustedVol,
    maxDrawdownDuration,
    averageDrawdownDuration,
    currentDrawdown,
    drawdownRecoveryDays,
    conditionalDrawdown95,
  };
}

export function runMonteCarloStress(
  portfolioReturns: number[],
  scenario: {
    name: string;
    meanShift: number;
    volMultiplier: number;
  },
  numPaths: number = 100,
  horizon: number = 252,
  periodsPerYear: number = 252
): MonteCarloStressResult {
  const mu = mean(portfolioReturns);
  const sigma = stdDev(portfolioReturns);

  const stressedMu = mu + scenario.meanShift / periodsPerYear;
  const stressedSigma = sigma * scenario.volMultiplier;

  const paths: MonteCarloStressPath[] = [];
  const finalReturns: number[] = [];
  const maxDrawdowns: number[] = [];

  for (let p = 0; p < numPaths; p++) {
    const cumulativeReturns: number[] = [0];
    let cumReturn = 1;
    let peak = 1;
    let maxDD = 0;

    for (let t = 0; t < horizon; t++) {
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
      const dailyReturn = stressedMu + stressedSigma * z;

      cumReturn *= (1 + dailyReturn);
      if (cumReturn > peak) peak = cumReturn;
      const dd = (peak - cumReturn) / peak;
      if (dd > maxDD) maxDD = dd;

      cumulativeReturns.push((cumReturn - 1) * 100);
    }

    const finalReturn = cumReturn - 1;
    finalReturns.push(finalReturn);
    maxDrawdowns.push(maxDD);

    if (p < 20) {
      paths.push({
        pathId: p,
        cumulativeReturns: cumulativeReturns.filter((_, i) => i % Math.max(1, Math.floor(horizon / 50)) === 0 || i === cumulativeReturns.length - 1),
        finalReturn,
        maxDrawdown: maxDD,
        var95: 0,
      });
    }
  }

  finalReturns.sort((a, b) => a - b);
  const probabilityOfLoss = finalReturns.filter(r => r < 0).length / numPaths;
  const cutoff = Math.max(1, Math.floor(numPaths * 0.05));
  const expectedShortfall = mean(finalReturns.slice(0, cutoff));

  return {
    scenarioName: scenario.name,
    numPaths,
    horizon,
    paths,
    percentiles: {
      p5: percentile(finalReturns, 5),
      p25: percentile(finalReturns, 25),
      p50: percentile(finalReturns, 50),
      p75: percentile(finalReturns, 75),
      p95: percentile(finalReturns, 95),
    },
    expectedReturn: mean(finalReturns),
    expectedVol: stdDev(finalReturns),
    expectedMaxDrawdown: mean(maxDrawdowns),
    probabilityOfLoss,
    expectedShortfall,
  };
}

export function calculateDrawdownSeries(portfolioValues: number[]): {
  drawdowns: number[];
  periods: { start: number; end: number; depth: number; duration: number; recovered: boolean }[];
} {
  if (portfolioValues.length === 0) return { drawdowns: [], periods: [] };

  const drawdowns: number[] = [];
  const periods: { start: number; end: number; depth: number; duration: number; recovered: boolean }[] = [];

  let peak = portfolioValues[0];
  let drawdownStart = -1;
  let maxDepth = 0;

  for (let i = 0; i < portfolioValues.length; i++) {
    const val = portfolioValues[i];
    if (val >= peak) {
      if (drawdownStart >= 0) {
        periods.push({
          start: drawdownStart,
          end: i,
          depth: maxDepth,
          duration: i - drawdownStart,
          recovered: true,
        });
        drawdownStart = -1;
        maxDepth = 0;
      }
      peak = val;
    } else {
      if (drawdownStart < 0) drawdownStart = i;
      const dd = (peak - val) / peak;
      if (dd > maxDepth) maxDepth = dd;
    }
    drawdowns.push(peak > 0 ? (peak - val) / peak : 0);
  }

  if (drawdownStart >= 0) {
    periods.push({
      start: drawdownStart,
      end: portfolioValues.length - 1,
      depth: maxDepth,
      duration: portfolioValues.length - drawdownStart,
      recovered: false,
    });
  }

  return { drawdowns, periods };
}
