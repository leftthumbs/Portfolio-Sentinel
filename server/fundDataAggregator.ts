/**
 * Unified Fund Data Aggregator
 * Merges data from SEC EDGAR, Financial Modeling Prep, Alpha Vantage,
 * and FRED into a single reconciled view per fund.
 *
 * Priority system:
 *  1. SEC EDGAR — official filings (highest trust for AUM, filings)
 *  2. Financial Modeling Prep — real-time NAV/pricing, historical returns
 *  3. Alpha Vantage — supplemental pricing and fundamentals
 *  4. Seed data — static baseline (lowest priority, used as fallback)
 */

import type { IntervalFund, InsertIntervalFund } from "@shared/schema";
import { fetchSecFundData, type SecFundData } from "./secEdgarFeed";
import { fetchFmpFundData, type FmpFundData } from "./fmpFeed";
import { fetchAvFundData, type AvFundData } from "./alphaVantageFundFeed";
import { get3MonthTBillRate } from "./treasuryRates";

// --- Types ---

export interface SourceStatus {
  name: string;
  available: boolean;
  lastFetched: string | null;
  fieldsProvided: string[];
  error: string | null;
}

export interface AggregatedFundData {
  fundId: string;
  ticker: string;
  sources: SourceStatus[];
  // Merged fields with provenance
  fields: AggregatedField[];
  // Conflicts between sources
  conflicts: DataConflict[];
  // Overall data freshness
  freshestDate: string | null;
  aggregatedAt: string;
}

export interface AggregatedField {
  field: string;
  value: string | number | null;
  source: string;
  confidence: "high" | "medium" | "low";
  alternatives?: { source: string; value: string | number | null }[];
}

export interface DataConflict {
  field: string;
  values: { source: string; value: string | number | null }[];
  severity: "minor" | "major";
  resolution: string;
}

export interface RefreshResult {
  ticker: string;
  fundId: string;
  sourcesQueried: string[];
  sourcesSucceeded: string[];
  fieldsUpdated: string[];
  conflicts: DataConflict[];
  updatedData: Partial<InsertIntervalFund>;
}

// --- Aggregation cache ---

const aggregationCache = new Map<string, { data: AggregatedFundData; at: number }>();
const AGG_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// --- Helpers ---

function safeNum(val: string | number | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  const n = typeof val === "string" ? parseFloat(val) : val;
  return isNaN(n) ? null : n;
}

function pctDiff(a: number, b: number): number {
  if (b === 0) return a === 0 ? 0 : 1;
  return Math.abs(a - b) / Math.abs(b);
}

/**
 * Determine if two numeric values conflict.
 * Minor: >10% difference. Major: >25% difference.
 */
function classifyConflict(a: number | null, b: number | null): "none" | "minor" | "major" {
  if (a === null || b === null) return "none";
  const diff = pctDiff(a, b);
  if (diff > 0.25) return "major";
  if (diff > 0.10) return "minor";
  return "none";
}

/**
 * Pick the best value from multiple sources based on priority.
 */
function pickBest(
  values: { source: string; value: number | null; priority: number }[]
): { value: number | null; source: string; confidence: "high" | "medium" | "low" } {
  // Filter out nulls
  const valid = values.filter(v => v.value !== null).sort((a, b) => a.priority - b.priority);
  if (valid.length === 0) return { value: null, source: "none", confidence: "low" };
  if (valid.length === 1) return { value: valid[0].value, source: valid[0].source, confidence: "medium" };

  // Multiple sources agree within 10% → high confidence
  const best = valid[0];
  const otherClose = valid.slice(1).some(v => pctDiff(v.value!, best.value!) < 0.10);
  const confidence = otherClose ? "high" : "medium";
  return { value: best.value, source: best.source, confidence };
}

/**
 * Fetch data from all available sources for a single fund
 */
