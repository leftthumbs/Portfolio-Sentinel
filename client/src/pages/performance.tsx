import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePortfolio } from "@/hooks/use-portfolio";
import { getTimePeriodStartDate, getTimePeriodLabel, TimePeriod } from "@/components/time-period-selector";
import { AlertTriangle, TrendingUp, Activity, Target, Plus, X, Layers, ChevronRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/metric-card";
import { ChartSkeleton, MetricCardSkeleton } from "@/components/loading-skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
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
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface SelectedBenchmarkData {
  benchmark: Benchmark;
  returns: BenchmarkReturn[];
}

interface PerformanceData {
  portfolio: Portfolio;
  performanceHistory: PerformanceHistory[];
  selectedBenchmarks: SelectedBenchmarkData[];
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

interface BenchmarksData {
  benchmarks: Benchmark[];
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

const BENCHMARK_COLORS = [
  "#3b82f6",
  "#10b981", 
  "#f59e0b",
  "#ec4899",
  "#8b5cf6",
  "#14b8a6",
];

export default function PerformancePage() {
  const { toast } = useToast();
  const { selectedPortfolioId, selectedPortfolioType, selectedTimePeriod } = usePortfolio();

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

  const { data: benchmarksData } = useQuery<BenchmarksData>({
    queryKey: ["/api/benchmarks"],
  });

  const addBenchmarkMutation = useMutation({
    mutationFn: async (benchmarkId: string) => {
      await apiRequest("POST", `/api/portfolios/${data?.portfolio?.id}/benchmarks`, {
        benchmarkId,
        isPrimary: false,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/performance"] });
      toast({ title: "Benchmark added", description: "Benchmark has been added to comparison" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to add benchmark", variant: "destructive" });
    },
  });

  const removeBenchmarkMutation = useMutation({
    mutationFn: async (benchmarkId: string) => {
      await apiRequest("DELETE", `/api/portfolios/${data?.portfolio?.id}/benchmarks/${benchmarkId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/performance"] });
      toast({ title: "Benchmark removed", description: "Benchmark has been removed from comparison" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to remove benchmark", variant: "destructive" });
    },
  });

  const [compositeDialogOpen, setCompositeDialogOpen] = useState(false);
  const [compositeName, setCompositeName] = useState("");
  const [compositeComponents, setCompositeComponents] = useState<{ benchmarkId: string; name: string; weight: number }[]>([]);

  const createCompositeMutation = useMutation({
    mutationFn: async (data: { name: string; components: { benchmarkId: string; weight: number }[] }) => {
      return await apiRequest("POST", "/api/composite-benchmarks", {
        name: data.name,
        color: "#" + Math.floor(Math.random()*16777215).toString(16),
        components: data.components.map(c => ({ benchmarkId: c.benchmarkId, weight: c.weight })),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/composite-benchmarks"] });
      toast({ title: "Composite benchmark created", description: "Your custom benchmark has been created" });
      setCompositeDialogOpen(false);
      setCompositeName("");
      setCompositeComponents([]);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create composite benchmark", variant: "destructive" });
    },
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

  const { portfolio, performanceHistory: rawPerformanceHistory, selectedBenchmarks = [], metrics } = data;
  
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

  const allBenchmarks = benchmarksData?.benchmarks || [];
  const compositeList = compositeBenchmarksData?.compositeBenchmarks || [];
  const selectedBenchmarkIds = selectedBenchmarks.map(sb => sb.benchmark.id);
  const availableBenchmarks = allBenchmarks.filter(b => !selectedBenchmarkIds.includes(b.id));
  const availableCompositeBenchmarks = compositeList.filter(b => !selectedBenchmarkIds.includes(b.id));

  const categoryOrder = ["Custom", "Equity", "Fixed Income", "Real Estate", "Commodities", "Alternative", "Multi-Asset"];
  
  const benchmarksByCategory: Record<string, Array<{ id: string; name: string; ticker?: string | null; color?: string | null; isComposite?: boolean }>> = {};
  
  // Add composite benchmarks under "Custom" category
  if (availableCompositeBenchmarks.length > 0) {
    benchmarksByCategory["Custom"] = availableCompositeBenchmarks.map(b => ({ 
      id: b.id, 
      name: b.name,
      ticker: null,
      color: b.color || "#6366f1", 
      isComposite: true 
    }));
  }
  
  // Add standard benchmarks by category
  availableBenchmarks.forEach(b => {
    const category = b.category || "Other";
    if (!benchmarksByCategory[category]) benchmarksByCategory[category] = [];
    benchmarksByCategory[category].push({ id: b.id, name: b.name, ticker: b.ticker, color: null, isComposite: false });
  });

  const sortedCategories = Object.keys(benchmarksByCategory).sort((a, b) => {
    const indexA = categoryOrder.indexOf(a);
    const indexB = categoryOrder.indexOf(b);
    if (indexA === -1 && indexB === -1) return a.localeCompare(b);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });

  // Build benchmark return lookup maps by date for proper alignment
  // For aggregated (monthly/quarterly) data, build a sorted array so we can
  // find the most recent period end date for any given portfolio date
  const benchmarkReturnMaps = new Map<string, Map<string, number>>();
  const benchmarkSortedDates = new Map<string, string[]>();
  selectedBenchmarks.forEach(sb => {
    const dateMap = new Map<string, number>();
    const sortedDates: string[] = [];
    // Sort returns chronologically
    const sortedReturns = [...sb.returns].sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    sortedReturns.forEach(r => {
      const dateKey = new Date(r.date).toISOString().split('T')[0];
      if (r.cumulativeReturn) {
        dateMap.set(dateKey, parseFloat(r.cumulativeReturn) * 100);
        sortedDates.push(dateKey);
      }
    });
    benchmarkReturnMaps.set(sb.benchmark.id, dateMap);
    benchmarkSortedDates.set(sb.benchmark.id, sortedDates);
  });

  // Helper: find the most recent benchmark value for a given date
  // This handles monthly/quarterly cadence where exact dates don't match
  const findBenchmarkValue = (benchmarkId: string, dateKey: string): number | undefined => {
    const dateMap = benchmarkReturnMaps.get(benchmarkId);
    if (!dateMap) return undefined;

    // Try exact match first (works for daily cadence)
    const exact = dateMap.get(dateKey);
    if (exact !== undefined) return exact;

    // For aggregated cadence, find the most recent period end date <= dateKey
    const dates = benchmarkSortedDates.get(benchmarkId);
    if (!dates || dates.length === 0) return undefined;

    let lastValue: number | undefined;
    for (const d of dates) {
      if (d <= dateKey) {
        lastValue = dateMap.get(d);
      } else {
        break;
      }
    }
    return lastValue;
  };

  // Build chart data with portfolio and selected benchmarks joined by date
  const returnChart = performanceHistory.map((p) => {
    const dateKey = new Date(p.date).toISOString().split('T')[0];
    const chartPoint: Record<string, any> = {
      date: formatDate(p.date),
      fullDate: formatDateFull(p.date),
      portfolio: p.cumulativeReturn ? parseFloat(p.cumulativeReturn) * 100 : 0,
      defaultBenchmark: p.benchmarkReturn ? parseFloat(p.benchmarkReturn) * 100 : 0,
    };

    // Add each selected benchmark's cumulative return matched by date
    // Uses period-aware matching for monthly/quarterly aggregated data
    selectedBenchmarks.forEach(sb => {
      const benchmarkValue = findBenchmarkValue(sb.benchmark.id, dateKey);
      if (benchmarkValue !== undefined) {
        chartPoint[`benchmark_${sb.benchmark.id}`] = benchmarkValue;
      }
    });

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
        
        <div className="flex flex-wrap items-center gap-2">
          {selectedBenchmarks.map((sb, index) => (
            <Badge 
              key={sb.benchmark.id} 
              variant="secondary"
              className="flex items-center gap-1.5 px-2 py-1"
              style={{ borderLeft: `3px solid ${sb.benchmark.color || BENCHMARK_COLORS[index % BENCHMARK_COLORS.length]}` }}
            >
              <span className="text-xs">{sb.benchmark.ticker || sb.benchmark.name}</span>
              <button 
                onClick={() => removeBenchmarkMutation.mutate(sb.benchmark.id)}
                className="ml-1 hover:text-destructive"
                data-testid={`button-remove-benchmark-${sb.benchmark.id}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-add-benchmark">
                <Plus className="h-4 w-4 mr-1" />
                Add Benchmark
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 max-h-[400px] overflow-y-auto">
              <DropdownMenuLabel>Select Benchmark by Category</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {sortedCategories.length === 0 ? (
                <DropdownMenuItem disabled>
                  All benchmarks added
                </DropdownMenuItem>
              ) : (
                sortedCategories.map((category) => (
                  <DropdownMenuSub key={category}>
                    <DropdownMenuSubTrigger>
                      <span>{category}</span>
                      <Badge variant="outline" className="ml-auto text-xs">
                        {benchmarksByCategory[category].length}
                      </Badge>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="max-h-[300px] overflow-y-auto">
                      {benchmarksByCategory[category].map((benchmark) => (
                        <DropdownMenuItem
                          key={benchmark.id}
                          onClick={() => {
                            if (benchmark.isComposite) {
                              toast({ 
                                title: "Custom Benchmark", 
                                description: "Use the Risk Analytics page to compare against custom benchmarks for rolling alpha analysis."
                              });
                            } else {
                              addBenchmarkMutation.mutate(benchmark.id);
                            }
                          }}
                          data-testid={`menu-item-benchmark-${benchmark.id}`}
                        >
                          <div className="flex items-center gap-2 w-full">
                            <div 
                              className="w-3 h-3 rounded-full" 
                              style={{ backgroundColor: benchmark.color || "#6366f1" }}
                            />
                            <div className="flex-1">
                              <div className="font-medium text-sm">
                                {benchmark.name}
                                {benchmark.isComposite && <Badge variant="secondary" className="ml-2 text-xs">Custom</Badge>}
                              </div>
                              <div className="text-xs text-muted-foreground">{benchmark.ticker}</div>
                            </div>
                          </div>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ))
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setCompositeDialogOpen(true)}>
                <Layers className="h-4 w-4 mr-2" />
                Create Custom Blend
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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
                      const benchmarkMatch = selectedBenchmarks.find(sb => `benchmark_${sb.benchmark.id}` === name);
                      const displayName = name === "portfolio" ? "Portfolio" 
                        : name === "defaultBenchmark" ? "Default Benchmark"
                        : benchmarkMatch?.benchmark.name || name;
                      return [`${value.toFixed(2)}%`, displayName];
                    }}
                  />
                  <Legend 
                    formatter={(value) => {
                      const benchmarkMatch = selectedBenchmarks.find(sb => `benchmark_${sb.benchmark.id}` === value);
                      return value === "portfolio" ? "Portfolio" 
                        : value === "defaultBenchmark" ? "Default Benchmark"
                        : benchmarkMatch?.benchmark.name || value;
                    }}
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
                  <Line 
                    type="monotone" 
                    dataKey="defaultBenchmark" 
                    stroke="hsl(var(--muted-foreground))" 
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    dot={false}
                    name="defaultBenchmark"
                  />
                  {selectedBenchmarks.map((sb, index) => (
                    <Line 
                      key={sb.benchmark.id}
                      type="monotone" 
                      dataKey={`benchmark_${sb.benchmark.id}`}
                      stroke={sb.benchmark.color || BENCHMARK_COLORS[index % BENCHMARK_COLORS.length]} 
                      strokeWidth={2}
                      dot={false}
                      name={`benchmark_${sb.benchmark.id}`}
                    />
                  ))}
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
                <span className="text-sm text-muted-foreground">Benchmark Return</span>
                <span className={`font-mono text-sm ${periodBenchmarkReturn >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                  {periodBenchmarkReturn >= 0 ? "+" : ""}{formatPercent(periodBenchmarkReturn)}
                </span>
              </div>
              <div className="flex items-center justify-between py-3 border-b">
                <span className="text-sm text-muted-foreground">Outperformance (Alpha)</span>
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

      {selectedBenchmarks.length > 0 && (
        <Card data-testid="card-benchmark-comparison">
          <CardHeader>
            <CardTitle className="text-base font-medium">Selected Benchmarks</CardTitle>
            <CardDescription>Benchmarks for performance comparison</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3">
              {selectedBenchmarks.map((sb, index) => {
                const lastReturn = sb.returns[sb.returns.length - 1];
                const totalReturn = lastReturn?.cumulativeReturn ? parseFloat(lastReturn.cumulativeReturn) : 0;
                return (
                  <div 
                    key={sb.benchmark.id} 
                    className="flex items-center justify-between p-3 rounded-lg border"
                    style={{ borderLeftWidth: 4, borderLeftColor: sb.benchmark.color || BENCHMARK_COLORS[index % BENCHMARK_COLORS.length] }}
                  >
                    <div>
                      <div className="font-medium text-sm">{sb.benchmark.name}</div>
                      <div className="text-xs text-muted-foreground">{sb.benchmark.ticker} • {sb.benchmark.category}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`font-mono text-sm ${totalReturn >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                        {totalReturn >= 0 ? "+" : ""}{(totalReturn * 100).toFixed(2)}%
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeBenchmarkMutation.mutate(sb.benchmark.id)}
                        data-testid={`button-remove-benchmark-card-${sb.benchmark.id}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={compositeDialogOpen} onOpenChange={setCompositeDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Custom Composite Benchmark</DialogTitle>
            <DialogDescription>
              Blend multiple benchmarks with custom allocations to create your own benchmark.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <Label htmlFor="composite-name">Benchmark Name</Label>
              <Input
                id="composite-name"
                value={compositeName}
                onChange={(e) => setCompositeName(e.target.value)}
                placeholder="e.g., 70/30 Global Equity-Bond"
                data-testid="input-composite-name"
              />
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Component Allocations</Label>
                <span className={`text-sm ${
                  Math.abs(compositeComponents.reduce((sum, c) => sum + c.weight, 0) - 1) < 0.001 
                    ? "text-emerald-500" 
                    : "text-muted-foreground"
                }`}>
                  Total: {(compositeComponents.reduce((sum, c) => sum + c.weight, 0) * 100).toFixed(0)}%
                </span>
              </div>
              
              {compositeComponents.map((component, index) => (
                <div key={component.benchmarkId} className="flex items-center gap-2 p-2 bg-muted rounded-md">
                  <div className="flex-1 text-sm">{component.name}</div>
                  <div className="flex items-center gap-2 w-32">
                    <Slider
                      value={[component.weight * 100]}
                      onValueChange={([value]) => {
                        const updated = [...compositeComponents];
                        updated[index] = { ...component, weight: value / 100 };
                        setCompositeComponents(updated);
                      }}
                      max={100}
                      step={5}
                      className="flex-1"
                    />
                    <span className="text-sm w-10 text-right">{(component.weight * 100).toFixed(0)}%</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setCompositeComponents(compositeComponents.filter((_, i) => i !== index));
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Component
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-64 max-h-[300px] overflow-y-auto">
                  {sortedCategories.map((category) => (
                    <DropdownMenuSub key={category}>
                      <DropdownMenuSubTrigger>{category}</DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="max-h-[250px] overflow-y-auto">
                        {benchmarksByCategory[category]
                          .filter(b => !compositeComponents.some(c => c.benchmarkId === b.id))
                          .map((benchmark) => (
                            <DropdownMenuItem
                              key={benchmark.id}
                              onClick={() => {
                                setCompositeComponents([
                                  ...compositeComponents,
                                  { benchmarkId: benchmark.id, name: benchmark.name, weight: 0.2 },
                                ]);
                              }}
                            >
                              <div 
                                className="w-3 h-3 rounded-full mr-2" 
                                style={{ backgroundColor: benchmark.color || "#6366f1" }}
                              />
                              {benchmark.name}
                            </DropdownMenuItem>
                          ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompositeDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => {
                if (!compositeName.trim()) {
                  toast({ title: "Error", description: "Please enter a benchmark name", variant: "destructive" });
                  return;
                }
                if (compositeComponents.length === 0) {
                  toast({ title: "Error", description: "Please add at least one component", variant: "destructive" });
                  return;
                }
                const totalWeight = compositeComponents.reduce((sum, c) => sum + c.weight, 0);
                if (Math.abs(totalWeight - 1) > 0.01) {
                  toast({ title: "Error", description: "Weights must sum to 100%", variant: "destructive" });
                  return;
                }
                createCompositeMutation.mutate({
                  name: compositeName,
                  components: compositeComponents,
                });
              }}
              disabled={createCompositeMutation.isPending}
              data-testid="button-create-composite"
            >
              {createCompositeMutation.isPending ? "Creating..." : "Create Benchmark"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
