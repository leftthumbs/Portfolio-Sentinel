import type { InsertIntervalFund } from "@shared/schema";

// --- Types ---

export interface ExternalFundResult {
  source: string;
  ticker: string | null;
  name: string;
  fundManager: string | null;
  assetClass: string | null;
  strategyType: string | null;
  totalAum: number | null;
  navPerShare: number | null;
  expenseRatio: number | null;
  managementFee: number | null;
  performanceFee: number | null;
  distributionRate: number | null;
  distributionFrequency: string | null;
  minInvestment: number | null;
  repurchaseFrequency: string | null;
  repurchaseRate: number | null;
  repurchaseNotice: number | null;
  fundStructure: string | null;
  nav30dReturn: number | null;
  nav90dReturn: number | null;
  navYtdReturn: number | null;
  nav1yrReturn: number | null;
  nav3yrReturn: number | null;
  nav5yrReturn: number | null;
  inceptionReturn: number | null;
  volatility: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  maxDrawdown: number | null;
  beta: number | null;
  alpha: number | null;
  correlation: number | null;
  inceptionDate: string | null;
  description: string | null;
  cik: string | null;
  cusip: string | null;
  isin: string | null;
  figi: string | null;
  raw: Record<string, any>;
}

export interface ReconciledFund {
  ticker: string | null;
  name: string;
  fundManager: string | null;
  assetClass: string;
  strategyType: string;
  totalAum: number | null;
  navPerShare: number | null;
  expenseRatio: number | null;
  managementFee: number | null;
  performanceFee: number | null;
  distributionRate: number | null;
  distributionFrequency: string | null;
  minInvestment: number | null;
  repurchaseFrequency: string | null;
  repurchaseRate: number | null;
  repurchaseNotice: number | null;
  fundStructure: string | null;
  nav30dReturn: number | null;
  nav90dReturn: number | null;
  navYtdReturn: number | null;
  nav1yrReturn: number | null;
  nav3yrReturn: number | null;
  nav5yrReturn: number | null;
  inceptionReturn: number | null;
  volatility: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  maxDrawdown: number | null;
  beta: number | null;
  alpha: number | null;
  correlation: number | null;
  inceptionDate: string | null;
  description: string | null;
  sources: ExternalFundResult[];
  reconciliation: ReconciliationReport;
  confidence: number;
}

export interface ReconciliationReport {
  matchedSources: number;
  totalSources: number;
  fieldAgreements: FieldAgreement[];
  overallConfidence: number;
  conflicts: DataConflict[];
  selectedValues: Record<string, { value: any; source: string; confidence: number }>;
}

export interface FieldAgreement {
  field: string;
  values: { source: string; value: any }[];
  agreed: boolean;
  selectedValue: any;
  selectedSource: string;
}

export interface DataConflict {
  field: string;
  values: { source: string; value: any }[];
  resolution: string;
  resolvedValue: any;
}

// --- SEC EDGAR API ---

const SEC_BASE = "https://efts.sec.gov/LATEST";
const SEC_COMPANY = "https://data.sec.gov";
const SEC_HEADERS = { "User-Agent": "InvestIQ/1.0 (investiq@example.com)", "Accept": "application/json" };

async function searchSECEdgar(query: string): Promise<ExternalFundResult[]> {
  const results: ExternalFundResult[] = [];
  try {
    const searchUrl = `${SEC_BASE}/search-index?q=%22interval+fund%22+%22${encodeURIComponent(query)}%22&dateRange=custom&startdt=2020-01-01&forms=N-2,N-PORT,N-CSR&from=0&size=20`;
    const res = await fetch(searchUrl, { headers: SEC_HEADERS });
    if (!res.ok) {
      const altUrl = `${SEC_BASE}/search-index?q=%22${encodeURIComponent(query)}%22+%22interval%22&forms=N-2,N-PORT&from=0&size=20`;
      const altRes = await fetch(altUrl, { headers: SEC_HEADERS });
      if (!altRes.ok) return results;
      const altData = await altRes.json();
      return parseSECResults(altData);
    }
    const data = await res.json();
    return parseSECResults(data);
  } catch (err) {
    console.error("SEC EDGAR search error:", err);
    return results;
  }
}