async function fetchAllSources(ticker: string): Promise<{
  sec: SecFundData | null;
  fmp: FmpFundData | null;
  av: AvFundData | null;
}> {
  // Run all feeds in parallel (they're independent)
  const [sec, fmp, av] = await Promise.all([
    fetchSecFundData(ticker).catch(e => { console.error("SEC fetch failed:", e); return null; }),
    fetchFmpFundData(ticker).catch(e => { console.error("FMP fetch failed:", e); return null; }),
    fetchAvFundData(ticker).catch(e => { console.error("AV fetch failed:", e); return null; }),
  ]);

  return { sec, fmp, av };
}

/**
 * Build source status summaries
 */
function buildSourceStatuses(
  sec: SecFundData | null,
  fmp: FmpFundData | null,
  av: AvFundData | null
): SourceStatus[] {
  const statuses: SourceStatus[] = [];

  statuses.push({
    name: "SEC EDGAR",
    available: sec !== null,
    lastFetched: sec?.fetchedAt || null,
    fieldsProvided: sec ? [
      ...(sec.totalNetAssets ? ["totalAum"] : []),
      ...(sec.monthlyReturns.length > 0 ? ["monthlyReturns"] : []),
      "fundName", "cik", "filingDate",
    ] : [],
    error: sec === null ? (process.env.FMP_API_KEY ? "No SEC data found for ticker" : "No CIK mapping found") : null,
  });

  statuses.push({
    name: "Financial Modeling Prep",
    available: fmp !== null,
    lastFetched: fmp?.fetchedAt || null,
    fieldsProvided: fmp ? [
      ...(fmp.navPrice !== null ? ["navPerShare"] : []),
      ...(fmp.return1yr !== null ? ["nav1yrReturn"] : []),
      ...(fmp.return3yr !== null ? ["nav3yrReturn"] : []),
      ...(fmp.return30d !== null ? ["nav30dReturn"] : []),
      ...(fmp.return90d !== null ? ["nav90dReturn"] : []),
      ...(fmp.volatility30d !== null ? ["volatility"] : []),
      ...(fmp.yearHigh !== null ? ["yearHigh", "yearLow"] : []),
    ] : [],
    error: fmp === null ? (process.env.FMP_API_KEY ? "FMP returned no data" : "FMP_API_KEY not configured") : null,
  });

  statuses.push({
    name: "Alpha Vantage",
    available: av !== null,
    lastFetched: av?.fetchedAt || null,
    fieldsProvided: av ? [
      ...(av.price !== null ? ["navPerShare"] : []),
      ...(av.return1yr !== null ? ["nav1yrReturn"] : []),
      ...(av.return3yr !== null ? ["nav3yrReturn"] : []),
      ...(av.annualizedVolatility !== null ? ["volatility"] : []),
      ...(av.beta !== null ? ["beta"] : []),
      ...(av.dividendYield !== null ? ["dividendYield"] : []),
    ] : [],
    error: av === null ? (process.env.ALPHA_VANTAGE_API_KEY ? "AV returned no data" : "ALPHA_VANTAGE_API_KEY not configured") : null,
  });

  return statuses;
}

/**
 * Merge data from all sources into aggregated fields with conflict detection
 */
