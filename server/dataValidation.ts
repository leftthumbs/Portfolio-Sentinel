import type { IntervalFund } from "@shared/schema";

// --- Interfaces ---

export interface DataSource {
  name: string;
  priority: number; // lower = higher priority
  lastUpdated: string;
}

export interface FieldValidation {
  field: string;
  value: string | number | null;
  source: string;
  isValid: boolean;
  issue?: string;
}

export interface ReconciliationResult {
  fundId: string;
  fundName: string;
  status: "clean" | "warning" | "conflict";
  validationScore: number; // 0-100
  fieldValidations: FieldValidation[];
  crossFieldChecks: CrossFieldCheck[];
  recommendations: string[];
}

export interface CrossFieldCheck {
  name: string;
  passed: boolean;
  detail: string;
  severity: "info" | "warning" | "error";
}

export interface DataQualityReport {
  totalFunds: number;
  cleanFunds: number;
  warningFunds: number;
  conflictFunds: number;
  overallScore: number;
  commonIssues: { issue: string; count: number }[];
  fundResults: ReconciliationResult[];
}

// --- Helpers ---

function safeNum(val: string | number | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  const n = typeof val === "string" ? parseFloat(val) : val;
  return isNaN(n) ? null : n;
}

// --- Validation Rules ---

function validateNavPerShare(fund: IntervalFund): FieldValidation {
  const val = safeNum(fund.navPerShare);
  if (val === null) return { field: "navPerShare", value: null, source: "primary", isValid: false, issue: "NAV per share is missing" };
  if (val <= 0) return { field: "navPerShare", value: val, source: "primary", isValid: false, issue: "NAV per share must be positive" };
  if (val > 10000) return { field: "navPerShare", value: val, source: "primary", isValid: false, issue: "NAV per share appears unreasonably high" };
  return { field: "navPerShare", value: val, source: "primary", isValid: true };
}

function validateAum(fund: IntervalFund): FieldValidation {
  const val = safeNum(fund.totalAum);
  if (val === null) return { field: "totalAum", value: null, source: "primary", isValid: false, issue: "Total AUM is missing" };
  if (val <= 0) return { field: "totalAum", value: val, source: "primary", isValid: false, issue: "AUM must be positive" };
  if (val < 1000000) return { field: "totalAum", value: val, source: "primary", isValid: false, issue: "AUM appears too low for an interval fund (< $1M)" };
  return { field: "totalAum", value: val, source: "primary", isValid: true };
}

function validateExpenseRatio(fund: IntervalFund): FieldValidation {
  const val = safeNum(fund.expenseRatio);
  if (val === null) return { field: "expenseRatio", value: null, source: "primary", isValid: false, issue: "Expense ratio is missing" };
  if (val < 0) return { field: "expenseRatio", value: val, source: "primary", isValid: false, issue: "Expense ratio cannot be negative" };
  if (val > 0.10) return { field: "expenseRatio", value: val, source: "primary", isValid: false, issue: "Expense ratio exceeds 10% - verify data" };
  if (val > 0.05) return { field: "expenseRatio", value: val, source: "primary", isValid: true, issue: "Expense ratio is above typical range (>5%)" };
  return { field: "expenseRatio", value: val, source: "primary", isValid: true };
}

function validateDistributionRate(fund: IntervalFund): FieldValidation {
  const val = safeNum(fund.distributionRate);
  if (val === null) return { field: "distributionRate", value: null, source: "primary", isValid: false, issue: "Distribution rate is missing" };
  if (val < 0) return { field: "distributionRate", value: val, source: "primary", isValid: false, issue: "Distribution rate cannot be negative" };
  if (val > 0.25) return { field: "distributionRate", value: val, source: "primary", isValid: false, issue: "Distribution rate exceeds 25% - likely data error" };
  if (val > 0.15) return { field: "distributionRate", value: val, source: "primary", isValid: true, issue: "Unusually high distribution rate (>15%) may include return of capital" };
  return { field: "distributionRate", value: val, source: "primary", isValid: true };
}

function validateReturns(fund: IntervalFund): FieldValidation[] {
  const results: FieldValidation[] = [];
  const pairs: [string, string | null | undefined][] = [
    ["nav30dReturn", fund.nav30dReturn],
    ["nav90dReturn", fund.nav90dReturn],
    ["navYtdReturn", fund.navYtdReturn],
    ["nav1yrReturn", fund.nav1yrReturn],
    ["nav3yrReturn", fund.nav3yrReturn],
    ["nav5yrReturn", fund.nav5yrReturn],
  ];
  for (const [field, raw] of pairs) {
    const val = safeNum(raw);
    if (val === null) {
      results.push({ field, value: null, source: "primary", isValid: true }); // optional
      continue;
    }
    if (val < -1 || val > 5) {
      results.push({ field, value: val, source: "primary", isValid: false, issue: `${field} value of ${(val * 100).toFixed(1)}% is outside plausible range` });
    } else {
      results.push({ field, value: val, source: "primary", isValid: true });
    }
  }
  return results;
}

