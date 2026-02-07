interface TreasuryRateResponse {
  rate: number;
  date: string;
  source: string;
}

let cachedRate: { rate: number; date: string; fetchedAt: number } | null = null;
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function get3MonthTBillRate(): Promise<TreasuryRateResponse> {
  // Check cache first
  if (cachedRate && Date.now() - cachedRate.fetchedAt < CACHE_DURATION_MS) {
    return {
      rate: cachedRate.rate,
      date: cachedRate.date,
      source: "FRED (cached)"
    };
  }

  const apiKey = process.env.FRED_API_KEY;
  
  if (!apiKey) {
    console.log("FRED_API_KEY not configured, using fallback rate");
    return {
      rate: 0.04, // 4% fallback
      date: new Date().toISOString().split("T")[0],
      source: "fallback"
    };
  }

  try {
    // Fetch daily 3-month T-bill rate from FRED (DTB3 series)
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=DTB3&api_key=${apiKey}&file_type=json&sort_order=desc&limit=10`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`FRED API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.observations || data.observations.length === 0) {
      throw new Error("No observations returned from FRED API");
    }
    
    // Find the most recent valid observation (skip "." values which indicate no data)
    let latestObservation = null;
    for (const obs of data.observations) {
      if (obs.value && obs.value !== ".") {
        latestObservation = obs;
        break;
      }
    }
    
    if (!latestObservation) {
      throw new Error("No valid rate found in FRED data");
    }
    
    // FRED returns rate as percentage (e.g., 4.25), convert to decimal (0.0425)
    const ratePercent = parseFloat(latestObservation.value);
    const rateDecimal = ratePercent / 100;
    
    // Update cache
    cachedRate = {
      rate: rateDecimal,
      date: latestObservation.date,
      fetchedAt: Date.now()
    };
    
    console.log(`Fetched 3-month T-bill rate: ${ratePercent}% (${rateDecimal}) as of ${latestObservation.date}`);
    
    return {
      rate: rateDecimal,
      date: latestObservation.date,
      source: "FRED"
    };
  } catch (error) {
    console.error("Error fetching T-bill rate from FRED:", error);
    
    // Return cached value if available, otherwise fallback
    if (cachedRate) {
      return {
        rate: cachedRate.rate,
        date: cachedRate.date,
        source: "FRED (stale cache)"
      };
    }
    
    return {
      rate: 0.04, // 4% fallback
      date: new Date().toISOString().split("T")[0],
      source: "fallback"
    };
  }
}

export function clearRateCache(): void {
  cachedRate = null;
}