function mergeFields(
  fund: IntervalFund,
  sec: SecFundData | null,
  fmp: FmpFundData | null,
  av: AvFundData | null
): { fields: AggregatedField[]; conflicts: DataConflict[] } {
  const fields: AggregatedField[] = [];
  const conflicts: DataConflict[] = [];

  // --- NAV Per Share ---
  const navSources = [
    { source: "fmp", value: fmp?.navPrice || null, priority: 1 },
    { source: "alpha-vantage", value: av?.price || null, priority: 2 },
    { source: "seed", value: safeNum(fund.navPerShare), priority: 3 },
  ];
  const navBest = pickBest(navSources);
  const navAlts = navSources.filter(s => s.value !== null && s.source !== navBest.source)
    .map(s => ({ source: s.source, value: s.value }));
  fields.push({ field: "navPerShare", value: navBest.value, source: navBest.source, confidence: navBest.confidence, alternatives: navAlts });

  // Check NAV conflict between FMP and AV
  if (fmp?.navPrice && av?.price) {
    const severity = classifyConflict(fmp.navPrice, av.price);
    if (severity !== "none") {
      conflicts.push({
        field: "navPerShare",
        values: [
          { source: "fmp", value: fmp.navPrice },
          { source: "alpha-vantage", value: av.price },
        ],
        severity,
        resolution: `Using FMP value ($${fmp.navPrice.toFixed(2)}) as primary — more frequently updated`,
      });
    }
  }

  // --- Total AUM ---
  const aumSources = [
    { source: "sec-edgar", value: sec?.totalNetAssets || null, priority: 1 },
    { source: "seed", value: safeNum(fund.totalAum), priority: 3 },
  ];
  const aumBest = pickBest(aumSources);
  fields.push({ field: "totalAum", value: aumBest.value, source: aumBest.source, confidence: aumBest.confidence });

  if (sec?.totalNetAssets && safeNum(fund.totalAum)) {
    const severity = classifyConflict(sec.totalNetAssets, safeNum(fund.totalAum)!);
    if (severity !== "none") {
      conflicts.push({
        field: "totalAum",
        values: [
          { source: "sec-edgar", value: sec.totalNetAssets },
          { source: "seed", value: safeNum(fund.totalAum) },
        ],
        severity,
        resolution: `SEC filing value preferred — official regulatory data`,
      });
    }
  }

  // --- 1-Year Return ---
  const ret1ySources = [
    { source: "fmp", value: fmp?.return1yr || null, priority: 1 },
    { source: "alpha-vantage", value: av?.return1yr || null, priority: 2 },
    { source: "seed", value: safeNum(fund.nav1yrReturn), priority: 3 },
  ];
  const ret1yBest = pickBest(ret1ySources);
  const ret1yAlts = ret1ySources.filter(s => s.value !== null && s.source !== ret1yBest.source)
    .map(s => ({ source: s.source, value: s.value }));
  fields.push({ field: "nav1yrReturn", value: ret1yBest.value, source: ret1yBest.source, confidence: ret1yBest.confidence, alternatives: ret1yAlts });

  if (fmp?.return1yr !== null && av?.return1yr !== null && fmp?.return1yr !== undefined && av?.return1yr !== undefined) {
    const severity = classifyConflict(fmp.return1yr, av.return1yr);
    if (severity !== "none") {
      conflicts.push({
        field: "nav1yrReturn",
        values: [
          { source: "fmp", value: fmp.return1yr },
          { source: "alpha-vantage", value: av.return1yr },
        ],
        severity,
        resolution: `Using FMP value — computed from more granular daily data`,
      });
    }
  }

  // --- 3-Year Return ---
  const ret3ySources = [
    { source: "fmp", value: fmp?.return3yr || null, priority: 1 },
    { source: "alpha-vantage", value: av?.return3yr || null, priority: 2 },
    { source: "seed", value: safeNum(fund.nav3yrReturn), priority: 3 },
  ];
  const ret3yBest = pickBest(ret3ySources);
  fields.push({ field: "nav3yrReturn", value: ret3yBest.value, source: ret3yBest.source, confidence: ret3yBest.confidence });

  // --- 30-Day Return ---
  const ret30dSources = [
    { source: "fmp", value: fmp?.return30d || null, priority: 1 },
    { source: "seed", value: safeNum(fund.nav30dReturn), priority: 3 },
  ];
  const ret30dBest = pickBest(ret30dSources);
  fields.push({ field: "nav30dReturn", value: ret30dBest.value, source: ret30dBest.source, confidence: ret30dBest.confidence });

  // --- 90-Day Return ---
  const ret90dSources = [
    { source: "fmp", value: fmp?.return90d || null, priority: 1 },
    { source: "seed", value: safeNum(fund.nav90dReturn), priority: 3 },
  ];
  const ret90dBest = pickBest(ret90dSources);
  fields.push({ field: "nav90dReturn", value: ret90dBest.value, source: ret90dBest.source, confidence: ret90dBest.confidence });

  // --- Volatility ---
  const volSources = [
    { source: "fmp", value: fmp?.volatility30d || null, priority: 1 },
    { source: "alpha-vantage", value: av?.annualizedVolatility || null, priority: 2 },
    { source: "seed", value: safeNum(fund.volatility), priority: 3 },
  ];
  const volBest = pickBest(volSources);
  fields.push({ field: "volatility", value: volBest.value, source: volBest.source, confidence: volBest.confidence });

  // --- Beta ---
  const betaSources = [
    { source: "alpha-vantage", value: av?.beta || null, priority: 1 },
    { source: "seed", value: safeNum(fund.beta), priority: 2 },
  ];
  const betaBest = pickBest(betaSources);
  fields.push({ field: "beta", value: betaBest.value, source: betaBest.source, confidence: betaBest.confidence });

  // --- Fund Name ---
  const nameSources = [
    { source: "sec-edgar", value: sec?.fundName || null, priority: 1 },
    { source: "fmp", value: fmp?.fundName || null, priority: 2 },
    { source: "alpha-vantage", value: av?.fundName || null, priority: 3 },
  ];
  const nameVal = nameSources.find(s => s.value)?.value || fund.name;
  fields.push({ field: "name", value: nameVal, source: nameSources.find(s => s.value)?.source || "seed", confidence: "high" });

  return { fields, conflicts };
}

