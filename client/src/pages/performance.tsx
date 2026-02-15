import { useQuery } from "@tanstack/react-query";
import { usePortfolio } from "@/hooks/use-portfolio";
import { getTimePeriodStartDate, getTimePeriodLabel, TimePeriod } from "@/components/time-period-selector";
import { AlertTriangle, TrendingUp, Activity, Target } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/metric-card";
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
  Legend,
} from "recharts";
import type { Portfolio, PerformanceHistory, Benchmark, BenchmarkReturn } from "@shared/schema";

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


export default function PerformancePage() {
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
    const qs = params.toString();
    return qs ? `/api/performance?${qs}` : "/api/performance";
  };

  const performanceUrl = buildPerformanceUrl();

  const { data, isLoading, error, refetch } = useQuery<PerformanceData & { isCustomPortfolio?: boolean }>({
    queryKey: ["/api/performance", selectedPortfolioId, selectedPortfolioType, selectedTimePeriod],
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

  const { data: globalBenchmarkReturns } = useQuery<{ returns: any[] }>({
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

  // Handle empty performance history
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

    const startBenchmarkValue = firstInPeriod.benchmarkValue ? parseFloat(firstInPeriod.benchmarkValue) : startValue;
    const endBenchmarkValue = lastInPeriod.benchmarkValue ? parseFloat(lastInPeriod.benchmarkValue) : endValue;
    periodBenchmarkReturn = startBenchmarkValue > 0 ? (endBenchmarkValue - startBenchmarkValue) / startBenchmarkValue : 0;
    periodAlpha = periodTotalReturn - periodBenchmarkReturn;
  }

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

  // Build chart data with portfolio and globally selected benchmark joined by date
  const returnChart = performanceHistory.map((p) => {
    const dateKey = new Date(p.date).toISOString().split('T')[0];
    const chartPoint: Record<string, any> = {
      date: formatDate(p.date),
      fullDate: formatDateFull(p.date),
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
    date: formatDate(p.date),
    fullDate: formatDateFull(p.date),
    portfolio: parseFloat(p.portfolioValue),
    benchmark: p.benchmarkValue ? parseFloat(p.benchmarkValue) : null,
  }));

  const dailyReturnChart = performanceHistory.slice(-90).map((p) => ({
    date: formatDate(p.date),
    fullDate: formatDateFull(p.date),
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
          changeLabel={`${periodPositiveDays}/${performanceHistory.length} days`}
        />
      </div>

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
                      name === "portfolio" ? "Portfolio" : "Benchmark"
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
                    stroke="hsl(var(--muted-foreground))" 
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    dot={false}
                    name="Default Benchmark"
                  />
                </LineChart>
              </ResponsiveContainer>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card data-testid="card-daily-returns">
          <CardHeader>
            <CardTitle className="text-base font-medium">Daily Returns</CardTitle>
            <CardDescription>Last 90 days of daily performance</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={dailyReturnChart}>
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
                  formatter={(value: number) => [`${value.toFixed(3)}%`, "Daily Return"]}
                />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                <Bar 
                  dataKey="daily" 
                  fill="hsl(var(--chart-1))"
                  radius={[2, 2, 0, 0]}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card data-testid="card-performance-stats">
          <CardHeader>
            <CardTitle className="text-base font-medium">Performance Statistics</CardTitle>
            <CardDescription>Key performance indicators for {getTimePeriodLabel(selectedTimePeriod)}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              <div className="flex items-center justify-between py-3 border-b">
                <span className="text-sm text-muted-foreground">Best Day</span>
                <span className="font-mono text-sm text-emerald-500">
                  +{formatPercent(periodBestDay)}
                </span>
              </div>
              <div className="flex items-center justify-between py-3 border-b">
                <span className="text-sm text-muted-foreground">Worst Day</span>
                <span className="font-mono text-sm text-red-500">
                  {formatPercent(periodWorstDay)}
                </span>
              </div>
              <div className="flex items-center justify-between py-3 border-b">
                <span className="text-sm text-muted-foreground">{benchmarkDisplayName} Return</span>
                <span className={`font-mono text-sm ${periodBenchmarkReturn >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                  {periodBenchmarkReturn >= 0 ? "+" : ""}{formatPercent(periodBenchmarkReturn)}
                </span>
              </div>
              <div className="flex items-center justify-between py-3 border-b">
                <span className="text-sm text-muted-foreground">Alpha vs {benchmarkDisplayName}</span>
                <span className={`font-mono text-sm ${periodAlpha >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                  {periodAlpha >= 0 ? "+" : ""}{formatPercent(periodAlpha)}
                </span>
              </div>
              <div className="flex items-center justify-between py-3">
                <span className="text-sm text-muted-foreground">Positive Days</span>
                <span className="font-mono text-sm">
                  {periodPositiveDays} / {performanceHistory.length}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