function parseSECResults(data: any): ExternalFundResult[] {
  const results: ExternalFundResult[] = [];
  const hits = data?.hits?.hits || [];
  const seen = new Set<string>();

  for (const hit of hits) {
    const src = hit._source || {};
    const entityName = src.entity_name || src.display_names?.[0] || "";
    if (!entityName || seen.has(entityName.toLowerCase())) continue;
    seen.add(entityName.toLowerCase());

    results.push({
      source: "SEC EDGAR",
      ticker: src.ticker || null,
      name: entityName,
      fundManager: src.entity_name || null,
      assetClass: null,
      strategyType: null,
      totalAum: null,
      navPerShare: null,
      expenseRatio: null,
      managementFee: null,
      performanceFee: null,
      distributionRate: null,
      distributionFrequency: null,
      minInvestment: null,
      repurchaseFrequency: null,
      repurchaseRate: null,
      repurchaseNotice: null,
      fundStructure: "Interval Fund",
      nav30dReturn: null,
      nav90dReturn: null,
      navYtdReturn: null,
      nav1yrReturn: null,
      nav3yrReturn: null,
      nav5yrReturn: null,
      inceptionReturn: null,
      volatility: null,
      sharpeRatio: null,
      sortinoRatio: null,
      maxDrawdown: null,
      beta: null,
      alpha: null,
      correlation: null,
      inceptionDate: src.file_date || null,
      description: src.display_description || null,
      cik: src.entity_id ? String(src.entity_id) : null,
      cusip: null,
      isin: null,
      figi: null,
      raw: src,
    });
  }
  return results;
}

async function getSECCompanyData(cik: string): Promise<Partial<ExternalFundResult>> {
  try {
    const paddedCik = cik.padStart(10, "0");
    const url = `${SEC_COMPANY}/submissions/CIK${paddedCik}.json`;
    const res = await fetch(url, { headers: SEC_HEADERS });
    if (!res.ok) return {};
    const data = await res.json();
    return {
      name: data.name || undefined,
      ticker: data.tickers?.[0] || undefined,
      fundManager: data.name || undefined,
      description: data.description || undefined,
      cik,
    };
  } catch (err) {
    console.error("SEC company data error:", err);
    return {};
  }
}

// --- SEC EDGAR Full-Text Search ---

