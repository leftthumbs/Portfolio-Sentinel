/**
 * Alpha Vantage Fund Data Feed
 * Extends existing Alpha Vantage integration for interval fund NAV history.
 * Free tier: 25 requests/day, 5 per minute. Requires API key.
 */

const AV_BASE = "https://www.alphavantage.co/query";

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Types ---

export interface AvFundData {
  source: "alpha-vantage";
  ticker: string;
  fundName: string | null;
  // Current
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  // Fundamentals (from OVERVIEW where available)
  dividendYield: number | null;
  beta: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  // Computed from monthly history
  return1yr: number | null;
  return3yr: number | null;
  annualizedVolatility: number | null;
  monthlyPrices: { date: string; close: number }[];
  fetchedAt: string;
}

// --- Cache ---

const avCache = new Map<string, { data: AvFundData; at: number }>();
const AV_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours (conservative with 25/day limit)

function getApiKey(): string | null {
  return process.env.ALPHA_VANTAGE_API_KEY || null;
}

/**
 * Fetch current quote for a fund ticker
 */
async function fetchQuote(ticker: string, apiKey: string): Promise<{
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  name: string | null;
}> {
  try {
    const url = `${AV_BASE}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`AV quote: ${resp.status}`);

    const data = await resp.json() as any;
    const q = data["Global Quote"];
    if (!q || !q["05. price"]) return { price: null, previousClose: null, change: null, changePercent: null, name: null };

    return {
      price: parseFloat(q["05. price"]) || null,
      previousClose: parseFloat(q["08. previous close"]) || null,
      change: parseFloat(q["09. change"]) || null,
      changePercent: parseFloat((q["10. change percent"] || "").replace("%", "")) || null,
      name: null,
    };
  } catch (error) {
    console.error(`AV quote error for ${ticker}:`, error);
    return { price: null, previousClose: null, change: null, changePercent: null, name: null };
  }
}

/**
 * Fetch fundamental overview data (works for stocks/ETFs, limited for mutual funds)
 */
async function fetchOverview(ticker: string, apiKey: string): Promise<{
  name: string | null;
  dividendYield: number | null;
  beta: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
}> {
  try {
    const url = `${AV_BASE}?function=OVERVIEW&symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`AV overview: ${resp.status}`);

    const data = await resp.json() as any;
    return {
      name: data.Name || null,
      dividendYield: data.DividendYield ? parseFloat(data.DividendYield) : null,
      beta: data.Beta ? parseFloat(data.Beta) : null,
      fiftyTwoWeekHigh: data["52WeekHigh"] ? parseFloat(data["52WeekHigh"]) : null,
      fiftyTwoWeekLow: data["52WeekLow"] ? parseFloat(data["52WeekLow"]) : null,
    };
  } catch (error) {
    console.error(`AV overview error for ${ticker}:`, error);
    return { name: null, dividendYield: null, beta: null, fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null };
  }
}

/**
 * Fetch monthly adjusted time series for return calculations
 */
async function fetchMonthlyHistory(ticker: string, apiKey: string): Promise<{ date: string; close: number }[]> {
  try {
    const url = `${AV_BASE}?function=TIME_SERIES_MONTHLY_ADJUSTED&symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`AV monthly: ${resp.status}`);

    const data = await resp.json() as any;
    const series = data["Monthly Adjusted Time Series"];
    if (!series) return [];

    const prices: { date: string; close: number }[] = [];
    for (const [date, values] of Object.entries(series) as [string, any][]) {
      const adjClose = parseFloat(values["5. adjusted close"]);
      if (!isNaN(adjClose)) {
        prices.push({ date, close: adjClose });
      }
    }

    // Sort ascending by date
    prices.sort((a, b) => a.date.localeCompare(b.date));
    return prices;
  } catch (error) {
    console.error(`AV monthly history error for ${ticker}:`, error);
    return [];
  }
}

/**
 * Compute return over N months from monthly prices
 */
function computeMonthlyReturn(prices: { date: string; close: number }[], months: number): number | null {
  if (prices.length < months + 1) return null;
  const latest = prices[prices.length - 1];
  const past = prices[prices.length - 1 - months];
  if (!past || past.close === 0) return null;
  return (latest.close - past.close) / past.close;
}

/**
 * Compute annualized volatility from monthly returns
 */
function computeMonthlyVolatility(prices: { date: string; close: number }[], months: number): number | null {
  const slice = prices.slice(-months);
  if (slice.length < 6) return null;

  const returns: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1].close > 0) {
      returns.push((slice[i].close - slice[i - 1].close) / slice[i - 1].close);
    }
  }
  if (returns.length < 3) return null;

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance * 12); // annualize monthly vol
}

/**
 * Main entry: Fetch comprehensive fund data from Alpha Vantage.
 * Makes 3 API calls (quote + overview + monthly history) with rate limiting.
 */
export async function fetchAvFundData(ticker: string): Promise<AvFundData | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.log("ALPHA_VANTAGE_API_KEY not configured");
    return null;
  }

  // Check cache
  const cached = avCache.get(ticker.toUpperCase());
  if (cached && Date.now() - cached.at < AV_CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    // Quote
    const quote = await fetchQuote(ticker, apiKey);
    await delay(1500); // respect rate limit

    // Overview
    const overview = await fetchOverview(ticker, apiKey);
    await delay(1500);

    // Monthly history
    const monthly = await fetchMonthlyHistory(ticker, apiKey);

    const result: AvFundData = {
      source: "alpha-vantage",
      ticker: ticker.toUpperCase(),
      fundName: overview.name || quote.name || null,
      price: quote.price,
      previousClose: quote.previousClose,
      change: quote.change,
      changePercent: quote.changePercent,
      dividendYield: overview.dividendYield,
      beta: overview.beta,
      fiftyTwoWeekHigh: overview.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: overview.fiftyTwoWeekLow,
      return1yr: computeMonthlyReturn(monthly, 12),
      return3yr: computeMonthlyReturn(monthly, 36),
      annualizedVolatility: computeMonthlyVolatility(monthly, 36),
      monthlyPrices: monthly.slice(-36), // last 3 years
      fetchedAt: new Date().toISOString(),
    };

    avCache.set(ticker.toUpperCase(), { data: result, at: Date.now() });
    return result;
  } catch (error) {
    console.error(`AV fetch error for ${ticker}:`, error);
    return null;
  }
}

/**
 * Batch fetch — very conservative due to 25/day limit.
 * Only fetches tickers not already cached.
 */
export async function fetchAvDataBatch(tickers: string[]): Promise<Map<string, AvFundData>> {
  const results = new Map<string, AvFundData>();

  for (const ticker of tickers) {
    const cached = avCache.get(ticker.toUpperCase());
    if (cached && Date.now() - cached.at < AV_CACHE_TTL_MS) {
      results.set(ticker.toUpperCase(), cached.data);
      continue;
    }

    const data = await fetchAvFundData(ticker);
    if (data) {
      results.set(ticker.toUpperCase(), data);
    }
    // Extra delay between batch items (3 calls per fund × 1.5s = 4.5s + buffer)
    await delay(2000);
  }

  return results;
}

export function clearAvCache(): void {
  avCache.clear();
}
