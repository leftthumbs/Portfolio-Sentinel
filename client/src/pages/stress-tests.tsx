import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePortfolio } from "@/hooks/use-portfolio";
import { AlertTriangle, Play, TrendingDown, Zap, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { TableSkeleton, MetricCardSkeleton } from "@/components/loading-skeleton";
import { MetricCard } from "@/components/metric-card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
import type { Portfolio, StressTest } from "@shared/schema";

interface StressTestData {
  portfolio: Portfolio;
  stressTests: StressTest[];
}

interface PortfolioOption {
  id: string;
  name: string;
  type: "core" | "custom";
}

interface PortfolioOptionsData {
  options: PortfolioOption[];
}

const PRESET_SCENARIOS = [
  { name: "2008 Financial Crisis", equityShock: -0.55, rateShock: -0.02, creditSpreadShock: 0.04, fxShock: -0.15 },
  { name: "2020 COVID Crash", equityShock: -0.35, rateShock: -0.015, creditSpreadShock: 0.025, fxShock: -0.08 },
  { name: "2022 Rate Shock", equityShock: -0.25, rateShock: 0.03, creditSpreadShock: 0.02, fxShock: 0.05 },
  { name: "Mild Recession", equityShock: -0.20, rateShock: -0.01, creditSpreadShock: 0.015, fxShock: -0.05 },
  { name: "Stagflation", equityShock: -0.15, rateShock: 0.04, creditSpreadShock: 0.03, fxShock: -0.10 },
];

function formatCurrency(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (Math.abs(num) >= 1e9) return `${num >= 0 ? "" : "-"}$${(Math.abs(num) / 1e9).toFixed(2)}B`;
  if (Math.abs(num) >= 1e6) return `${num >= 0 ? "" : "-"}$${(Math.abs(num) / 1e6).toFixed(2)}M`;
  if (Math.abs(num) >= 1e3) return `${num >= 0 ? "" : "-"}$${(Math.abs(num) / 1e3).toFixed(0)}K`;
  return `$${num.toFixed(0)}`;
}

function formatPercent(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  return `${(num * 100).toFixed(2)}%`;
}

function getSeverityBadge(impact: number): { label: string; variant: "default" | "secondary" | "destructive" } {
  const absImpact = Math.abs(impact);
  if (absImpact > 0.20) return { label: "Severe", variant: "destructive" };
  if (absImpact > 0.10) return { label: "Moderate", variant: "secondary" };
  return { label: "Low", variant: "default" };
}

export default function StressTestsPage() {
  const { toast } = useToast();
  const { selectedPortfolioId, selectedPortfolioType, selectedPortfolio } = usePortfolio();
  const [selectedScenario, setSelectedScenario] = useState<string>("");
  const [customScenario, setCustomScenario] = useState({
    name: "",
    equityShock: -0.20,
    rateShock: 0.01,
    creditSpreadShock: 0.02,
    fxShock: -0.05,
  });

  const stressTestUrl = selectedPortfolioId 
    ? `/api/stress-tests?portfolioId=${selectedPortfolioId}&portfolioType=${selectedPortfolioType}`
    : "/api/stress-tests";

  const { data, isLoading, error } = useQuery<StressTestData & { isCustomPortfolio?: boolean }>({
    queryKey: ["/api/stress-tests", selectedPortfolioId, selectedPortfolioType],
    queryFn: async () => {
      const res = await fetch(stressTestUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch stress test data");
      return res.json();
    },
  });

  const runStressTest = useMutation({
    mutationFn: async (scenario: typeof customScenario) => {
      return apiRequest("POST", "/api/stress-tests", {
        ...scenario,
        portfolioId: selectedPortfolioId,
        portfolioType: selectedPortfolioType,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stress-tests"] });
      toast({
        title: "Stress test completed",
        description: "The scenario has been analyzed successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to run stress test. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handlePresetSelect = (presetName: string) => {
    setSelectedScenario(presetName);
    const preset = PRESET_SCENARIOS.find(p => p.name === presetName);
    if (preset) {
      setCustomScenario({
        name: preset.name,
        equityShock: preset.equityShock,
        rateShock: preset.rateShock,
        creditSpreadShock: preset.creditSpreadShock,
        fxShock: preset.fxShock,
      });
    }
  };

  const handleRunTest = () => {
    if (!customScenario.name) {
      toast({
        title: "Missing scenario name",
        description: "Please enter a name for your scenario.",
        variant: "destructive",
      });
      return;
    }
    runStressTest.mutate(customScenario);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <MetricCardSkeleton key={i} />
          ))}
        </div>
        <TableSkeleton rows={5} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-[400px] gap-4">
        <AlertTriangle className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">Failed to load stress test data</p>
      </div>
    );
  }

  const { portfolio, stressTests } = data;
  const portfolioValue = parseFloat(portfolio.totalValue);
  
  const worstCase = stressTests.length > 0 
    ? stressTests.reduce((worst, test) => {
        const impact = test.portfolioImpact ? parseFloat(test.portfolioImpact) : 0;
        return impact < worst ? impact : worst;
      }, 0)
    : 0;

  const avgImpact = stressTests.length > 0
    ? stressTests.reduce((sum, test) => sum + (test.portfolioImpact ? parseFloat(test.portfolioImpact) : 0), 0) / stressTests.length
    : 0;

  const chartData = stressTests.slice(-10).map(test => ({
    name: test.scenarioName.length > 15 ? test.scenarioName.substring(0, 15) + "..." : test.scenarioName,
    impact: test.portfolioImpact ? parseFloat(test.portfolioImpact) * 100 : 0,
    amount: test.impactAmount ? parseFloat(test.impactAmount) : 0,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-stress-title">Stress Testing</h1>
            {data?.isCustomPortfolio && (
              <Badge variant="outline" className="text-xs">Custom Portfolio</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {selectedPortfolio?.name || portfolio.name} • Scenario analysis and stress testing
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          title="Portfolio at Risk"
          value={formatCurrency(portfolioValue)}
          icon={<Zap className="h-5 w-5" />}
        />
        <MetricCard
          title="Worst Case Impact"
          value={formatPercent(worstCase)}
          icon={<TrendingDown className="h-5 w-5" />}
          valueClassName="text-red-500"
        />
        <MetricCard
          title="Average Impact"
          value={formatPercent(avgImpact)}
          icon={<AlertTriangle className="h-5 w-5" />}
          valueClassName="text-yellow-500"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2" data-testid="card-scenario-builder">
          <CardHeader>
            <CardTitle className="text-base font-medium">Scenario Builder</CardTitle>
            <CardDescription>Configure and run stress test scenarios</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Preset Scenario</Label>
              <Select value={selectedScenario} onValueChange={handlePresetSelect}>
                <SelectTrigger data-testid="select-preset-scenario">
                  <SelectValue placeholder="Select a preset scenario" />
                </SelectTrigger>
                <SelectContent>
                  {PRESET_SCENARIOS.map(preset => (
                    <SelectItem key={preset.name} value={preset.name}>
                      {preset.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="scenario-name">Scenario Name</Label>
              <Input
                id="scenario-name"
                value={customScenario.name}
                onChange={(e) => setCustomScenario(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Enter scenario name"
                data-testid="input-scenario-name"
              />
            </div>

            <div className="space-y-4">
              <div className="space-y-3">
                <div className="flex justify-between">
                  <Label>Equity Shock</Label>
                  <span className="text-sm font-mono text-muted-foreground">
                    {(customScenario.equityShock * 100).toFixed(0)}%
                  </span>
                </div>
                <Slider
                  value={[customScenario.equityShock * 100]}
                  onValueChange={([value]) => setCustomScenario(prev => ({ ...prev, equityShock: value / 100 }))}
                  min={-80}
                  max={20}
                  step={5}
                  className="w-full"
                  data-testid="slider-equity-shock"
                />
              </div>

              <div className="space-y-3">
                <div className="flex justify-between">
                  <Label>Interest Rate Shock</Label>
                  <span className="text-sm font-mono text-muted-foreground">
                    {(customScenario.rateShock * 100).toFixed(1)}%
                  </span>
                </div>
                <Slider
                  value={[customScenario.rateShock * 100]}
                  onValueChange={([value]) => setCustomScenario(prev => ({ ...prev, rateShock: value / 100 }))}
                  min={-3}
                  max={5}
                  step={0.25}
                  className="w-full"
                  data-testid="slider-rate-shock"
                />
              </div>

              <div className="space-y-3">
                <div className="flex justify-between">
                  <Label>Credit Spread Shock</Label>
                  <span className="text-sm font-mono text-muted-foreground">
                    {(customScenario.creditSpreadShock * 100).toFixed(1)}%
                  </span>
                </div>
                <Slider
                  value={[customScenario.creditSpreadShock * 100]}
                  onValueChange={([value]) => setCustomScenario(prev => ({ ...prev, creditSpreadShock: value / 100 }))}
                  min={0}
                  max={5}
                  step={0.25}
                  className="w-full"
                  data-testid="slider-credit-shock"
                />
              </div>

              <div className="space-y-3">
                <div className="flex justify-between">
                  <Label>FX Shock</Label>
                  <span className="text-sm font-mono text-muted-foreground">
                    {(customScenario.fxShock * 100).toFixed(0)}%
                  </span>
                </div>
                <Slider
                  value={[customScenario.fxShock * 100]}
                  onValueChange={([value]) => setCustomScenario(prev => ({ ...prev, fxShock: value / 100 }))}
                  min={-30}
                  max={30}
                  step={5}
                  className="w-full"
                  data-testid="slider-fx-shock"
                />
              </div>
            </div>

            <Button 
              onClick={handleRunTest} 
              className="w-full" 
              disabled={runStressTest.isPending}
              data-testid="button-run-stress-test"
            >
              {runStressTest.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Run Stress Test
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3" data-testid="card-impact-chart">
          <CardHeader>
            <CardTitle className="text-base font-medium">Impact Analysis</CardTitle>
            <CardDescription>Portfolio impact by scenario</CardDescription>
          </CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[300px] text-muted-foreground">
                <AlertTriangle className="h-10 w-10 mb-3" />
                <p>No stress tests run yet</p>
                <p className="text-sm">Run a scenario to see the impact analysis</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis 
                    type="number" 
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickFormatter={(v) => `${v}%`}
                    domain={['auto', 0]}
                  />
                  <YAxis 
                    type="category" 
                    dataKey="name" 
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    width={120}
                    tickLine={false}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: "hsl(var(--card))", 
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px",
                      fontSize: 12,
                    }}
                    formatter={(value: number, name: string, props: any) => [
                      `${value.toFixed(2)}% (${formatCurrency(props.payload.amount)})`,
                      "Impact"
                    ]}
                  />
                  <ReferenceLine x={0} stroke="hsl(var(--muted-foreground))" />
                  <Bar dataKey="impact" radius={[0, 4, 4, 0]}>
                    {chartData.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={entry.impact < -20 ? "hsl(var(--destructive))" : entry.impact < -10 ? "hsl(var(--chart-4))" : "hsl(var(--chart-1))"} 
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-stress-history">
        <CardHeader>
          <CardTitle className="text-base font-medium">Stress Test History</CardTitle>
          <CardDescription>All completed scenario analyses</CardDescription>
        </CardHeader>
        <CardContent>
          {stressTests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <AlertTriangle className="h-10 w-10 mb-3" />
              <p>No stress tests have been run</p>
              <p className="text-sm">Use the scenario builder to run your first test</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">Scenario</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Equity</TableHead>
                  <TableHead className="text-right">Rates</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">FX</TableHead>
                  <TableHead className="text-right">Impact</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Severity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stressTests.map((test) => {
                  const impact = test.portfolioImpact ? parseFloat(test.portfolioImpact) : 0;
                  const severity = getSeverityBadge(impact);
                  return (
                    <TableRow key={test.id} data-testid={`row-stress-${test.id}`}>
                      <TableCell className="font-medium">{test.scenarioName}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-normal">
                          {test.scenarioType}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {test.equityShock ? `${(parseFloat(test.equityShock) * 100).toFixed(0)}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {test.rateShock ? `${(parseFloat(test.rateShock) * 100).toFixed(1)}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {test.creditSpreadShock ? `${(parseFloat(test.creditSpreadShock) * 100).toFixed(1)}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {test.fxShock ? `${(parseFloat(test.fxShock) * 100).toFixed(0)}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={`font-mono text-sm ${impact < 0 ? "text-red-500" : "text-emerald-500"}`}>
                          {formatPercent(impact)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={`font-mono text-sm ${impact < 0 ? "text-red-500" : "text-emerald-500"}`}>
                          {test.impactAmount ? formatCurrency(test.impactAmount) : "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={severity.variant}>{severity.label}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Stress Testing Methodology</CardTitle>
          <CardDescription>How scenario analysis is performed</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              Stress tests use a <strong className="text-foreground">deterministic factor-based sensitivity analysis</strong> to estimate portfolio
              impact under various market scenarios. This is not a Monte Carlo simulation — each scenario produces a single,
              deterministic outcome based on the portfolio's asset class weights and predefined factor sensitivities.
            </p>
            <div>
              <p className="font-medium text-foreground mb-2">Impact Calculation</p>
              <p className="mb-2">The total portfolio impact is calculated as the sum of four factor-specific impacts, each weighted by the portfolio's actual asset class allocations:</p>
              <ul className="space-y-1.5 ml-4 list-disc">
                <li><strong className="text-foreground">Equity Impact</strong> = Equity Shock × Equity Weight — direct pass-through of equity market movements</li>
                <li><strong className="text-foreground">Interest Rate Impact</strong> = Rate Shock × (-8) × Fixed Income Weight — assumes an effective portfolio duration of ~8 years for fixed income holdings</li>
                <li><strong className="text-foreground">Credit Spread Impact</strong> = Credit Spread Shock × (-5) × Fixed Income Weight — assumes a spread duration of ~5 years for credit-sensitive holdings</li>
                <li><strong className="text-foreground">FX Impact</strong> = FX Shock × 0.3 × (Equity + Alternative Weight) — assumes approximately 30% foreign currency exposure in equity and alternative allocations</li>
              </ul>
            </div>
            <div>
              <p className="font-medium text-foreground mb-2">Asset Class Classification</p>
              <p>
                Portfolio holdings are classified into four buckets — Equity, Fixed Income, Commodities, and Alternatives — based on their
                asset class labels. Each holding's allocation weight determines how much of the portfolio is exposed to the corresponding factor shock.
              </p>
            </div>
            <div>
              <p className="font-medium text-foreground mb-2">Limitations</p>
              <p>
                This approach provides a first-order linear approximation of portfolio stress impact. It does not account for non-linear effects
                (convexity, option payoffs), cross-asset correlations that may change under stress, or liquidity-driven amplification effects.
                Preset scenarios are calibrated to approximate historical episodes but are stylized representations, not exact replays.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