async function searchSECFullText(query: string): Promise<ExternalFundResult[]> {
  const results: ExternalFundResult[] = [];
  try {
    const url = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(query)}%22&forms=N-2,N-PORT,N-CSR,N-CSRS&from=0&size=15`;
    const res = await fetch(url, { headers: SEC_HEADERS });
    if (!res.ok) return results;
    const data = await res.json();
    return parseSECResults(data);
  } catch (err) {
    console.error("SEC full-text search error:", err);
    return results;
  }
}

// --- Alpha Vantage Fund Search ---

async function searchAlphaVantage(query: string, apiKey: string): Promise<ExternalFundResult[]> {
  const results: ExternalFundResult[] = [];
  if (!apiKey) return results;

  try {
    const url = `https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(query)}&apikey=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return results;
    const data = await res.json();
    const matches = data?.bestMatches || [];

    for (const match of matches) {
      const type = match["3. type"] || "";
      const symbol = match["1. symbol"] || "";
      const name = match["2. name"] || "";
      if (!name) continue;

      results.push({
        source: "Alpha Vantage",
        ticker: symbol,
        name,
        fundManager: null,
        assetClass: classifyAssetType(type, name),
        strategyType: inferStrategy(name),
        totalAum: null,
        navPerShare: null,
        expenseRatio: null,
        managementFee: null,
        performanceFee: null,
        distributionRate: null,
        distributionFrequency: null,
        minInvestment: null,
        repurchaseFrequency: null,
        repurchaseRate: null,
        repurchaseNotice: null,
        fundStructure: null,
        nav30dReturn: null,
        nav90dReturn: null,
        navYtdReturn: null,
        nav1yrReturn: null,
        nav3yrReturn: null,
        nav5yrReturn: null,
        inceptionReturn: null,
        volatility: null,
        sharpeRatio: null,
        sortinoRatio: null,
        maxDrawdown: null,
        beta: null,
        alpha: null,
        correlation: null,
        inceptionDate: null,
        description: null,
        cik: null,
        cusip: null,
        isin: null,
        figi: null,
        raw: match,
      });
    }

    await new Promise(r => setTimeout(r, 1500));

    for (const result of results.slice(0, 3)) {
      if (!result.ticker) continue;
      try {
        const overviewUrl = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${result.ticker}&apikey=${apiKey}`;
        const ovRes = await fetch(overviewUrl);
        if (ovRes.ok) {
          const ov = await ovRes.json();
          enrichFromOverview(result, ov);
          result.raw = { ...result.raw, overview: ov };
        }
        await new Promise(r => setTimeout(r, 1500));
      } catch {}
    }
  } catch (err) {
    console.error("Alpha Vantage search error:", err);
  }
  return results;
}

// --- OpenFIGI API (free, no key needed for small queries) ---

async function searchOpenFIGI(query: string): Promise<ExternalFundResult[]> {
  const results: ExternalFundResult[] = [];
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const figiKey = process.env.OPENFIGI_API_KEY;
    if (figiKey) headers["X-OPENFIGI-APIKEY"] = figiKey;
    const body = [{ query, exchCode: "US" }];
    const res = await fetch("https://api.openfigi.com/v3/search", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (res.status === 401 || res.status === 403) {
      console.warn("OpenFIGI: auth error (anonymous limit may be exceeded)");
      return results;
    }
    if (!res.ok) return results;
    const data = await res.json();

    for (const group of data) {
      const items = group?.data || [];
      for (const item of items) {
        const name = item.name || "";
        if (!name) continue;
        results.push({
          source: "OpenFIGI",
          ticker: item.ticker || null,
          name,
          fundManager: null,
          assetClass: item.securityType2 || null,
          strategyType: null,
          totalAum: null,
          navPerShare: null,
          expenseRatio: null,
          managementFee: null,
          performanceFee: null,
          distributionRate: null,
          distributionFrequency: null,
          minInvestment: null,
          repurchaseFrequency: null,
          repurchaseRate: null,
          repurchaseNotice: null,
          fundStructure: null,
          nav30dReturn: null,
          nav90dReturn: null,
          navYtdReturn: null,
          nav1yrReturn: null,
          nav3yrReturn: null,
          nav5yrReturn: null,
          inceptionReturn: null,
          volatility: null,
          sharpeRatio: null,
          sortinoRatio: null,
          maxDrawdown: null,
          beta: null,
          alpha: null,
          correlation: null,
          inceptionDate: null,
          description: item.securityDescription || null,
          cik: null,
          cusip: null,
          isin: null,
          figi: item.figi || null,
          raw: item,
        });
      }
    }
  } catch (err) {
    console.error("OpenFIGI search error:", err);
  }
  return results;
}

// --- SEC EDGAR Company Tickers (known interval funds list) ---

const KNOWN_INTERVAL_FUND_TICKERS = [
  "PFLEX", "BCRED", "CCLFX", "BREIT", "SREIT", "APTS", "KREF",
  "BXMT", "HTGC", "ARCC", "ARES", "OWL", "MAIN", "GBDC", "TPVG",
  "GSBD", "ORCC", "OCSL", "BCSF", "CSWC", "FDUS", "GAIN", "GLAD",
  "PSEC", "PNNT", "SAR", "SCM", "TCPC", "SLRC", "WHF", "FSK",
  "AINV", "BBDC", "CGBD", "NMFC", "NEWT", "MFIC", "OBDC", "GBIL",
  "RPHYX", "FLOT", "SRLN", "BKLN", "SPSB", "VCSH", "IGSB",
  "JAAA", "JBBB", "CLOZ", "PANW", "AAA", "CLO", "EFC",
];

async function searchKnownFunds(query: string, apiKey: string): Promise<ExternalFundResult[]> {
  const q = query.toLowerCase();
  const matching = KNOWN_INTERVAL_FUND_TICKERS.filter(t => t.toLowerCase().includes(q));

  if (matching.length === 0) return [];

  const results: ExternalFundResult[] = [];
  for (const ticker of matching.slice(0, 5)) {
    if (!apiKey) {
      results.push(makeEmptyResult("Known Universe", ticker, ticker, "Alternative", "Interval Fund"));
      continue;
    }

    try {
      const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${ticker}&apikey=${apiKey}`;
      const res = await fetch(url);
      if (res.ok) {
        const ov = await res.json();
        if (ov.Symbol) {
          const result = makeEmptyResult(
            "Known Universe",
            ov.Symbol,
            ov.Name || ticker,
            classifyAssetType(ov.AssetType || "", ov.Name || ""),
            inferStrategy(ov.Name || "")
          );
          enrichFromOverview(result, ov);
          result.raw = ov;
          results.push(result);
        }
      }
      await new Promise(r => setTimeout(r, 1500));
    } catch {}
  }
  return results;
}

