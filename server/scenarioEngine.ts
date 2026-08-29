/**
 * Enhanced Scenario Testing Engine
 *
 * Inspired by patterns from:
 * - Riskfolio-Lib: CVaR/ES, factor models, robust covariance estimators, worst-case optimization
 * - skfolio: structured scenario/risk pipeline with factor decomposition
 * - Stress-Testing-Financial-Portfolios: VaR/CVaR + factor-model stress testing
 *
 * Capabilities:
 * 1. Multi-factor model with configurable factor sensitivities (betas)
 * 2. Correlated factor shocks via Cholesky decomposition
 * 3. Monte Carlo scenario simulation with fat-tailed distributions
 * 4. Parametric & historical VaR / CVaR (Expected Shortfall)
 * 5. Component risk decomposition (Euler allocation)
 * 6. Reverse stress testing (find shocks that cause a target loss)
 * 7. Regime-aware scenarios (expansion, contraction, crisis)
 * 8. Multi-asset-class factor sensitivity matrix
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FactorDefinition {
  id: string;
  name: string;
  description: string;
  annualVol: number;         // annualized volatility of the factor
  expectedReturn: number;    // annualized expected return contribution
}

export const DEFAULT_FACTORS: FactorDefinition[] = [
  { id: "equity",       name: "Equity Market",      description: "Global equity risk premium",              annualVol: 0.16, expectedReturn: 0.07 },
  { id: "rates",        name: "Interest Rates",      description: "Duration / rate level shock",             annualVol: 0.01, expectedReturn: 0.00 },
  { id: "credit",       name: "Credit Spreads",      description: "Investment-grade & high-yield spreads",   annualVol: 0.02, expectedReturn: 0.00 },
  { id: "fx",           name: "FX / Dollar",          description: "Broad dollar strength / weakness",        annualVol: 0.08, expectedReturn: 0.00 },
  { id: "commodity",    name: "Commodities",          description: "Broad commodity index",                   annualVol: 0.18, expectedReturn: 0.02 },
  { id: "volatility",   name: "Volatility (VIX)",     description: "Equity implied volatility regime",        annualVol: 0.80, expectedReturn: -0.05 },
  { id: "inflation",    name: "Inflation Surprise",   description: "Break-even inflation shocks",             annualVol: 0.015, expectedReturn: 0.00 },
  { id: "liquidity",    name: "Liquidity",             description: "Funding / liquidity stress",              annualVol: 0.10, expectedReturn: 0.00 },
];

/** Default factor correlation matrix (8x8) – rows/cols in DEFAULT_FACTORS order */
export const DEFAULT_FACTOR_CORRELATION: number[][] = [
  //  equity  rates  credit    fx    commodity  vol   inflation  liquidity
  [   1.00,  -0.20,   0.50,  -0.15,   0.30,  -0.70,   0.05,  -0.40 ],  // equity
  [  -0.20,   1.00,  -0.30,   0.10,  -0.10,   0.15,  -0.20,   0.10 ],  // rates
  [   0.50,  -0.30,   1.00,  -0.10,   0.15,  -0.45,   0.10,  -0.50 ],  // credit
  [  -0.15,   0.10,  -0.10,   1.00,   0.20,   0.10,   0.05,   0.05 ],  // fx
  [   0.30,  -0.10,   0.15,   0.20,   1.00,  -0.25,   0.40,  -0.15 ],  // commodity
  [  -0.70,   0.15,  -0.45,   0.10,  -0.25,   1.00,  -0.05,   0.55 ],  // volatility
  [   0.05,  -0.20,   0.10,   0.05,   0.40,  -0.05,   1.00,  -0.05 ],  // inflation
  [  -0.40,   0.10,  -0.50,   0.05,  -0.15,   0.55,  -0.05,   1.00 ],  // liquidity
];

/** Factor betas (sensitivities) by asset class */
export interface AssetClassFactorBetas {
  equity: number;
  rates: number;       // duration-like sensitivity
  credit: number;      // spread duration
  fx: number;          // foreign exposure
  commodity: number;
  volatility: number;  // vega-like sensitivity
  inflation: number;
  liquidity: number;
}

