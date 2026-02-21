/**
 * Benchmark Calculations Module
 *
 * Provides time series aggregation and period-aware calculations for benchmark data.
 * Handles converting raw daily returns into monthly/quarterly figures and filtering
 * by time period to match portfolio and strategy cadence.
 */

export type Cadence = "daily" | "monthly" | "quarterly";
export type TimePeriod = "YTD" | "LTM" | "1Y" | "3Y" | "5Y" | "10Y" | "SI";

export interface ReturnDataPoint {
  date: Date | string;
  returnValue: string;
  cumulativeReturn?: string | null;
}

export interface AggregatedReturn {
  date: string;
  periodStartDate: string;
  periodEndDate: string;
  returnValue: string;
  cumulativeReturn: string;
  cadence: Cadence;
}

/**
 * Determines the time period start date for a given period selection.
 */
export function getTimePeriodStartDate(period: TimePeriod, inceptionDate?: Date): Date {
  const now = new Date();

  switch (period) {
    case "YTD":
      return new Date(now.getFullYear(), 0, 1);
    case "LTM":
    case "1Y":
      return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    case "3Y":
      return new Date(now.getFullYear() - 3, now.getMonth(), now.getDate());
    case "5Y":
      return new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
    case "10Y":
      return new Date(now.getFullYear() - 10, now.getMonth(), now.getDate());
    case "SI":
      return inceptionDate || new Date(2000, 0, 1);
    default:
      return new Date(now.getFullYear(), 0, 1);
  }
}

/**
 * Determines the appropriate cadence based on the time period and an optional
 * portfolio/strategy cadence override.
 *
 * Logic:
 * - YTD/LTM/1Y: daily (short period, daily granularity is appropriate)
 * - 3Y: monthly (too many daily points, monthly gives clearer picture)
 * - 5Y/10Y/SI: monthly by default; quarterly if portfolio cadence is quarterly
 */
export function determineCadence(timePeriod: TimePeriod, portfolioCadence?: Cadence): Cadence {
  // If portfolio explicitly specifies a cadence, respect it
  if (portfolioCadence) {
    return portfolioCadence;
  }

  switch (timePeriod) {
    case "YTD":
    case "LTM":
    case "1Y":
      return "daily";
    case "3Y":
      return "monthly";
    case "5Y":
    case "10Y":
    case "SI":
      return "monthly";
    default:
      return "daily";
  }
}

/**
 * Filters return data points to only include those within the specified time period.
 */
export function filterReturnsByTimePeriod(
  returns: ReturnDataPoint[],
  timePeriod: TimePeriod,
  inceptionDate?: Date
): ReturnDataPoint[] {
  const startDate = getTimePeriodStartDate(timePeriod, inceptionDate);

  return returns.filter((r) => {
    const date = r.date instanceof Date ? r.date : new Date(r.date);
    return date >= startDate;
  });
}

/**
 * Gets the period key for a date based on the cadence.
 * - daily: YYYY-MM-DD
 * - monthly: YYYY-MM
 * - quarterly: YYYY-QN
 */
function getPeriodKey(date: Date, cadence: Cadence): string {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed

  switch (cadence) {
    case "daily":
      return date.toISOString().split("T")[0];
    case "monthly":
      return `${year}-${String(month + 1).padStart(2, "0")}`;
    case "quarterly": {
      const quarter = Math.floor(month / 3) + 1;
      return `${year}-Q${quarter}`;
    }
    default:
      return date.toISOString().split("T")[0];
  }
}

/**
 * Gets the last day of a period for display purposes.
 */
function getPeriodEndDate(periodKey: string, cadence: Cadence): string {
  if (cadence === "daily") {
    return periodKey;
  }

  if (cadence === "monthly") {
    const [year, month] = periodKey.split("-").map(Number);
    const lastDay = new Date(year, month, 0); // Day 0 of next month = last day of this month
    return lastDay.toISOString().split("T")[0];
  }

  if (cadence === "quarterly") {
    const [yearStr, qStr] = periodKey.split("-Q");
    const year = parseInt(yearStr);
    const quarter = parseInt(qStr);
    const lastMonth = quarter * 3; // e.g., Q1 -> month 3 (March)
    const lastDay = new Date(year, lastMonth, 0);
    return lastDay.toISOString().split("T")[0];
  }

  return periodKey;
}