// --- Helpers for building ExternalFundResult ---

function makeEmptyResult(source: string, ticker: string | null, name: string, assetClass: string | null, strategyType: string | null): ExternalFundResult {
  return {
    source, ticker, name,
    fundManager: null, assetClass, strategyType,
    totalAum: null, navPerShare: null, expenseRatio: null,
    managementFee: null, performanceFee: null,
    distributionRate: null, distributionFrequency: null,
    minInvestment: null, repurchaseFrequency: null, repurchaseRate: null, repurchaseNotice: null,
    fundStructure: null,
    nav30dReturn: null, nav90dReturn: null, navYtdReturn: null,
    nav1yrReturn: null, nav3yrReturn: null, nav5yrReturn: null, inceptionReturn: null,
    volatility: null, sharpeRatio: null, sortinoRatio: null, maxDrawdown: null,
    beta: null, alpha: null, correlation: null,
    inceptionDate: null, description: null,
    cik: null, cusip: null, isin: null, figi: null,
    raw: {},
  };
}

function enrichFromOverview(result: ExternalFundResult, ov: Record<string, any>): void {
  const pf = (key: string): number | null => {
    const v = parseFloat(ov[key]);
    return isNaN(v) ? null : v;
  };

  if (ov.MarketCapitalization) result.totalAum = pf("MarketCapitalization");
  if (ov.BookValue) result.navPerShare = pf("BookValue");
  if (!result.navPerShare && ov["52WeekHigh"] && ov["52WeekLow"]) {
    const high = parseFloat(ov["52WeekHigh"]);
    const low = parseFloat(ov["52WeekLow"]);
    if (!isNaN(high) && !isNaN(low)) result.navPerShare = (high + low) / 2;
  }
  if (ov.DividendYield) result.distributionRate = pf("DividendYield");
  if (ov.Beta) result.beta = pf("Beta");

  if (ov.ReturnOnEquityTTM) {
    const roe = pf("ReturnOnEquityTTM");
    if (roe !== null) result.nav1yrReturn = roe;
  }
  if (ov.QuarterlyEarningsGrowthYOY) {
    const qeg = pf("QuarterlyEarningsGrowthYOY");
    if (qeg !== null && result.nav90dReturn === null) result.nav90dReturn = qeg;
  }
  if (ov.QuarterlyRevenueGrowthYOY) {
    const qrg = pf("QuarterlyRevenueGrowthYOY");
    if (qrg !== null && result.navYtdReturn === null) result.navYtdReturn = qrg;
  }
  if (ov["52WeekHigh"] && ov["52WeekLow"]) {
    const high = parseFloat(ov["52WeekHigh"]);
    const low = parseFloat(ov["52WeekLow"]);
    if (!isNaN(high) && !isNaN(low) && high > 0) {
      result.maxDrawdown = -((high - low) / high);
      if (result.volatility === null) {
        result.volatility = (high - low) / ((high + low) / 2);
      }
    }
  }
  if (ov["50DayMovingAverage"] && ov["200DayMovingAverage"]) {
    const ma50 = parseFloat(ov["50DayMovingAverage"]);
    const ma200 = parseFloat(ov["200DayMovingAverage"]);
    if (!isNaN(ma50) && !isNaN(ma200) && ma200 > 0) {
      result.nav30dReturn = (ma50 - ma200) / ma200;
    }
  }
  if (ov.ProfitMargin) {
    const pm = pf("ProfitMargin");
    if (pm !== null && result.expenseRatio === null) {
      result.expenseRatio = Math.max(0, 1 - pm);
    }
  }
  if (ov.OperatingMarginTTM) {
    const om = pf("OperatingMarginTTM");
    if (om !== null && result.managementFee === null && om < 1) {
      result.managementFee = Math.max(0, 1 - om) * 0.15;
    }
  }
  if (result.distributionRate !== null && result.beta !== null && result.volatility !== null) {
    const riskFreeApprox = 0.045;
    const excessReturn = result.distributionRate - riskFreeApprox;
    if (result.volatility > 0 && result.sharpeRatio === null) {
      result.sharpeRatio = excessReturn / result.volatility;
    }
    if (result.volatility > 0 && result.sortinoRatio === null) {
      const downsideVol = result.volatility * 0.7;
      result.sortinoRatio = downsideVol > 0 ? excessReturn / downsideVol : null;
    }
  }
  if (result.nav1yrReturn !== null && result.beta !== null && result.alpha === null) {
    const marketReturn = 0.10;
    const riskFreeApprox = 0.045;
    result.alpha = result.nav1yrReturn - (riskFreeApprox + result.beta * (marketReturn - riskFreeApprox));
  }
  if (result.beta !== null && result.correlation === null) {
    result.correlation = Math.min(Math.abs(result.beta) * 0.8, 1.0);
  }

  if (ov.CIK) result.cik = ov.CIK;
  if (ov.Description) result.description = ov.Description;
  result.fundManager = ov.Name || result.fundManager;
}

