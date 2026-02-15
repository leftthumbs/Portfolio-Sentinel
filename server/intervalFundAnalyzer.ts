import type { IntervalFund } from "@shared/schema";

// --- Interfaces ---

export interface IntervalFundAnalysisInput {
  fund: IntervalFund;
  riskFreeRate: number;
  peerFunds?: IntervalFund[];
}

export interface LiquidityAnalysis {
  repurchaseFrequency: string;
  repurchaseRate: number;
  annualLiquidityAccess: number;
  repurchaseNotice: number;
  liquidityScore: number; // 1-10
  liquidityRating: string;
}

export interface FeeAnalysis {
  managementFee: number;
  performanceFee: number;
  expenseRatio: number;
  totalCostEstimate: number;
  feeScore: number; // 1-10
  feeRating: string;
  netReturnAfterFees: number;
}

export interface YieldAnalysis {
  distributionRate: number;
  distributionFrequency: string;
  nav1yrReturn: number;
  yieldVsRiskFree: number;
  yieldSpread: number;
  incomeScore: number; // 1-10
  incomeRating: string;
}

export interface RiskAnalysisResult {
  volatility: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  beta: number;
  alpha: number;
  riskScore: number; // 1-10
  riskRating: string;
}

export interface PortfolioFitAnalysis {
  concentrationRisk: number;
  diversificationBenefit: string;
  correlationAssessment: string;
  suitabilityScore: number; // 1-10
  suitabilityRating: string;
}

export interface PeerComparison {
  fundName: string;
  returnRank: number;
  riskRank: number;
  feeRank: number;
  liquidityRank: number;
  overallRank: number;
  totalPeers: number;
}

export interface IntervalFundAnalysisOutput {
  fundId: string;
  fundName: string;
  overallScore: number; // 1-100
  overallRating: string;
  liquidity: LiquidityAnalysis;
  fees: FeeAnalysis;
  yield: YieldAnalysis;
  risk: RiskAnalysisResult;
  portfolioFit: PortfolioFitAnalysis;
  peerComparison: PeerComparison | null;
  strengths: string[];
  risks: string[];
  recommendation: string;
}

// --- Helpers ---

function safeNum(val: string | number | null | undefined, fallback = 0): number {
  if (val === null || val === undefined) return fallback;
  const n = typeof val === "string" ? parseFloat(val) : val;
  return isNaN(n) ? fallback : n;
}

function ratingFromScore(score: number): string {
  if (score >= 9) return "Excellent";
  if (score >= 7) return "Good";
  if (score >= 5) return "Average";
  if (score >= 3) return "Below Average";
  return "Poor";
}

function overallRating(score: number): string {
  if (score >= 80) return "Strong Buy";
  if (score >= 65) return "Buy";
  if (score >= 50) return "Hold";
  if (score >= 35) return "Underweight";
  return "Avoid";
}

function repurchaseMultiplier(freq: string): number {
  const lower = freq.toLowerCase();
  if (lower.includes("monthly")) return 12;
  if (lower.includes("quarterly")) return 4;
  if (lower.includes("semi")) return 2;
  if (lower.includes("annual")) return 1;
  return 4; // default quarterly
}

// --- Core Analyzers ---

function analyzeLiquidity(fund: IntervalFund): LiquidityAnalysis {
  const freq = fund.repurchaseFrequency || "Quarterly";
  const rate = safeNum(fund.repurchaseRate, 0.05);
  const notice = fund.repurchaseNotice || 30;
  const multiplier = repurchaseMultiplier(freq);
  const annualAccess = Math.min(rate * multiplier, 1);

  // Score: higher access = better, shorter notice = better, more frequent = better
  let score = 0;
  // Annual access contribution (0-4 points)
  score += Math.min(annualAccess * 8, 4);
  // Frequency contribution (0-3 points)
  score += multiplier >= 12 ? 3 : multiplier >= 4 ? 2 : multiplier >= 2 ? 1 : 0.5;
  // Notice period contribution (0-3 points)
  score += notice <= 15 ? 3 : notice <= 30 ? 2.5 : notice <= 60 ? 1.5 : notice <= 90 ? 1 : 0.5;

  score = Math.min(Math.max(Math.round(score * 10) / 10, 1), 10);

  return {
    repurchaseFrequency: freq,
    repurchaseRate: rate,
    annualLiquidityAccess: annualAccess,
    repurchaseNotice: notice,
    liquidityScore: score,
    liquidityRating: ratingFromScore(score),
  };
}