export const ASSET_CLASS_FACTOR_BETAS: Record<string, AssetClassFactorBetas> = {
  "US Equity":              { equity: 1.00, rates: -0.10, credit:  0.10, fx: -0.05, commodity:  0.05, volatility: -0.15, inflation:  0.00, liquidity: -0.05 },
  "International Equity":   { equity: 0.85, rates: -0.08, credit:  0.08, fx:  0.40, commodity:  0.10, volatility: -0.12, inflation:  0.00, liquidity: -0.08 },
  "Emerging Markets":       { equity: 1.10, rates: -0.15, credit:  0.25, fx:  0.50, commodity:  0.20, volatility: -0.20, inflation:  0.05, liquidity: -0.15 },
  "Fixed Income":           { equity: 0.05, rates: -8.00, credit:  0.30, fx:  0.00, commodity:  0.00, volatility:  0.00, inflation: -0.50, liquidity: -0.05 },
  "High Yield":             { equity: 0.40, rates: -4.00, credit: -5.00, fx:  0.00, commodity:  0.05, volatility: -0.10, inflation: -0.10, liquidity: -0.20 },
  "Real Estate":            { equity: 0.60, rates: -3.00, credit:  0.20, fx:  0.00, commodity:  0.10, volatility: -0.08, inflation:  0.30, liquidity: -0.15 },
  "Commodities":            { equity: 0.15, rates:  0.00, credit:  0.05, fx: -0.20, commodity:  1.00, volatility: -0.05, inflation:  0.60, liquidity: -0.05 },
  "Alternatives":           { equity: 0.30, rates: -1.00, credit:  0.15, fx:  0.10, commodity:  0.10, volatility: -0.05, inflation:  0.05, liquidity: -0.10 },
  "Private Equity":         { equity: 1.20, rates: -0.50, credit:  0.30, fx:  0.15, commodity:  0.05, volatility: -0.10, inflation:  0.05, liquidity: -0.30 },
  "Hedge Funds":            { equity: 0.35, rates: -0.50, credit:  0.15, fx:  0.10, commodity:  0.10, volatility:  0.05, inflation:  0.00, liquidity: -0.10 },
  "Cash":                   { equity: 0.00, rates:  0.25, credit:  0.00, fx:  0.00, commodity:  0.00, volatility:  0.00, inflation: -0.10, liquidity:  0.00 },
  "Other":                  { equity: 0.30, rates: -1.00, credit:  0.10, fx:  0.10, commodity:  0.10, volatility: -0.05, inflation:  0.00, liquidity: -0.05 },
};

export interface PortfolioHolding {
  name: string;
  assetClass: string;
  weight: number;          // decimal, e.g. 0.30 = 30%
  expectedReturn?: number; // annualized
  volatility?: number;     // annualized
  /** Optional overrides for factor betas */
  factorBetas?: Partial<AssetClassFactorBetas>;
}

export interface ScenarioShock {
  equity?: number;
  rates?: number;
  credit?: number;
  fx?: number;
  commodity?: number;
  volatility?: number;
  inflation?: number;
  liquidity?: number;
}

export interface ScenarioDefinition {
  name: string;
  description: string;
  category: "historical" | "hypothetical" | "reverse" | "monte_carlo";
  shocks: ScenarioShock;
  regime?: "expansion" | "contraction" | "crisis";
}

// ─── Preset Historical Scenarios ────────────────────────────────────────────

export const HISTORICAL_SCENARIOS: ScenarioDefinition[] = [
  {
    name: "2008 Global Financial Crisis",
    description: "Lehman collapse, credit freeze, equity crash. Peak-to-trough S&P -56.8%, credit spreads widened 600bp+, VIX >80.",
    category: "historical",
    regime: "crisis",
    shocks: { equity: -0.55, rates: -0.02, credit: 0.06, fx: -0.15, commodity: -0.40, volatility: 3.0, inflation: -0.01, liquidity: 0.50 },
  },
  {
    name: "2020 COVID-19 Crash",
    description: "Pandemic-driven selloff. S&P -34% in 23 trading days, fastest bear market in history, massive Fed intervention.",
    category: "historical",
    regime: "crisis",
    shocks: { equity: -0.35, rates: -0.015, credit: 0.035, fx: -0.08, commodity: -0.30, volatility: 2.5, inflation: -0.005, liquidity: 0.30 },
  },
  {
    name: "2022 Rate Shock / Inflation",
    description: "Fed tightening 425bp, worst bond year since 1788, equity multiple compression, 60/40 down ~17%.",
    category: "historical",
    regime: "contraction",
    shocks: { equity: -0.25, rates: 0.03, credit: 0.02, fx: 0.12, commodity: 0.15, volatility: 0.50, inflation: 0.04, liquidity: 0.10 },
  },
  {
    name: "2011 European Debt Crisis",
    description: "Greek/Italian sovereign risk, EFSF/ESM creation, peripheral spread blowout.",
    category: "historical",
    regime: "contraction",
    shocks: { equity: -0.20, rates: -0.01, credit: 0.03, fx: -0.10, commodity: -0.10, volatility: 1.0, inflation: 0.00, liquidity: 0.20 },
  },
  {
    name: "2015 China Devaluation / EM Rout",
    description: "PBoC surprise devaluation, EM currencies crash, commodity deflation scare.",
    category: "historical",
    regime: "contraction",
    shocks: { equity: -0.15, rates: -0.005, credit: 0.015, fx: -0.12, commodity: -0.25, volatility: 0.80, inflation: -0.01, liquidity: 0.15 },
  },
  {
    name: "2000 Dot-Com Bust",
    description: "Tech bubble burst. Nasdaq -78% peak-to-trough, S&P -49%, mild recession.",
    category: "historical",
    regime: "contraction",
    shocks: { equity: -0.45, rates: -0.02, credit: 0.02, fx: 0.05, commodity: -0.05, volatility: 1.5, inflation: 0.00, liquidity: 0.10 },
  },
  {
    name: "1994 Bond Massacre",
    description: "Unexpected Fed tightening, global bond selloff. 10Y UST from 5.8% to 8%.",
    category: "historical",
    regime: "contraction",
    shocks: { equity: -0.05, rates: 0.022, credit: 0.01, fx: -0.05, commodity: 0.05, volatility: 0.30, inflation: 0.01, liquidity: 0.05 },
  },
  {
    name: "1970s Stagflation",
    description: "Oil embargo, persistent inflation, equity stagnation. Gold rallied, bonds crushed.",
    category: "historical",
    regime: "crisis",
    shocks: { equity: -0.15, rates: 0.04, credit: 0.03, fx: -0.15, commodity: 0.50, volatility: 0.80, inflation: 0.06, liquidity: 0.15 },
  },
];