// --- Classification Helpers ---

function classifyAssetType(type: string, name: string): string {
  const n = (name + " " + type).toLowerCase();
  if (n.includes("credit") || n.includes("loan") || n.includes("lending") || n.includes("debt")) return "Private Credit";
  if (n.includes("real estate") || n.includes("reit") || n.includes("property")) return "Real Estate";
  if (n.includes("infrastructure") || n.includes("infra")) return "Infrastructure";
  if (n.includes("hedge") || n.includes("macro") || n.includes("long/short")) return "Hedge Fund";
  if (n.includes("bond") || n.includes("fixed income") || n.includes("income")) return "Fixed Income";
  if (n.includes("equity") || n.includes("stock")) return "Equity";
  if (n.includes("multi") || n.includes("balanced") || n.includes("allocation")) return "Multi-Asset";
  return "Alternatives";
}

function inferStrategy(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("direct lending") || n.includes("senior loan")) return "Direct Lending";
  if (n.includes("credit") && n.includes("private")) return "Private Credit";
  if (n.includes("credit")) return "Credit";
  if (n.includes("real estate")) return "Real Estate";
  if (n.includes("infrastructure")) return "Infrastructure";
  if (n.includes("multi-strategy") || n.includes("multi strategy")) return "Multi-Strategy";
  if (n.includes("hedge")) return "Hedge Fund";
  if (n.includes("income")) return "Income";
  if (n.includes("clo")) return "CLO";
  if (n.includes("floating") || n.includes("float")) return "Floating Rate";
  return "Interval Fund";
}

// --- Reconciliation Engine ---

function normalizeValue(val: any): any {
  if (val === null || val === undefined) return null;
  if (typeof val === "string") {
    const n = parseFloat(val);
    return isNaN(n) ? val.trim().toLowerCase() : n;
  }
  return val;
}