/**
 * Main entry: Aggregate data from all sources for a single fund.
 */
export async function aggregateFundData(fund: IntervalFund): Promise<AggregatedFundData> {
  const ticker = fund.ticker;
  if (!ticker) {
    return {
      fundId: fund.id,
      ticker: "",
      sources: [],
      fields: [],
      conflicts: [],
      freshestDate: null,
      aggregatedAt: new Date().toISOString(),
    };
  }

  // Check cache
  const cached = aggregationCache.get(fund.id);
  if (cached && Date.now() - cached.at < AGG_CACHE_TTL_MS) {
    return cached.data;
  }

  const { sec, fmp, av } = await fetchAllSources(ticker);
  const sources = buildSourceStatuses(sec, fmp, av);
  const { fields, conflicts } = mergeFields(fund, sec, fmp, av);

  // Determine freshest data point
  const dates = [sec?.fetchedAt, fmp?.fetchedAt, av?.fetchedAt].filter(Boolean) as string[];
  const freshestDate = dates.length > 0
    ? dates.sort().reverse()[0]
    : null;

  const result: AggregatedFundData = {
    fundId: fund.id,
    ticker: ticker.toUpperCase(),
    sources,
    fields,
    conflicts,
    freshestDate,
    aggregatedAt: new Date().toISOString(),
  };

  aggregationCache.set(fund.id, { data: result, at: Date.now() });
  return result;
}

/**
 * Refresh a fund's stored data from external sources.
 * Returns which fields were updated and any conflicts found.
 */