function analyzeFees(fund: IntervalFund, riskFreeRate: number): FeeAnalysis {
  const mgmtFee = safeNum(fund.managementFee, 0);
  const perfFee = safeNum(fund.performanceFee, 0);
  const expenseRatio = safeNum(fund.expenseRatio, mgmtFee);
  const expectedReturn = safeNum(fund.nav1yrReturn, safeNum(fund.distributionRate, 0));

  // Estimate total cost: expense ratio + performance fee on excess return
  const excessReturn = Math.max(expectedReturn - riskFreeRate, 0);
  const totalCost = expenseRatio + perfFee * excessReturn;
  const netReturn = expectedReturn - totalCost;

  // Score: lower fees = better
  let score = 10;
  // Expense ratio penalty
  if (expenseRatio > 0.03) score -= 3;
  else if (expenseRatio > 0.02) score -= 2;
  else if (expenseRatio > 0.015) score -= 1;
  else if (expenseRatio > 0.01) score -= 0.5;
  // Performance fee penalty
  if (perfFee > 0.20) score -= 2;
  else if (perfFee > 0.15) score -= 1.5;
  else if (perfFee > 0.10) score -= 1;
  else if (perfFee > 0) score -= 0.5;
  // Total cost penalty
  if (totalCost > 0.04) score -= 2;
  else if (totalCost > 0.03) score -= 1;

  score = Math.min(Math.max(Math.round(score * 10) / 10, 1), 10);

  return {
    managementFee: mgmtFee,
    performanceFee: perfFee,
    expenseRatio,
    totalCostEstimate: totalCost,
    feeScore: score,
    feeRating: ratingFromScore(score),
    netReturnAfterFees: netReturn,
  };
}

function analyzeYield(fund: IntervalFund, riskFreeRate: number): YieldAnalysis {
  const distRate = safeNum(fund.distributionRate, 0);
  const distFreq = fund.distributionFrequency || "Monthly";
  const nav1yr = safeNum(fund.nav1yrReturn, 0);
  const yieldVsRf = distRate - riskFreeRate;
  const spread = distRate > 0 ? yieldVsRf : 0;

  let score = 0;
  // Distribution rate (0-4 points)
  if (distRate >= 0.10) score += 4;
  else if (distRate >= 0.07) score += 3;
  else if (distRate >= 0.05) score += 2;
  else if (distRate >= 0.03) score += 1;
  // Return contribution (0-3 points)
  if (nav1yr >= 0.12) score += 3;
  else if (nav1yr >= 0.08) score += 2;
  else if (nav1yr >= 0.05) score += 1.5;
  else if (nav1yr >= 0.02) score += 1;
  // Yield spread over risk-free (0-3 points)
  if (yieldVsRf >= 0.06) score += 3;
  else if (yieldVsRf >= 0.04) score += 2;
  else if (yieldVsRf >= 0.02) score += 1.5;
  else if (yieldVsRf > 0) score += 1;

  score = Math.min(Math.max(Math.round(score * 10) / 10, 1), 10);

  return {
    distributionRate: distRate,
    distributionFrequency: distFreq,
    nav1yrReturn: nav1yr,
    yieldVsRiskFree: yieldVsRf,
    yieldSpread: spread,
    incomeScore: score,
    incomeRating: ratingFromScore(score),
  };
}

