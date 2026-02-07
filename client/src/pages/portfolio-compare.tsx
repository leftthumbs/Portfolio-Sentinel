import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartSkeleton, MetricCardSkeleton } from "@/components/loading-skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { GitCompare, Plus, X, TrendingUp, AlertTriangle, BarChart3 } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  BarChart,
  Bar,
  Cell,
} from "recharts";

interface CustomPortfolio {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}

interface BacktestResult {
  id: string;
  portfolioId: string;
  initialValue: string;
  finalValue: string;
  totalReturn: string;
  annualizedReturn: string;
  volatility: string;
  sharpeRatio: string;
  maxDrawdown: string;
  performanceData: { date: string; value: number; dailyReturn: number }[];
}

interface PortfolioItem {
  id: string;
  name: string;
  strategyType: string;
  assetClass: string;
  weight: string;
}

interface ComparisonData {
  portfolio: CustomPortfolio;
  backtest: BacktestResult | null;
  items: PortfolioItem[];
  riskMetrics: {
    sharpeRatio: string | null;
    sortinoRatio: string | null;
    volatility: string | null;
    maxDrawdown: string | null;
    beta: string | null;
    alpha: string | null;
    calmarRatio: string | null;
  } | null;
}

const CHART_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))"];
const COLOR_NAMES = ["cyan", "purple", "orange"];

function formatPercent(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "—";
  return `${(num * 100).toFixed(2)}%`;
}