export async function refreshFundFromSources(fund: IntervalFund): Promise<RefreshResult> {
  const ticker = fund.ticker || "";
  const sourcesQueried: string[] = [];
  const sourcesSucceeded: string[] = [];

  // Fetch from all sources
  const { sec, fmp, av } = await fetchAllSources(ticker);

  if (sec !== null || true) sourcesQueried.push("sec-edgar"); // always queried
  if (fmp !== null || process.env.FMP_API_KEY) sourcesQueried.push("fmp");
  if (av !== null || process.env.ALPHA_VANTAGE_API_KEY) sourcesQueried.push("alpha-vantage");

  if (sec) sourcesSucceeded.push("sec-edgar");
  if (fmp) sourcesSucceeded.push("fmp");
  if (av) sourcesSucceeded.push("alpha-vantage");

  const { fields, conflicts } = mergeFields(fund, sec, fmp, av);

  // Build partial update — only include fields that differ from current values
  const updatedData: Partial<InsertIntervalFund> = {};
  const fieldsUpdated: string[] = [];

  for (const field of fields) {
    if (field.value === null) continue;
    const currentVal = safeNum((fund as any)[field.field]);
    const newVal = typeof field.value === "number" ? field.value : safeNum(field.value as any);

    // Only update if the value actually changed (>1% difference for numerics)
    if (newVal !== null && (currentVal === null || pctDiff(newVal, currentVal) > 0.01)) {
      (updatedData as any)[field.field] = String(newVal);
      fieldsUpdated.push(field.field);
    }
  }

  // Clear aggregation cache for this fund
  aggregationCache.delete(fund.id);

  return {
    ticker,
    fundId: fund.id,
    sourcesQueried,
    sourcesSucceeded,
    fieldsUpdated,
    conflicts,
    updatedData,
  };
}

/**
 * Batch refresh all funds from external sources
 */
export async function refreshAllFunds(funds: IntervalFund[]): Promise<{
  results: RefreshResult[];
  summary: {
    totalFunds: number;
    fundsUpdated: number;
    totalFieldsUpdated: number;
    totalConflicts: number;
    sourceAvailability: { source: string; available: number; total: number }[];
  };
}> {
  const results: RefreshResult[] = [];
  const sourceHits = new Map<string, number>();

  for (const fund of funds) {
    if (!fund.ticker) continue;
    try {
      const result = await refreshFundFromSources(fund);
      results.push(result);
      for (const src of result.sourcesSucceeded) {
        sourceHits.set(src, (sourceHits.get(src) || 0) + 1);
      }
    } catch (error) {
      console.error(`Refresh failed for ${fund.ticker}:`, error);
    }
  }

  const fundsWithTicker = funds.filter(f => f.ticker).length;
  const sourceAvailability = ["sec-edgar", "fmp", "alpha-vantage"].map(src => ({
    source: src,
    available: sourceHits.get(src) || 0,
    total: fundsWithTicker,
  }));

  return {
    results,
    summary: {
      totalFunds: funds.length,
      fundsUpdated: results.filter(r => r.fieldsUpdated.length > 0).length,
      totalFieldsUpdated: results.reduce((s, r) => s + r.fieldsUpdated.length, 0),
      totalConflicts: results.reduce((s, r) => s + r.conflicts.length, 0),
      sourceAvailability,
    },
  };
}

/**
 * Get the current data source configuration status
 */
export function getDataSourceConfig(): {
  sources: { name: string; configured: boolean; envVar: string; description: string }[];
  riskFreeRateSource: string;
} {
  return {
    sources: [
      {
        name: "SEC EDGAR",
        configured: true, // no API key needed
        envVar: "N/A (free, no key required)",
        description: "Official SEC filings (N-PORT, N-CEN). Provides AUM, monthly returns, filing history.",
      },
      {
        name: "Financial Modeling Prep",
        configured: !!process.env.FMP_API_KEY,
        envVar: "FMP_API_KEY",
        description: "Real-time NAV quotes, historical prices, computed returns. 250 free calls/day.",
      },
      {
        name: "Alpha Vantage",
        configured: !!process.env.ALPHA_VANTAGE_API_KEY,
        envVar: "ALPHA_VANTAGE_API_KEY",
        description: "Fund quotes, fundamentals (beta, yield), monthly price history. 25 free calls/day.",
      },
      {
        name: "FRED",
        configured: !!process.env.FRED_API_KEY,
        envVar: "FRED_API_KEY",
        description: "Risk-free rate (3-month T-Bill) for Sharpe ratio and analysis benchmarking.",
      },
    ],
    riskFreeRateSource: process.env.FRED_API_KEY ? "FRED API" : "Fallback (4%)",
  };
}

export function clearAggregationCache(): void {
  aggregationCache.clear();
}