/**
 * Gets the first day of a period.
 */
function getPeriodStartDate(periodKey: string, cadence: Cadence): string {
  if (cadence === "daily") {
    return periodKey;
  }

  if (cadence === "monthly") {
    return `${periodKey}-01`;
  }

  if (cadence === "quarterly") {
    const [yearStr, qStr] = periodKey.split("-Q");
    const quarter = parseInt(qStr);
    const firstMonth = (quarter - 1) * 3 + 1; // Q1 -> 1, Q2 -> 4, Q3 -> 7, Q4 -> 10
    return `${yearStr}-${String(firstMonth).padStart(2, "0")}-01`;
  }

  return periodKey;
}

/**
 * Aggregates daily return data into the specified cadence (monthly or quarterly).
 *
 * For each period, compounds the daily returns within that period:
 *   period_return = product((1 + daily_return) for each day in period) - 1
 *
 * Then recalculates cumulative returns across the aggregated periods.
 */
export function aggregateReturns(
  returns: ReturnDataPoint[],
  cadence: Cadence
): AggregatedReturn[] {
  if (cadence === "daily") {
    // No aggregation needed; just normalize the format
    let cumulative = 0;
    return returns.map((r) => {
      const dateStr =
        r.date instanceof Date
          ? r.date.toISOString().split("T")[0]
          : new Date(r.date).toISOString().split("T")[0];
      const returnVal = parseFloat(r.returnValue);
      cumulative = (1 + cumulative) * (1 + returnVal) - 1;

      return {
        date: dateStr,
        periodStartDate: dateStr,
        periodEndDate: dateStr,
        returnValue: String(returnVal),
        cumulativeReturn: String(cumulative),
        cadence: "daily" as Cadence,
      };
    });
  }

  // Group daily returns by period
  const periodGroups = new Map<
    string,
    { returns: number[]; firstDate: Date; lastDate: Date }
  >();

  for (const r of returns) {
    const date = r.date instanceof Date ? r.date : new Date(r.date);
    const periodKey = getPeriodKey(date, cadence);
    const returnVal = parseFloat(r.returnValue);

    if (!periodGroups.has(periodKey)) {
      periodGroups.set(periodKey, {
        returns: [],
        firstDate: date,
        lastDate: date,
      });
    }

    const group = periodGroups.get(periodKey)!;
    group.returns.push(returnVal);
    if (date < group.firstDate) group.firstDate = date;
    if (date > group.lastDate) group.lastDate = date;
  }

  // Sort period keys chronologically
  const sortedPeriods = Array.from(periodGroups.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  // Compound daily returns within each period and build cumulative
  let cumulativeReturn = 0;
  const aggregated: AggregatedReturn[] = [];

  for (const [periodKey, group] of sortedPeriods) {
    // Compound daily returns within the period
    let periodReturn = 1;
    for (const dailyReturn of group.returns) {
      periodReturn *= 1 + dailyReturn;
    }
    periodReturn -= 1;

    // Update cumulative return
    cumulativeReturn = (1 + cumulativeReturn) * (1 + periodReturn) - 1;

    aggregated.push({
      date: getPeriodEndDate(periodKey, cadence),
      periodStartDate: getPeriodStartDate(periodKey, cadence),
      periodEndDate: getPeriodEndDate(periodKey, cadence),
      returnValue: String(periodReturn),
      cumulativeReturn: String(cumulativeReturn),
      cadence,
    });
  }

  return aggregated;
}

/**
 * Full pipeline: filters by time period, then aggregates to the appropriate cadence.
 * This is the main entry point for processing benchmark returns.
 */
export function processReturnsForPeriod(
  returns: ReturnDataPoint[],
  timePeriod: TimePeriod,
  portfolioCadence?: Cadence,
  inceptionDate?: Date
): AggregatedReturn[] {
  // 1. Filter to time period
  const filtered = filterReturnsByTimePeriod(returns, timePeriod, inceptionDate);

  // 2. Determine cadence
  const cadence = determineCadence(timePeriod, portfolioCadence);

  // 3. Aggregate returns
  return aggregateReturns(filtered, cadence);
}

/**
 * Processes composite benchmark returns (multiple weighted components).
 * Downloads the full time series for each component, weights them,
 * then aggregates to the requested cadence.
 */
export function processCompositeReturns(
  componentReturns: Array<{ weight: number; returns: ReturnDataPoint[] }>,
  timePeriod: TimePeriod,
  portfolioCadence?: Cadence,
  inceptionDate?: Date
): AggregatedReturn[] {
  // 1. Filter each component's returns to the time period
  const startDate = getTimePeriodStartDate(timePeriod, inceptionDate);
  const cadence = determineCadence(timePeriod, portfolioCadence);

  // 2. Combine weighted daily returns by date
  const dateMap = new Map<string, number>();
  for (const { weight, returns } of componentReturns) {
    for (const r of returns) {
      const date =
        r.date instanceof Date ? r.date : new Date(r.date);
      if (date < startDate) continue;

      const dateKey = date.toISOString().split("T")[0];
      const existing = dateMap.get(dateKey) || 0;
      dateMap.set(dateKey, existing + parseFloat(r.returnValue) * weight);
    }
  }

  // 3. Convert to sorted array of ReturnDataPoints
  const combinedReturns: ReturnDataPoint[] = Array.from(dateMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, returnValue]) => ({
      date,
      returnValue: String(returnValue),
    }));

  // 4. Aggregate to requested cadence
  return aggregateReturns(combinedReturns, cadence);
}

