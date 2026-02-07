interface TickerData {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  previousClose: number;
  open: number;
  high: number;
  low: number;
  marketCap?: number;
  peRatio?: number;
  dividendYield?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  annualizedReturn?: number;
  annualizedVolatility?: number;
  historicalReturns?: { date: string; returnValue: number }[];
}

interface AlphaVantageQuote {
  "Global Quote": {
    "01. symbol": string;
    "02. open": string;
    "03. high": string;
    "04. low": string;
    "05. price": string;
    "06. volume": string;
    "07. latest trading day": string;
    "08. previous close": string;
    "09. change": string;
    "10. change percent": string;
  };
}

interface AlphaVantageOverview {
  Symbol: string;
  Name: string;
  MarketCapitalization: string;
  PERatio: string;
  DividendYield: string;
  "52WeekHigh": string;
  "52WeekLow": string;
  Beta: string;
}

interface AlphaVantageTimeSeries {
  "Meta Data": {
    "2. Symbol": string;
  };
  "Monthly Adjusted Time Series"?: {
    [date: string]: {
      "5. adjusted close": string;
    };
  };
  "Time Series (Daily)"?: {
    [date: string]: {
      "4. close": string;
      "5. adjusted close"?: string;
    };
  };
}

// Helper to add delay between API calls (Alpha Vantage free tier limit: 1 request/second)
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function lookupTicker(symbol: string, apiKey: string): Promise<TickerData | null> {
  try {
    const quoteResponse = await fetch(
      `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${apiKey}`
    );
    const quoteData: AlphaVantageQuote = await quoteResponse.json();

    if (!quoteData["Global Quote"] || !quoteData["Global Quote"]["01. symbol"]) {
      console.log(`No quote data found for ${symbol}`);
      return null;
    }

    const quote = quoteData["Global Quote"];

    // Wait 1.5 seconds to respect API rate limit
    await delay(1500);

    const overviewResponse = await fetch(
      `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${symbol}&apikey=${apiKey}`
    );
    const overview: AlphaVantageOverview = await overviewResponse.json();
    
    console.log(`Overview for ${symbol}:`, JSON.stringify(overview).substring(0, 200));

    const tickerData: TickerData = {
      symbol: quote["01. symbol"],
      name: overview.Name && overview.Name !== "" ? overview.Name : symbol,
      price: parseFloat(quote["05. price"]) || 0,
      change: parseFloat(quote["09. change"]) || 0,
      changePercent: parseFloat(quote["10. change percent"]?.replace("%", "")) || 0,
      volume: parseInt(quote["06. volume"]) || 0,
      previousClose: parseFloat(quote["08. previous close"]) || 0,
      open: parseFloat(quote["02. open"]) || 0,
      high: parseFloat(quote["03. high"]) || 0,
      low: parseFloat(quote["04. low"]) || 0,
      marketCap: overview.MarketCapitalization ? parseInt(overview.MarketCapitalization) : undefined,
      peRatio: overview.PERatio ? parseFloat(overview.PERatio) : undefined,
      dividendYield: overview.DividendYield ? parseFloat(overview.DividendYield) : undefined,
      fiftyTwoWeekHigh: overview["52WeekHigh"] ? parseFloat(overview["52WeekHigh"]) : undefined,
      fiftyTwoWeekLow: overview["52WeekLow"] ? parseFloat(overview["52WeekLow"]) : undefined,
    };

    return tickerData;
  } catch (error) {
    console.error(`Error looking up ticker ${symbol}:`, error);
    return null;
  }
}

export async function getHistoricalReturns(
  symbol: string, 
  apiKey: string,
  period: "monthly" | "daily" = "monthly"
): Promise<{ date: string; returnValue: number }[]> {
  try {
    let url: string;
    if (period === "monthly") {
      url = `https://www.alphavantage.co/query?function=TIME_SERIES_MONTHLY_ADJUSTED&symbol=${symbol}&apikey=${apiKey}`;
    } else {
      url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${symbol}&outputsize=full&apikey=${apiKey}`;
    }

    const response = await fetch(url);
    const data: AlphaVantageTimeSeries = await response.json();

    const returns: { date: string; returnValue: number }[] = [];
    
    let timeSeries: { [date: string]: any } | undefined;
    if (period === "monthly") {
      timeSeries = data["Monthly Adjusted Time Series"];
    } else {
      timeSeries = data["Time Series (Daily)"];
    }

    if (!timeSeries) {
      console.log(`No time series data found for ${symbol}`);
      return [];
    }

    const dates = Object.keys(timeSeries).sort();
    
    for (let i = 1; i < dates.length; i++) {
      const currentDate = dates[i];
      const previousDate = dates[i - 1];
      
      const currentClose = parseFloat(timeSeries[currentDate]["5. adjusted close"] || timeSeries[currentDate]["4. close"]);
      const previousClose = parseFloat(timeSeries[previousDate]["5. adjusted close"] || timeSeries[previousDate]["4. close"]);
      
      if (currentClose && previousClose && previousClose !== 0) {
        const periodReturn = (currentClose - previousClose) / previousClose;
        returns.push({
          date: currentDate,
          returnValue: periodReturn
        });
      }
    }

    return returns;
  } catch (error) {
    console.error(`Error fetching historical returns for ${symbol}:`, error);
    return [];
  }
}

export function calculateAnnualizedMetrics(returns: { date: string; returnValue: number }[], isMonthly: boolean = true): {
  annualizedReturn: number | null;
  annualizedVolatility: number | null;
} {
  if (!returns || returns.length === 0) {
    return { annualizedReturn: null, annualizedVolatility: null };
  }

  const avgReturn = returns.reduce((sum, r) => sum + r.returnValue, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r.returnValue - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  const periodsPerYear = isMonthly ? 12 : 252;
  
  const annualizedReturn = avgReturn * periodsPerYear;
  const annualizedVolatility = stdDev * Math.sqrt(periodsPerYear);

  if (isNaN(annualizedReturn) || isNaN(annualizedVolatility)) {
    return { annualizedReturn: null, annualizedVolatility: null };
  }
  
  return { annualizedReturn, annualizedVolatility };
}

export async function getTickerWithMetrics(symbol: string, apiKey: string): Promise<TickerData | null> {
  const tickerData = await lookupTicker(symbol, apiKey);
  
  if (!tickerData) {
    return null;
  }

  // Wait 1.5 seconds before next API call to respect rate limit
  await delay(1500);
  
  const historicalReturns = await getHistoricalReturns(symbol, apiKey, "monthly");
  
  if (historicalReturns.length > 0) {
    const metrics = calculateAnnualizedMetrics(historicalReturns, true);
    tickerData.annualizedReturn = metrics.annualizedReturn ?? undefined;
    tickerData.annualizedVolatility = metrics.annualizedVolatility ?? undefined;
    tickerData.historicalReturns = historicalReturns;
  } else {
    // Provide default estimates when historical data isn't available
    // These are rough market average defaults
    tickerData.annualizedReturn = 0.10; // 10% default expected return
    tickerData.annualizedVolatility = 0.16; // 16% default volatility
    console.log(`Using default metrics for ${symbol} (no historical data available)`);
  }

  return tickerData;
}
