/**
 * Financial Modeling Prep (FMP) Data Feed
 * Provides real-time quotes, historical prices, and fund profiles.
 * Free tier: 250 requests/day. Requires API key.
 * Docs: https://site.financialmodelingprep.com/developer/docs
 */

const FMP_BASE = "https://financialmodelingprep.com/api/v3";

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Types ---

export interface FmpQuote {
  symbol: string;
  name: string;
  price: number;
  changesPercentage: number;
  change: number;
  dayLow: number;
  dayHigh: number;
  yearHigh: number;
  yearLow: number;
  marketCap: number | null;
  priceAvg50: number;
  priceAvg200: number;
  volume: number;
  avgVolume: number;
  exchange: string;
}

export interface FmpHistoricalPrice {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose: number;
  volume: number;
  changePercent: number;
}

export interface FmpFundData {
  source: "fmp";
  ticker: string;
  fundName: string | null;
  // Current pricing
  navPrice: number | null;
  dayChange: number | null;
  dayChangePercent: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  avg50Day: number | null;
  avg200Day: number | null;
  volume: number | null;
  // Computed from historical
  return30d: number | null;
  return90d: number | null;
  return1yr: number | null;
  return3yr: number | null;
  volatility30d: number | null;
  historicalPrices: FmpHistoricalPrice[];
  fetchedAt: string;
}

// --- Cache ---

const quoteCache = new Map<string, { data: FmpQuote; at: number }>();
const historyCache = new Map<string, { data: FmpHistoricalPrice[]; at: number }>();
const QUOTE_TTL_MS = 60 * 60 * 1000; // 1 hour
const HISTORY_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function getApiKey(): string | null {
  return process.env.FMP_API_KEY || null;
}

/**
 * Fetch a real-time quote for a single ticker
 */
export async function fetchFmpQuote(ticker: string): Promise<FmpQuote | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.log("FMP_API_KEY not configured");
    return null;
  }

  const cached = quoteCache.get(ticker);
  if (cached && Date.now() - cached.at < QUOTE_TTL_MS) {
    return cached.data;
  }

  try {
    const url = `${FMP_BASE}/quote/${encodeURIComponent(ticker)}?apikey=${apiKey}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`FMP quote: ${resp.status}`);

    const data = await resp.json() as FmpQuote[];
    if (!data || data.length === 0) return null;

    const quote = data[0];
    quoteCache.set(ticker, { data: quote, at: Date.now() });
    return quote;
  } catch (error) {
    console.error(`FMP quote error for ${ticker}:`, error);
    return null;
  }
}

/**
 * Fetch historical daily prices (up to 5 years on free tier)
 */
export async function fetchFmpHistory(ticker: string, from?: string): Promise<FmpHistoricalPrice[]> {
  const apiKey = getApiKey();
  if (!apiKey) return [];

  const cacheKey = `${ticker}-${from || "all"}`;
  const cached = historyCache.get(cacheKey);
  if (cached && Date.now() - cached.at < HISTORY_TTL_MS) {
    return cached.data;
  }

  try {
    let url = `${FMP_BASE}/historical-price-full/${encodeURIComponent(ticker)}?apikey=${apiKey}&serietype=line`;
    if (from) url += `&from=${from}`;

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`FMP history: ${resp.status}`);

    const data = await resp.json() as { historical?: FmpHistoricalPrice[] };
    const history = data.historical || [];

    historyCache.set(cacheKey, { data: history, at: Date.now() });
    return history;
  } catch (error) {
    console.error(`FMP history error for ${ticker}:`, error);
    return [];
  }
}

/**
 * Fetch quotes for multiple tickers in one call (FMP supports comma-separated, max 3 on free tier)
 */
export async function fetchFmpQuoteBatch(tickers: string[]): Promise<Map<string, FmpQuote>> {
  const apiKey = getApiKey();
  if (!apiKey) return new Map();

  const results = new Map<string, FmpQuote>();

  // FMP free tier allows max 3 symbols per batch call
  const batches: string[][] = [];
  for (let i = 0; i < tickers.length; i += 3) {
    batches.push(tickers.slice(i, i + 3));
  }

  for (const batch of batches) {
    try {
      const symbols = batch.join(",");
      const url = `${FMP_BASE}/quote/${encodeURIComponent(symbols)}?apikey=${apiKey}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`FMP batch quote: ${resp.status}`);

      const data = await resp.json() as FmpQuote[];
      for (const quote of data) {
        results.set(quote.symbol.toUpperCase(), quote);
        quoteCache.set(quote.symbol.toUpperCase(), { data: quote, at: Date.now() });
      }
    } catch (error) {
      console.error(`FMP batch error for ${batch.join(",")}:`, error);
    }
    await delay(500);
  }

  return results;
}

