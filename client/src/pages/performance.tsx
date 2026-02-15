import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePortfolio } from "@/hooks/use-portfolio";
import { getTimePeriodStartDate, getTimePeriodLabel, TimePeriod } from "@/components/time-period-selector";
import { AlertTriangle, Info } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ChartSkeleton, MetricCardSkeleton } from "@/components/loading-skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  ReferenceLine,
  ComposedChart,
  Bar,
  Cell,
  Legend,
} from "recharts";
import type { Portfolio, PerformanceHistory, Benchmark, BenchmarkReturn } from "@shared/schema";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { detectDataFrequency, formatDateForFrequency, formatDateFullForFrequency, getFrequencyLabel, getPeriodLabel, getRecentPeriodCount, getXAxisTickInterval } from "@/lib/data-frequency";

interface SelectedBenchmarkData {
  benchmark: Benchmark;
  returns: BenchmarkReturn[];
}

interface PerformanceData {
  portfolio: Portfolio;
  performanceHistory: PerformanceHistory[];
  selectedBenchmarks: Array<{ benchmark: Benchmark; returns: BenchmarkReturn[] }>;
  metrics: {
    totalReturn: number;
    annualizedReturn: number;
    benchmarkReturn: number;
    alpha: number;
    bestDay: number;
    worstDay: number;
    positivedays: number;
    totalDays: number;
  };
}

function formatCurrency(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(0)}K`;
  return `$${num.toFixed(0)}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDateFull(date: string | Date): string {
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}


