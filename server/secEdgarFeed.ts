/**
 * SEC EDGAR Data Feed
 * Fetches interval fund data from SEC filings (N-PORT, company info)
 * Free, no authentication required. Rate limit: 10 req/sec.
 * Requires User-Agent header per SEC policy.
 */

const SEC_USER_AGENT = "Portfolio-Sentinel admin@portfolio-sentinel.com";
const SEC_BASE = "https://data.sec.gov";
const SEC_RATE_DELAY_MS = 150; // stay well under 10/sec

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Types ---

export interface SecFundInfo {
  cik: string;
  name: string;
  ticker: string;
  seriesId?: string;
  classId?: string;
}

export interface SecFilingRef {
  accessionNumber: string;
  filingDate: string;
  form: string;
  primaryDocument: string;
}

export interface SecFundData {
  source: "sec-edgar";
  ticker: string;
  cik: string;
  fundName: string;
  filingDate: string | null;
  totalNetAssets: number | null;
  // From N-PORT monthly returns (3 months reported)
  monthlyReturns: { month: number; classReturn: number }[];
  // From latest filing metadata
  latestFilingType: string | null;
  latestFilingDate: string | null;
  fetchedAt: string;
}

// --- CIK ticker map cache ---

let tickerMapCache: Map<string, SecFundInfo> | null = null;
let tickerMapFetchedAt = 0;
const TICKER_MAP_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Load the SEC mutual fund ticker→CIK mapping.
 * File: https://www.sec.gov/files/company_tickers_mf.json
 */
export async function loadTickerMap(): Promise<Map<string, SecFundInfo>> {
  if (tickerMapCache && Date.now() - tickerMapFetchedAt < TICKER_MAP_TTL_MS) {
    return tickerMapCache;
  }

  try {
    const resp = await fetch("https://www.sec.gov/files/company_tickers_mf.json", {
      headers: { "User-Agent": SEC_USER_AGENT },
    });
    if (!resp.ok) throw new Error(`SEC ticker map: ${resp.status}`);
    const data = await resp.json() as { data: string[][] };

    const map = new Map<string, SecFundInfo>();
    // data.data is an array of [seriesId, cik, companyName, classTicker, classId]
    if (data.data) {
      for (const row of data.data) {
        const ticker = (row[3] || "").toUpperCase().trim();
        if (ticker) {
          map.set(ticker, {
            cik: String(row[1]).padStart(10, "0"),
            name: row[2],
            ticker,
            seriesId: row[0],
            classId: row[4],
          });
        }
      }
    }

    tickerMapCache = map;
    tickerMapFetchedAt = Date.now();
    console.log(`SEC ticker map loaded: ${map.size} mutual fund tickers`);
    return map;
  } catch (error) {
    console.error("Failed to load SEC ticker map:", error);
    return tickerMapCache || new Map();
  }
}

/**
 * Lookup a fund's CIK from its ticker symbol
 */
export async function lookupCik(ticker: string): Promise<SecFundInfo | null> {
  const map = await loadTickerMap();
  return map.get(ticker.toUpperCase()) || null;
}

/**
 * Fetch recent filings for a given CIK from EDGAR submissions endpoint
 */
export async function getRecentFilings(cik: string): Promise<SecFilingRef[]> {
  try {
    const paddedCik = cik.padStart(10, "0");
    const url = `${SEC_BASE}/submissions/CIK${paddedCik}.json`;

    const resp = await fetch(url, {
      headers: { "User-Agent": SEC_USER_AGENT },
    });
    if (!resp.ok) throw new Error(`SEC submissions: ${resp.status}`);

    const data = await resp.json() as {
      name: string;
      cik: string;
      recentFilings?: {
        accessionNumber: string[];
        filingDate: string[];
        form: string[];
        primaryDocument: string[];
      };
      filings?: {
        recent?: {
          accessionNumber: string[];
          filingDate: string[];
          form: string[];
          primaryDocument: string[];
        };
      };
    };

    // EDGAR returns filings in filings.recent or recentFilings
    const recent = data.filings?.recent || data.recentFilings;
    if (!recent || !recent.accessionNumber) return [];

    const filings: SecFilingRef[] = [];
    const count = Math.min(recent.accessionNumber.length, 50);
    for (let i = 0; i < count; i++) {
      filings.push({
        accessionNumber: recent.accessionNumber[i],
        filingDate: recent.filingDate[i],
        form: recent.form[i],
        primaryDocument: recent.primaryDocument[i],
      });
    }
    return filings;
  } catch (error) {
    console.error(`SEC getRecentFilings error for CIK ${cik}:`, error);
    return [];
  }
}

/**
 * Fetch N-PORT XML filing and extract key data.
 * N-PORT reports contain total net assets and monthly class returns.
 */
