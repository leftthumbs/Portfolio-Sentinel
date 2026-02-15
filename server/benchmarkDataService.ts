import { db } from "./db";
import { benchmarks, benchmarkReturns } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getHistoricalReturns } from "./tickerLookup";

const REAL_TICKERS = new Set([
  "SPY", "URTH", "EEM", "QQQ", "IWM", "EWU", "EWJ", "FEZ",
  "AGG", "IEF", "TLT", "HYG", "LQD", "TIP", "MUB", "BNDX",
  "VNQ", "VNQI", "REZ", "ICF",
  "GLD", "SLV", "DJP", "USO", "DBA",
  "IGF", "DBMF", "RPAR",
]);

const SYNTHETIC_TICKERS = new Set([
  "HFRI", "PE-IDX", "VC-IDX", "60/40", "AWP", "GAA",
]);

const refreshTimestamps = new Map<string, number>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function generateSyntheticReturns(ticker: string, days: number = 365): { date: Date; returnValue: string; cumulativeReturn: string }[] {
  const params: Record<string, { meanDaily: number; vol: number }> = {
    "HFRI": { meanDaily: 0.00018, vol: 0.005 },
    "PE-IDX": { meanDaily: 0.00035, vol: 0.008 },
    "VC-IDX": { meanDaily: 0.0004, vol: 0.012 },
    "60/40": { meanDaily: 0.00015, vol: 0.006 },
    "AWP": { meanDaily: 0.00013, vol: 0.004 },
    "GAA": { meanDaily: 0.00016, vol: 0.007 },
    "RPAR": { meanDaily: 0.00014, vol: 0.005 },
  };

  const p = params[ticker] || { meanDaily: 0.0002, vol: 0.008 };
  const results: { date: Date; returnValue: string; cumulativeReturn: string }[] = [];
  let cumReturn = 0;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    if (date.getDay() === 0 || date.getDay() === 6) continue;

    const dailyReturn = p.meanDaily + (Math.random() - 0.5) * p.vol * 2;
    cumReturn = (1 + cumReturn) * (1 + dailyReturn) - 1;

    results.push({
      date,
      returnValue: dailyReturn.toFixed(8),
      cumulativeReturn: cumReturn.toFixed(8),
    });
  }

  return results;
}

export async function refreshBenchmarkReturns(benchmarkId: string, ticker: string, apiKey: string): Promise<boolean> {
  const lastRefresh = refreshTimestamps.get(benchmarkId);
  if (lastRefresh && Date.now() - lastRefresh < CACHE_TTL_MS) {
    return true;
  }

  try {
    if (REAL_TICKERS.has(ticker)) {
      const historicalReturns = await getHistoricalReturns(ticker, apiKey, "daily");

      if (historicalReturns.length === 0) {
        console.log(`No Alpha Vantage data for ${ticker}, keeping existing data`);
        refreshTimestamps.set(benchmarkId, Date.now());
        return false;
      }

      await db.delete(benchmarkReturns).where(eq(benchmarkReturns.benchmarkId, benchmarkId));

      let cumReturn = 0;
      const returnsToInsert = historicalReturns.map((r) => {
        cumReturn = (1 + cumReturn) * (1 + r.returnValue) - 1;
        return {
          benchmarkId,
          date: new Date(r.date),
          returnValue: r.returnValue.toFixed(8),
          cumulativeReturn: cumReturn.toFixed(8),
        };
      });

      if (returnsToInsert.length > 0) {
        const batchSize = 500;
        for (let i = 0; i < returnsToInsert.length; i += batchSize) {
          await db.insert(benchmarkReturns).values(returnsToInsert.slice(i, i + batchSize));
        }
      }

      console.log(`Refreshed ${returnsToInsert.length} returns for ${ticker} from Alpha Vantage`);
      refreshTimestamps.set(benchmarkId, Date.now());
      return true;
    } else if (SYNTHETIC_TICKERS.has(ticker)) {
      const existing = await db.select().from(benchmarkReturns).where(eq(benchmarkReturns.benchmarkId, benchmarkId)).limit(1);
      if (existing.length > 0) {
        refreshTimestamps.set(benchmarkId, Date.now());
        return true;
      }

      const syntheticData = generateSyntheticReturns(ticker);
      if (syntheticData.length > 0) {
        const toInsert = syntheticData.map((d) => ({
          benchmarkId,
          date: d.date,
          returnValue: d.returnValue,
          cumulativeReturn: d.cumulativeReturn,
        }));
        const batchSize = 500;
        for (let i = 0; i < toInsert.length; i += batchSize) {
          await db.insert(benchmarkReturns).values(toInsert.slice(i, i + batchSize));
        }
        console.log(`Generated ${toInsert.length} synthetic returns for ${ticker}`);
      }
      refreshTimestamps.set(benchmarkId, Date.now());
      return true;
    }

    refreshTimestamps.set(benchmarkId, Date.now());
    return true;
  } catch (error) {
    console.error(`Error refreshing benchmark returns for ${ticker}:`, error);
    return false;
  }
}

export async function refreshAllBenchmarkReturns(apiKey: string): Promise<{ refreshed: number; failed: number; skipped: number }> {
  const allBenchmarks = await db.select().from(benchmarks);
  let refreshed = 0;
  let failed = 0;
  let skipped = 0;

  for (const benchmark of allBenchmarks) {
    const lastRefresh = refreshTimestamps.get(benchmark.id);
    if (lastRefresh && Date.now() - lastRefresh < CACHE_TTL_MS) {
      skipped++;
      continue;
    }

    if (REAL_TICKERS.has(benchmark.ticker)) {
      const success = await refreshBenchmarkReturns(benchmark.id, benchmark.ticker, apiKey);
      if (success) {
        refreshed++;
      } else {
        failed++;
      }
      await new Promise(resolve => setTimeout(resolve, 13000));
    } else {
      const success = await refreshBenchmarkReturns(benchmark.id, benchmark.ticker, apiKey);
      if (success) refreshed++;
      else failed++;
    }
  }

  return { refreshed, failed, skipped };
}

export async function refreshSingleBenchmark(benchmarkId: string, apiKey: string): Promise<boolean> {
  const [benchmark] = await db.select().from(benchmarks).where(eq(benchmarks.id, benchmarkId));
  if (!benchmark) return false;
  return refreshBenchmarkReturns(benchmark.id, benchmark.ticker, apiKey);
}

export function isRealTicker(ticker: string): boolean {
  return REAL_TICKERS.has(ticker);
}