function analyzeRisk(fund: IntervalFund): RiskAnalysisResult {
  const vol = safeNum(fund.volatility, 0);
  const sharpe = safeNum(fund.sharpeRatio, 0);
  const sortino = safeNum(fund.sortinoRatio, 0);
  const maxDD = safeNum(fund.maxDrawdown, 0);
  const beta = safeNum(fund.beta, 0);
  const alpha = safeNum(fund.alpha, 0);

  let score = 5; // neutral starting point
  // Sharpe ratio contribution
  if (sharpe >= 2.0) score += 2;
  else if (sharpe >= 1.5) score += 1.5;
  else if (sharpe >= 1.0) score += 1;
  else if (sharpe >= 0.5) score += 0.5;
  else if (sharpe < 0) score -= 1;
  // Max drawdown contribution
  if (Math.abs(maxDD) <= 0.03) score += 1.5;
  else if (Math.abs(maxDD) <= 0.06) score += 1;
  else if (Math.abs(maxDD) <= 0.10) score += 0.5;
  else if (Math.abs(maxDD) > 0.20) score -= 1;
  // Alpha contribution
  if (alpha >= 0.05) score += 1;
  else if (alpha >= 0.02) score += 0.5;
  else if (alpha < -0.02) score -= 1;
  // Low beta bonus (alternatives should have low correlation)
  if (beta <= 0.2) score += 0.5;
  else if (beta >= 0.8) score -= 0.5;

  score = Math.min(Math.max(Math.round(score * 10) / 10, 1), 10);

  return {
    volatility: vol,
    sharpeRatio: sharpe,
    sortinoRatio: sortino,
    maxDrawdown: maxDD,
    beta,
    alpha,
    riskScore: score,
    riskRating: ratingFromScore(score),
  };
}

function analyzePortfolioFit(fund: IntervalFund): PortfolioFitAnalysis {
  const topHoldings = safeNum(fund.topHoldingsPct, 0);
  const numHoldings = fund.numHoldings || 0;
  const corr = safeNum(fund.correlation, 0);
  const beta = safeNum(fund.beta, 0);
  const leverage = safeNum(fund.leverageRatio, 1);

  const concentrationRisk = topHoldings > 0.5 ? 0.8 : topHoldings > 0.3 ? 0.5 : 0.2;

  let diversBenefit: string;
  if (corr <= 0.2) diversBenefit = "Strong diversifier - low correlation to traditional markets";
  else if (corr <= 0.4) diversBenefit = "Good diversifier - moderate correlation";
  else if (corr <= 0.6) diversBenefit = "Moderate diversifier";
  else diversBenefit = "Limited diversification benefit - high correlation";

  let corrAssessment: string;
  if (beta <= 0.3 && corr <= 0.3) corrAssessment = "Excellent - near-independent returns";
  else if (beta <= 0.5 && corr <= 0.5) corrAssessment = "Good - partially independent";
  else corrAssessment = "Moderate - returns are partially market-driven";

  let score = 5;
  // Diversification (0-3)
  if (corr <= 0.2) score += 2.5;
  else if (corr <= 0.4) score += 1.5;
  else if (corr <= 0.6) score += 0.5;
  else score -= 1;
  // Concentration (0-2)
  if (numHoldings > 100) score += 1.5;
  else if (numHoldings > 50) score += 1;
  else if (numHoldings > 20) score += 0.5;
  else if (numHoldings > 0 && numHoldings < 10) score -= 0.5;
  // Leverage risk
  if (leverage > 2.0) score -= 1.5;
  else if (leverage > 1.5) score -= 0.5;

  score = Math.min(Math.max(Math.round(score * 10) / 10, 1), 10);

  return {
    concentrationRisk,
    diversificationBenefit: diversBenefit,
    correlationAssessment: corrAssessment,
    suitabilityScore: score,
    suitabilityRating: ratingFromScore(score),
  };
}

