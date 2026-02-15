import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePortfolio } from "@/hooks/use-portfolio";
import {
  AlertTriangle, Play, TrendingDown, Zap, RefreshCw, Target,
  BarChart3, Activity, Shield, Layers, FlaskConical, ArrowDownUp,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TableSkeleton, MetricCardSkeleton } from "@/components/loading-skeleton";
import { MetricCard } from "@/components/metric-card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell, RadarChart, Radar,
  PolarGrid, PolarAngleAxis, PolarRadiusAxis, AreaChart, Area,
} from "recharts";
import type { Portfolio, StressTest } from "@shared/schema";

// ─── Types ──────────────────────────────────────────────────────────────────

interface StressTestData {
  portfolio: Portfolio;
  stressTests: StressTest[];
}

interface ScenarioShock {
  equity?: number;
  rates?: number;
  credit?: number;
  fx?: number;
  commodity?: number;
  volatility?: number;
  inflation?: number;
  liquidity?: number;
}

interface AssetImpact {
  name: string;
  assetClass: string;
  weight: number;
  impact: number;
  factorContributions: Record<string, number>;
  marginalContribution: number;
}

interface ScenarioResult {
  scenarioName: string;
  scenarioCategory: string;
  scenarioDescription: string;
  regime?: string;
  totalImpact: number;
  impactAmount: number;
  portfolioValue: number;
  stressedValue: number;
  parametricVaR95: number;
  parametricVaR99: number;
  cvar95: number;
  cvar99: number;
  componentVaR: Record<string, number>;
  factorImpacts: Record<string, number>;
  assetImpacts: AssetImpact[];
  monteCarloStats?: MonteCarloScenarioStats;
}

interface MonteCarloScenarioStats {
  numSimulations: number;
  meanImpact: number;
  medianImpact: number;
  stdDevImpact: number;
  percentile1: number;
  percentile5: number;
  percentile10: number;
  percentile25: number;
  percentile75: number;
  percentile90: number;
  percentile95: number;
  percentile99: number;
  skewness: number;
  kurtosis: number;
  probabilityOfLoss: number;
  probabilityOfLossGt10pct: number;
  probabilityOfLossGt20pct: number;
  simulatedReturns: number[];
  tailExpectedShortfall: number;
}

interface ReverseStressResult {
  targetLoss: number;
  achievedLoss: number;
  requiredShocks: ScenarioShock;
  scenarioDescription: string;
  dominantFactor: string;
  assetImpacts: AssetImpact[];
}

interface ScenarioComparisonResult {
  scenarios: ScenarioResult[];
  ranking: Array<{ name: string; impact: number; rank: number }>;
  worstCase: ScenarioResult;
  bestCase: ScenarioResult;
  averageImpact: number;
  impactRange: number;
}

interface EngineConfig {
  factors: Array<{ id: string; name: string; description: string }>;
  historicalScenarios: Array<{ name: string; description: string; category: string; regime?: string; shocks: ScenarioShock }>;
  hypotheticalScenarios: Array<{ name: string; description: string; category: string; regime?: string; shocks: ScenarioShock }>;
}

// ─── Formatting Helpers ─────────────────────────────────────────────────────

function formatCurrency(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (Math.abs(num) >= 1e9) return `${num >= 0 ? "" : "-"}$${(Math.abs(num) / 1e9).toFixed(2)}B`;
  if (Math.abs(num) >= 1e6) return `${num >= 0 ? "" : "-"}$${(Math.abs(num) / 1e6).toFixed(2)}M`;
  if (Math.abs(num) >= 1e3) return `${num >= 0 ? "" : "-"}$${(Math.abs(num) / 1e3).toFixed(0)}K`;
  return `$${num.toFixed(0)}`;
}

function formatPercent(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "\u2014";
  const num = typeof value === "string" ? parseFloat(value) : value;
  return `${(num * 100).toFixed(2)}%`;
}

function getSeverityBadge(impact: number): { label: string; variant: "default" | "secondary" | "destructive" } {
  const absImpact = Math.abs(impact);
  if (absImpact > 0.20) return { label: "Severe", variant: "destructive" };
  if (absImpact > 0.10) return { label: "Moderate", variant: "secondary" };
  return { label: "Low", variant: "default" };
}