export const HYPOTHETICAL_SCENARIOS: ScenarioDefinition[] = [
  {
    name: "Mild Recession",
    description: "Shallow recession with modest equity decline and rate cuts. Credit spreads widen modestly.",
    category: "hypothetical",
    regime: "contraction",
    shocks: { equity: -0.20, rates: -0.01, credit: 0.015, fx: -0.05, commodity: -0.10, volatility: 0.50, inflation: -0.005, liquidity: 0.10 },
  },
  {
    name: "Stagflation",
    description: "Persistent inflation with economic stagnation. Equities and bonds both decline.",
    category: "hypothetical",
    regime: "crisis",
    shocks: { equity: -0.15, rates: 0.04, credit: 0.03, fx: -0.10, commodity: 0.20, volatility: 0.60, inflation: 0.04, liquidity: 0.15 },
  },
  {
    name: "Sudden Liquidity Crisis",
    description: "Systemic funding stress, repo market freeze, broad deleveraging across all risk assets.",
    category: "hypothetical",
    regime: "crisis",
    shocks: { equity: -0.30, rates: -0.01, credit: 0.05, fx: -0.05, commodity: -0.15, volatility: 2.0, inflation: 0.00, liquidity: 0.60 },
  },
  {
    name: "Dollar Collapse",
    description: "Loss of confidence in USD, capital flight from US assets, imported inflation.",
    category: "hypothetical",
    regime: "crisis",
    shocks: { equity: -0.10, rates: 0.02, credit: 0.02, fx: -0.30, commodity: 0.30, volatility: 1.2, inflation: 0.03, liquidity: 0.20 },
  },
  {
    name: "Tech Sector Crash",
    description: "AI bubble burst, tech-heavy indices down 40%+, rotation into value and defensives.",
    category: "hypothetical",
    regime: "contraction",
    shocks: { equity: -0.30, rates: -0.005, credit: 0.01, fx: 0.05, commodity: 0.00, volatility: 1.5, inflation: 0.00, liquidity: 0.10 },
  },
  {
    name: "Goldilocks Recovery",
    description: "Soft landing achieved, disinflation without recession, risk assets rally.",
    category: "hypothetical",
    regime: "expansion",
    shocks: { equity: 0.15, rates: -0.005, credit: -0.01, fx: 0.03, commodity: 0.05, volatility: -0.30, inflation: -0.01, liquidity: -0.10 },
  },
];

// ─── Math Utilities ─────────────────────────────────────────────────────────

/**
 * Deterministic PRNG (mulberry32) driving the Monte Carlo draws.
 *
 * Seeded from the clock, the same portfolio and scenario produced different
 * percentiles on every run, so a stress number shown to an investment
 * committee could not be reproduced afterwards. It also made the simulation
 * untestable beyond loose statistical bounds. Callers can override the seed
 * to explore sampling variation deliberately.
 */
export const DEFAULT_SIMULATION_SEED = 0x5712;

