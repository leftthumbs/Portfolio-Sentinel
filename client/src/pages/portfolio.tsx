import { useQuery } from "@tanstack/react-query";
import { usePortfolio } from "@/hooks/use-portfolio";
import { AlertTriangle, ArrowUpRight, ArrowDownRight, Wallet } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TableSkeleton, MetricCardSkeleton } from "@/components/loading-skeleton";
import { MetricCard } from "@/components/metric-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import type { Portfolio, Holding } from "@shared/schema";

interface PortfolioData {
  portfolio: Portfolio;
  holdings: Holding[];
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

export default function PortfolioPage() {
  const { selectedPortfolioId } = usePortfolio();

  const portfolioUrl = selectedPortfolioId 
    ? `/api/portfolio?portfolioId=${selectedPortfolioId}`
    : "/api/portfolio";

  const { data, isLoading, error } = useQuery<PortfolioData>({
    queryKey: ["/api/portfolio", selectedPortfolioId],
    queryFn: async () => {
      const res = await fetch(portfolioUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch portfolio data");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <MetricCardSkeleton key={i} />
          ))}
        </div>
        <TableSkeleton rows={8} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-[400px] gap-4">
        <AlertTriangle className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">Failed to load portfolio data</p>
      </div>
    );
  }

  const { portfolio, holdings } = data;
  const totalValue = parseFloat(portfolio.totalValue);
  const totalCost = holdings.reduce((sum, h) => sum + parseFloat(h.costBasis), 0);
  const totalGain = holdings.reduce((sum, h) => sum + parseFloat(h.unrealizedGain), 0);
  const gainPercent = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;

  const assetClassData = holdings.reduce((acc, h) => {
    const existing = acc.find((a) => a.name === h.assetClass);
    if (existing) {
      existing.value += parseFloat(h.allocation);
      existing.marketValue += parseFloat(h.marketValue);
    } else {
      acc.push({
        name: h.assetClass,
        value: parseFloat(h.allocation),
        marketValue: parseFloat(h.marketValue),
      });
    }
    return acc;
  }, [] as { name: string; value: number; marketValue: number }[]);

  const performanceData = holdings.map((h) => ({
    name: h.fundName.length > 15 ? h.fundName.substring(0, 15) + "..." : h.fundName,
    ytd: h.returnYtd ? parseFloat(h.returnYtd) * 100 : 0,
    oneYear: h.return1yr ? parseFloat(h.return1yr) * 100 : 0,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-portfolio-title">Portfolio Composition</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {portfolio.name} • {holdings.length} funds
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          title="Total Market Value"
          value={formatCurrency(totalValue)}
          icon={<Wallet className="h-5 w-5" />}
        />
        <MetricCard
          title="Total Cost Basis"
          value={formatCurrency(totalCost)}
        />
        <MetricCard
          title="Unrealized Gain/Loss"
          value={`${totalGain >= 0 ? "+" : ""}${formatCurrency(totalGain)}`}
          change={gainPercent}
          valueClassName={totalGain >= 0 ? "text-emerald-500" : "text-red-500"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card data-testid="card-asset-allocation">
          <CardHeader>
            <CardTitle className="text-base font-medium">Asset Class Allocation</CardTitle>
            <CardDescription>Breakdown by asset class</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={assetClassData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={3}
                  dataKey="value"
                  nameKey="name"
                >
                  {assetClassData.map((_, index) => (
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
                  formatter={(value: number, name: string, props: any) => [
                    `${value.toFixed(1)}% (${formatCurrency(props.payload.marketValue)})`,
                    name
                  ]}
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

        <Card data-testid="card-fund-performance">
          <CardHeader>
            <CardTitle className="text-base font-medium">Fund Performance</CardTitle>
            <CardDescription>YTD and 1-Year returns by fund</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={performanceData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis 
                  type="number" 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={11}
                  tickFormatter={(v) => `${v}%`}
                />
                <YAxis 
                  type="category" 
                  dataKey="name" 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={11}
                  width={100}
                  tickLine={false}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: "hsl(var(--card))", 
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "6px",
                    fontSize: 12,
                  }}
                  formatter={(value: number) => [`${value.toFixed(2)}%`, ""]}
                />
                <Bar dataKey="ytd" name="YTD" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} />
                <Bar dataKey="oneYear" name="1 Year" fill="hsl(var(--chart-2))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-holdings-detail">
        <CardHeader>
          <CardTitle className="text-base font-medium">All Holdings</CardTitle>
          <CardDescription>Complete list of fund positions</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[220px]">Fund Name</TableHead>
                <TableHead>Asset Class</TableHead>
                <TableHead className="text-right">Allocation</TableHead>
                <TableHead className="text-right">Market Value</TableHead>
                <TableHead className="text-right">Cost Basis</TableHead>
                <TableHead className="text-right">YTD</TableHead>
                <TableHead className="text-right">1 Year</TableHead>
                <TableHead className="text-right">Gain/Loss</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {holdings.map((holding) => {
                const unrealizedGain = parseFloat(holding.unrealizedGain);
                const isPositive = unrealizedGain >= 0;
                const ytdReturn = holding.returnYtd ? parseFloat(holding.returnYtd) : 0;
                const oneYrReturn = holding.return1yr ? parseFloat(holding.return1yr) : 0;
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
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Progress value={parseFloat(holding.allocation)} className="w-16 h-2" />
                        <span className="font-mono text-sm w-12 text-right">
                          {parseFloat(holding.allocation).toFixed(1)}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(holding.marketValue)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {formatCurrency(holding.costBasis)}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={`font-mono ${ytdReturn >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                        {formatPercent(ytdReturn)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={`font-mono ${oneYrReturn >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                        {formatPercent(oneYrReturn)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className={`flex items-center justify-end gap-1 font-mono ${isPositive ? "text-emerald-500" : "text-red-500"}`}>
                        {isPositive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                        {isPositive ? "+" : ""}{formatCurrency(unrealizedGain)}
                      </div>
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
