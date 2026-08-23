/**
 * Client-side mirrors of the Return Analyzer API payloads.
 *
 * Kept hand-written rather than inferred from the server module so the client
 * bundle never pulls in the analytics engine, and so the wire contract is
 * explicit in one place.
 */

export type ColumnKind = "returnPercent" | "returnDecimal" | "level";

export interface ParsedColumn {
  name: string;
  index: number;
  detectedKind: ColumnKind;
  detectionReason: string;
  rawValues: (number | null)[];
  coverage: number;
}

export interface ParseResponse {
  fileName: string;
  dates: string[];
  rowCount: number;
  detectedFrequency: "daily" | "weekly" | "monthly" | "quarterly" | "annual";
  periodsPerYear: number;
  warnings: string[];
  columns: ParsedColumn[];
  suggestedFundColumn: number | null;
  suggestedBenchmarkColumn: number | null;
}

export interface PeriodReturn {
  label: string;
  cumulative: number | null;
  annualized: number | null;
  benchmarkCumulative: number | null;
  benchmarkAnnualized: number | null;
  excess: number | null;
  periods: number;
  complete: boolean;
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

export interface TailRiskLevel {
  confidence: number;
  historicalVar: number;
  parametricVar: number;
  modifiedVar: number | null;
  historicalCvar: number;
  parametricCvar: number;
  observationsInTail: number;
}

export interface DataQualityCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  value: string;
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

export interface Analytics {
  meta: {
    fundName: string;
    benchmarkName: string | null;
    periods: number;
    periodsPerYear: number;
    frequencyLabel: string;
    periodLabel: string;
    startDate: string;
    endDate: string;
    trackRecordYears: number;
    riskFreeRate: number;
    minimumAcceptableReturn: number;
    hasBenchmark: boolean;
    generatedAt: string;
  };
  performance: {
    cumulativeReturn: number;
    annualizedReturn: number | null;
    arithmeticAnnualizedReturn: number;
    bestPeriod: number;
    bestPeriodDate: string;
    worstPeriod: number;
    worstPeriodDate: string;
    positivePeriods: number;
    negativePeriods: number;
    flatPeriods: number;
    hitRate: number;
    averageGain: number;
    averageLoss: number;
    gainLossRatio: number | null;
    longestWinStreak: number;
    longestLossStreak: number;
    wealthIndex: { date: string; fund: number; benchmark: number | null }[];
    periodReturns: PeriodReturn[];
    calendarYears: { year: number; fund: number; benchmark: number | null; excess: number | null; periods: number; partial: boolean }[];
    monthlyGrid: { year: number; months: (number | null)[]; total: number | null }[] | null;
  };
  risk: {
    annualizedVolatility: number;
    periodVolatility: number;
    downsideDeviation: number;
    upsideDeviation: number;
    volatilitySkewRatio: number | null;
    skewness: number | null;
    excessKurtosis: number | null;
    jarqueBera: number | null;
    jarqueBeraPValue: number | null;
    isNormal: boolean | null;
    var95: TailRiskLevel;
    var99: TailRiskLevel;
    tailRisk: TailRiskLevel[];
    tailRatio: number | null;
    histogram: { label: string; lowerBound: number; upperBound: number; count: number; normalCount: number }[];
    worstWindows: { label: string; periods: number; worstReturn: number | null; startDate: string | null; endDate: string | null; benchmarkReturn: number | null }[];
    drawdown: {
      series: { date: string; drawdown: number; wealth: number }[];
      maxDrawdown: number;
      maxDrawdownDate: string | null;
      episodes: DrawdownEpisode[];
      ulcerIndex: number;
      painIndex: number;
      conditionalDrawdown95: number;
      periodsUnderwater: number;
      percentTimeUnderwater: number;
      longestUnderwaterPeriods: number;
      currentDrawdown: number;
      currentUnderwaterPeriods: number;
      averageRecoveryPeriods: number | null;
    };
  };
  riskAdjusted: {
    sharpeRatio: number | null;
    sortinoRatio: number | null;
    calmarRatio: number | null;
    sterlingRatio: number | null;
    burkeRatio: number | null;
    martinRatio: number | null;
    omegaRatio: number | null;
    kappaThree: number | null;
    gainToPainRatio: number | null;
    modifiedSharpe: number | null;
    adjustedSharpe: number | null;
    commonSenseRatio: number | null;
    probabilisticSharpe: number | null;
    minimumTrackRecordYears: number | null;
  };
  smoothing: {
    autocorrelations: { lag: number; value: number | null }[];
    lag1Autocorrelation: number | null;
    ljungBox: number | null;
    ljungBoxPValue: number | null;
    ljungBoxLags: number;
    hasSerialDependence: boolean | null;
    unsmoothed: { rho: number; volatility: number; sharpe: number | null; maxDrawdown: number; volatilityUplift: number } | null;
  };
  relative: {
    beta: number | null;
    upBeta: number | null;
    downBeta: number | null;
    betaAsymmetry: number | null;
    alpha: number | null;
    alphaTStat: number | null;
    alphaPValue: number | null;
    alphaIsSignificant: boolean | null;
    correlation: number | null;
    downsideCorrelation: number | null;
    rSquared: number | null;
    trackingError: number;
    informationRatio: number | null;
    treynorRatio: number | null;
    activePremium: number | null;
    upCapture: number | null;
    downCapture: number | null;
    captureSpread: number | null;
    battingAverage: number;
    upPeriodRatio: number | null;
    downPeriodRatio: number | null;
    upPeriods: number;
    downPeriods: number;
    m2: number | null;
    m2Alpha: number | null;
    appraisalRatio: number | null;
    residualVolatility: number | null;
    benchmarkAnnualizedReturn: number | null;
    benchmarkCumulativeReturn: number;
    benchmarkVolatility: number;
    fundVolatility: number;
    activeCumulative: number[];
    observations: number;
  } | null;
  rolling: { window: number; windowLabel: string; points: RollingPoint[] };
  scatter: { date: string; fund: number; benchmark: number }[] | null;
  simulation: {
    horizonYears: number;
    horizonPeriods: number;
    paths: number;
    meanBlockLength: number;
    percentiles: { period: number; yearFraction: number; p5: number; p25: number; p50: number; p75: number; p95: number }[];
    lossProbabilities: { years: number; probabilityOfLoss: number; medianReturn: number }[];
    terminalAnnualized: { p5: number; p25: number; p50: number; p75: number; p95: number; mean: number };
    expectedMaxDrawdown: { p50: number; p95: number; worst: number };
    probabilityOfLossOverHorizon: number;
  };
  dataQuality: DataQualityCheck[];
}

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
  weight: number;
  effectiveWeight: number;
  drivers: ScoreDriver[];
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

export interface AnalyzeResponse {
  analytics: Analytics;
  assessment: ICAssessment;
  riskFreeSource: string;
  notes: string[];
}