function validateRiskMetrics(fund: IntervalFund): FieldValidation[] {
  const results: FieldValidation[] = [];
  const sharpe = safeNum(fund.sharpeRatio);
  if (sharpe !== null) {
    if (sharpe < -5 || sharpe > 10) {
      results.push({ field: "sharpeRatio", value: sharpe, source: "primary", isValid: false, issue: "Sharpe ratio outside plausible range (-5 to 10)" });
    } else {
      results.push({ field: "sharpeRatio", value: sharpe, source: "primary", isValid: true });
    }
  }
  const vol = safeNum(fund.volatility);
  if (vol !== null) {
    if (vol < 0) results.push({ field: "volatility", value: vol, source: "primary", isValid: false, issue: "Volatility cannot be negative" });
    else if (vol > 1) results.push({ field: "volatility", value: vol, source: "primary", isValid: false, issue: "Volatility >100% is unusual - verify data" });
    else results.push({ field: "volatility", value: vol, source: "primary", isValid: true });
  }
  const maxDD = safeNum(fund.maxDrawdown);
  if (maxDD !== null) {
    if (maxDD > 0) results.push({ field: "maxDrawdown", value: maxDD, source: "primary", isValid: false, issue: "Max drawdown should be negative or zero" });
    else if (maxDD < -1) results.push({ field: "maxDrawdown", value: maxDD, source: "primary", isValid: false, issue: "Max drawdown <-100% is invalid" });
    else results.push({ field: "maxDrawdown", value: maxDD, source: "primary", isValid: true });
  }
  return results;
}

function validateRepurchaseTerms(fund: IntervalFund): FieldValidation[] {
  const results: FieldValidation[] = [];
  const rate = safeNum(fund.repurchaseRate);
  if (rate !== null) {
    if (rate < 0.05 || rate > 1) {
      results.push({ field: "repurchaseRate", value: rate, source: "primary", isValid: false, issue: "Repurchase rate outside SEC-required minimum of 5%" });
    } else {
      results.push({ field: "repurchaseRate", value: rate, source: "primary", isValid: true });
    }
  }
  return results;
}

// --- Cross-field Checks ---

function crossFieldChecks(fund: IntervalFund): CrossFieldCheck[] {
  const checks: CrossFieldCheck[] = [];

  // 1. Distribution rate vs 1yr return consistency
  const distRate = safeNum(fund.distributionRate);
  const nav1yr = safeNum(fund.nav1yrReturn);
  if (distRate !== null && nav1yr !== null) {
    if (distRate > nav1yr * 2) {
      checks.push({ name: "Distribution vs Return", passed: false, detail: `Distribution rate (${(distRate * 100).toFixed(1)}%) is more than 2x the 1-year return (${(nav1yr * 100).toFixed(1)}%), suggesting possible return of capital`, severity: "warning" });
    } else {
      checks.push({ name: "Distribution vs Return", passed: true, detail: "Distribution rate is consistent with fund returns", severity: "info" });
    }
  }

  // 2. Fee reasonableness
  const mgmt = safeNum(fund.managementFee);
  const perf = safeNum(fund.performanceFee);
  const expense = safeNum(fund.expenseRatio);
  if (mgmt !== null && expense !== null && mgmt > expense) {
    checks.push({ name: "Fee Consistency", passed: false, detail: "Management fee exceeds total expense ratio - data inconsistency", severity: "error" });
  } else {
    checks.push({ name: "Fee Consistency", passed: true, detail: "Fee structure is internally consistent", severity: "info" });
  }

  // 3. Leverage vs volatility check
  const leverage = safeNum(fund.leverageRatio);
  const vol = safeNum(fund.volatility);
  if (leverage !== null && vol !== null && leverage > 2 && vol < 0.03) {
    checks.push({ name: "Leverage vs Volatility", passed: false, detail: "High leverage with very low volatility is unusual - verify data", severity: "warning" });
  } else {
    checks.push({ name: "Leverage vs Volatility", passed: true, detail: "Leverage and volatility are consistent", severity: "info" });
  }

  // 4. Sharpe ratio vs returns/volatility consistency
  const sharpe = safeNum(fund.sharpeRatio);
  if (nav1yr !== null && vol !== null && vol > 0 && sharpe !== null) {
    const impliedSharpe = nav1yr / vol;
    const diff = Math.abs(sharpe - impliedSharpe);
    if (diff > 1.5) {
      checks.push({ name: "Sharpe Ratio Consistency", passed: false, detail: `Reported Sharpe (${sharpe.toFixed(2)}) diverges significantly from implied (${impliedSharpe.toFixed(2)})`, severity: "warning" });
    } else {
      checks.push({ name: "Sharpe Ratio Consistency", passed: true, detail: "Sharpe ratio is consistent with return/volatility profile", severity: "info" });
    }
  }

  // 5. Return ordering (short-term vs long-term)
  const nav3yr = safeNum(fund.nav3yrReturn);
  const nav5yr = safeNum(fund.nav5yrReturn);
  if (nav1yr !== null && nav3yr !== null && nav5yr !== null) {
    // This is just a check, not necessarily a failure
    checks.push({ name: "Return Time Series", passed: true, detail: `1Y: ${(nav1yr * 100).toFixed(1)}%, 3Y: ${(nav3yr * 100).toFixed(1)}%, 5Y: ${(nav5yr * 100).toFixed(1)}%`, severity: "info" });
  }

  // 6. Min investment check
  const minInv = safeNum(fund.minInvestment);
  if (minInv !== null && minInv > 1000000) {
    checks.push({ name: "Accessibility", passed: true, detail: `High minimum investment ($${(minInv / 1000).toFixed(0)}K) limits investor accessibility`, severity: "warning" });
  } else {
    checks.push({ name: "Accessibility", passed: true, detail: "Minimum investment is within accessible range", severity: "info" });
  }

  return checks;
}