function getRegimeBadge(regime?: string): { label: string; className: string } {
  switch (regime) {
    case "crisis": return { label: "Crisis", className: "bg-red-500/20 text-red-400 border-red-500/30" };
    case "contraction": return { label: "Contraction", className: "bg-amber-500/20 text-amber-400 border-amber-500/30" };
    case "expansion": return { label: "Expansion", className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" };
    default: return { label: "Custom", className: "bg-blue-500/20 text-blue-400 border-blue-500/30" };
  }
}

const FACTOR_LABELS: Record<string, string> = {
  equity: "Equity",
  rates: "Rates",
  credit: "Credit",
  fx: "FX",
  commodity: "Cmdty",
  volatility: "Vol",
  inflation: "Infl",
  liquidity: "Liq",
};

const FACTOR_COLORS: Record<string, string> = {
  equity: "hsl(var(--chart-1))",
  rates: "hsl(var(--chart-2))",
  credit: "hsl(var(--chart-3))",
  fx: "hsl(var(--chart-4))",
  commodity: "hsl(var(--chart-5))",
  volatility: "#a855f7",
  inflation: "#f97316",
  liquidity: "#06b6d4",
};

// ─── Scenario Shock Defaults ────────────────────────────────────────────────

const DEFAULT_SHOCKS: ScenarioShock = {
  equity: -0.20,
  rates: 0.01,
  credit: 0.02,
  fx: -0.05,
  commodity: -0.10,
  volatility: 0.50,
  inflation: 0.00,
  liquidity: 0.10,
};

const SHOCK_CONFIGS: Array<{
  key: keyof ScenarioShock;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}> = [
  { key: "equity", label: "Equity Market", min: -80, max: 30, step: 5, format: v => `${v.toFixed(0)}%` },
  { key: "rates", label: "Interest Rates", min: -3, max: 5, step: 0.25, format: v => `${v.toFixed(1)}%` },
  { key: "credit", label: "Credit Spreads", min: -2, max: 8, step: 0.25, format: v => `${v.toFixed(1)}%` },
  { key: "fx", label: "FX / Dollar", min: -30, max: 30, step: 5, format: v => `${v.toFixed(0)}%` },
  { key: "commodity", label: "Commodities", min: -50, max: 60, step: 5, format: v => `${v.toFixed(0)}%` },
  { key: "volatility", label: "Volatility (VIX)", min: -50, max: 300, step: 10, format: v => `${v.toFixed(0)}%` },
  { key: "inflation", label: "Inflation", min: -3, max: 8, step: 0.25, format: v => `${v.toFixed(1)}%` },
  { key: "liquidity", label: "Liquidity Stress", min: -20, max: 70, step: 5, format: v => `${v.toFixed(0)}%` },
];

// ─── Main Component ─────────────────────────────────────────────────────────

export default function StressTestsPage() {
  const { toast } = useToast();
  const { selectedPortfolioId, selectedPortfolioType, selectedPortfolio } = usePortfolio();
  const [activeTab, setActiveTab] = useState("scenario");
  const [selectedPreset, setSelectedPreset] = useState<string>("");
  const [scenarioName, setScenarioName] = useState("");
  const [scenarioRegime, setScenarioRegime] = useState<string>("");
  const [shocks, setShocks] = useState<ScenarioShock>({ ...DEFAULT_SHOCKS });
  const [useMonteCarlo, setUseMonteCarlo] = useState(false);
  const [numSimulations, setNumSimulations] = useState(1000);
  const [lastResult, setLastResult] = useState<ScenarioResult | null>(null);
  const [comparisonResult, setComparisonResult] = useState<ScenarioComparisonResult | null>(null);
  const [reverseTarget, setReverseTarget] = useState(-0.25);
  const [reverseResult, setReverseResult] = useState<ReverseStressResult | null>(null);

  // Fetch config (factors + presets)
  const { data: config } = useQuery<EngineConfig>({
    queryKey: ["/api/scenario-engine/config"],
    queryFn: async () => {
      const res = await fetch("/api/scenario-engine/config", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch config");
      return res.json();
    },
  });

  // Fetch legacy stress test history
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

  // Enhanced stress test mutation
  const runEnhancedTest = useMutation({
    mutationFn: async (params: {
      scenario: { name: string; description: string; category: string; regime?: string; shocks: ScenarioShock };
      monteCarlo: boolean;
      numSimulations: number;
    }) => {
      const res = await apiRequest("POST", "/api/scenario-engine/stress-test", {
        ...params,
        fatTails: true,
        degreesOfFreedom: 5,
        portfolioId: selectedPortfolioId,
        portfolioType: selectedPortfolioType,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setLastResult(data.result);
      queryClient.invalidateQueries({ queryKey: ["/api/stress-tests"] });
      toast({ title: "Scenario analysis complete", description: `${data.result.scenarioName}: ${formatPercent(data.result.totalImpact)} impact` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to run scenario. Please try again.", variant: "destructive" });
    },
  });

  // Run all presets mutation
  const runAllPresets = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/scenario-engine/run-all-presets", {
        portfolioId: selectedPortfolioId,
        portfolioType: selectedPortfolioType,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setComparisonResult(data);
      toast({ title: "All scenarios complete", description: `${data.scenarios.length} scenarios analyzed` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to run scenarios.", variant: "destructive" });
    },
  });

  // Reverse stress test mutation
  const runReverseTest = useMutation({
    mutationFn: async (targetLoss: number) => {
      const res = await apiRequest("POST", "/api/scenario-engine/reverse-stress-test", {
        targetLoss,
        portfolioId: selectedPortfolioId,
        portfolioType: selectedPortfolioType,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setReverseResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/stress-tests"] });
      toast({ title: "Reverse stress test complete", description: data.scenarioDescription });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to run reverse stress test.", variant: "destructive" });
    },
  });

  // Legacy stress test mutation (backwards compat)
  const runLegacyTest = useMutation({
    mutationFn: async (scenario: { name: string; equityShock: number; rateShock: number; creditSpreadShock: number; fxShock: number }) => {
      return apiRequest("POST", "/api/stress-tests", {
        ...scenario,
        portfolioId: selectedPortfolioId,
        portfolioType: selectedPortfolioType,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stress-tests"] });
      toast({ title: "Stress test completed", description: "The scenario has been analyzed." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to run stress test.", variant: "destructive" });
    },
  });

  const allPresets = [
    ...(config?.historicalScenarios || []),
    ...(config?.hypotheticalScenarios || []),
  ];

  const handlePresetSelect = (presetName: string) => {
    setSelectedPreset(presetName);
    const preset = allPresets.find(p => p.name === presetName);
    if (preset) {
      setScenarioName(preset.name);
      setScenarioRegime(preset.regime || "");
      setShocks({ ...preset.shocks });
    }
  };

  const handleRunScenario = () => {
    if (!scenarioName) {
      toast({ title: "Missing scenario name", description: "Please enter a name.", variant: "destructive" });
      return;
    }
    runEnhancedTest.mutate({
      scenario: {
        name: scenarioName,
        description: "",
        category: selectedPreset ? "historical" : "hypothetical",
        regime: scenarioRegime || undefined,
        shocks,
      },
      monteCarlo: useMonteCarlo,
      numSimulations,
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <MetricCardSkeleton key={i} />)}
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

  const enhancedTests = stressTests.filter(t => t.scenarioCategory);
  const latestCvar = enhancedTests.length > 0 && enhancedTests[0].cvar95
    ? parseFloat(enhancedTests[0].cvar95)
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-stress-title">Stress Testing</h1>
            <Badge variant="outline" className="text-xs font-mono">8-Factor Model</Badge>
            {data?.isCustomPortfolio && (
              <Badge variant="outline" className="text-xs">Custom Portfolio</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {selectedPortfolio?.name || portfolio.name} &bull; Multi-factor scenario analysis with CVaR, Monte Carlo & reverse stress testing
          </p>
        </div>
      </div>

      {/* Summary Metrics */}
      <div className="grid gap-4 md:grid-cols-4">
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
        <MetricCard
          title="CVaR (95%)"
          value={latestCvar !== null ? formatPercent(latestCvar) : "\u2014"}
          icon={<Shield className="h-5 w-5" />}
          valueClassName="text-orange-500"
        />
      </div>

      {/* Main Tabbed Interface */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid grid-cols-4 w-full max-w-2xl">
          <TabsTrigger value="scenario" className="gap-1.5">
            <FlaskConical className="h-3.5 w-3.5" />
            Scenario Builder
          </TabsTrigger>
          <TabsTrigger value="comparison" className="gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" />
            Compare All
          </TabsTrigger>
          <TabsTrigger value="reverse" className="gap-1.5">
            <ArrowDownUp className="h-3.5 w-3.5" />
            Reverse Test
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <Layers className="h-3.5 w-3.5" />
            History
          </TabsTrigger>
        </TabsList>

        {/* ─── Tab 1: Scenario Builder ─────────────────────────────────────── */}
        <TabsContent value="scenario" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-5">
            {/* Left: Controls */}
            <Card className="lg:col-span-2" data-testid="card-scenario-builder">
              <CardHeader>
                <CardTitle className="text-base font-medium">Multi-Factor Scenario Builder</CardTitle>
                <CardDescription>8 risk factors with correlated shocks & fat-tailed MC simulation</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Preset */}
                <div className="space-y-2">
                  <Label>Preset Scenario</Label>
                  <Select value={selectedPreset} onValueChange={handlePresetSelect}>
                    <SelectTrigger data-testid="select-preset-scenario">
                      <SelectValue placeholder="Select a preset scenario" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__section_hist" disabled>Historical</SelectItem>
                      {(config?.historicalScenarios || []).map(s => (
                        <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>
                      ))}
                      <SelectItem value="__section_hypo" disabled>Hypothetical</SelectItem>
                      {(config?.hypotheticalScenarios || []).map(s => (
                        <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Name + Regime */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="scenario-name">Scenario Name</Label>
                    <Input
                      id="scenario-name"
                      value={scenarioName}
                      onChange={e => setScenarioName(e.target.value)}
                      placeholder="My scenario"
                      data-testid="input-scenario-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Regime</Label>
                    <Select value={scenarioRegime} onValueChange={setScenarioRegime}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select regime" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="expansion">Expansion</SelectItem>
                        <SelectItem value="contraction">Contraction</SelectItem>
                        <SelectItem value="crisis">Crisis</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* 8 Factor Sliders */}
                <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                  {SHOCK_CONFIGS.map(cfg => (
                    <div key={cfg.key} className="space-y-1.5">
                      <div className="flex justify-between">
                        <Label className="text-xs">{cfg.label}</Label>
                        <span className="text-xs font-mono text-muted-foreground">
                          {cfg.format(((shocks[cfg.key] ?? 0) * 100))}
                        </span>
                      </div>
                      <Slider
                        value={[((shocks[cfg.key] ?? 0) * 100)]}
                        onValueChange={([v]) => setShocks(prev => ({ ...prev, [cfg.key]: v / 100 }))}
                        min={cfg.min}
                        max={cfg.max}
                        step={cfg.step}
                        className="w-full"
                      />
                    </div>
                  ))}
                </div>

                {/* Monte Carlo Toggle */}
                <div className="flex items-center gap-3 pt-2 border-t">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useMonteCarlo}
                      onChange={e => setUseMonteCarlo(e.target.checked)}
                      className="rounded border-border"
                    />
                    <span className="text-sm">Monte Carlo (fat-tailed)</span>
                  </label>
                  {useMonteCarlo && (
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground">Sims:</Label>
                      <Select value={String(numSimulations)} onValueChange={v => setNumSimulations(Number(v))}>
                        <SelectTrigger className="h-7 w-[90px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="500">500</SelectItem>
                          <SelectItem value="1000">1,000</SelectItem>
                          <SelectItem value="5000">5,000</SelectItem>
                          <SelectItem value="10000">10,000</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                <Button
                  onClick={handleRunScenario}
                  className="w-full"
                  disabled={runEnhancedTest.isPending}
                  data-testid="button-run-stress-test"
                >
                  {runEnhancedTest.isPending ? (
                    <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Running...</>
                  ) : (
                    <><Play className="h-4 w-4 mr-2" />Run Scenario Analysis</>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Right: Result Panel */}
            <div className="lg:col-span-3 space-y-4">
              {lastResult ? (
                <>
                  {/* Result Header */}
                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-base">{lastResult.scenarioName}</CardTitle>
                          <CardDescription>{lastResult.scenarioDescription}</CardDescription>
                        </div>
                        <Badge className={getRegimeBadge(lastResult.regime).className}>
                          {getRegimeBadge(lastResult.regime).label}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <p className="text-xs text-muted-foreground">Total Impact</p>
                          <p className={`text-lg font-semibold font-mono ${lastResult.totalImpact < 0 ? "text-red-500" : "text-emerald-500"}`}>
                            {formatPercent(lastResult.totalImpact)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Dollar Impact</p>
                          <p className={`text-lg font-semibold font-mono ${lastResult.impactAmount < 0 ? "text-red-500" : "text-emerald-500"}`}>
                            {formatCurrency(lastResult.impactAmount)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">VaR (95%)</p>
                          <p className="text-lg font-semibold font-mono text-orange-500">
                            {formatPercent(lastResult.parametricVaR95)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">CVaR / ES (95%)</p>
                          <p className="text-lg font-semibold font-mono text-red-400">
                            {formatPercent(lastResult.cvar95)}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Factor Decomposition */}
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Factor Impact Decomposition</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={240}>
                          <BarChart
                            data={Object.entries(lastResult.factorImpacts).map(([k, v]) => ({
                              factor: FACTOR_LABELS[k] || k,
                              impact: v * 100,
                              fill: (v < 0 ? "hsl(var(--destructive))" : "hsl(var(--chart-1))"),
                            }))}
                            layout="vertical"
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                            <XAxis type="number" fontSize={10} tickFormatter={v => `${v.toFixed(1)}%`} stroke="hsl(var(--muted-foreground))" />
                            <YAxis type="category" dataKey="factor" fontSize={10} width={50} stroke="hsl(var(--muted-foreground))" tickLine={false} />
                            <Tooltip
                              contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: 11 }}
                              formatter={(v: number) => [`${v.toFixed(3)}%`, "Impact"]}
                            />
                            <ReferenceLine x={0} stroke="hsl(var(--muted-foreground))" />
                            <Bar dataKey="impact" radius={[0, 3, 3, 0]}>
                              {Object.entries(lastResult.factorImpacts).map(([k, v]) => (
                                <Cell key={k} fill={v < 0 ? "hsl(var(--destructive))" : "hsl(var(--chart-1))"} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Component VaR (Risk Budget)</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={240}>
                          <RadarChart data={Object.entries(lastResult.componentVaR).map(([k, v]) => ({
                            factor: FACTOR_LABELS[k] || k,
                            value: Math.abs(v) * 100,
                          }))}>
                            <PolarGrid stroke="hsl(var(--border))" />
                            <PolarAngleAxis dataKey="factor" fontSize={10} stroke="hsl(var(--muted-foreground))" />
                            <PolarRadiusAxis fontSize={9} stroke="hsl(var(--muted-foreground))" />
                            <Radar dataKey="value" stroke="hsl(var(--chart-1))" fill="hsl(var(--chart-1))" fillOpacity={0.3} />
                          </RadarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Asset-Level Impact Table */}
                  {lastResult.assetImpacts.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Asset-Level Impact Breakdown</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Asset</TableHead>
                              <TableHead>Class</TableHead>
                              <TableHead className="text-right">Weight</TableHead>
                              <TableHead className="text-right">Impact</TableHead>
                              <TableHead className="text-right">Contribution</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {lastResult.assetImpacts.map((a, i) => (
                              <TableRow key={i}>
                                <TableCell className="font-medium text-sm">{a.name}</TableCell>
                                <TableCell><Badge variant="secondary" className="text-xs">{a.assetClass}</Badge></TableCell>
                                <TableCell className="text-right font-mono text-sm">{(a.weight * 100).toFixed(1)}%</TableCell>
                                <TableCell className={`text-right font-mono text-sm ${a.impact < 0 ? "text-red-500" : "text-emerald-500"}`}>
                                  {(a.impact * 100).toFixed(2)}%
                                </TableCell>
                                <TableCell className={`text-right font-mono text-sm ${a.marginalContribution < 0 ? "text-red-500" : "text-emerald-500"}`}>
                                  {(a.marginalContribution * 100).toFixed(3)}%
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  )}

                  {/* Monte Carlo Distribution */}
                  {lastResult.monteCarloStats && (
                    <Card>
                      <CardHeader className="pb-2">
                        <div className="flex items-center gap-2">
                          <Activity className="h-4 w-4" />
                          <CardTitle className="text-sm font-medium">Monte Carlo Distribution ({lastResult.monteCarloStats.numSimulations.toLocaleString()} sims, Student-t)</CardTitle>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4 text-xs">
                          <div className="rounded-md bg-muted/50 p-2">
                            <p className="text-muted-foreground">Mean</p>
                            <p className="font-mono font-medium">{(lastResult.monteCarloStats.meanImpact * 100).toFixed(2)}%</p>
                          </div>
                          <div className="rounded-md bg-muted/50 p-2">
                            <p className="text-muted-foreground">5th Pctile</p>
                            <p className="font-mono font-medium text-red-500">{(lastResult.monteCarloStats.percentile5 * 100).toFixed(2)}%</p>
                          </div>
                          <div className="rounded-md bg-muted/50 p-2">
                            <p className="text-muted-foreground">Tail ES</p>
                            <p className="font-mono font-medium text-red-400">{(lastResult.monteCarloStats.tailExpectedShortfall * 100).toFixed(2)}%</p>
                          </div>
                          <div className="rounded-md bg-muted/50 p-2">
                            <p className="text-muted-foreground">Skewness</p>
                            <p className="font-mono font-medium">{lastResult.monteCarloStats.skewness.toFixed(3)}</p>
                          </div>
                          <div className="rounded-md bg-muted/50 p-2">
                            <p className="text-muted-foreground">P(Loss{">"}20%)</p>
                            <p className="font-mono font-medium text-red-500">{(lastResult.monteCarloStats.probabilityOfLossGt20pct * 100).toFixed(1)}%</p>
                          </div>
                        </div>
                        <ResponsiveContainer width="100%" height={200}>
                          <AreaChart data={buildHistogram(lastResult.monteCarloStats.simulatedReturns)}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="bin" fontSize={9} stroke="hsl(var(--muted-foreground))" tickFormatter={v => `${v}%`} />
                            <YAxis fontSize={9} stroke="hsl(var(--muted-foreground))" />
                            <Tooltip
                              contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: 11 }}
                              formatter={(v: number) => [v, "Count"]}
                              labelFormatter={(v) => `Return: ${v}%`}
                            />
                            <Area type="monotone" dataKey="count" stroke="hsl(var(--chart-1))" fill="hsl(var(--chart-1))" fillOpacity={0.3} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  )}
                </>
              ) : (
                <Card className="lg:col-span-3">
                  <CardContent className="flex flex-col items-center justify-center h-[400px] text-muted-foreground">
                    <FlaskConical className="h-12 w-12 mb-4" />
                    <p className="font-medium">Configure and run a scenario</p>
                    <p className="text-sm mt-1">Select a preset or build a custom 8-factor scenario</p>
                    <p className="text-xs mt-3 max-w-md text-center">
                      Uses factor model with Cholesky-correlated shocks, CVaR/Expected Shortfall,
                      component VaR risk budgeting, and optional fat-tailed Monte Carlo simulation.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ─── Tab 2: Compare All Scenarios ─────────────────────────────────── */}
        <TabsContent value="comparison" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium">Scenario Comparison</h2>
              <p className="text-sm text-muted-foreground">Run all {(config?.historicalScenarios?.length || 0) + (config?.hypotheticalScenarios?.length || 0)} preset scenarios and rank by impact</p>
            </div>
            <Button
              onClick={() => runAllPresets.mutate()}
              disabled={runAllPresets.isPending}
            >
              {runAllPresets.isPending ? (
                <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Running All...</>
              ) : (
                <><Play className="h-4 w-4 mr-2" />Run All Presets</>
              )}
            </Button>
          </div>

          {comparisonResult ? (
            <>
              {/* Summary cards */}
              <div className="grid gap-4 md:grid-cols-4">
                <MetricCard
                  title="Worst Scenario"
                  value={formatPercent(comparisonResult.worstCase.totalImpact)}
                  changeLabel={comparisonResult.worstCase.scenarioName}
                  icon={<TrendingDown className="h-5 w-5" />}
                  valueClassName="text-red-500"
                />
                <MetricCard
                  title="Best Scenario"
                  value={formatPercent(comparisonResult.bestCase.totalImpact)}
                  changeLabel={comparisonResult.bestCase.scenarioName}
                  icon={<Target className="h-5 w-5" />}
                  valueClassName="text-emerald-500"
                />
                <MetricCard
                  title="Average Impact"
                  value={formatPercent(comparisonResult.averageImpact)}
                  icon={<Activity className="h-5 w-5" />}
                  valueClassName="text-yellow-500"
                />
                <MetricCard
                  title="Impact Range"
                  value={formatPercent(comparisonResult.impactRange)}
                  icon={<BarChart3 className="h-5 w-5" />}
                />
              </div>

              {/* Ranking chart */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Scenario Impact Ranking (worst to best)</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={Math.max(300, comparisonResult.ranking.length * 32)}>
                    <BarChart
                      data={comparisonResult.ranking.map(r => ({
                        name: r.name.length > 25 ? r.name.slice(0, 25) + "..." : r.name,
                        impact: r.impact * 100,
                      }))}
                      layout="vertical"
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                      <XAxis type="number" fontSize={10} tickFormatter={v => `${v}%`} stroke="hsl(var(--muted-foreground))" />
                      <YAxis type="category" dataKey="name" fontSize={10} width={180} stroke="hsl(var(--muted-foreground))" tickLine={false} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: 11 }}
                        formatter={(v: number) => [`${v.toFixed(2)}%`, "Impact"]}
                      />
                      <ReferenceLine x={0} stroke="hsl(var(--muted-foreground))" />
                      <Bar dataKey="impact" radius={[0, 3, 3, 0]}>
                        {comparisonResult.ranking.map((r, i) => (
                          <Cell key={i} fill={r.impact < -20 ? "hsl(var(--destructive))" : r.impact < -10 ? "hsl(var(--chart-4))" : r.impact < 0 ? "hsl(var(--chart-3))" : "hsl(var(--chart-1))"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Detail table */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Detailed Results</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8">#</TableHead>
                        <TableHead>Scenario</TableHead>
                        <TableHead>Regime</TableHead>
                        <TableHead className="text-right">Impact</TableHead>
                        <TableHead className="text-right">$ Impact</TableHead>
                        <TableHead className="text-right">VaR 95</TableHead>
                        <TableHead className="text-right">CVaR 95</TableHead>
                        <TableHead>Severity</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {comparisonResult.ranking.map((r, i) => {
                        const sc = comparisonResult.scenarios.find(s => s.scenarioName === r.name);
                        if (!sc) return null;
                        const severity = getSeverityBadge(sc.totalImpact);
                        return (
                          <TableRow key={i}>
                            <TableCell className="font-mono text-xs text-muted-foreground">{r.rank}</TableCell>
                            <TableCell className="font-medium text-sm">{sc.scenarioName}</TableCell>
                            <TableCell>
                              <Badge className={`text-[10px] ${getRegimeBadge(sc.regime).className}`}>
                                {getRegimeBadge(sc.regime).label}
                              </Badge>
                            </TableCell>
                            <TableCell className={`text-right font-mono text-sm ${sc.totalImpact < 0 ? "text-red-500" : "text-emerald-500"}`}>
                              {formatPercent(sc.totalImpact)}
                            </TableCell>
                            <TableCell className={`text-right font-mono text-sm ${sc.impactAmount < 0 ? "text-red-500" : "text-emerald-500"}`}>
                              {formatCurrency(sc.impactAmount)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm text-orange-500">{formatPercent(sc.parametricVaR95)}</TableCell>
                            <TableCell className="text-right font-mono text-sm text-red-400">{formatPercent(sc.cvar95)}</TableCell>
                            <TableCell><Badge variant={severity.variant}>{severity.label}</Badge></TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center h-[300px] text-muted-foreground">
                <BarChart3 className="h-10 w-10 mb-3" />
                <p>Click "Run All Presets" to compare {(config?.historicalScenarios?.length || 8) + (config?.hypotheticalScenarios?.length || 6)} scenarios</p>
                <p className="text-xs mt-1">Includes historical crises and hypothetical stress events</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ─── Tab 3: Reverse Stress Test ───────────────────────────────────── */}
        <TabsContent value="reverse" className="space-y-4">
          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-medium">Reverse Stress Test</CardTitle>
                <CardDescription>
                  Find the market shocks needed to produce a target portfolio loss.
                  Uses bisection search along a crisis-direction vector.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <Label>Target Loss</Label>
                    <span className="text-sm font-mono text-red-500">{(reverseTarget * 100).toFixed(0)}%</span>
                  </div>
                  <Slider
                    value={[reverseTarget * 100]}
                    onValueChange={([v]) => setReverseTarget(v / 100)}
                    min={-80}
                    max={-5}
                    step={5}
                    className="w-full"
                  />
                </div>
                <Button
                  onClick={() => runReverseTest.mutate(reverseTarget)}
                  className="w-full"
                  disabled={runReverseTest.isPending}
                >
                  {runReverseTest.isPending ? (
                    <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Searching...</>
                  ) : (
                    <><ArrowDownUp className="h-4 w-4 mr-2" />Find Required Shocks</>
                  )}
                </Button>
              </CardContent>
            </Card>

            <div className="lg:col-span-2">
              {reverseResult ? (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-medium">Required Shock Profile</CardTitle>
                    <CardDescription>{reverseResult.scenarioDescription}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <div className="rounded-md bg-muted/50 p-3">
                        <p className="text-xs text-muted-foreground">Target Loss</p>
                        <p className="font-mono font-semibold text-red-500">{(reverseResult.targetLoss * 100).toFixed(1)}%</p>
                      </div>
                      <div className="rounded-md bg-muted/50 p-3">
                        <p className="text-xs text-muted-foreground">Achieved Loss</p>
                        <p className="font-mono font-semibold text-red-500">{(reverseResult.achievedLoss * 100).toFixed(2)}%</p>
                      </div>
                      <div className="rounded-md bg-muted/50 p-3">
                        <p className="text-xs text-muted-foreground">Dominant Factor</p>
                        <p className="font-mono font-semibold">{FACTOR_LABELS[reverseResult.dominantFactor] || reverseResult.dominantFactor}</p>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs text-muted-foreground mb-2">Required Factor Shocks</p>
                      <div className="grid grid-cols-4 gap-2">
                        {Object.entries(reverseResult.requiredShocks).map(([k, v]) => (
                          <div key={k} className="rounded-md bg-muted/30 p-2 text-center">
                            <p className="text-[10px] text-muted-foreground">{FACTOR_LABELS[k] || k}</p>
                            <p className={`text-xs font-mono font-medium ${(v as number) < 0 ? "text-red-500" : (v as number) > 0 ? "text-amber-500" : ""}`}>
                              {((v as number) * 100).toFixed(1)}%
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {reverseResult.assetImpacts.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-2">Asset Impacts Under Reverse Scenario</p>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Asset</TableHead>
                              <TableHead className="text-right">Weight</TableHead>
                              <TableHead className="text-right">Impact</TableHead>
                              <TableHead className="text-right">Contribution</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {reverseResult.assetImpacts.map((a, i) => (
                              <TableRow key={i}>
                                <TableCell className="text-sm">{a.name}</TableCell>
                                <TableCell className="text-right font-mono text-sm">{(a.weight * 100).toFixed(1)}%</TableCell>
                                <TableCell className={`text-right font-mono text-sm ${a.impact < 0 ? "text-red-500" : "text-emerald-500"}`}>
                                  {(a.impact * 100).toFixed(2)}%
                                </TableCell>
                                <TableCell className={`text-right font-mono text-sm ${a.marginalContribution < 0 ? "text-red-500" : "text-emerald-500"}`}>
                                  {(a.marginalContribution * 100).toFixed(3)}%
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center h-[300px] text-muted-foreground">
                    <ArrowDownUp className="h-10 w-10 mb-3" />
                    <p>Set a target loss and find the required market shocks</p>
                    <p className="text-xs mt-1">Answers "what would it take to lose X%?"</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ─── Tab 4: History ───────────────────────────────────────────────── */}
        <TabsContent value="history" className="space-y-4">
          <Card data-testid="card-stress-history">
            <CardHeader>
              <CardTitle className="text-base font-medium">Stress Test History</CardTitle>
              <CardDescription>All completed scenario analyses (legacy + enhanced)</CardDescription>
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
                      <TableHead>Regime</TableHead>
                      <TableHead className="text-right">Equity</TableHead>
                      <TableHead className="text-right">Rates</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                      <TableHead className="text-right">FX</TableHead>
                      <TableHead className="text-right">Impact</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">VaR 95</TableHead>
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
                            <Badge variant="secondary" className="font-normal text-xs">
                              {test.scenarioCategory || test.scenarioType}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {test.regime ? (
                              <Badge className={`text-[10px] ${getRegimeBadge(test.regime).className}`}>
                                {getRegimeBadge(test.regime).label}
                              </Badge>
                            ) : "\u2014"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {test.equityShock ? `${(parseFloat(test.equityShock) * 100).toFixed(0)}%` : "\u2014"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {test.rateShock ? `${(parseFloat(test.rateShock) * 100).toFixed(1)}%` : "\u2014"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {test.creditSpreadShock ? `${(parseFloat(test.creditSpreadShock) * 100).toFixed(1)}%` : "\u2014"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {test.fxShock ? `${(parseFloat(test.fxShock) * 100).toFixed(0)}%` : "\u2014"}
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={`font-mono text-sm ${impact < 0 ? "text-red-500" : "text-emerald-500"}`}>
                              {formatPercent(impact)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={`font-mono text-sm ${impact < 0 ? "text-red-500" : "text-emerald-500"}`}>
                              {test.impactAmount ? formatCurrency(test.impactAmount) : "\u2014"}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm text-orange-500">
                            {test.parametricVaR95 ? formatPercent(parseFloat(test.parametricVaR95)) : "\u2014"}
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
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Histogram builder for MC distribution chart ────────────────────────────

function buildHistogram(returns: number[], numBins: number = 40): Array<{ bin: string; count: number }> {
  if (returns.length === 0) return [];
  const min = returns[0];
  const max = returns[returns.length - 1];
  const range = max - min || 0.01;
  const binWidth = range / numBins;

  const bins: Array<{ bin: string; count: number }> = [];
  for (let i = 0; i < numBins; i++) {
    const lo = min + i * binWidth;
    bins.push({
      bin: (lo * 100).toFixed(1),
      count: 0,
    });
  }

  for (const r of returns) {
    let idx = Math.floor((r - min) / binWidth);
    if (idx >= numBins) idx = numBins - 1;
    if (idx < 0) idx = 0;
    bins[idx].count++;
  }

  return bins;
}