function formatCurrency(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "—";
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(1)}K`;
  return `$${num.toFixed(2)}`;
}

function formatNumber(value: string | number | null | undefined, decimals: number = 2): string {
  if (value === null || value === undefined) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "—";
  return num.toFixed(decimals);
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function PortfolioComparePage() {
  const { toast } = useToast();
  const [selectedPortfolios, setSelectedPortfolios] = useState<string[]>([]);

  const { data: portfoliosData, isLoading: portfoliosLoading } = useQuery<{ portfolios: CustomPortfolio[] }>({
    queryKey: ["/api/custom-portfolios"],
  });

  const { data: comparisonData, isLoading: comparisonLoading, error: comparisonError } = useQuery<{ comparisons: ComparisonData[] }>({
    queryKey: ["/api/portfolio-compare", ...selectedPortfolios],
    queryFn: async () => {
      const params = new URLSearchParams();
      selectedPortfolios.forEach(id => params.append("portfolioIds", id));
      const response = await apiRequest("GET", `/api/portfolio-compare?${params.toString()}`);
      return response.json();
    },
    enabled: selectedPortfolios.length > 0,
  });

  useEffect(() => {
    if (comparisonError) {
      toast({
        title: "Comparison Error",
        description: "Failed to load comparison data. Please try again.",
        variant: "destructive",
      });
    }
  }, [comparisonError, toast]);

  const portfolios = portfoliosData?.portfolios || [];
  const comparisons = comparisonData?.comparisons || [];

  const availablePortfolios = portfolios.filter(p => !selectedPortfolios.includes(p.id));

  const addPortfolio = (id: string) => {
    if (selectedPortfolios.length < 3 && !selectedPortfolios.includes(id)) {
      setSelectedPortfolios([...selectedPortfolios, id]);
    }
  };

  const removePortfolio = (id: string) => {
    setSelectedPortfolios(selectedPortfolios.filter(p => p !== id));
  };

  const performanceChartData = useMemo(() => {
    if (comparisons.length === 0) return [];
    
    // Pre-index performance data by date for O(1) lookups
    const portfolioDataByDate: Map<string, number>[] = comparisons.map(c => {
      const dateMap = new Map<string, number>();
      if (c.backtest?.performanceData) {
        const initialValue = parseFloat(c.backtest?.initialValue || "1000000");
        c.backtest.performanceData.forEach(p => {
          const cumulativeReturn = ((p.value - initialValue) / initialValue) * 100;
          dateMap.set(p.date, cumulativeReturn);
        });
      }
      return dateMap;
    });
    
    // Collect all unique dates
    const allDates = new Set<string>();
    comparisons.forEach(c => {
      if (c.backtest?.performanceData) {
        c.backtest.performanceData.forEach(p => allDates.add(p.date));
      }
    });
    
    const sortedDates = Array.from(allDates).sort();
    
    // Build chart data using O(1) lookups
    return sortedDates.map(date => {
      const point: Record<string, string | number> = { date: formatDate(date) };
      portfolioDataByDate.forEach((dateMap, idx) => {
        const value = dateMap.get(date);
        if (value !== undefined) {
          point[`portfolio${idx}`] = value;
        }
      });
      return point;
    });
  }, [comparisons]);

  const allocationData = useMemo(() => {
    const assetClasses = new Set<string>();
    comparisons.forEach(c => {
      c.items.forEach(item => assetClasses.add(item.assetClass || "Other"));
    });
    
    return Array.from(assetClasses).map(assetClass => {
      const row: Record<string, string | number> = { assetClass };
      comparisons.forEach((c, idx) => {
        const totalWeight = c.items
          .filter(item => (item.assetClass || "Other") === assetClass)
          .reduce((sum, item) => sum + parseFloat(item.weight || "0"), 0);
        row[`portfolio${idx}`] = totalWeight;
      });
      return row;
    });
  }, [comparisons]);

  if (portfoliosLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <MetricCardSkeleton key={i} />
          ))}
        </div>
        <ChartSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-compare-title">
            Portfolio Comparison
          </h1>
          <Badge variant="outline" className="text-xs">Up to 3</Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Compare performance and risk metrics across custom portfolios
        </p>
      </div>

      <Card data-testid="card-portfolio-selector">
        <CardHeader>
          <CardTitle className="text-base font-medium">Select Portfolios to Compare</CardTitle>
          <CardDescription>Choose 2-3 custom portfolios for side-by-side comparison</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            {selectedPortfolios.map((id, idx) => {
              const portfolio = portfolios.find(p => p.id === id);
              return (
                <Badge
                  key={id}
                  variant="secondary"
                  className="flex items-center gap-2 px-3 py-1.5"
                  style={{ borderLeft: `3px solid ${CHART_COLORS[idx]}` }}
                  data-testid={`badge-portfolio-${idx}`}
                >
                  <span>{portfolio?.name || "Unknown"}</span>
                  <button
                    onClick={() => removePortfolio(id)}
                    className="ml-1 hover:text-destructive"
                    data-testid={`button-remove-portfolio-${idx}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              );
            })}
            
            {selectedPortfolios.length < 3 && availablePortfolios.length > 0 && (
              <Select value="" onValueChange={addPortfolio}>
                <SelectTrigger className="w-[200px]" data-testid="select-add-portfolio">
                  <Plus className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Add portfolio" />
                </SelectTrigger>
                <SelectContent>
                  {availablePortfolios.map(p => (
                    <SelectItem key={p.id} value={p.id} data-testid={`option-portfolio-${p.id}`}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          
          {selectedPortfolios.length === 0 && (
            <div className="flex items-center gap-2 mt-4 text-muted-foreground">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm">Select at least 2 portfolios to begin comparison</span>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedPortfolios.length >= 2 && (
        <>
          {comparisonLoading ? (
            <div className="grid gap-6">
              <ChartSkeleton />
              <ChartSkeleton />
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                {comparisons.map((c, idx) => (
                  <Card key={c.portfolio.id} data-testid={`card-summary-${idx}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: CHART_COLORS[idx] }}
                        />
                        <CardTitle className="text-base font-medium">{c.portfolio.name}</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Total Return</span>
                        <span className={`font-mono text-sm ${parseFloat(c.backtest?.totalReturn || "0") >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                          {formatPercent(c.backtest?.totalReturn)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Sharpe Ratio</span>
                        <span className="font-mono text-sm">{formatNumber(c.backtest?.sharpeRatio)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Max Drawdown</span>
                        <span className="font-mono text-sm text-red-500">{formatPercent(c.backtest?.maxDrawdown)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Final Value</span>
                        <span className="font-mono text-sm">{formatCurrency(c.backtest?.finalValue)}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card data-testid="card-performance-chart">
                <CardHeader>
                  <CardTitle className="text-base font-medium flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    Performance Comparison
                  </CardTitle>
                  <CardDescription>Cumulative returns over time</CardDescription>
                </CardHeader>
                <CardContent>
                  {performanceChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={350}>
                      <LineChart data={performanceChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis
                          dataKey="date"
                          fontSize={12}
                          tickLine={false}
                          axisLine={false}
                          tick={{ fill: "hsl(var(--muted-foreground))" }}
                        />
                        <YAxis
                          fontSize={12}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(value) => `${value.toFixed(0)}%`}
                          tick={{ fill: "hsl(var(--muted-foreground))" }}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                          }}
                          formatter={(value: number, name: string) => {
                            const idx = parseInt(name.replace("portfolio", ""));
                            return [`${value.toFixed(2)}%`, comparisons[idx]?.portfolio.name || name];
                          }}
                        />
                        <Legend
                          formatter={(value: string) => {
                            const idx = parseInt(value.replace("portfolio", ""));
                            return comparisons[idx]?.portfolio.name || value;
                          }}
                        />
                        {comparisons.map((_, idx) => (
                          <Line
                            key={idx}
                            type="monotone"
                            dataKey={`portfolio${idx}`}
                            stroke={CHART_COLORS[idx]}
                            strokeWidth={2}
                            dot={false}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-[350px] text-muted-foreground">
                      No performance data available
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="grid gap-6 lg:grid-cols-2">
                <Card data-testid="card-metrics-comparison">
                  <CardHeader>
                    <CardTitle className="text-base font-medium flex items-center gap-2">
                      <BarChart3 className="h-4 w-4" />
                      Risk Metrics Comparison
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Metric</TableHead>
                          {comparisons.map((c, idx) => (
                            <TableHead key={c.portfolio.id} className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <div
                                  className="w-2 h-2 rounded-full"
                                  style={{ backgroundColor: CHART_COLORS[idx] }}
                                />
                                {c.portfolio.name.length > 12 ? c.portfolio.name.substring(0, 12) + "..." : c.portfolio.name}
                              </div>
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow>
                          <TableCell className="font-medium">Annualized Return</TableCell>
                          {comparisons.map(c => (
                            <TableCell key={c.portfolio.id} className="text-right font-mono">
                              {formatPercent(c.backtest?.annualizedReturn)}
                            </TableCell>
                          ))}
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">Volatility</TableCell>
                          {comparisons.map(c => (
                            <TableCell key={c.portfolio.id} className="text-right font-mono">
                              {formatPercent(c.backtest?.volatility)}
                            </TableCell>
                          ))}
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">Sharpe Ratio</TableCell>
                          {comparisons.map(c => (
                            <TableCell key={c.portfolio.id} className="text-right font-mono">
                              {formatNumber(c.backtest?.sharpeRatio)}
                            </TableCell>
                          ))}
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">Sortino Ratio</TableCell>
                          {comparisons.map(c => (
                            <TableCell key={c.portfolio.id} className="text-right font-mono">
                              {formatNumber(c.riskMetrics?.sortinoRatio)}
                            </TableCell>
                          ))}
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">Max Drawdown</TableCell>
                          {comparisons.map(c => (
                            <TableCell key={c.portfolio.id} className="text-right font-mono text-red-500">
                              {formatPercent(c.backtest?.maxDrawdown)}
                            </TableCell>
                          ))}
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">Calmar Ratio</TableCell>
                          {comparisons.map(c => (
                            <TableCell key={c.portfolio.id} className="text-right font-mono">
                              {formatNumber(c.riskMetrics?.calmarRatio)}
                            </TableCell>
                          ))}
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">Beta</TableCell>
                          {comparisons.map(c => (
                            <TableCell key={c.portfolio.id} className="text-right font-mono">
                              {formatNumber(c.riskMetrics?.beta)}
                            </TableCell>
                          ))}
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">Alpha</TableCell>
                          {comparisons.map(c => (
                            <TableCell key={c.portfolio.id} className="text-right font-mono">
                              {formatPercent(c.riskMetrics?.alpha)}
                            </TableCell>
                          ))}
                        </TableRow>
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card data-testid="card-allocation-comparison">
                  <CardHeader>
                    <CardTitle className="text-base font-medium flex items-center gap-2">
                      <GitCompare className="h-4 w-4" />
                      Asset Allocation Comparison
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {allocationData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={allocationData} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis
                            type="number"
                            tickFormatter={(v) => `${v}%`}
                            fontSize={12}
                            tick={{ fill: "hsl(var(--muted-foreground))" }}
                          />
                          <YAxis
                            type="category"
                            dataKey="assetClass"
                            fontSize={12}
                            tick={{ fill: "hsl(var(--muted-foreground))" }}
                            width={100}
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "hsl(var(--card))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: "8px",
                            }}
                            formatter={(value: number, name: string) => {
                              const idx = parseInt(name.replace("portfolio", ""));
                              return [`${value.toFixed(1)}%`, comparisons[idx]?.portfolio.name || name];
                            }}
                          />
                          <Legend
                            formatter={(value: string) => {
                              const idx = parseInt(value.replace("portfolio", ""));
                              return comparisons[idx]?.portfolio.name || value;
                            }}
                          />
                          {comparisons.map((_, idx) => (
                            <Bar
                              key={idx}
                              dataKey={`portfolio${idx}`}
                              fill={CHART_COLORS[idx]}
                              radius={[0, 4, 4, 0]}
                            />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                        No allocation data available
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </>
      )}

      {selectedPortfolios.length === 1 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <GitCompare className="h-10 w-10 mb-3" />
            <p>Select one more portfolio to compare</p>
          </CardContent>
        </Card>
      )}

      {portfolios.length < 2 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <AlertTriangle className="h-10 w-10 mb-3" />
            <p>You need at least 2 custom portfolios to use comparison</p>
            <p className="text-sm mt-1">Create portfolios in the Portfolio Builder</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