function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomNormal(random: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/** Student-t distributed random variable (for fat tails) */
function randomStudentT(degreesOfFreedom: number, random: () => number): number {
  // Use the ratio of normal / sqrt(chi-squared/df) approach
  const z = randomNormal(random);
  let chiSq = 0;
  for (let i = 0; i < degreesOfFreedom; i++) {
    const n = randomNormal(random);
    chiSq += n * n;
  }
  return z / Math.sqrt(chiSq / degreesOfFreedom);
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function variance(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return arr.reduce((sum, x) => sum + (x - m) ** 2, 0) / (arr.length - 1);
}

function stdDev(arr: number[]): number {
  return Math.sqrt(variance(arr));
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

/**
 * Cholesky decomposition of a positive-definite matrix.
 * Returns lower-triangular L such that A = L * L^T.
 * Used to generate correlated random factor shocks.
 */
function choleskyDecomposition(matrix: number[][]): number[][] {
  const n = matrix.length;
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) {
        sum += L[i][k] * L[j][k];
      }
      if (i === j) {
        const val = matrix[i][i] - sum;
        L[i][j] = Math.sqrt(Math.max(0, val));
      } else {
        L[i][j] = L[j][j] !== 0 ? (matrix[i][j] - sum) / L[j][j] : 0;
      }
    }
  }
  return L;
}

/**
 * Multiply lower-triangular matrix L by vector z to produce correlated shocks.
 */
function multiplyLz(L: number[][], z: number[]): number[] {
  const n = L.length;
  const result = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      result[i] += L[i][j] * z[j];
    }
  }
  return result;
}

// ─── Factor Model Covariance ────────────────────────────────────────────────

/**
 * Build the factor covariance matrix from correlation + volatilities.
 * Sigma_f = D * R * D  where D = diag(vols), R = correlation matrix.
 */
function buildFactorCovarianceMatrix(
  factors: FactorDefinition[],
  correlation: number[][]
): number[][] {
  const n = factors.length;
  const cov: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      cov[i][j] = factors[i].annualVol * factors[j].annualVol * correlation[i][j];
    }
  }
  return cov;
}

// ─── Core Scenario Computation ──────────────────────────────────────────────

export interface AssetImpact {
  name: string;
  assetClass: string;
  weight: number;
  impact: number;                          // total return impact
  factorContributions: Record<string, number>;  // impact by factor
  idiosyncraticImpact: number;
  marginalContribution: number;            // contribution to total portfolio impact
}

export interface ScenarioResult {
  scenarioName: string;
  scenarioCategory: string;
  scenarioDescription: string;
  regime?: string;

  // Portfolio-level results
  totalImpact: number;                     // portfolio-level P&L %
  impactAmount: number;                    // dollar amount
  portfolioValue: number;
  stressedValue: number;

  // Risk metrics under stress
  parametricVaR95: number;
  parametricVaR99: number;
  cvar95: number;                          // Expected Shortfall at 95%
  cvar99: number;
  componentVaR: Record<string, number>;    // per-factor VaR contribution

  // Factor-level decomposition
  factorImpacts: Record<string, number>;   // total impact attributable to each factor

  // Asset-level breakdown
  assetImpacts: AssetImpact[];

  // Monte Carlo results (if simulated)
  monteCarloStats?: MonteCarloScenarioStats;

  // Shocks applied
  shocksApplied: ScenarioShock;
}

export interface MonteCarloScenarioStats {
  numSimulations: number;
  meanImpact: number;
  medianImpact: number;
  stdDevImpact: number;
  percentile1: number;
  percentile5: number;
  percentile10: number;
  percentile25: number;
  percentile75: number;
  percentile90: number;
  percentile95: number;
  percentile99: number;
  skewness: number;
  kurtosis: number;
  probabilityOfLoss: number;
  probabilityOfLossGt10pct: number;
  probabilityOfLossGt20pct: number;
  simulatedReturns: number[];
  tailExpectedShortfall: number;       // mean of worst 5%
}

export interface ReverseStressResult {
  targetLoss: number;
  achievedLoss: number;
  requiredShocks: ScenarioShock;
  scenarioDescription: string;
  dominantFactor: string;
  assetImpacts: AssetImpact[];
}

export interface ScenarioComparisonResult {
  scenarios: ScenarioResult[];
  ranking: Array<{ name: string; impact: number; rank: number }>;
  worstCase: ScenarioResult;
  bestCase: ScenarioResult;
  averageImpact: number;
  impactRange: number;
}

// ─── Scenario Engine ────────────────────────────────────────────────────────

export class ScenarioEngine {
  private factors: FactorDefinition[];
  private factorCorrelation: number[][];
  private factorCovariance: number[][];
  private choleskyL: number[][];

  constructor(
    factors: FactorDefinition[] = DEFAULT_FACTORS,
    factorCorrelation: number[][] = DEFAULT_FACTOR_CORRELATION
  ) {
    this.factors = factors;
    this.factorCorrelation = factorCorrelation;
    this.factorCovariance = buildFactorCovarianceMatrix(factors, factorCorrelation);
    this.choleskyL = choleskyDecomposition(this.factorCovariance);
  }