/**
 * Calculates annualized return and volatility metrics from aggregated returns.
 */
export function calculateMetricsFromAggregated(
  aggregatedReturns: AggregatedReturn[]
): {
  totalReturn: number;
  annualizedReturn: number;
  annualizedVolatility: number;
  periodCount: number;
} {
  if (aggregatedReturns.length === 0) {
    return {
      totalReturn: 0,
      annualizedReturn: 0,
      annualizedVolatility: 0,
      periodCount: 0,
    };
  }

  const lastReturn = aggregatedReturns[aggregatedReturns.length - 1];
  const totalReturn = parseFloat(lastReturn.cumulativeReturn);

  // Determine periods per year based on cadence
  const cadence = lastReturn.cadence;
  let periodsPerYear: number;
  switch (cadence) {
    case "daily":
      periodsPerYear = 252;
      break;
    case "monthly":
      periodsPerYear = 12;
      break;
    case "quarterly":
      periodsPerYear = 4;
      break;
    default:
      periodsPerYear = 252;
  }

  const numPeriods = aggregatedReturns.length;
  const years = numPeriods / periodsPerYear;

  // Annualized return using CAGR formula
  const annualizedReturn =
    years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : totalReturn;

  // Annualized volatility
  const periodReturns = aggregatedReturns.map((r) =>
    parseFloat(r.returnValue)
  );
  const avgReturn =
    periodReturns.reduce((a, b) => a + b, 0) / periodReturns.length;
  const variance =
    periodReturns.reduce(
      (sum, r) => sum + Math.pow(r - avgReturn, 2),
      0
    ) / Math.max(periodReturns.length - 1, 1);
  const periodVolatility = Math.sqrt(variance);
  const annualizedVolatility = periodVolatility * Math.sqrt(periodsPerYear);

  return {
    totalReturn,
    annualizedReturn,
    annualizedVolatility,
    periodCount: numPeriods,
  };
}

/**
 * Maps a strategy/portfolio redemption frequency string to a Cadence.
 */
export function redemptionFrequencyToCadence(
  frequency: string | null | undefined
): Cadence | undefined {
  if (!frequency) return undefined;

  const lower = frequency.toLowerCase();
  if (lower === "daily" || lower === "weekly") return "daily";
  if (lower === "monthly") return "monthly";
  if (
    lower === "quarterly" ||
    lower === "semi-annual" ||
    lower === "annual"
  )
    return "quarterly";

  return undefined;
}