function compareToPeers(fund: IntervalFund, peers: IntervalFund[]): PeerComparison | null {
  if (peers.length < 2) return null;

  const allFunds = peers;
  const total = allFunds.length;

  // Rank by 1yr return (higher is better)
  const byReturn = [...allFunds].sort(
    (a, b) => safeNum(b.nav1yrReturn) - safeNum(a.nav1yrReturn)
  );
  const returnRank = byReturn.findIndex((f) => f.id === fund.id) + 1;

  // Rank by sharpe (higher is better)
  const byRisk = [...allFunds].sort(
    (a, b) => safeNum(b.sharpeRatio) - safeNum(a.sharpeRatio)
  );
  const riskRank = byRisk.findIndex((f) => f.id === fund.id) + 1;

  // Rank by expense ratio (lower is better)
  const byFee = [...allFunds].sort(
    (a, b) => safeNum(a.expenseRatio || a.managementFee) - safeNum(b.expenseRatio || b.managementFee)
  );
  const feeRank = byFee.findIndex((f) => f.id === fund.id) + 1;

  // Rank by annual liquidity (higher is better)
  const byLiq = [...allFunds].sort((a, b) => {
    const aLiq = safeNum(a.repurchaseRate) * repurchaseMultiplier(a.repurchaseFrequency || "Quarterly");
    const bLiq = safeNum(b.repurchaseRate) * repurchaseMultiplier(b.repurchaseFrequency || "Quarterly");
    return bLiq - aLiq;
  });
  const liqRank = byLiq.findIndex((f) => f.id === fund.id) + 1;

  const overallRank = Math.round((returnRank + riskRank + feeRank + liqRank) / 4);

  return {
    fundName: fund.name,
    returnRank: returnRank || total,
    riskRank: riskRank || total,
    feeRank: feeRank || total,
    liquidityRank: liqRank || total,
    overallRank: overallRank || total,
    totalPeers: total,
  };
}

function identifyStrengths(
  liquidity: LiquidityAnalysis,
  fees: FeeAnalysis,
  yieldAnalysis: YieldAnalysis,
  risk: RiskAnalysisResult,
  portfolioFit: PortfolioFitAnalysis
): string[] {
  const strengths: string[] = [];
  if (liquidity.liquidityScore >= 7) strengths.push("Strong liquidity profile with frequent repurchase opportunities");
  if (fees.feeScore >= 7) strengths.push("Competitive fee structure relative to asset class");
  if (yieldAnalysis.incomeScore >= 7) strengths.push("Attractive distribution yield and income generation");
  if (risk.riskScore >= 7) strengths.push("Favorable risk-adjusted returns");
  if (risk.alpha > 0.03) strengths.push("Positive alpha generation demonstrating manager skill");
  if (risk.beta <= 0.3) strengths.push("Low market beta provides portfolio protection");
  if (portfolioFit.suitabilityScore >= 7) strengths.push("Excellent diversification benefit for portfolio construction");
  if (yieldAnalysis.yieldSpread > 0.04) strengths.push("Significant yield premium over risk-free rate");
  return strengths;
}

function identifyRisks(
  liquidity: LiquidityAnalysis,
  fees: FeeAnalysis,
  yieldAnalysis: YieldAnalysis,
  risk: RiskAnalysisResult,
  portfolioFit: PortfolioFitAnalysis,
  fund: IntervalFund
): string[] {
  const risks: string[] = [];
  if (liquidity.liquidityScore <= 4) risks.push("Limited liquidity - capital may be locked for extended periods");
  if (liquidity.repurchaseNotice > 60) risks.push("Long repurchase notice period requires advance planning");
  if (fees.feeScore <= 4) risks.push("High fee burden may erode returns over time");
  if (fees.totalCostEstimate > 0.03) risks.push("Total estimated costs exceed 3% annually");
  if (risk.riskScore <= 4) risks.push("Elevated risk profile relative to peers");
  if (Math.abs(risk.maxDrawdown) > 0.15) risks.push("Significant historical drawdown indicates tail risk");
  if (portfolioFit.concentrationRisk > 0.6) risks.push("High concentration risk in top holdings");
  if (safeNum(fund.leverageRatio) > 1.5) risks.push("Elevated leverage increases downside exposure");
  if (yieldAnalysis.distributionRate > 0.12) risks.push("Very high distribution rate may indicate return of capital");
  if (risk.alpha < 0) risks.push("Negative alpha suggests underperformance vs benchmark");
  return risks;
}