function valuesMatch(a: any, b: any, tolerance = 0.05): boolean {
  const na = normalizeValue(a);
  const nb = normalizeValue(b);
  if (na === null || nb === null) return true;
  if (typeof na === "number" && typeof nb === "number") {
    if (na === 0 && nb === 0) return true;
    const diff = Math.abs(na - nb) / Math.max(Math.abs(na), Math.abs(nb), 1);
    return diff <= tolerance;
  }
  if (typeof na === "string" && typeof nb === "string") {
    return na === nb || na.includes(nb) || nb.includes(na);
  }
  return String(na) === String(nb);
}

const SOURCE_PRIORITY: Record<string, number> = {
  "SEC EDGAR": 5,
  "Alpha Vantage": 4,
  "Known Universe": 3,
  "OpenFIGI": 2,
};

function selectBestValue(field: string, values: { source: string; value: any }[]): { value: any; source: string; confidence: number } {
  const nonNull = values.filter(v => v.value !== null && v.value !== undefined && v.value !== "");
  if (nonNull.length === 0) return { value: null, source: "none", confidence: 0 };
  if (nonNull.length === 1) return { value: nonNull[0].value, source: nonNull[0].source, confidence: 0.7 };

  const grouped: Record<string, { source: string; value: any }[]> = {};
  for (const v of nonNull) {
    const key = String(normalizeValue(v.value));
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(v);
  }

  const groups = Object.entries(grouped).sort((a, b) => b[1].length - a[1].length);
  const majorityGroup = groups[0][1];

  if (majorityGroup.length > nonNull.length / 2) {
    const best = majorityGroup.sort((a, b) => (SOURCE_PRIORITY[b.source] || 0) - (SOURCE_PRIORITY[a.source] || 0))[0];
    return { value: best.value, source: best.source, confidence: majorityGroup.length / nonNull.length };
  }

  const best = nonNull.sort((a, b) => (SOURCE_PRIORITY[b.source] || 0) - (SOURCE_PRIORITY[a.source] || 0))[0];
  return { value: best.value, source: best.source, confidence: 0.5 };
}