function getStoredBenchmarkIds(portfolioKey: string): string[] {
  try {
    const stored = localStorage.getItem(`perf_benchmarks_${portfolioKey}`);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function setStoredBenchmarkIds(portfolioKey: string, ids: string[]) {
  localStorage.setItem(`perf_benchmarks_${portfolioKey}`, JSON.stringify(ids));
}

export default function PerformancePage() {
  const { toast } = useToast();
  const { selectedPortfolioId, selectedPortfolioType, selectedTimePeriod, selectedBenchmarkId, selectedBenchmark } = usePortfolio();

  // Build performance URL with timePeriod for period-aware benchmark calculations
  const buildPerformanceUrl = () => {
    const params = new URLSearchParams();
    if (selectedPortfolioId) {
      params.set("portfolioId", selectedPortfolioId);
      params.set("portfolioType", selectedPortfolioType);
    }
    if (selectedTimePeriod) {
      params.set("timePeriod", selectedTimePeriod);
    }
    if (selectedBenchmarkId) {
      params.set("benchmarkId", selectedBenchmarkId);
    }
    const qs = params.toString();
    return qs ? `/api/performance?${qs}` : "/api/performance";
  };

  const performanceUrl = buildPerformanceUrl();

  const portfolioKey = selectedPortfolioId
    ? `${selectedPortfolioType}_${selectedPortfolioId}`
    : "default";

  const [localBenchmarkIds, setLocalBenchmarkIds] = useState<string[]>(() => getStoredBenchmarkIds(portfolioKey));

  const { data, isLoading, error, refetch } = useQuery<PerformanceData & { isCustomPortfolio?: boolean }>({
    queryKey: ["/api/performance", selectedPortfolioId, selectedPortfolioType, selectedTimePeriod, selectedBenchmarkId],
    queryFn: async () => {
      const res = await fetch(performanceUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch performance data");
      return res.json();
    },
  });

  // Fetch benchmark returns for the globally selected benchmark (from sidebar)
  const isCompositeBenchmark = selectedBenchmark?.isComposite === true;
  const benchmarkApiId = isCompositeBenchmark && selectedBenchmarkId?.startsWith("composite-")
    ? selectedBenchmarkId.replace("composite-", "")
    : selectedBenchmarkId;

  const { data: globalBenchmarkReturns } = useQuery<{ returns: any[]; cadence?: "daily" | "monthly" | "quarterly"; metrics?: { totalReturn: number; annualizedReturn: number; annualizedVolatility: number; periodCount: number } }>({
    queryKey: [
      isCompositeBenchmark ? "/api/composite-benchmarks" : "/api/benchmarks",
      benchmarkApiId,
      "returns",
      selectedTimePeriod,
    ],
    queryFn: async () => {
      if (!benchmarkApiId) return { returns: [] };
      const baseUrl = isCompositeBenchmark
        ? `/api/composite-benchmarks/${benchmarkApiId}/returns`
        : `/api/benchmarks/${benchmarkApiId}/returns`;
      const params = new URLSearchParams();
      if (selectedTimePeriod) params.set("timePeriod", selectedTimePeriod);
      const qs = params.toString();
      const url = qs ? `${baseUrl}?${qs}` : baseUrl;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return { returns: [] };
      return res.json();
    },
    enabled: !!benchmarkApiId,

  });

  const { data: compositeBenchmarksData } = useQuery<{ compositeBenchmarks: any[] }>({
    queryKey: ["/api/composite-benchmarks"],
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <MetricCardSkeleton key={i} />
          ))}
        </div>
        <ChartSkeleton />
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartSkeleton />
          <ChartSkeleton />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-[400px] gap-4">
        <AlertTriangle className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">Failed to load performance data</p>
      </div>
    );
  }

  // Handle completely empty performance history (no data at all)
  if (!data.performanceHistory || data.performanceHistory.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-performance-title">Performance Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {data.portfolio.name} • No performance history available
          </p>
        </div>
        <div className="flex flex-col items-center justify-center h-[300px] gap-4 border rounded-lg">
          <AlertTriangle className="h-10 w-10 text-muted-foreground" />
          <p className="text-muted-foreground">No performance history data to display</p>
          <p className="text-xs text-muted-foreground">Import portfolio data or select a different portfolio to view analytics</p>
        </div>
      </div>
    );
  }

  const { portfolio, performanceHistory: rawPerformanceHistory, metrics } = data;

  const inceptionDate = rawPerformanceHistory.length > 0
    ? new Date(rawPerformanceHistory[0].date)
    : undefined;
  const startDate = getTimePeriodStartDate(selectedTimePeriod, inceptionDate);

  const performanceHistory = rawPerformanceHistory.filter(
    (p) => new Date(p.date) >= startDate
  );

  // Detect whether the selected time period is fully covered by available data
  const earliestDataDate = rawPerformanceHistory.length > 0
    ? new Date(rawPerformanceHistory[0].date)
    : null;
  const latestDataDate = rawPerformanceHistory.length > 0
    ? new Date(rawPerformanceHistory[rawPerformanceHistory.length - 1].date)
    : null;

  const requestedStartDate = startDate;
  const portfolioDataGap = earliestDataDate && earliestDataDate > requestedStartDate;
  const portfolioCoversDays = earliestDataDate && latestDataDate
    ? Math.round((latestDataDate.getTime() - earliestDataDate.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  // Map time period to approximate expected days
  const expectedDaysForPeriod = (period: string): number => {
    switch (period) {
      case "YTD": return Math.round((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (1000 * 60 * 60 * 24));
      case "LTM": case "1Y": return 365;
      case "3Y": return 365 * 3;
      case "5Y": return 365 * 5;
      case "10Y": return 365 * 10;
      case "SI": return 0; // Since Inception always fits
      default: return 365;
    }
  };

  const expectedDays = expectedDaysForPeriod(selectedTimePeriod);

  // No portfolio data at all for this time period
  const portfolioHasNoData = performanceHistory.length === 0;
  // Has some data but doesn't fully cover the period
  const portfolioHasPartialData = !portfolioHasNoData && portfolioDataGap && selectedTimePeriod !== "SI";
  // Benchmark has no data for this period
  const benchmarkHasNoData = (globalBenchmarkReturns?.returns?.length ?? 0) === 0 && !!benchmarkApiId;

  // If data exists in raw history but nothing falls within the selected time period, show an alert
  if (portfolioHasNoData && rawPerformanceHistory.length > 0) {
    const dataStart = formatDateFull(rawPerformanceHistory[0].date);
    const dataEnd = formatDateFull(rawPerformanceHistory[rawPerformanceHistory.length - 1].date);
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-performance-title">Performance Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {portfolio.name} • {getTimePeriodLabel(selectedTimePeriod)}
          </p>
        </div>
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Historical data not available for this period</AlertTitle>
          <AlertDescription>
            No portfolio data exists for the selected <strong>{getTimePeriodLabel(selectedTimePeriod)}</strong> time period.
            Available data ranges from <strong>{dataStart}</strong> to <strong>{dataEnd}</strong>.
            Try selecting a shorter time period or <strong>Since Inception (SI)</strong> to view all available data.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const dataFrequency = detectDataFrequency(performanceHistory.map(p => p.date));
  const periodLabel = getPeriodLabel(dataFrequency);
  const frequencyLabel = getFrequencyLabel(dataFrequency);

  const firstInPeriod = performanceHistory[0];
  const lastInPeriod = performanceHistory[performanceHistory.length - 1];

  let periodTotalReturn = 0;
  let periodAnnualizedReturn = 0;
  let periodBenchmarkReturn = 0;
  let periodAlpha = 0;
  let periodBestDay = 0;
  let periodWorstDay = 0;
  let periodPositiveDays = 0;

  if (firstInPeriod && lastInPeriod) {
    const startValue = parseFloat(firstInPeriod.portfolioValue);
    const endValue = parseFloat(lastInPeriod.portfolioValue);
    periodTotalReturn = startValue > 0 ? (endValue - startValue) / startValue : 0;

    const startDateMs = new Date(firstInPeriod.date).getTime();
    const endDateMs = new Date(lastInPeriod.date).getTime();
    const yearsElapsed = (endDateMs - startDateMs) / (365.25 * 24 * 60 * 60 * 1000);
    periodAnnualizedReturn = yearsElapsed > 0 ? Math.pow(1 + periodTotalReturn, 1 / yearsElapsed) - 1 : periodTotalReturn;

    const dailyReturns = performanceHistory.map(p => parseFloat(p.dailyReturn || "0"));
    periodBestDay = Math.max(...dailyReturns);
    periodWorstDay = Math.min(...dailyReturns);
    periodPositiveDays = dailyReturns.filter(r => r > 0).length;

    const gbReturns = globalBenchmarkReturns?.returns || [];
    if (gbReturns.length > 0) {
      const sortedBR = [...gbReturns]
        .filter(r => new Date(r.date) >= startDate)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      if (sortedBR.length >= 2) {
        const firstBR = sortedBR[0];
        const lastBR = sortedBR[sortedBR.length - 1];
        const startCum = firstBR.cumulativeReturn ? parseFloat(firstBR.cumulativeReturn) : 0;
        const endCum = lastBR.cumulativeReturn ? parseFloat(lastBR.cumulativeReturn) : 0;
        periodBenchmarkReturn = (1 + endCum) / (1 + startCum) - 1;

        const benchStartDate = new Date(firstBR.date);
        const benchEndDate = new Date(lastBR.date);
        const overlapHistory = performanceHistory.filter(p => {
          const d = new Date(p.date);
          return d >= benchStartDate && d <= benchEndDate;
        });
        if (overlapHistory.length >= 2) {
          const overlapStartVal = parseFloat(overlapHistory[0].portfolioValue);
          const overlapEndVal = parseFloat(overlapHistory[overlapHistory.length - 1].portfolioValue);
          const overlapReturn = overlapStartVal > 0 ? (overlapEndVal - overlapStartVal) / overlapStartVal : 0;
          periodAlpha = overlapReturn - periodBenchmarkReturn;
        } else {
          periodAlpha = periodTotalReturn - periodBenchmarkReturn;
        }
      }
    } else {
      const startBenchmarkValue = firstInPeriod.benchmarkValue ? parseFloat(firstInPeriod.benchmarkValue) : startValue;
      const endBenchmarkValue = lastInPeriod.benchmarkValue ? parseFloat(lastInPeriod.benchmarkValue) : endValue;
      periodBenchmarkReturn = startBenchmarkValue > 0 ? (endBenchmarkValue - startBenchmarkValue) / startBenchmarkValue : 0;
      periodAlpha = periodTotalReturn - periodBenchmarkReturn;
    }
  }

  const compositeList = compositeBenchmarksData?.compositeBenchmarks || [];

  // Build benchmark return lookup from the globally selected benchmark (sidebar)
  const benchmarkReturns = globalBenchmarkReturns?.returns || [];
  const benchmarkDateMap = new Map<string, number>();
  const benchmarkSortedDates: string[] = [];

  const sortedBenchmarkReturns = [...benchmarkReturns].sort((a: any, b: any) =>
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  sortedBenchmarkReturns.forEach((r: any) => {
    const dateKey = new Date(r.date).toISOString().split('T')[0];
    if (r.cumulativeReturn) {
      benchmarkDateMap.set(dateKey, parseFloat(r.cumulativeReturn) * 100);
      benchmarkSortedDates.push(dateKey);
    }
  });

  // Helper: find the most recent benchmark value for a given date
  // This handles monthly/quarterly cadence where exact dates don't match
  const findBenchmarkValue = (dateKey: string): number | undefined => {
    // Try exact match first (works for daily cadence)
    const exact = benchmarkDateMap.get(dateKey);
    if (exact !== undefined) return exact;

    // For aggregated cadence, find the most recent period end date <= dateKey
    if (benchmarkSortedDates.length === 0) return undefined;

    let lastValue: number | undefined;
    for (const d of benchmarkSortedDates) {
      if (d <= dateKey) {
        lastValue = benchmarkDateMap.get(d);
      } else {
        break;
      }
    }
    return lastValue;
  };

  // Recalculate benchmark return and alpha from the globally selected benchmark
  if (selectedBenchmark && benchmarkReturns.length > 0) {
    const lastBenchReturn = sortedBenchmarkReturns[sortedBenchmarkReturns.length - 1];
    if (lastBenchReturn?.cumulativeReturn) {
      periodBenchmarkReturn = parseFloat(lastBenchReturn.cumulativeReturn);
      periodAlpha = periodTotalReturn - periodBenchmarkReturn;
    }
  }

  const benchmarkDisplayName = selectedBenchmark?.name || "Benchmark";
  const benchmarkTicker = selectedBenchmark?.ticker !== "CUSTOM" ? selectedBenchmark?.ticker : null;

  // Detect portfolio data cadence from the actual data point intervals
  const detectPortfolioCadence = (): "daily" | "monthly" | "quarterly" => {
    if (performanceHistory.length < 2) return "daily";
    const intervals: number[] = [];
    for (let i = 1; i < Math.min(performanceHistory.length, 20); i++) {
      const diff = new Date(performanceHistory[i].date).getTime() - new Date(performanceHistory[i - 1].date).getTime();
      intervals.push(diff / (1000 * 60 * 60 * 24));
    }
    const avgDays = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    if (avgDays > 60) return "quarterly";
    if (avgDays > 15) return "monthly";
    return "daily";
  };

  const portfolioCadence = detectPortfolioCadence();
  const benchmarkCadence = globalBenchmarkReturns?.cadence || "daily";

  // Annualization factor depends on cadence
  const annualizationFactor = (cadence: "daily" | "monthly" | "quarterly") => {
    switch (cadence) {
      case "quarterly": return 4;
      case "monthly": return 12;
      default: return 252;
    }
  };

  // Dynamic labels based on data cadence
  const cadenceLabel = (cadence: "daily" | "monthly" | "quarterly") => {
    switch (cadence) {
      case "quarterly": return { period: "Quarter", periods: "Quarters" };
      case "monthly": return { period: "Month", periods: "Months" };
      default: return { period: "Day", periods: "Days" };
    }
  };

  const portfolioLabels = cadenceLabel(portfolioCadence);
  const benchmarkLabels = cadenceLabel(benchmarkCadence);

  // Use the same cadence label when both match, otherwise show each independently
  const sameCadence = portfolioCadence === benchmarkCadence;
  const bestLabel = sameCadence ? `Best ${portfolioLabels.period}` : "Best Period";
  const worstLabel = sameCadence ? `Worst ${portfolioLabels.period}` : "Worst Period";
  const positiveLabel = sameCadence ? `Positive ${portfolioLabels.periods}` : "Positive Periods";

  // Compute benchmark period stats from the fetched returns
  const benchmarkMetrics = globalBenchmarkReturns?.metrics;
  let benchmarkAnnualizedReturn = 0;
  let benchmarkBestPeriod = 0;
  let benchmarkWorstPeriod = 0;
  let benchmarkPositivePeriods = 0;
  let benchmarkVolatility = 0;
  let benchmarkTotalPeriods = 0;

  if (benchmarkMetrics) {
    benchmarkAnnualizedReturn = benchmarkMetrics.annualizedReturn;
    benchmarkVolatility = benchmarkMetrics.annualizedVolatility;
  }

  if (sortedBenchmarkReturns.length > 0) {
    const benchPeriodReturns = sortedBenchmarkReturns.map((r: any) =>
      parseFloat(r.returnValue || "0")
    );
    benchmarkBestPeriod = Math.max(...benchPeriodReturns);
    benchmarkWorstPeriod = Math.min(...benchPeriodReturns);
    benchmarkPositivePeriods = benchPeriodReturns.filter((r: number) => r > 0).length;
    benchmarkTotalPeriods = benchPeriodReturns.length;

    // Fallback: compute annualized volatility if not provided by API
    if (!benchmarkMetrics && benchPeriodReturns.length > 1) {
      const mean = benchPeriodReturns.reduce((a: number, b: number) => a + b, 0) / benchPeriodReturns.length;
      const variance = benchPeriodReturns.reduce((sum: number, r: number) => sum + Math.pow(r - mean, 2), 0) / (benchPeriodReturns.length - 1);
      benchmarkVolatility = Math.sqrt(variance) * Math.sqrt(annualizationFactor(benchmarkCadence));
    }
  }

  // Compute portfolio volatility from period returns
  let portfolioVolatility = 0;
  if (performanceHistory.length > 1) {
    const periodReturnsArr = performanceHistory.map(p => parseFloat(p.dailyReturn || "0"));
    const mean = periodReturnsArr.reduce((a, b) => a + b, 0) / periodReturnsArr.length;
    const variance = periodReturnsArr.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (periodReturnsArr.length - 1);
    portfolioVolatility = Math.sqrt(variance) * Math.sqrt(annualizationFactor(portfolioCadence));
  }

  // Build chart data with portfolio and globally selected benchmark joined by date
  const returnChart = performanceHistory.map((p) => {
    const dateKey = new Date(p.date).toISOString().split('T')[0];
    const chartPoint: Record<string, any> = {
      date: formatDateForFrequency(p.date, dataFrequency),
      fullDate: formatDateFullForFrequency(p.date, dataFrequency),
      portfolio: p.cumulativeReturn ? parseFloat(p.cumulativeReturn) * 100 : 0,
    };

    // Add the globally selected benchmark's cumulative return
    const benchmarkValue = findBenchmarkValue(dateKey);
    if (benchmarkValue !== undefined) {
      chartPoint["benchmark"] = benchmarkValue;
    }

    return chartPoint;
  });

  const valueChart = performanceHistory.map((p) => ({
    date: formatDateForFrequency(p.date, dataFrequency),
    fullDate: formatDateFullForFrequency(p.date, dataFrequency),
    portfolio: parseFloat(p.portfolioValue),
    benchmark: p.benchmarkValue ? parseFloat(p.benchmarkValue) : null,
  }));

  // Period return chart uses the full time-period-filtered history (driven by sidebar time period selector)
  const periodReturnChart = performanceHistory.map((p) => ({
    date: formatDate(p.date),
    fullDate: formatDateFull(p.date),
    period: p.dailyReturn ? parseFloat(p.dailyReturn) * 100 : 0,
  }));

  const recentCount = getRecentPeriodCount(dataFrequency);
  const periodReturnData = performanceHistory.slice(-recentCount);
  const dailyReturnChart = periodReturnData.map((p) => ({
    date: formatDateForFrequency(p.date, dataFrequency),
    fullDate: formatDateFullForFrequency(p.date, dataFrequency),
    daily: p.dailyReturn ? parseFloat(p.dailyReturn) * 100 : 0,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-performance-title">Performance Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {portfolio.name} • {getTimePeriodLabel(selectedTimePeriod)} performance and attribution
          </p>
        </div>

        {selectedBenchmark && (
          <Badge
            variant="secondary"
            className="flex items-center gap-1.5 px-3 py-1.5"
            style={{ borderLeft: `3px solid ${selectedBenchmark.color || "#6366f1"}` }}
          >
            <span className="text-xs">vs {selectedBenchmark.ticker !== "CUSTOM" ? selectedBenchmark.ticker : selectedBenchmark.name}</span>
          </Badge>
        )}
      </div>

      {portfolioHasPartialData && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Partial data for selected period</AlertTitle>
          <AlertDescription>
            Portfolio data starts {formatDateFull(earliestDataDate!)} which is after
            the {getTimePeriodLabel(selectedTimePeriod)} start
            date ({formatDateFull(requestedStartDate)}).
            Showing {performanceHistory.length} available {portfolioLabels.periods.toLowerCase()} of data.
          </AlertDescription>
        </Alert>
      )}

      {benchmarkHasNoData && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Benchmark data not available</AlertTitle>
          <AlertDescription>
            No historical return data is available for <strong>{benchmarkDisplayName}</strong> during
            the selected {getTimePeriodLabel(selectedTimePeriod)} period.
            Benchmark comparison columns will show &ldquo;—&rdquo; until data is available.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title={`${getTimePeriodLabel(selectedTimePeriod)} Return`}
          value={formatPercent(periodTotalReturn)}
          icon={<TrendingUp className="h-5 w-5" />}
          valueClassName={periodTotalReturn >= 0 ? "text-emerald-500" : "text-red-500"}
        />
        <MetricCard
          title="Annualized Return"
          value={formatPercent(periodAnnualizedReturn)}
          icon={<Activity className="h-5 w-5" />}
          valueClassName={periodAnnualizedReturn >= 0 ? "text-emerald-500" : "text-red-500"}
        />
        <MetricCard
          title="Alpha vs Benchmark"
          value={formatPercent(periodAlpha)}
          icon={<Target className="h-5 w-5" />}
          valueClassName={periodAlpha >= 0 ? "text-emerald-500" : "text-red-500"}
        />
        <MetricCard
          title="Win Rate"
          value={performanceHistory.length > 0 ? `${((periodPositiveDays / performanceHistory.length) * 100).toFixed(1)}%` : "—"}
          changeLabel={`${periodPositiveDays}/${performanceHistory.length} ${frequencyLabel.toLowerCase()} periods`}
        />
      </div>

      <Card data-testid="card-performance-comparison">
        <CardContent className="p-0">
          <div className="grid grid-cols-[1fr_auto_auto_auto] items-center text-sm">
            {/* Header row */}
            <div className="px-5 py-3 border-b font-medium text-muted-foreground">Metric</div>
            <div className="px-5 py-3 border-b border-l text-center font-medium text-muted-foreground min-w-[120px]">Portfolio</div>
            <div className="px-5 py-3 border-b border-l text-center font-medium min-w-[120px]" style={{ color: selectedBenchmark?.color || "#6366f1" }}>
              {benchmarkTicker || benchmarkDisplayName}
            </div>
            <div className="px-5 py-3 border-b border-l text-center font-medium text-muted-foreground min-w-[100px]">Difference</div>

            {/* Period Return */}
            <div className="px-5 py-3 border-b text-muted-foreground">{getTimePeriodLabel(selectedTimePeriod)} Return</div>
            <div className={`px-5 py-3 border-b border-l text-center font-mono font-semibold ${periodTotalReturn >= 0 ? "text-emerald-500" : "text-red-500"}`}>
              {formatPercent(periodTotalReturn)}
            </div>
            <div className={`px-5 py-3 border-b border-l text-center font-mono ${periodBenchmarkReturn >= 0 ? "text-emerald-500" : "text-red-500"}`}>
              {formatPercent(periodBenchmarkReturn)}
            </div>
            <div className={`px-5 py-3 border-b border-l text-center font-mono font-medium ${periodAlpha >= 0 ? "text-emerald-500" : "text-red-500"}`}>
              {periodAlpha >= 0 ? "+" : ""}{formatPercent(periodAlpha)}
            </div>

            {/* Annualized Return */}
            <div className="px-5 py-3 border-b text-muted-foreground">Annualized Return</div>
            <div className={`px-5 py-3 border-b border-l text-center font-mono font-semibold ${periodAnnualizedReturn >= 0 ? "text-emerald-500" : "text-red-500"}`}>
              {formatPercent(periodAnnualizedReturn)}
            </div>
            <div className={`px-5 py-3 border-b border-l text-center font-mono ${benchmarkAnnualizedReturn >= 0 ? "text-emerald-500" : "text-red-500"}`}>
              {benchmarkAnnualizedReturn !== 0 ? formatPercent(benchmarkAnnualizedReturn) : "—"}
            </div>
            <div className={`px-5 py-3 border-b border-l text-center font-mono font-medium ${(periodAnnualizedReturn - benchmarkAnnualizedReturn) >= 0 ? "text-emerald-500" : "text-red-500"}`}>
              {benchmarkAnnualizedReturn !== 0
                ? `${(periodAnnualizedReturn - benchmarkAnnualizedReturn) >= 0 ? "+" : ""}${formatPercent(periodAnnualizedReturn - benchmarkAnnualizedReturn)}`
                : "—"}
            </div>

            {/* Volatility */}
            <div className="px-5 py-3 border-b text-muted-foreground">Annualized Volatility</div>
            <div className="px-5 py-3 border-b border-l text-center font-mono font-semibold">
              {portfolioVolatility > 0 ? formatPercent(portfolioVolatility) : "—"}
            </div>
            <div className="px-5 py-3 border-b border-l text-center font-mono">
              {benchmarkVolatility > 0 ? formatPercent(benchmarkVolatility) : "—"}
            </div>
            <div className={`px-5 py-3 border-b border-l text-center font-mono font-medium ${portfolioVolatility > 0 && benchmarkVolatility > 0 ? ((portfolioVolatility - benchmarkVolatility) <= 0 ? "text-emerald-500" : "text-red-500") : ""}`}>
              {portfolioVolatility > 0 && benchmarkVolatility > 0
                ? `${(portfolioVolatility - benchmarkVolatility) <= 0 ? "" : "+"}${formatPercent(portfolioVolatility - benchmarkVolatility)}`
                : "—"}
            </div>

            {/* Best Period */}
            <div className="px-5 py-3 border-b text-muted-foreground">
              {bestLabel}
              {!sameCadence && <span className="text-xs text-muted-foreground/60 ml-1">({portfolioLabels.period} / {benchmarkLabels.period})</span>}
            </div>
            <div className="px-5 py-3 border-b border-l text-center font-mono font-semibold text-emerald-500">
              +{formatPercent(periodBestDay)}
            </div>
            <div className="px-5 py-3 border-b border-l text-center font-mono text-emerald-500">
              {benchmarkBestPeriod !== 0 ? `+${formatPercent(benchmarkBestPeriod)}` : "—"}
            </div>
            <div className="px-5 py-3 border-b border-l text-center font-mono font-medium text-muted-foreground">—</div>

            {/* Worst Period */}
            <div className="px-5 py-3 border-b text-muted-foreground">
              {worstLabel}
              {!sameCadence && <span className="text-xs text-muted-foreground/60 ml-1">({portfolioLabels.period} / {benchmarkLabels.period})</span>}
            </div>
            <div className="px-5 py-3 border-b border-l text-center font-mono font-semibold text-red-500">
              {formatPercent(periodWorstDay)}
            </div>
            <div className="px-5 py-3 border-b border-l text-center font-mono text-red-500">
              {benchmarkWorstPeriod !== 0 ? formatPercent(benchmarkWorstPeriod) : "—"}
            </div>
            <div className="px-5 py-3 border-b border-l text-center font-mono font-medium text-muted-foreground">—</div>

            {/* Positive Periods */}
            <div className="px-5 py-3 text-muted-foreground">
              {positiveLabel}
              {!sameCadence && <span className="text-xs text-muted-foreground/60 ml-1">({portfolioLabels.periods} / {benchmarkLabels.periods})</span>}
            </div>
            <div className="px-5 py-3 border-l text-center font-mono font-semibold">
              {performanceHistory.length > 0 ? `${((periodPositiveDays / performanceHistory.length) * 100).toFixed(1)}%` : "—"}
              <span className="text-muted-foreground text-xs ml-1">({periodPositiveDays}/{performanceHistory.length})</span>
            </div>
            <div className="px-5 py-3 border-l text-center font-mono">
              {benchmarkTotalPeriods > 0 ? `${((benchmarkPositivePeriods / benchmarkTotalPeriods) * 100).toFixed(1)}%` : "—"}
              {benchmarkTotalPeriods > 0 && <span className="text-muted-foreground text-xs ml-1">({benchmarkPositivePeriods}/{benchmarkTotalPeriods})</span>}
            </div>
            <div className="px-5 py-3 border-l text-center font-mono font-medium text-muted-foreground">—</div>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-cumulative-performance">
        <CardHeader>
          <CardTitle className="text-base font-medium">Cumulative Performance</CardTitle>
          <CardDescription>Portfolio vs benchmark returns over time</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="returns" className="w-full">
            <TabsList className="mb-4">
              <TabsTrigger value="returns" data-testid="tab-returns">Returns</TabsTrigger>
              <TabsTrigger value="value" data-testid="tab-value">Portfolio Value</TabsTrigger>
            </TabsList>
            <TabsContent value="returns">
              <ResponsiveContainer width="100%" height={350}>
                <AreaChart data={returnChart}>
                  <defs>
                    <linearGradient id="colorCumulative" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis 
                    dataKey="date" 
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    interval={getXAxisTickInterval(returnChart.length, dataFrequency)}
                  />
                  <YAxis 
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    tickFormatter={(v) => `${v.toFixed(0)}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px",
                      fontSize: 12,
                    }}
                    labelFormatter={(label, payload) => payload[0]?.payload?.fullDate || label}
                    formatter={(value: number, name: string) => {
                      const displayName = name === "portfolio" ? "Portfolio" : benchmarkDisplayName;
                      return [`${value.toFixed(2)}%`, displayName];
                    }}
                  />
                  <Legend
                    formatter={(value) => value === "portfolio" ? "Portfolio" : benchmarkDisplayName}
                  />
                  <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                  <Area
                    type="monotone"
                    dataKey="portfolio"
                    stroke="hsl(var(--chart-1))"
                    strokeWidth={2}
                    fill="url(#colorCumulative)"
                    name="portfolio"
                  />
                  {benchmarkReturns.length > 0 && (
                    <Line
                      type="monotone"
                      dataKey="benchmark"
                      stroke={selectedBenchmark?.color || "hsl(var(--muted-foreground))"}
                      strokeWidth={2}
                      dot={false}
                      name="benchmark"
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </TabsContent>
            <TabsContent value="value">
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={valueChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis 
                    dataKey="date" 
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    interval={getXAxisTickInterval(valueChart.length, dataFrequency)}
                  />
                  <YAxis 
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    tickFormatter={(v) => formatCurrency(v)}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: "hsl(var(--card))", 
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px",
                      fontSize: 12,
                    }}
                    labelFormatter={(label, payload) => payload[0]?.payload?.fullDate || label}
                    formatter={(value: number, name: string) => [
                      formatCurrency(value),
                      name === "portfolio" ? "Portfolio" : benchmarkDisplayName
                    ]}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="portfolio"
                    stroke="hsl(var(--chart-1))"
                    strokeWidth={2}
                    dot={false}
                    name="Portfolio"
                  />
                  <Line
                    type="monotone"
                    dataKey="benchmark"
                    stroke={selectedBenchmark?.color || "hsl(var(--muted-foreground))"}
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    dot={false}
                    name={benchmarkDisplayName}
                  />
                </LineChart>
              </ResponsiveContainer>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card data-testid="card-period-returns">
        <CardHeader>
          <CardTitle className="text-base font-medium">{portfolioLabels.period === "Day" ? "Daily" : portfolioLabels.period + "ly"} Returns</CardTitle>
          <CardDescription>{getTimePeriodLabel(selectedTimePeriod)} period return distribution ({performanceHistory.length} {portfolioLabels.periods.toLowerCase()})</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={periodReturnChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="date"
                stroke="hsl(var(--muted-foreground))"
                fontSize={10}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickLine={false}
                tickFormatter={(v) => `${v.toFixed(1)}%`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "6px",
                  fontSize: 12,
                }}
                labelFormatter={(label, payload) => payload[0]?.payload?.fullDate || label}
                formatter={(value: number) => [`${value.toFixed(3)}%`, `${portfolioLabels.period} Return`]}
              />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
              <Bar
                dataKey="period"
                fill="hsl(var(--chart-1))"
                radius={[2, 2, 0, 0]}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

    </div>
  );
}