/**
 * Compute return over N calendar days from historical prices
 */
function computeReturn(prices: FmpHistoricalPrice[], days: number): number | null {
  if (prices.length < 2) return null;

  // prices are sorted newest first from FMP
  const sorted = [...prices].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const latest = sorted[0];

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  // Find the price closest to the cutoff date
  let closest = sorted[sorted.length - 1];
  for (const p of sorted) {
    if (new Date(p.date) <= cutoffDate) {
      closest = p;
      break;
    }
  }

  if (closest.adjClose === 0 || closest === latest) return null;
  return (latest.adjClose - closest.adjClose) / closest.adjClose;
}

/**
 * Compute annualized volatility from daily returns over a window
 */
function computeVolatility(prices: FmpHistoricalPrice[], days: number): number | null {
  const sorted = [...prices]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(-days);

  if (sorted.length < 10) return null;

  const returns: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1].adjClose > 0) {
      returns.push((sorted[i].adjClose - sorted[i - 1].adjClose) / sorted[i - 1].adjClose);
    }
  }

  if (returns.length < 5) return null;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance * 252); // annualize
}

/**
 * Main entry: Fetch comprehensive fund data from FMP.
 * Combines quote + historical prices into a unified result.
 */
export async function fetchFmpFundData(ticker: string): Promise<FmpFundData | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return null;
  }

  try {
    const quote = await fetchFmpQuote(ticker);
    await delay(300);

    // Fetch 4 years of history for return calculations
    const fourYearsAgo = new Date();
    fourYearsAgo.setFullYear(fourYearsAgo.getFullYear() - 4);
    const fromDate = fourYearsAgo.toISOString().split("T")[0];
    const history = await fetchFmpHistory(ticker, fromDate);

    return {
      source: "fmp",
      ticker: ticker.toUpperCase(),
      fundName: quote?.name || null,
      navPrice: quote?.price || null,
      dayChange: quote?.change || null,
      dayChangePercent: quote?.changesPercentage || null,
      yearHigh: quote?.yearHigh || null,
      yearLow: quote?.yearLow || null,
      avg50Day: quote?.priceAvg50 || null,
      avg200Day: quote?.priceAvg200 || null,
      volume: quote?.volume || null,
      return30d: computeReturn(history, 30),
      return90d: computeReturn(history, 90),
      return1yr: computeReturn(history, 365),
      return3yr: computeReturn(history, 365 * 3),
      volatility30d: computeVolatility(history, 30),
      historicalPrices: history.slice(0, 90), // last ~90 trading days
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`FMP fetch error for ${ticker}:`, error);
    return null;
  }
}

/**
 * Batch fetch FMP data for multiple tickers
 */
export async function fetchFmpDataBatch(tickers: string[]): Promise<Map<string, FmpFundData>> {
  const results = new Map<string, FmpFundData>();
  for (const ticker of tickers) {
    const data = await fetchFmpFundData(ticker);
    if (data) {
      results.set(ticker.toUpperCase(), data);
    }
    await delay(500);
  }
  return results;
}

export function clearFmpCache(): void {
  quoteCache.clear();
  historyCache.clear();
}