// --- Main Exports ---

export function validateIntervalFund(fund: IntervalFund): ReconciliationResult {
  const fieldValidations: FieldValidation[] = [
    validateNavPerShare(fund),
    validateAum(fund),
    validateExpenseRatio(fund),
    validateDistributionRate(fund),
    ...validateReturns(fund),
    ...validateRiskMetrics(fund),
    ...validateRepurchaseTerms(fund),
  ];

  const crossChecks = crossFieldChecks(fund);
  const failedFields = fieldValidations.filter((f) => !f.isValid).length;
  const failedCross = crossChecks.filter((c) => !c.passed).length;
  const errorCross = crossChecks.filter((c) => c.severity === "error").length;
  const totalChecks = fieldValidations.length + crossChecks.length;
  const passedChecks = totalChecks - failedFields - failedCross;
  const validationScore = Math.round((passedChecks / totalChecks) * 100);

  let status: "clean" | "warning" | "conflict" = "clean";
  if (errorCross > 0 || failedFields > 2) status = "conflict";
  else if (failedFields > 0 || failedCross > 0) status = "warning";

  const recommendations: string[] = [];
  if (failedFields > 0) {
    recommendations.push(`${failedFields} field(s) have validation issues - review and update data`);
  }
  const warningCross = crossChecks.filter((c) => c.severity === "warning" && !c.passed);
  for (const wc of warningCross) {
    recommendations.push(wc.detail);
  }
  if (status === "clean") {
    recommendations.push("All data validation checks passed successfully");
  }

  return {
    fundId: fund.id,
    fundName: fund.name,
    status,
    validationScore,
    fieldValidations,
    crossFieldChecks: crossChecks,
    recommendations,
  };
}

export function generateDataQualityReport(funds: IntervalFund[]): DataQualityReport {
  const fundResults = funds.map(validateIntervalFund);

  const cleanFunds = fundResults.filter((r) => r.status === "clean").length;
  const warningFunds = fundResults.filter((r) => r.status === "warning").length;
  const conflictFunds = fundResults.filter((r) => r.status === "conflict").length;
  const overallScore = fundResults.length > 0
    ? Math.round(fundResults.reduce((s, r) => s + r.validationScore, 0) / fundResults.length)
    : 100;

  // Collect common issues
  const issueCounts = new Map<string, number>();
  for (const result of fundResults) {
    for (const fv of result.fieldValidations) {
      if (!fv.isValid && fv.issue) {
        const key = fv.issue.replace(/\d+(\.\d+)?%/g, "X%").replace(/\$[\d,]+/g, "$X");
        issueCounts.set(key, (issueCounts.get(key) || 0) + 1);
      }
    }
    for (const cc of result.crossFieldChecks) {
      if (!cc.passed) {
        issueCounts.set(cc.name, (issueCounts.get(cc.name) || 0) + 1);
      }
    }
  }

  const commonIssues = Array.from(issueCounts.entries())
    .map(([issue, count]) => ({ issue, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalFunds: funds.length,
    cleanFunds,
    warningFunds,
    conflictFunds,
    overallScore,
    commonIssues,
    fundResults,
  };
}