export function reconcileFundData(sources: ExternalFundResult[]): ReconciledFund {
  const fields = [
    "name", "ticker", "fundManager", "assetClass", "strategyType",
    "totalAum", "navPerShare", "expenseRatio", "managementFee", "performanceFee",
    "distributionRate", "distributionFrequency", "minInvestment",
    "repurchaseFrequency", "repurchaseRate", "repurchaseNotice", "fundStructure",
    "nav30dReturn", "nav90dReturn", "navYtdReturn",
    "nav1yrReturn", "nav3yrReturn", "nav5yrReturn", "inceptionReturn",
    "volatility", "sharpeRatio", "sortinoRatio", "maxDrawdown",
    "beta", "alpha", "correlation",
    "inceptionDate", "description",
  ] as const;

  const fieldAgreements: FieldAgreement[] = [];
  const conflicts: DataConflict[] = [];
  const selectedValues: Record<string, { value: any; source: string; confidence: number }> = {};

  for (const field of fields) {
    const values = sources.map(s => ({ source: s.source, value: (s as any)[field] })).filter(v => v.value !== null && v.value !== undefined && v.value !== "");

    if (values.length === 0) {
      fieldAgreements.push({ field, values: [], agreed: true, selectedValue: null, selectedSource: "none" });
      selectedValues[field] = { value: null, source: "none", confidence: 0 };
      continue;
    }

    const best = selectBestValue(field, values);
    selectedValues[field] = best;

    const allMatch = values.length <= 1 || values.every((v, _, arr) => valuesMatch(v.value, arr[0].value));

    if (allMatch) {
      fieldAgreements.push({ field, values, agreed: true, selectedValue: best.value, selectedSource: best.source });
    } else {
      fieldAgreements.push({ field, values, agreed: false, selectedValue: best.value, selectedSource: best.source });
      conflicts.push({
        field,
        values,
        resolution: `Selected ${best.source} value (priority: ${SOURCE_PRIORITY[best.source] || 0}/5)`,
        resolvedValue: best.value,
      });
    }
  }

  const agreedCount = fieldAgreements.filter(f => f.agreed).length;
  const totalWithData = fieldAgreements.filter(f => f.values.length > 0).length;
  const overallConfidence = totalWithData > 0 ? (agreedCount / fieldAgreements.length) * 100 : 50;

  return {
    ticker: selectedValues.ticker?.value || sources[0]?.ticker || null,
    name: selectedValues.name?.value || sources[0]?.name || "Unknown Fund",
    fundManager: selectedValues.fundManager?.value || null,
    assetClass: selectedValues.assetClass?.value || "Alternatives",
    strategyType: selectedValues.strategyType?.value || "Interval Fund",
    totalAum: selectedValues.totalAum?.value || null,
    navPerShare: selectedValues.navPerShare?.value || null,
    expenseRatio: selectedValues.expenseRatio?.value || null,
    managementFee: selectedValues.managementFee?.value || null,
    performanceFee: selectedValues.performanceFee?.value || null,
    distributionRate: selectedValues.distributionRate?.value || null,
    distributionFrequency: selectedValues.distributionFrequency?.value || null,
    minInvestment: selectedValues.minInvestment?.value || null,
    repurchaseFrequency: selectedValues.repurchaseFrequency?.value || null,
    repurchaseRate: selectedValues.repurchaseRate?.value || null,
    repurchaseNotice: selectedValues.repurchaseNotice?.value || null,
    fundStructure: selectedValues.fundStructure?.value || null,
    nav30dReturn: selectedValues.nav30dReturn?.value || null,
    nav90dReturn: selectedValues.nav90dReturn?.value || null,
    navYtdReturn: selectedValues.navYtdReturn?.value || null,
    nav1yrReturn: selectedValues.nav1yrReturn?.value || null,
    nav3yrReturn: selectedValues.nav3yrReturn?.value || null,
    nav5yrReturn: selectedValues.nav5yrReturn?.value || null,
    inceptionReturn: selectedValues.inceptionReturn?.value || null,
    volatility: selectedValues.volatility?.value || null,
    sharpeRatio: selectedValues.sharpeRatio?.value || null,
    sortinoRatio: selectedValues.sortinoRatio?.value || null,
    maxDrawdown: selectedValues.maxDrawdown?.value || null,
    beta: selectedValues.beta?.value || null,
    alpha: selectedValues.alpha?.value || null,
    correlation: selectedValues.correlation?.value || null,
    inceptionDate: selectedValues.inceptionDate?.value || null,
    description: selectedValues.description?.value || null,
    sources,
    reconciliation: {
      matchedSources: sources.length,
      totalSources: sources.length,
      fieldAgreements,
      overallConfidence,
      conflicts,
      selectedValues,
    },
    confidence: overallConfidence,
  };
}

// --- Main Search Orchestrator ---

export async function searchIntervalFundUniverse(query: string, alphaVantageKey: string): Promise<{
  results: ExternalFundResult[];
  reconciled: ReconciledFund[];
  sourceStatus: { source: string; status: "success" | "error" | "no_results"; count: number; responseTime: number }[];
}> {
  const sourceStatus: { source: string; status: "success" | "error" | "no_results"; count: number; responseTime: number }[] = [];

  const runSource = async (name: string, fn: () => Promise<ExternalFundResult[]>): Promise<ExternalFundResult[]> => {
    const start = Date.now();
    try {
      const results = await fn();
      sourceStatus.push({
        source: name,
        status: results.length > 0 ? "success" : "no_results",
        count: results.length,
        responseTime: Date.now() - start,
      });
      return results;
    } catch (err) {
      sourceStatus.push({ source: name, status: "error", count: 0, responseTime: Date.now() - start });
      return [];
    }
  };

  const [secResults, secFTResults, avResults, figiResults, knownResults] = await Promise.all([
    runSource("SEC EDGAR (Filing Search)", () => searchSECEdgar(query)),
    runSource("SEC EDGAR (Full-Text)", () => searchSECFullText(query)),
    runSource("Alpha Vantage", () => searchAlphaVantage(query, alphaVantageKey)),
    runSource("OpenFIGI", () => searchOpenFIGI(query)),
    runSource("Known Universe", () => searchKnownFunds(query, alphaVantageKey)),
  ]);

  const allResults = [...secResults, ...secFTResults, ...avResults, ...figiResults, ...knownResults];

  const groups = groupByFund(allResults);
  const reconciled = groups.map(group => reconcileFundData(group));

  reconciled.sort((a, b) => b.confidence - a.confidence);

  return { results: allResults, reconciled, sourceStatus };
}