async function parseNportData(cik: string, accession: string, primaryDoc: string): Promise<{
  totalNetAssets: number | null;
  monthlyReturns: { month: number; classReturn: number }[];
}> {
  try {
    const accessionPath = accession.replace(/-/g, "");
    const url = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${accessionPath}/${primaryDoc}`;

    const resp = await fetch(url, {
      headers: { "User-Agent": SEC_USER_AGENT },
    });
    if (!resp.ok) throw new Error(`N-PORT fetch: ${resp.status}`);

    const text = await resp.text();

    // Extract total net assets from XML
    let totalNetAssets: number | null = null;
    const netAssetsMatch = text.match(/<netAssets>([^<]+)<\/netAssets>/i)
      || text.match(/<totalNetAssets>([^<]+)<\/totalNetAssets>/i);
    if (netAssetsMatch) {
      totalNetAssets = parseFloat(netAssetsMatch[1]);
      if (isNaN(totalNetAssets)) totalNetAssets = null;
    }

    // Extract monthly returns (N-PORT reports 3 months of class-level returns)
    const monthlyReturns: { month: number; classReturn: number }[] = [];
    const returnPattern = /<mon(\d)ReturnsCat[^>]*>([^<]*)<\/mon\dReturnsCat[^>]*>/gi;
    let match;
    while ((match = returnPattern.exec(text)) !== null) {
      const monthNum = parseInt(match[1]);
      const retVal = parseFloat(match[2]);
      if (!isNaN(retVal)) {
        monthlyReturns.push({ month: monthNum, classReturn: retVal });
      }
    }

    // Also try alternative XML tag patterns
    const altReturnPattern = /<rtnMon(\d)>([^<]*)<\/rtnMon\d>/gi;
    while ((match = altReturnPattern.exec(text)) !== null) {
      const monthNum = parseInt(match[1]);
      const retVal = parseFloat(match[2]);
      if (!isNaN(retVal) && !monthlyReturns.some(r => r.month === monthNum)) {
        monthlyReturns.push({ month: monthNum, classReturn: retVal });
      }
    }

    return { totalNetAssets, monthlyReturns };
  } catch (error) {
    console.error("N-PORT parse error:", error);
    return { totalNetAssets: null, monthlyReturns: [] };
  }
}

/**
 * Main entry: Fetch SEC data for an interval fund by ticker.
 * Returns filing info, net assets, and monthly returns from N-PORT.
 */
export async function fetchSecFundData(ticker: string): Promise<SecFundData | null> {
  try {
    // 1. Lookup CIK
    const fundInfo = await lookupCik(ticker);
    if (!fundInfo) {
      console.log(`SEC: No CIK found for ticker ${ticker}`);
      return null;
    }

    await delay(SEC_RATE_DELAY_MS);

    // 2. Get recent filings
    const filings = await getRecentFilings(fundInfo.cik);
    if (filings.length === 0) {
      return {
        source: "sec-edgar",
        ticker,
        cik: fundInfo.cik,
        fundName: fundInfo.name,
        filingDate: null,
        totalNetAssets: null,
        monthlyReturns: [],
        latestFilingType: null,
        latestFilingDate: null,
        fetchedAt: new Date().toISOString(),
      };
    }

    // 3. Find latest N-PORT filing
    const nportFiling = filings.find(f => f.form.includes("N-PORT") || f.form.includes("NPORT"));
    const latestFiling = filings[0];

    let totalNetAssets: number | null = null;
    let monthlyReturns: { month: number; classReturn: number }[] = [];
    let nportDate: string | null = null;

    if (nportFiling) {
      await delay(SEC_RATE_DELAY_MS);
      const nportData = await parseNportData(fundInfo.cik, nportFiling.accessionNumber, nportFiling.primaryDocument);
      totalNetAssets = nportData.totalNetAssets;
      monthlyReturns = nportData.monthlyReturns;
      nportDate = nportFiling.filingDate;
    }

    return {
      source: "sec-edgar",
      ticker,
      cik: fundInfo.cik,
      fundName: fundInfo.name,
      filingDate: nportDate,
      totalNetAssets,
      monthlyReturns,
      latestFilingType: latestFiling.form,
      latestFilingDate: latestFiling.filingDate,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`SEC fetch error for ${ticker}:`, error);
    return null;
  }
}

/**
 * Batch fetch SEC data for multiple tickers with rate limiting
 */
export async function fetchSecDataBatch(tickers: string[]): Promise<Map<string, SecFundData>> {
  const results = new Map<string, SecFundData>();
  for (const ticker of tickers) {
    const data = await fetchSecFundData(ticker);
    if (data) {
      results.set(ticker.toUpperCase(), data);
    }
    await delay(SEC_RATE_DELAY_MS * 2);
  }
  return results;
}
