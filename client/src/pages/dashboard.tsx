import { useQuery } from "@tanstack/react-query";
import { usePortfolio } from "@/hooks/use-portfolio";
import { getTimePeriodStartDate, getTimePeriodLabel, TimePeriod } from "@/components/time-period-selector";
import { 
  DollarSign, 
  TrendingUp, 
  Shield, 
  AlertTriangle,
  Briefcase,
  ArrowUpRight,
  ArrowDownRight
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/metric-card";
import { DashboardSkeleton } from "@/components/loading-skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import type { Portfolio, Holding, RiskMetrics, PerformanceHistory } from "@shared/schema";

interface DashboardData {
  portfolio: Portfolio & { isCustom?: boolean };
  holdings: Holding[];
  riskMetrics: RiskMetrics | null;
  performanceHistory: PerformanceHistory[];
  isCustomPortfolio?: boolean;
}

const COLORS = [
  "hsl(199, 89%, 48%)",
  "hsl(152, 76%, 36%)",
  "hsl(280, 65%, 60%)",
  "hsl(38, 92%, 50%)",
  "hsl(0, 84%, 60%)",
  "hsl(220, 70%, 50%)",
];

function formatCurrency(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(0)}K`;
  return `$${num.toFixed(0)}`;
}

function formatPercent(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  return `${(num * 100).toFixed(2)}%`;
}

function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function Dashboard() {
  const { selectedPortfolioId, selectedPortfolioType, selectedPortfolio, selectedTimePeriod } = usePortfolio();

  const dashboardUrl = selectedPortfolioId 
    ? `/api/dashboard?portfolioId=${selectedPortfolioId}&portfolioType=${selectedPortfolioType}`
    : "/api/dashboard";

  const { data, isLoading, error } = useQuery<DashboardData>({
    queryKey: ["/api/dashboard", selectedPortfolioId, selectedPortfolioType],
    queryFn: async () => {
      const res = await fetch(dashboardUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch dashboard");
      return res.json();
    },
  });

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-[400px] gap-4">
        <AlertTriangle className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">Failed to load dashboard data</p>
      </div>
    );
  }

  const { portfolio, holdings, riskMetrics, performanceHistory } = data;
  const totalValue = parseFloat(portfolio.totalValue);

  const inceptionDate = performanceHistory.length > 0 
    ? new Date(performanceHistory[0].date) 
    : undefined;
  const startDate = getTimePeriodStartDate(selectedTimePeriod, inceptionDate);
  
  const filteredPerformance = performanceHistory.filter(
    (p) => new Date(p.date) >= startDate
  );

  const firstInPeriod = filteredPerformance[0];
  const lastInPeriod = filteredPerformance[filteredPerformance.length - 1];
  
  let periodReturn = 0;
  if (firstInPeriod && lastInPeriod) {
    const startValue = parseFloat(firstInPeriod.portfolioValue);
    const endValue = parseFloat(lastInPeriod.portfolioValue);
    periodReturn = startValue > 0 ? (endValue - startValue) / startValue : 0;
  }

  const allocationData = holdings.map((h) => ({
    name: h.fundName,
    value: parseFloat(h.allocation),
    assetClass: h.assetClass,
  }));

  const chartData = filteredPerformance.map((p) => ({
    date: formatDate(p.date),
    portfolio: parseFloat(p.portfolioValue),
    benchmark: p.benchmarkValue ? parseFloat(p.benchmarkValue) : null,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-dashboard-title">Dashboard Overview</h1>
            {data.isCustomPortfolio && (
              <Badge variant="secondary" className="text-xs">
                <Briefcase className="h-3 w-3 mr-1" />
                Custom Portfolio
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {selectedPortfolio?.name || portfolio.name} • {getTimePeriodLabel(selectedTimePeriod)} performance overview
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Portfolio Value"
          value={formatCurrency(totalValue)}
          change={periodReturn * 100}
          changeLabel={getTimePeriodLabel(selectedTimePeriod)}
          icon={<DollarSign className="h-5 w-5" />}
        />
        <MetricCard
          title={`${getTimePeriodLabel(selectedTimePeriod)} Return`}
          value={formatPercent(periodReturn)}
          change={periodReturn * 100}
          icon={<TrendingUp className="h-5 w-5" />}
          valueClassName={periodReturn >= 0 ? "text-emerald-500" : "text-red-500"}
        />
        <MetricCard
          title="Sharpe Ratio"
          value={riskMetrics?.sharpeRatio ? parseFloat(riskMetrics.sharpeRatio).toFixed(2) : "—"}
          icon={<Shield className="h-5 w-5" />}
        />
        <MetricCard
          title="VaR (95%)"
          value={riskMetrics?.var95 ? formatPercent(parseFloat(riskMetrics.var95)) : "—"}
          icon={<AlertTriangle className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card data-testid="card-performance-chart">
          <CardHeader>
            <CardTitle className="text-base font-medium">Portfolio Performance</CardTitle>
            <CardDescription>{getTimePeriodLabel(selectedTimePeriod)} portfolio value vs benchmark</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="date" 
                  stroke="hsl(var(--muted-foreground))" 
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis 
                  stroke="hsl(var(--muted-foreground))" 
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => formatCurrency(v)}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: "hsl(var(--card))", 
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "6px",
                    fontSize: 12,
                  }}
                  formatter={(value: number) => [formatCurrency(value), ""]}
                />
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
                  name="Benchmark"
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card data-testid="card-allocation-chart">
          <CardHeader>
            <CardTitle className="text-base font-medium">Asset Allocation</CardTitle>
            <CardDescription>Portfolio composition by fund</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={allocationData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="value"
                  nameKey="name"
                >
                  {allocationData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: "hsl(var(--card))", 
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "6px",
                    fontSize: 12,
                  }}
                  formatter={(value: number) => [`${value.toFixed(1)}%`, "Allocation"]}
                />
                <Legend 
                  verticalAlign="bottom" 
                  height={36}
                  formatter={(value) => <span className="text-xs text-foreground">{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-holdings-table">
        <CardHeader>
          <CardTitle className="text-base font-medium">Top Holdings</CardTitle>
          <CardDescription>Fund performance and allocation details</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[250px]">Fund Name</TableHead>
                <TableHead>Asset Class</TableHead>
                <TableHead className="text-right">Allocation</TableHead>
                <TableHead className="text-right">Market Value</TableHead>
                <TableHead className="text-right">YTD Return</TableHead>
                <TableHead className="text-right">Gain/Loss</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {holdings.slice(0, 8).map((holding) => {
                const unrealizedGain = parseFloat(holding.unrealizedGain);
                const isPositive = unrealizedGain >= 0;
                return (
                  <TableRow key={holding.id} data-testid={`row-holding-${holding.id}`}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{holding.fundName}</span>
                        {holding.ticker && (
                          <span className="text-xs text-muted-foreground">{holding.ticker}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-normal">
                        {holding.assetClass}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {parseFloat(holding.allocation).toFixed(1)}%
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(holding.marketValue)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className={`flex items-center justify-end gap-1 font-mono ${
                        holding.returnYtd && parseFloat(holding.returnYtd) >= 0 ? "text-emerald-500" : "text-red-500"
                      }`}>
                        {holding.returnYtd && parseFloat(holding.returnYtd) >= 0 ? (
                          <ArrowUpRight className="h-3 w-3" />
                        ) : (
                          <ArrowDownRight className="h-3 w-3" />
                        )}
                        {formatPercent(holding.returnYtd)}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={`font-mono ${isPositive ? "text-emerald-500" : "text-red-500"}`}>
                        {isPositive ? "+" : ""}{formatCurrency(unrealizedGain)}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
