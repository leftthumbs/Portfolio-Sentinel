import { useQuery } from "@tanstack/react-query";
import { usePortfolio } from "@/hooks/use-portfolio";
import { getTimePeriodStartDate, getTimePeriodLabel, TimePeriod } from "@/components/time-period-selector";
import { AlertTriangle, Shield, Activity, TrendingDown, BarChart3, Info } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { MetricCard } from "@/components/metric-card";
import { ChartSkeleton, MetricCardSkeleton } from "@/components/loading-skeleton";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  ReferenceLine,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  LineChart,
  Line,
  Legend,
} from "recharts";
import type { Portfolio, RiskMetrics, PerformanceHistory, Benchmark, BenchmarkReturn } from "@shared/schema";

interface RiskData {
  portfolio: Portfolio;
  riskMetrics: RiskMetrics;
  performanceHistory: PerformanceHistory[];
}

interface BenchmarkReturnsData {
  returns: BenchmarkReturn[];
}

function formatPercent(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  return `${(num * 100).toFixed(2)}%`;
}

function formatCurrency(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(1)}K`;
  return `$${num.toFixed(2)}`;
}

function formatVaR(value: number, isCustomPortfolio: boolean): string {
  if (value === 0) return "—";
  // Custom portfolios have VaR as dollar amounts from Monte Carlo simulation
  // Core portfolios store VaR as percentages
  if (isCustomPortfolio) {
    return formatCurrency(value);
  }
  return formatPercent(value);
}

function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getRiskLevel(sharpe: number): { level: string; color: string } {
  if (sharpe >= 2) return { level: "Excellent", color: "text-emerald-500" };
  if (sharpe >= 1) return { level: "Good", color: "text-emerald-500" };
  if (sharpe >= 0.5) return { level: "Moderate", color: "text-yellow-500" };
  return { level: "Poor", color: "text-red-500" };
}

interface PortfolioOption {
  id: string;
  name: string;
  type: "core" | "custom";
}

interface PortfolioOptionsData {
  options: PortfolioOption[];
}

export default function RiskPage() {
  const { selectedPortfolioId, selectedPortfolioType, selectedPortfolio, selectedBenchmarkId: globalBenchmarkId, selectedBenchmark, selectedTimePeriod } = usePortfolio();

  // Use the global benchmark from sidebar - determine type and API ID
  const isCompositeBenchmark = selectedBenchmark?.isComposite === true;
  const selectedBenchmarkId = globalBenchmarkId;
  const benchmarkApiId = isCompositeBenchmark && selectedBenchmarkId?.startsWith("composite-")
    ? selectedBenchmarkId.replace("composite-", "")
    : selectedBenchmarkId;

  const riskUrl = selectedPortfolioId
    ? `/api/risk?portfolioId=${selectedPortfolioId}&portfolioType=${selectedPortfolioType}`
    : "/api/risk";

  const { data, isLoading, error } = useQuery<RiskData & { isCustomPortfolio?: boolean }>({
    queryKey: ["/api/risk", selectedPortfolioId, selectedPortfolioType],
    queryFn: async () => {
      const res = await fetch(riskUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch risk data");
      return res.json();
    },
  });

  const { data: benchmarkReturnsData } = useQuery<BenchmarkReturnsData>({
    queryKey: [
      isCompositeBenchmark ? "/api/composite-benchmarks" : "/api/benchmarks",
      benchmarkApiId,
      "returns",
    ],
    queryFn: async () => {
      if (!benchmarkApiId) return { returns: [] };
      const endpoint = isCompositeBenchmark
        ? `/api/composite-benchmarks/${benchmarkApiId}/returns`
        : `/api/benchmarks/${benchmarkApiId}/returns`;
      const res = await fetch(endpoint, { credentials: "include" });
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
        <p className="text-muted-foreground">Failed to load risk data</p>
      </div>
    );
  }

  const { portfolio, riskMetrics, performanceHistory: rawPerformanceHistory } = data;
  
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
  const portfolioDataGap = earliestDataDate && earliestDataDate > startDate;
  const portfolioHasNoData = performanceHistory.length === 0;
  const portfolioHasPartialData = !portfolioHasNoData && portfolioDataGap && selectedTimePeriod !== "SI";
  const benchmarkHasNoData = (benchmarkReturnsData?.returns?.length ?? 0) === 0 && !!benchmarkApiId;

  // If data exists but nothing falls within the selected time period
  if (portfolioHasNoData && rawPerformanceHistory.length > 0) {
    const dataStart = new Date(rawPerformanceHistory[0].date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const dataEnd = new Date(rawPerformanceHistory[rawPerformanceHistory.length - 1].date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-risk-title">Risk Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {selectedPortfolio?.name || portfolio.name} • {getTimePeriodLabel(selectedTimePeriod)}
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

  // Detect portfolio data cadence from data point intervals
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

  const cadenceLabel = (cadence: "daily" | "monthly" | "quarterly") => {
    switch (cadence) {
      case "quarterly": return { period: "Quarter", periods: "Quarters", singular: "quarterly" };
      case "monthly": return { period: "Month", periods: "Months", singular: "monthly" };
      default: return { period: "Day", periods: "Days", singular: "daily" };
    }
  };

  const periodsPerYear = (cadence: "daily" | "monthly" | "quarterly") => {
    switch (cadence) {
      case "quarterly": return 4;
      case "monthly": return 12;
      default: return 252;
    }
  };

  const portfolioCadenceLabels = cadenceLabel(portfolioCadence);

  const volatility = riskMetrics?.volatility ? parseFloat(riskMetrics.volatility) : 0;
  const sharpe = riskMetrics?.sharpeRatio ? parseFloat(riskMetrics.sharpeRatio) : 0;
  const sortino = riskMetrics?.sortinoRatio ? parseFloat(riskMetrics.sortinoRatio) : 0;
  const maxDrawdown = riskMetrics?.maxDrawdown ? parseFloat(riskMetrics.maxDrawdown) : 0;
  const var95 = riskMetrics?.var95 ? parseFloat(riskMetrics.var95) : 0;
  const var99 = riskMetrics?.var99 ? parseFloat(riskMetrics.var99) : 0;
  const cvar95 = riskMetrics?.cvar95 ? parseFloat(riskMetrics.cvar95) : 0;
  const beta = riskMetrics?.beta ? parseFloat(riskMetrics.beta) : 1;
  const alpha = riskMetrics?.alpha ? parseFloat(riskMetrics.alpha) : 0;
  const treynor = riskMetrics?.treynorRatio ? parseFloat(riskMetrics.treynorRatio) : 0;
  const infoRatio = riskMetrics?.informationRatio ? parseFloat(riskMetrics.informationRatio) : 0;
  const trackingError = riskMetrics?.trackingError ? parseFloat(riskMetrics.trackingError) : 0;
  const correlation = riskMetrics?.correlation ? parseFloat(riskMetrics.correlation) : 0;
  const downsideCorrelation = riskMetrics?.downsideCorrelation ? parseFloat(riskMetrics.downsideCorrelation) : 0;
  const jensensAlpha = riskMetrics?.jensensAlpha ? parseFloat(riskMetrics.jensensAlpha) : 0;
  
  // Additional sophisticated metrics
  const calmarRatio = riskMetrics?.calmarRatio ? parseFloat(riskMetrics.calmarRatio) : 0;
  const omegaRatio = riskMetrics?.omegaRatio ? parseFloat(riskMetrics.omegaRatio) : 0;
  const skewness = riskMetrics?.skewness ? parseFloat(riskMetrics.skewness) : 0;
  const kurtosis = riskMetrics?.kurtosis ? parseFloat(riskMetrics.kurtosis) : 3;
  const upsideCapture = riskMetrics?.upsideCapture ? parseFloat(riskMetrics.upsideCapture) : 1;
  const downsideCapture = riskMetrics?.downsideCapture ? parseFloat(riskMetrics.downsideCapture) : 1;
  const ulcerIndex = riskMetrics?.ulcerIndex ? parseFloat(riskMetrics.ulcerIndex) : 0;
  const painIndex = riskMetrics?.painIndex ? parseFloat(riskMetrics.painIndex) : 0;
  const gainToPainRatio = riskMetrics?.gainToPainRatio ? parseFloat(riskMetrics.gainToPainRatio) : 0;
  const tailRatio = riskMetrics?.tailRatio ? parseFloat(riskMetrics.tailRatio) : 1;
  const commonSenseRatio = riskMetrics?.commonSenseRatio ? parseFloat(riskMetrics.commonSenseRatio) : 0;
  const averageDrawdown = riskMetrics?.averageDrawdown ? parseFloat(riskMetrics.averageDrawdown) : 0;
  const sterlingRatio = riskMetrics?.sterlingRatio ? parseFloat(riskMetrics.sterlingRatio) : 0;
  const burkeRatio = riskMetrics?.burkeRatio ? parseFloat(riskMetrics.burkeRatio) : 0;
  const herfindahlIndex = riskMetrics?.herfindahlIndex ? parseFloat(riskMetrics.herfindahlIndex) : 0;
  const diversificationRatio = riskMetrics?.diversificationRatio ? parseFloat(riskMetrics.diversificationRatio) : 1;
  const downsideDeviation = riskMetrics?.downsideDeviation ? parseFloat(riskMetrics.downsideDeviation) : 0;
  const upsidePotentialRatio = riskMetrics?.upsidePotentialRatio ? parseFloat(riskMetrics.upsidePotentialRatio) : 0;
  const cagr = riskMetrics?.cagr ? parseFloat(riskMetrics.cagr) : 0;
  const mar = riskMetrics?.mar ? parseFloat(riskMetrics.mar) : 0;

  const riskLevel = getRiskLevel(sharpe);

  const drawdownData = performanceHistory.map((p, i) => {
    const cumReturn = p.cumulativeReturn ? parseFloat(p.cumulativeReturn) : 0;
    const peak = Math.max(...performanceHistory.slice(0, i + 1).map(pp => pp.cumulativeReturn ? parseFloat(pp.cumulativeReturn) : 0));
    const drawdown = peak > 0 ? ((cumReturn - peak) / (1 + peak)) * 100 : 0;
    return {
      date: formatDate(p.date),
      drawdown: Math.min(0, drawdown),
    };
  });

  // Use cadence-aware bucket widths: daily=0.5%, monthly=2%, quarterly=5%
  const bucketWidth = portfolioCadence === "quarterly" ? 5 : portfolioCadence === "monthly" ? 2 : 0.5;
  const bucketPrecision = portfolioCadence === "quarterly" ? 0 : portfolioCadence === "monthly" ? 0 : 1;
  const returnDistribution = performanceHistory.reduce((acc, p) => {
    if (p.dailyReturn) {
      const ret = parseFloat(p.dailyReturn) * 100;
      const bucket = Math.round(ret / bucketWidth) * bucketWidth;
      const bucketKey = bucket.toFixed(bucketPrecision);
      acc[bucketKey] = (acc[bucketKey] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  const distributionData = Object.entries(returnDistribution)
    .map(([bucket, count]) => ({ bucket: `${bucket}%`, count, value: parseFloat(bucket) }))
    .sort((a, b) => a.value - b.value);

  const radarData = [
    { metric: "Sharpe", value: Math.min(3, Math.max(0, sharpe)), fullMark: 3 },
    { metric: "Sortino", value: Math.min(3, Math.max(0, sortino)), fullMark: 3 },
    { metric: "Info Ratio", value: Math.min(2, Math.max(0, infoRatio + 1)), fullMark: 2 },
    { metric: "Treynor", value: Math.min(0.3, Math.max(0, treynor + 0.1)), fullMark: 0.3 },
    { metric: "Alpha", value: Math.min(0.1, Math.max(0, alpha + 0.05)), fullMark: 0.1 },
  ];

  const riskMetricsList = [
    { label: "Volatility (Annualized)", value: formatPercent(volatility), description: "Standard deviation of returns" },
    { label: "Value at Risk (95%)", value: formatVaR(var95, !!data?.isCustomPortfolio), description: "Potential loss at 95% confidence" },
    { label: "Value at Risk (99%)", value: formatVaR(var99, !!data?.isCustomPortfolio), description: "Potential loss at 99% confidence" },
    { label: "Conditional VaR (95%)", value: formatVaR(cvar95, !!data?.isCustomPortfolio), description: "Expected loss beyond VaR" },
    { label: "Maximum Drawdown", value: formatPercent(maxDrawdown), description: "Largest peak-to-trough decline" },
    { label: "Tracking Error", value: formatPercent(trackingError), description: "Standard deviation vs benchmark" },
    { label: "Beta", value: beta.toFixed(2), description: "Sensitivity to market movements" },
    { label: "Correlation", value: correlation.toFixed(2), description: "Correlation with benchmark returns" },
    { label: "Downside Correlation", value: downsideCorrelation.toFixed(2), description: "Correlation during market downturns" },
  ];

  const performanceRatiosList = [
    { label: "Sharpe Ratio", value: sharpe.toFixed(2), description: "Risk-adjusted return (excess return / volatility)" },
    { label: "Sortino Ratio", value: sortino.toFixed(2), description: "Downside risk-adjusted return" },
    { label: "Information Ratio", value: infoRatio.toFixed(2), description: "Active return per unit of tracking error" },
    { label: "Jensen's Alpha", value: formatPercent(jensensAlpha), description: "Excess return vs CAPM predicted return" },
    { label: "Alpha", value: formatPercent(alpha), description: "Excess return over benchmark" },
    { label: "Treynor Ratio", value: treynor.toFixed(4), description: "Excess return per unit of systematic risk" },
    { label: "Calmar Ratio", value: calmarRatio.toFixed(2), description: "CAGR / Maximum Drawdown" },
    { label: "Omega Ratio", value: omegaRatio.toFixed(2), description: "Probability-weighted gains vs losses" },
    { label: "Sterling Ratio", value: sterlingRatio.toFixed(2), description: "Return / Average Drawdown" },
  ];

  const alternativeMetricsList = [
    { label: "Upside Capture", value: formatPercent(upsideCapture), description: "Capture of benchmark gains" },
    { label: "Downside Capture", value: formatPercent(downsideCapture), description: "Capture of benchmark losses" },
    { label: "Capture Ratio", value: upsideCapture && downsideCapture ? (upsideCapture / downsideCapture).toFixed(2) : "—", description: "Upside capture / Downside capture" },
    { label: "Ulcer Index", value: formatPercent(ulcerIndex), description: "Depth and duration of drawdowns" },
    { label: "Pain Index", value: formatPercent(painIndex), description: "Average drawdown magnitude" },
    { label: "Gain to Pain Ratio", value: gainToPainRatio.toFixed(2), description: "Sum of gains / Sum of losses" },
    { label: "MAR Ratio", value: mar.toFixed(2), description: "CAGR / Maximum Drawdown" },
    { label: "Burke Ratio", value: burkeRatio.toFixed(2), description: "Return / Root of squared drawdowns" },
    { label: "Upside Potential Ratio", value: upsidePotentialRatio.toFixed(2), description: "Upside potential / Downside deviation" },
  ];

  const tailRiskMetricsList = [
    { label: "Skewness", value: skewness.toFixed(2), description: "Asymmetry of return distribution (negative = left tail)" },
    { label: "Kurtosis", value: kurtosis.toFixed(2), description: "Fat tails / Extreme events (>3 = leptokurtic)" },
    { label: "Tail Ratio", value: tailRatio.toFixed(2), description: "Right tail (95th) / Left tail (5th) percentile" },
    { label: "Common Sense Ratio", value: commonSenseRatio.toFixed(2), description: "Tail ratio × Gain to pain ratio" },
    { label: "Average Drawdown", value: formatPercent(averageDrawdown), description: "Mean of all drawdown periods" },
    { label: "Downside Deviation", value: formatPercent(downsideDeviation), description: "Std dev of negative returns only" },
  ];

  const diversificationMetricsList = [
    { label: "Herfindahl Index (HHI)", value: herfindahlIndex.toFixed(4), description: "Concentration measure (0-1, lower = more diversified)" },
    { label: "Diversification Ratio", value: diversificationRatio.toFixed(2), description: "Weighted avg volatility / Portfolio volatility" },
    { label: "CAGR", value: formatPercent(cagr), description: "Compound annual growth rate" },
  ];

  // Calculate rolling alpha based on globally selected benchmark (sidebar)
  const benchmarkReturns = benchmarkReturnsData?.returns || [];
  const benchmarkDisplayName = selectedBenchmark?.name || "Benchmark";
  
  // Build benchmark return lookup by date
  const benchmarkReturnsByDate = new Map<string, number>();
  benchmarkReturns.forEach(r => {
    const dateKey = new Date(r.date).toISOString().split('T')[0];
    if (r.returnValue !== null && r.returnValue !== undefined) {
      benchmarkReturnsByDate.set(dateKey, parseFloat(r.returnValue));
    }
  });

  // Calculate rolling alpha using cadence-aware window sizes
  // Daily: 252/756 periods, Monthly: 12/36 periods, Quarterly: 4/12 periods
  const ppYear = periodsPerYear(portfolioCadence);
  const windowSize1Y = ppYear; // 1-year window in periods
  const windowSize3Y = ppYear * 3; // 3-year window in periods

  const calculateRollingAlpha = (windowPeriods: number) => {
    const sortedHistory = [...performanceHistory].sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const result: { date: string; alpha: number; portfolioReturn: number; benchmarkReturn: number }[] = [];

    for (let i = windowPeriods - 1; i < sortedHistory.length; i++) {
      const windowData = sortedHistory.slice(i - windowPeriods + 1, i + 1);

      let portfolioCompounded = 1;
      let benchmarkCompounded = 1;
      let matchedPeriods = 0;

      windowData.forEach(p => {
        const dateKey = new Date(p.date).toISOString().split('T')[0];
        const portfolioRet = p.dailyReturn ? parseFloat(p.dailyReturn) : 0;

        // Only include periods where we have benchmark data
        if (benchmarkReturnsByDate.has(dateKey)) {
          const benchRet = benchmarkReturnsByDate.get(dateKey) || 0;
          portfolioCompounded *= (1 + portfolioRet);
          benchmarkCompounded *= (1 + benchRet);
          matchedPeriods++;
        }
      });

      // Skip if insufficient matched periods (need at least 80% coverage)
      const minRequired = Math.floor(windowPeriods * 0.8);
      if (matchedPeriods < minRequired) continue;

      // Calculate cumulative returns over the window
      const portfolioCumReturn = portfolioCompounded - 1;
      const benchmarkCumReturn = benchmarkCompounded - 1;

      // Annualize using geometric annualization based on actual cadence
      const annFactor = ppYear / matchedPeriods;
      const annualizedPortfolioReturn = Math.pow(1 + portfolioCumReturn, annFactor) - 1;
      const annualizedBenchmarkReturn = Math.pow(1 + benchmarkCumReturn, annFactor) - 1;
      const rollingAlpha = annualizedPortfolioReturn - annualizedBenchmarkReturn;

      result.push({
        date: formatDate(sortedHistory[i].date),
        alpha: rollingAlpha * 100,
        portfolioReturn: annualizedPortfolioReturn * 100,
        benchmarkReturn: annualizedBenchmarkReturn * 100,
      });
    }

    return result;
  };

  const rolling1YearAlpha = selectedBenchmarkId ? calculateRollingAlpha(windowSize1Y) : [];
  const rolling3YearAlpha = selectedBenchmarkId ? calculateRollingAlpha(windowSize3Y) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-risk-title">Risk Analytics</h1>
            {data?.isCustomPortfolio && (
              <Badge variant="outline" className="text-xs">Custom Portfolio</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {selectedPortfolio?.name || portfolio.name} • {getTimePeriodLabel(selectedTimePeriod)} risk metrics and analysis
          </p>
        </div>
      </div>

      {portfolioHasPartialData && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Partial data for selected period</AlertTitle>
          <AlertDescription>
            Portfolio data starts {earliestDataDate!.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} which
            is after the {getTimePeriodLabel(selectedTimePeriod)} start
            date ({startDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}).
            Showing {performanceHistory.length} available data points.
          </AlertDescription>
        </Alert>
      )}

      {benchmarkHasNoData && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Benchmark data not available</AlertTitle>
          <AlertDescription>
            No historical return data is available for <strong>{selectedBenchmark?.name || "the selected benchmark"}</strong> during
            the selected {getTimePeriodLabel(selectedTimePeriod)} period.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title={`Sharpe Ratio${data?.isCustomPortfolio ? " *" : ""}`}
          value={sharpe.toFixed(2)}
          icon={<Shield className="h-5 w-5" />}
          changeLabel={riskLevel.level}
        />
        <MetricCard
          title={`Volatility${data?.isCustomPortfolio ? " *" : ""}`}
          value={formatPercent(volatility)}
          icon={<Activity className="h-5 w-5" />}
        />
        <MetricCard
          title={`Max Drawdown${data?.isCustomPortfolio ? " *" : ""}`}
          value={formatPercent(maxDrawdown)}
          icon={<TrendingDown className="h-5 w-5" />}
          valueClassName="text-red-500"
        />
        <MetricCard
          title={`VaR (95%)${data?.isCustomPortfolio ? " *" : ""}`}
          value={formatVaR(var95, !!data?.isCustomPortfolio)}
          icon={<AlertTriangle className="h-5 w-5" />}
        />
      </div>

      {data?.isCustomPortfolio && (
        <p className="text-xs text-muted-foreground -mt-3">
          * Metrics derived from Monte Carlo simulation using synthetic returns. Asset class parameters (expected return, volatility) are used to generate {performanceHistory.length > 0 ? "simulated" : ""} daily return paths. Results represent the median of 100 simulated scenarios and should be interpreted as estimates, not historical performance.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card data-testid="card-drawdown-chart">
          <CardHeader>
            <CardTitle className="text-base font-medium">Drawdown Analysis</CardTitle>
            <CardDescription>Historical peak-to-trough declines</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={drawdownData}>
                <defs>
                  <linearGradient id="colorDrawdown" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--destructive))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
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
                  formatter={(value: number) => [`${value.toFixed(2)}%`, "Drawdown"]}
                />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                <Area
                  type="monotone"
                  dataKey="drawdown"
                  stroke="hsl(var(--destructive))"
                  strokeWidth={2}
                  fill="url(#colorDrawdown)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card data-testid="card-return-distribution">
          <CardHeader>
            <CardTitle className="text-base font-medium">Return Distribution{data?.isCustomPortfolio ? " *" : ""}</CardTitle>
            <CardDescription>Frequency of {portfolioCadenceLabels.singular} returns{data?.isCustomPortfolio ? " (simulated)" : ""}</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={distributionData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis 
                  dataKey="bucket" 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={10}
                  tickLine={false}
                  interval={2}
                />
                <YAxis 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={11}
                  tickLine={false}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: "hsl(var(--card))", 
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "6px",
                    fontSize: 12,
                  }}
                  formatter={(value: number) => [value, portfolioCadenceLabels.periods]}
                />
                <ReferenceLine x="0.0%" stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                <Bar 
                  dataKey="count" 
                  fill="hsl(var(--chart-1))"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card data-testid="card-risk-adjusted">
          <CardHeader>
            <CardTitle className="text-base font-medium">Risk-Adjusted Performance</CardTitle>
            <CardDescription>Comparative risk ratios</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="hsl(var(--border))" />
                <PolarAngleAxis 
                  dataKey="metric" 
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} 
                />
                <PolarRadiusAxis 
                  angle={90} 
                  domain={[0, 'auto']} 
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                />
                <Radar
                  name="Portfolio"
                  dataKey="value"
                  stroke="hsl(var(--chart-1))"
                  fill="hsl(var(--chart-1))"
                  fillOpacity={0.3}
                  strokeWidth={2}
                />
              </RadarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card data-testid="card-risk-metrics">
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <CardTitle className="text-base font-medium">Risk Metrics{data?.isCustomPortfolio ? " *" : ""}</CardTitle>
                <CardDescription>Comprehensive risk indicators{data?.isCustomPortfolio ? " (derived from simulated returns)" : ""}</CardDescription>
              </div>
              <Badge 
                variant="secondary" 
                className={`font-medium ${riskLevel.color}`}
              >
                <BarChart3 className="h-3 w-3 mr-1" />
                {riskLevel.level} Risk Profile
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {riskMetricsList.map((metric) => (
                <div key={metric.label} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{metric.label}</span>
                    <span className="text-xs text-muted-foreground">{metric.description}</span>
                  </div>
                  <span className="font-mono text-sm">{metric.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-performance-ratios">
        <CardHeader>
          <CardTitle className="text-base font-medium">Performance & Risk-Adjusted Ratios{data?.isCustomPortfolio ? " *" : ""}</CardTitle>
          <CardDescription>Key investment performance metrics relative to risk{data?.isCustomPortfolio ? " (derived from simulated returns)" : ""}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {performanceRatiosList.map((metric) => (
              <div key={metric.label} className="p-4 border rounded-lg">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-muted-foreground">{metric.label}</span>
                  <span className="text-2xl font-semibold">{metric.value}</span>
                  <span className="text-xs text-muted-foreground">{metric.description}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card data-testid="card-alternative-metrics">
          <CardHeader>
            <CardTitle className="text-base font-medium">Alternative Investment Metrics{data?.isCustomPortfolio ? " *" : ""}</CardTitle>
            <CardDescription>Specialized metrics for hedge funds, private equity, and alternatives{data?.isCustomPortfolio ? " (simulated)" : ""}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {alternativeMetricsList.map((metric) => (
                <div key={metric.label} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{metric.label}</span>
                    <span className="text-xs text-muted-foreground">{metric.description}</span>
                  </div>
                  <span className="font-mono text-sm">{metric.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-tail-risk">
          <CardHeader>
            <CardTitle className="text-base font-medium">Tail Risk & Distribution{data?.isCustomPortfolio ? " *" : ""}</CardTitle>
            <CardDescription>Return distribution characteristics and extreme event analysis{data?.isCustomPortfolio ? " (simulated)" : ""}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {tailRiskMetricsList.map((metric) => (
                <div key={metric.label} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{metric.label}</span>
                    <span className="text-xs text-muted-foreground">{metric.description}</span>
                  </div>
                  <span className="font-mono text-sm">{metric.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-diversification">
        <CardHeader>
          <CardTitle className="text-base font-medium">Diversification & Concentration</CardTitle>
          <CardDescription>Portfolio concentration and diversification effectiveness</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            {diversificationMetricsList.map((metric) => (
              <div key={metric.label} className="p-4 border rounded-lg">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-muted-foreground">{metric.label}</span>
                  <span className="text-2xl font-semibold">{metric.value}</span>
                  <span className="text-xs text-muted-foreground">{metric.description}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-rolling-alpha">
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-base font-medium">Rolling Alpha Analysis</CardTitle>
              <CardDescription>Trailing 1-year and 3-year alpha vs {benchmarkDisplayName}</CardDescription>
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
        </CardHeader>
        <CardContent>
          {!benchmarkApiId ? (
            <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
              <p>Select a benchmark from the sidebar to view rolling alpha</p>
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <h4 className="text-sm font-medium mb-3">Rolling 1-Year Alpha</h4>
                {rolling1YearAlpha.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={rolling1YearAlpha}>
                      <defs>
                        <linearGradient id="colorAlpha1Y" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis 
                        dataKey="date" 
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                        tickLine={{ stroke: "hsl(var(--border))" }}
                      />
                      <YAxis 
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                        tickLine={{ stroke: "hsl(var(--border))" }}
                        tickFormatter={(v) => `${v.toFixed(1)}%`}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: "hsl(var(--card))", 
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "6px",
                          fontSize: 12,
                        }}
                        formatter={(value: number) => [`${value.toFixed(2)}%`, "Alpha"]}
                      />
                      <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                      <Area
                        type="monotone"
                        dataKey="alpha"
                        stroke="hsl(var(--chart-1))"
                        fill="url(#colorAlpha1Y)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[220px] text-muted-foreground text-sm">
                    Insufficient data for 1-year rolling alpha (requires {windowSize1Y}+ {portfolioCadenceLabels.singular} data points)
                  </div>
                )}
              </div>
              
              <div>
                <h4 className="text-sm font-medium mb-3">Rolling 3-Year Alpha</h4>
                {rolling3YearAlpha.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={rolling3YearAlpha}>
                      <defs>
                        <linearGradient id="colorAlpha3Y" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis 
                        dataKey="date" 
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                        tickLine={{ stroke: "hsl(var(--border))" }}
                      />
                      <YAxis 
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                        tickLine={{ stroke: "hsl(var(--border))" }}
                        tickFormatter={(v) => `${v.toFixed(1)}%`}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: "hsl(var(--card))", 
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "6px",
                          fontSize: 12,
                        }}
                        formatter={(value: number) => [`${value.toFixed(2)}%`, "Alpha"]}
                      />
                      <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                      <Area
                        type="monotone"
                        dataKey="alpha"
                        stroke="hsl(var(--chart-2))"
                        fill="url(#colorAlpha3Y)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[220px] text-muted-foreground text-sm">
                    Insufficient data for 3-year rolling alpha (requires {windowSize3Y}+ {portfolioCadenceLabels.singular} data points)
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {data?.isCustomPortfolio && (
        <div className="rounded-lg border border-dashed p-4 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">* Synthetic / Backtested Data Disclosure</p>
          <p className="text-xs text-muted-foreground">
            All risk metrics, ratios, and return distributions marked with (*) for this custom portfolio are derived from a Monte Carlo simulation
            using synthetically generated daily returns. The simulation runs 100 independent paths based on asset-class-level expected returns
            and volatilities (e.g., US Equity: 10% return, 16% volatility). Where historical returns have been uploaded for linked strategies,
            bootstrap sampling from actual returns is used instead. These results are estimates and should not be interpreted as actual historical performance.
          </p>
        </div>
      )}
    </div>
  );
}