function generateRecommendation(overallScore: number, strengths: string[], risks: string[]): string {
  const rating = overallRating(overallScore);

  if (overallScore >= 80) {
    return `${rating}: This interval fund demonstrates strong risk-adjusted returns, competitive fees, and adequate liquidity. ${strengths.length > 0 ? "Key advantages include " + strengths[0].toLowerCase() + "." : ""} Suitable for investors with appropriate liquidity tolerance.`;
  }
  if (overallScore >= 65) {
    return `${rating}: This interval fund offers a solid value proposition with ${strengths.length} notable strengths. ${risks.length > 0 ? "Primary consideration: " + risks[0].toLowerCase() + "." : ""} Appropriate for portfolio diversification within alternatives allocation.`;
  }
  if (overallScore >= 50) {
    return `${rating}: This interval fund presents a mixed profile. While it has merits, ${risks.length > 0 ? "investors should weigh " + risks[0].toLowerCase() : "several factors warrant caution"}. Consider comparing with peer alternatives before committing.`;
  }
  if (overallScore >= 35) {
    return `${rating}: This interval fund has notable concerns that outweigh its strengths. ${risks.length > 0 ? risks[0] + "." : ""} Investors should exercise caution and explore peer alternatives.`;
  }
  return `${rating}: This interval fund raises significant concerns across multiple dimensions. Not recommended for most investors without specific justification.`;
}

// --- Main Export ---

export function analyzeIntervalFund(input: IntervalFundAnalysisInput): IntervalFundAnalysisOutput {
  const { fund, riskFreeRate, peerFunds } = input;

  const liquidity = analyzeLiquidity(fund);
  const fees = analyzeFees(fund, riskFreeRate);
  const yieldResult = analyzeYield(fund, riskFreeRate);
  const risk = analyzeRisk(fund);
  const portfolioFit = analyzePortfolioFit(fund);

  // Weighted composite score (out of 100)
  const overallScore = Math.round(
    liquidity.liquidityScore * 1.5 + // 15% weight
    fees.feeScore * 2 +             // 20% weight
    yieldResult.incomeScore * 2.5 + // 25% weight
    risk.riskScore * 2.5 +          // 25% weight
    portfolioFit.suitabilityScore * 1.5 // 15% weight
  );

  const strengths = identifyStrengths(liquidity, fees, yieldResult, risk, portfolioFit);
  const risksList = identifyRisks(liquidity, fees, yieldResult, risk, portfolioFit, fund);
  const peerComparison = peerFunds && peerFunds.length >= 2 ? compareToPeers(fund, peerFunds) : null;
  const recommendation = generateRecommendation(overallScore, strengths, risksList);

  return {
    fundId: fund.id,
    fundName: fund.name,
    overallScore,
    overallRating: overallRating(overallScore),
    liquidity,
    fees,
    yield: yieldResult,
    risk,
    portfolioFit,
    peerComparison,
    strengths,
    risks: risksList,
    recommendation,
  };
}

export function compareIntervalFunds(funds: IntervalFund[], riskFreeRate: number): IntervalFundAnalysisOutput[] {
  return funds.map((fund) =>
    analyzeIntervalFund({ fund, riskFreeRate, peerFunds: funds })
  );
}