  /**
   * Get factor betas for a given asset class, with optional overrides.
   */
  private getFactorBetas(assetClass: string, overrides?: Partial<AssetClassFactorBetas>): AssetClassFactorBetas {
    const base = ASSET_CLASS_FACTOR_BETAS[assetClass] || ASSET_CLASS_FACTOR_BETAS["Other"];
    if (!overrides) return { ...base };
    return { ...base, ...overrides };
  }

  /**
   * Compute the return impact on a single asset given factor shocks.
   *
   * r_i = sum_k (beta_{i,k} * shock_k)
   *
   * This is the core factor-model equation used by Riskfolio-Lib and similar.
   */
  private computeAssetImpact(
    holding: PortfolioHolding,
    shocks: ScenarioShock
  ): AssetImpact {
    const betas = this.getFactorBetas(holding.assetClass, holding.factorBetas);
    const factorContributions: Record<string, number> = {};
    let totalImpact = 0;

    for (const factor of this.factors) {
      const shockValue = (shocks as Record<string, number | undefined>)[factor.id] ?? 0;
      const beta = (betas as unknown as Record<string, number>)[factor.id] ?? 0;
      const contribution = beta * shockValue;
      factorContributions[factor.id] = contribution;
      totalImpact += contribution;
    }

    return {
      name: holding.name,
      assetClass: holding.assetClass,
      weight: holding.weight,
      impact: totalImpact,
      factorContributions,
      idiosyncraticImpact: 0,
      marginalContribution: totalImpact * holding.weight,
    };
  }

  /**
   * Run a deterministic scenario (single set of shocks → single result).
   */
  runScenario(
    holdings: PortfolioHolding[],
    scenario: ScenarioDefinition,
    portfolioValue: number
  ): ScenarioResult {
    const assetImpacts = holdings.map(h => this.computeAssetImpact(h, scenario.shocks));

    // Portfolio impact = weighted sum of asset impacts
    const totalImpact = assetImpacts.reduce((sum, a) => sum + a.weight * a.impact, 0);
    const impactAmount = portfolioValue * totalImpact;

    // Factor-level aggregation
    const factorImpacts: Record<string, number> = {};
    for (const factor of this.factors) {
      factorImpacts[factor.id] = assetImpacts.reduce(
        (sum, a) => sum + a.weight * (a.factorContributions[factor.id] ?? 0), 0
      );
    }

    // Component VaR (approximate: contribution of each factor to portfolio variance)
    const componentVaR = this.computeComponentVaR(holdings, scenario.shocks);

    // Parametric VaR and CVaR, both as positive loss magnitudes measured from
    // zero rather than from the scenario's own mean.
    //
    // VaR previously ignored totalImpact while CVaR added it, which made the
    // two incomparable: CVaR came out below VaR in every preset scenario,
    // impossible for a coherent risk measure, and it fell as the scenario got
    // worse because the negative impact cancelled the positive tail term
    // before Math.abs hid the crossover. Subtracting the impact instead makes
    // a worse scenario report a worse loss, and keeps CVaR >= VaR by
    // construction since phi(z)/alpha exceeds z at both confidence levels.
    const stressedVol = this.estimateStressedVolatility(holdings, scenario);
    const phi95 = 0.10314; // phi(1.645), standard normal PDF at z=1.645
    const phi99 = 0.02665; // phi(2.326)
    const parametricVaR95 = 1.645 * stressedVol - totalImpact;
    const parametricVaR99 = 2.326 * stressedVol - totalImpact;
    const cvar95 = (phi95 / 0.05) * stressedVol - totalImpact;
    const cvar99 = (phi99 / 0.01) * stressedVol - totalImpact;

    return {
      scenarioName: scenario.name,
      scenarioCategory: scenario.category,
      scenarioDescription: scenario.description,
      regime: scenario.regime,
      totalImpact,
      impactAmount,
      portfolioValue,
      stressedValue: portfolioValue * (1 + totalImpact),
      parametricVaR95,
      parametricVaR99,
      cvar95,
      cvar99,
      componentVaR,
      factorImpacts,
      assetImpacts,
      shocksApplied: scenario.shocks,
    };
  }