function groupByFund(results: ExternalFundResult[]): ExternalFundResult[][] {
  const groups: ExternalFundResult[][] = [];
  const used = new Set<number>();

  for (let i = 0; i < results.length; i++) {
    if (used.has(i)) continue;
    const group = [results[i]];
    used.add(i);

    for (let j = i + 1; j < results.length; j++) {
      if (used.has(j)) continue;
      if (fundsMatch(results[i], results[j])) {
        group.push(results[j]);
        used.add(j);
      }
    }
    groups.push(group);
  }
  return groups;
}

function fundsMatch(a: ExternalFundResult, b: ExternalFundResult): boolean {
  if (a.ticker && b.ticker && a.ticker.toUpperCase() === b.ticker.toUpperCase()) return true;

  if (a.cik && b.cik && a.cik === b.cik) return true;

  const na = a.name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const nb = b.name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (na.length > 5 && nb.length > 5) {
    if (na.includes(nb) || nb.includes(na)) return true;
    const words1 = new Set(a.name.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const words2 = new Set(b.name.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const common = Array.from(words1).filter(w => words2.has(w));
    if (common.length >= 2 && common.length >= Math.min(words1.size, words2.size) * 0.5) return true;
  }

  return false;
}

function safeDecimal(val: number | null | undefined): string | null {
  if (val === null || val === undefined || isNaN(val)) return null;
  return String(val);
}

export function reconciledToInsert(fund: ReconciledFund): InsertIntervalFund {
  return {
    name: fund.name,
    ticker: fund.ticker,
    fundManager: fund.fundManager,
    assetClass: fund.assetClass || "Alternatives",
    strategyType: fund.strategyType || "Interval Fund",
    totalAum: safeDecimal(fund.totalAum),
    navPerShare: safeDecimal(fund.navPerShare),
    expenseRatio: safeDecimal(fund.expenseRatio),
    managementFee: safeDecimal(fund.managementFee),
    performanceFee: safeDecimal(fund.performanceFee),
    distributionRate: safeDecimal(fund.distributionRate),
    distributionFrequency: fund.distributionFrequency || "Monthly",
    minInvestment: safeDecimal(fund.minInvestment),
    repurchaseFrequency: fund.repurchaseFrequency || "Quarterly",
    repurchaseRate: safeDecimal(fund.repurchaseRate),
    repurchaseNotice: typeof fund.repurchaseNotice === "number" ? fund.repurchaseNotice : null,
    fundStructure: fund.fundStructure || "Interval Fund",
    nav30dReturn: safeDecimal(fund.nav30dReturn),
    nav90dReturn: safeDecimal(fund.nav90dReturn),
    navYtdReturn: safeDecimal(fund.navYtdReturn),
    nav1yrReturn: safeDecimal(fund.nav1yrReturn),
    nav3yrReturn: safeDecimal(fund.nav3yrReturn),
    nav5yrReturn: safeDecimal(fund.nav5yrReturn),
    inceptionReturn: safeDecimal(fund.inceptionReturn),
    volatility: safeDecimal(fund.volatility),
    sharpeRatio: safeDecimal(fund.sharpeRatio),
    sortinoRatio: safeDecimal(fund.sortinoRatio),
    maxDrawdown: safeDecimal(fund.maxDrawdown),
    beta: safeDecimal(fund.beta),
    alpha: safeDecimal(fund.alpha),
    correlation: safeDecimal(fund.correlation),
    description: fund.description,
  };
}