  /**
   * Run a Monte Carlo scenario simulation.
   *
   * Generates correlated factor shocks using Cholesky decomposition,
   * optionally with Student-t distribution for fat tails (like Riskfolio-Lib's
   * robust approach).
   *
   * Shocks are centered around the provided scenario shocks (mean shocks),
   * so this gives a distribution of outcomes around a stress scenario.
   */
  runMonteCarloScenario(
    holdings: PortfolioHolding[],
    scenario: ScenarioDefinition,
    portfolioValue: number,
    config: {
      numSimulations?: number;
      fatTails?: boolean;
      degreesOfFreedom?: number;      // for Student-t (lower = fatter tails, e.g. 5)
      horizonDays?: number;
      /** Override to explore sampling variation; fixed by default so runs reproduce. */
      seed?: number;
    } = {}
  ): ScenarioResult {
    const {
      numSimulations = 1000,
      fatTails = true,
      degreesOfFreedom = 5,
      horizonDays = 252,
      seed = DEFAULT_SIMULATION_SEED,
    } = config;

    const random = makeRandom(seed);

    const simulatedReturns: number[] = [];
    const nFactors = this.factors.length;
    const baseShocks = this.shocksToVector(scenario.shocks);

    for (let sim = 0; sim < numSimulations; sim++) {
      // Generate independent random vector
      const z = new Array(nFactors).fill(0).map(() =>
        fatTails ? randomStudentT(degreesOfFreedom, random) : randomNormal(random)
      );

      // Apply Cholesky to get correlated shocks
      const correlatedShocks = multiplyLz(this.choleskyL, z);

      // Scale by sqrt(horizon) and add base shocks
      const scaleFactor = Math.sqrt(horizonDays / 252);
      const totalShocks: number[] = correlatedShocks.map(
        (s, i) => baseShocks[i] + s * scaleFactor
      );

      // Convert back to shock object
      const shockObj = this.vectorToShocks(totalShocks);

      // Compute portfolio return for this simulation
      let portfolioReturn = 0;
      for (const holding of holdings) {
        const assetImpact = this.computeAssetImpact(holding, shockObj);
        portfolioReturn += holding.weight * assetImpact.impact;
      }

      simulatedReturns.push(portfolioReturn);
    }

    // Compute statistics
    const sorted = [...simulatedReturns].sort((a, b) => a - b);
    const meanImpact = mean(simulatedReturns);
    const stdDevImpact = stdDev(simulatedReturns);
    const m = meanImpact;
    const s = stdDevImpact;

    // Skewness & Kurtosis
    const n = simulatedReturns.length;
    let skewSum = 0, kurtSum = 0;
    for (const r of simulatedReturns) {
      skewSum += ((r - m) / s) ** 3;
      kurtSum += ((r - m) / s) ** 4;
    }
    const skewness = s > 0 ? (n / ((n - 1) * (n - 2))) * skewSum : 0;
    const kurtosis = s > 0 ? ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * kurtSum
      - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3)) : 0;

    // Tail Expected Shortfall (mean of worst 5%)
    const cutoff5 = Math.max(1, Math.floor(n * 0.05));
    const tail5 = sorted.slice(0, cutoff5);
    const tailExpectedShortfall = mean(tail5);

    const monteCarloStats: MonteCarloScenarioStats = {
      numSimulations,
      meanImpact,
      medianImpact: percentile(simulatedReturns, 50),
      stdDevImpact,
      percentile1: percentile(simulatedReturns, 1),
      percentile5: percentile(simulatedReturns, 5),
      percentile10: percentile(simulatedReturns, 10),
      percentile25: percentile(simulatedReturns, 25),
      percentile75: percentile(simulatedReturns, 75),
      percentile90: percentile(simulatedReturns, 90),
      percentile95: percentile(simulatedReturns, 95),
      percentile99: percentile(simulatedReturns, 99),
      skewness,
      kurtosis,
      probabilityOfLoss: simulatedReturns.filter(r => r < 0).length / n,
      probabilityOfLossGt10pct: simulatedReturns.filter(r => r < -0.10).length / n,
      probabilityOfLossGt20pct: simulatedReturns.filter(r => r < -0.20).length / n,
      simulatedReturns: sorted, // sorted for charting
      tailExpectedShortfall,
    };

    // Also compute the deterministic result for factor decomposition
    const deterministicResult = this.runScenario(holdings, scenario, portfolioValue);

    return {
      ...deterministicResult,
      // Override risk metrics with MC-derived values
      parametricVaR95: Math.abs(percentile(simulatedReturns, 5)),
      parametricVaR99: Math.abs(percentile(simulatedReturns, 1)),
      cvar95: Math.abs(tailExpectedShortfall),
      cvar99: Math.abs(mean(sorted.slice(0, Math.max(1, Math.floor(n * 0.01))))),
      monteCarloStats,
    };
  }

  /**
   * Reverse stress test: find the uniform shock magnitude that produces
   * a target portfolio loss.
   *
   * Uses a bisection search over shock magnitudes applied proportionally
   * to a direction vector (defaults to the worst historical scenario direction).
   */
  reverseStressTest(
    holdings: PortfolioHolding[],
    targetLoss: number, // e.g. -0.25 for 25% loss
    portfolioValue: number,
    direction?: ScenarioShock,
    maxIterations: number = 50
  ): ReverseStressResult {
    // Default direction: crisis scenario profile
    const dir = direction || { equity: -1.0, rates: -0.02, credit: 0.06, fx: -0.15, commodity: -0.40, volatility: 2.0, inflation: 0.00, liquidity: 0.50 };
    const dirVector = this.shocksToVector(dir);
    const dirNorm = Math.sqrt(dirVector.reduce((s, v) => s + v * v, 0));
    const normalizedDir = dirVector.map(v => v / (dirNorm || 1));

    let low = 0;
    let high = 5.0; // maximum multiplier
    let bestMultiplier = 1.0;
    let bestLoss = 0;

    for (let iter = 0; iter < maxIterations; iter++) {
      const mid = (low + high) / 2;
      const scaledShocks = normalizedDir.map(v => v * mid);
      const shockObj = this.vectorToShocks(scaledShocks);

      let portfolioReturn = 0;
      for (const holding of holdings) {
        const assetImpact = this.computeAssetImpact(holding, shockObj);
        portfolioReturn += holding.weight * assetImpact.impact;
      }

      if (portfolioReturn > targetLoss) {
        low = mid;
      } else {
        high = mid;
      }

      bestMultiplier = mid;
      bestLoss = portfolioReturn;

      if (Math.abs(portfolioReturn - targetLoss) < 0.0001) break;
    }

    const finalShocksVector = normalizedDir.map(v => v * bestMultiplier);
    const finalShocks = this.vectorToShocks(finalShocksVector);

    const assetImpacts = holdings.map(h => this.computeAssetImpact(h, finalShocks));

    // Find dominant factor
    const factorTotals: Record<string, number> = {};
    for (const factor of this.factors) {
      factorTotals[factor.id] = assetImpacts.reduce(
        (sum, a) => sum + a.weight * Math.abs(a.factorContributions[factor.id] ?? 0), 0
      );
    }
    const dominantFactor = Object.entries(factorTotals).sort((a, b) => b[1] - a[1])[0]?.[0] || "equity";

    return {
      targetLoss,
      achievedLoss: bestLoss,
      requiredShocks: finalShocks,
      scenarioDescription: `Reverse stress test to achieve ${(targetLoss * 100).toFixed(1)}% loss. Dominant risk factor: ${dominantFactor}.`,
      dominantFactor,
      assetImpacts,
    };
  }

  /**
   * Compare multiple scenarios side-by-side.
   */
  compareScenarios(
    holdings: PortfolioHolding[],
    scenarios: ScenarioDefinition[],
    portfolioValue: number
  ): ScenarioComparisonResult {
    const results = scenarios.map(s => this.runScenario(holdings, s, portfolioValue));

    const ranking = results
      .map(r => ({ name: r.scenarioName, impact: r.totalImpact, rank: 0 }))
      .sort((a, b) => a.impact - b.impact)
      .map((item, idx) => ({ ...item, rank: idx + 1 }));

    const worstCase = results.reduce((w, r) => r.totalImpact < w.totalImpact ? r : w, results[0]);
    const bestCase = results.reduce((b, r) => r.totalImpact > b.totalImpact ? r : b, results[0]);
    const averageImpact = mean(results.map(r => r.totalImpact));
    const impactRange = bestCase.totalImpact - worstCase.totalImpact;

    return { scenarios: results, ranking, worstCase, bestCase, averageImpact, impactRange };
  }

  /**
   * Run all preset scenarios (historical + hypothetical) for a portfolio.
   */
  runAllPresets(
    holdings: PortfolioHolding[],
    portfolioValue: number
  ): ScenarioComparisonResult {
    return this.compareScenarios(
      holdings,
      [...HISTORICAL_SCENARIOS, ...HYPOTHETICAL_SCENARIOS],
      portfolioValue
    );
  }

  // ─── Internal Helpers ───────────────────────────────────────────────────

  /**
   * Estimate portfolio volatility under a stressed regime.
   * Uses factor model: sigma_p^2 = w^T B Sigma_f B^T w + w^T D_eps w
   */
  private estimateStressedVolatility(
    holdings: PortfolioHolding[],
    scenario: ScenarioDefinition
  ): number {
    // Stress multiplier for volatility based on regime
    const regimeMultiplier = scenario.regime === "crisis" ? 2.0
      : scenario.regime === "contraction" ? 1.5
      : 1.0;

    // Weighted average of asset volatilities with factor model
    let portfolioVar = 0;
    for (let i = 0; i < holdings.length; i++) {
      for (let j = 0; j < holdings.length; j++) {
        const betasI = this.getFactorBetas(holdings[i].assetClass, holdings[i].factorBetas);
        const betasJ = this.getFactorBetas(holdings[j].assetClass, holdings[j].factorBetas);

        let factorCov = 0;
        for (let fi = 0; fi < this.factors.length; fi++) {
          for (let fj = 0; fj < this.factors.length; fj++) {
            const betaI = (betasI as unknown as Record<string, number>)[this.factors[fi].id] ?? 0;
            const betaJ = (betasJ as unknown as Record<string, number>)[this.factors[fj].id] ?? 0;
            factorCov += betaI * betaJ * this.factorCovariance[fi][fj];
          }
        }
        portfolioVar += holdings[i].weight * holdings[j].weight * factorCov;
      }
    }

    return Math.sqrt(Math.max(0, portfolioVar)) * regimeMultiplier;
  }

  /**
   * Compute component VaR contribution by factor (Euler decomposition).
   * Component VaR_k = w * beta_k * Sigma_f[k,:] * B^T * w / sigma_p
   */
  private computeComponentVaR(
    holdings: PortfolioHolding[],
    shocks: ScenarioShock
  ): Record<string, number> {
    const componentVaR: Record<string, number> = {};
    const totalImpact = holdings.reduce((sum, h) => {
      const ai = this.computeAssetImpact(h, shocks);
      return sum + h.weight * ai.impact;
    }, 0);

    for (const factor of this.factors) {
      let factorContribution = 0;
      for (const holding of holdings) {
        const betas = this.getFactorBetas(holding.assetClass, holding.factorBetas);
        const beta = (betas as unknown as Record<string, number>)[factor.id] ?? 0;
        const shockValue = (shocks as Record<string, number | undefined>)[factor.id] ?? 0;
        factorContribution += holding.weight * beta * shockValue;
      }
      componentVaR[factor.id] = factorContribution;
    }

    return componentVaR;
  }

  private shocksToVector(shocks: ScenarioShock): number[] {
    return this.factors.map(f => (shocks as Record<string, number | undefined>)[f.id] ?? 0);
  }

  private vectorToShocks(vec: number[]): ScenarioShock {
    const shocks: Record<string, number> = {};
    this.factors.forEach((f, i) => {
      shocks[f.id] = vec[i] ?? 0;
    });
    return shocks as ScenarioShock;
  }
}

// ─── Helper: Convert DB holdings to engine format ───────────────────────────

export function holdingsToPortfolioHoldings(
  items: Array<{
    name?: string;
    fundName?: string;
    assetClass: string;
    weight?: string;
    allocation?: string;
    expectedReturn?: string | null;
    volatility?: string | null;
  }>
): PortfolioHolding[] {
  const totalWeight = items.reduce((sum, item) => {
    const w = parseFloat(item.weight || item.allocation || "0");
    return sum + w;
  }, 0);

  return items.map(item => {
    const rawWeight = parseFloat(item.weight || item.allocation || "0");
    return {
      name: item.name || item.fundName || "Unknown",
      assetClass: normalizeAssetClass(item.assetClass),
      weight: totalWeight > 0 ? rawWeight / totalWeight : 0,
      expectedReturn: item.expectedReturn ? parseFloat(item.expectedReturn) : undefined,
      volatility: item.volatility ? parseFloat(item.volatility) : undefined,
    };
  });
}

function normalizeAssetClass(assetClass: string): string {
  // Match on the singular stem. Every branch below tests for "equity" and
  // "stock", so a book labelled "US Equities" or "Global Equities" — the more
  // common institutional spelling — fell through to "Other" and was stressed
  // with an equity beta of 0.30 instead of 1.00, understating an equity shock
  // by roughly seventy percent.
  const lower = (assetClass || "")
    .toLowerCase()
    .replace(/equities/g, "equity")
    .replace(/stocks/g, "stock");
  if (lower.includes("us equity") || lower.includes("us stock") || lower.includes("domestic equity")) return "US Equity";
  if (lower.includes("international") || lower.includes("intl") || lower.includes("developed")) return "International Equity";
  if (lower.includes("emerging") || lower.includes("em ")) return "Emerging Markets";
  if (lower.includes("high yield") || lower.includes("high-yield") || lower.includes("hy ")) return "High Yield";
  if (lower.includes("fixed") || lower.includes("bond") || lower.includes("treasury") || lower.includes("aggregate")) return "Fixed Income";
  if (lower.includes("real estate") || lower.includes("reit")) return "Real Estate";
  if (lower.includes("commodit") || lower.includes("gold") || lower.includes("oil")) return "Commodities";
  if (lower.includes("private equity") || lower.includes("pe ") || lower.includes("venture")) return "Private Equity";
  if (lower.includes("hedge") || lower.includes("long/short") || lower.includes("long-short")) return "Hedge Funds";
  if (lower.includes("cash") || lower.includes("money market")) return "Cash";
  if (lower.includes("equity") || lower.includes("stock")) return "US Equity";
  if (lower.includes("credit")) return "High Yield";
  if (lower.includes("alternative")) return "Alternatives";
  return "Other";
}
