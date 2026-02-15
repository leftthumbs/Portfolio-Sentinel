import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePortfolio } from "@/hooks/use-portfolio";
import { AlertTriangle, Play, TrendingDown, Zap, RefreshCw, Info, ChevronDown, ChevronUp, BookOpen, Activity, Layers, RotateCcw, BarChart3, History, Target } from "lucide-react";
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
import { Progress } from "@/components/ui/progress";
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
  LineChart,
  Line,
  PieChart,
  Pie,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
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

interface ScenarioAssumptions {
  description: string;
  historicalContext: string;
  keyAssumptions: string[];
  affectedAssets: { assetClass: string; expectedImpact: string; rationale: string }[];
  duration: string;
  recoveryOutlook: string;
}

interface FactorDefinition {
  id: string;
  name: string;
  description: string;
  annualVol: number;
  expectedReturn: number;
}

interface ScenarioPreset {
  name: string;
  description: string;
  category: "historical" | "hypothetical";
  regime?: "expansion" | "contraction" | "crisis";
  shocks: Record<string, number>;
}

interface AssetImpact {
  name: string;
  assetClass: string;
  weight: number;
  impact: number;
  factorContributions: Record<string, number>;
  idiosyncraticImpact: number;
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
  shocksApplied: Record<string, number>;
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
  requiredShocks: Record<string, number>;
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
  factors: FactorDefinition[];
  historicalScenarios: ScenarioPreset[];
  hypotheticalScenarios: ScenarioPreset[];
}

const SCENARIO_ASSUMPTIONS: Record<string, ScenarioAssumptions> = {
  "2008 Financial Crisis": {
    description: "Simulates a systemic financial crisis similar to the 2008 Global Financial Crisis, triggered by a collapse in the housing market and cascading failures across the banking sector.",
    historicalContext: "From peak to trough (Oct 2007 - Mar 2009), the S&P 500 fell ~57%. Credit markets froze, Lehman Brothers collapsed, and central banks slashed rates to near zero.",
    keyAssumptions: [
      "Equity markets experience a severe 55% drawdown across all major indices",
      "Interest rates drop 200bps as central banks implement emergency cuts",
      "Credit spreads widen by 400bps reflecting elevated default risk and credit market stress",
      "USD weakens 15% against major currencies due to aggressive monetary easing",
      "Correlations between asset classes increase sharply, reducing diversification benefits",
      "Liquidity dries up in credit and structured product markets",
    ],
    affectedAssets: [
      { assetClass: "Public Equities", expectedImpact: "Severe Loss (-50% to -60%)", rationale: "Broad-based selling across sectors; financials and real estate hit hardest" },
      { assetClass: "Fixed Income (Investment Grade)", expectedImpact: "Moderate Gain (+5% to +10%)", rationale: "Flight to quality drives Treasury prices up despite credit spread widening" },
      { assetClass: "High Yield / Credit", expectedImpact: "Severe Loss (-25% to -35%)", rationale: "Credit spreads blow out as default fears spike" },
      { assetClass: "Private Equity", expectedImpact: "Significant Loss (-30% to -40%)", rationale: "Valuation markdowns lag public markets; exit markets freeze" },
      { assetClass: "Hedge Funds", expectedImpact: "Moderate Loss (-15% to -25%)", rationale: "Varies by strategy; long/short equity and credit strategies face large drawdowns" },
      { assetClass: "Real Assets / REITs", expectedImpact: "Severe Loss (-40% to -60%)", rationale: "Real estate valuations collapse; commercial RE particularly exposed" },
    ],
    duration: "18-24 months of market stress with gradual recovery over 3-5 years",
    recoveryOutlook: "Assumes aggressive policy response (rate cuts, QE, fiscal stimulus) eventually stabilizes markets, but recovery is prolonged.",
  },
  "2020 COVID Crash": {
    description: "Models a rapid, exogenous shock similar to the COVID-19 pandemic, characterized by an abrupt economic shutdown followed by unprecedented fiscal and monetary response.",
    historicalContext: "The S&P 500 fell ~34% in just 23 trading days (Feb-Mar 2020), the fastest bear market in history. Markets recovered to new highs within 5 months driven by massive stimulus.",
    keyAssumptions: [
      "Equity markets drop 35% in a rapid, concentrated sell-off over 4-6 weeks",
      "Interest rates fall 150bps as central banks cut to zero lower bound",
      "Credit spreads widen 250bps reflecting short-term liquidity stress",
      "USD weakens 8% as markets price in monetary easing",
      "Volatility (VIX) spikes above 80, reflecting extreme uncertainty",
      "Recovery assumes significant government intervention and stimulus programs",
    ],
    affectedAssets: [
      { assetClass: "Public Equities", expectedImpact: "Significant Loss (-30% to -40%)", rationale: "Broad sell-off; travel, energy, and hospitality sectors hit hardest" },
      { assetClass: "Fixed Income (Treasuries)", expectedImpact: "Moderate Gain (+3% to +8%)", rationale: "Safe-haven demand drives yields lower" },
      { assetClass: "High Yield / Credit", expectedImpact: "Moderate Loss (-10% to -20%)", rationale: "Spread widening partially offset by rate decline" },
      { assetClass: "Private Equity", expectedImpact: "Moderate Loss (-15% to -25%)", rationale: "Portfolio company revenues disrupted; valuations eventually supported by low rates" },
      { assetClass: "Hedge Funds", expectedImpact: "Mixed (-5% to -15%)", rationale: "Dispersion across strategies; some benefit from volatility" },
      { assetClass: "Real Assets / REITs", expectedImpact: "Moderate Loss (-20% to -30%)", rationale: "Office and retail REIT hit hard; industrial and residential more resilient" },
    ],
    duration: "1-3 months of acute stress with V-shaped recovery over 6-12 months",
    recoveryOutlook: "Historically, pandemic-driven downturns recovered rapidly due to massive fiscal and monetary stimulus, but assumes no prolonged shutdowns.",
  },
  "2022 Rate Shock": {
    description: "Simulates a period of aggressive monetary tightening, where central banks raise rates sharply to combat persistent inflation, similar to the 2022 Fed hiking cycle.",
    historicalContext: "In 2022, the Fed raised rates by 425bps (fastest since the 1980s). The S&P 500 fell ~25%, the Bloomberg Aggregate Bond Index fell ~13% (worst year ever for bonds), and 60/40 portfolios experienced one of their worst years on record.",
    keyAssumptions: [
      "Equity markets decline 25% as higher rates compress valuations and slow growth",
      "Interest rates rise 300bps across the yield curve",
      "Credit spreads widen 200bps as tighter financial conditions increase default risk",
      "USD strengthens 5% as rate differentials attract capital flows",
      "Growth stocks and long-duration assets are disproportionately impacted",
      "Traditional bond/equity diversification fails (both decline simultaneously)",
    ],
    affectedAssets: [
      { assetClass: "Public Equities", expectedImpact: "Significant Loss (-20% to -30%)", rationale: "Multiple compression as discount rates rise; growth stocks hit hardest" },
      { assetClass: "Fixed Income (Long Duration)", expectedImpact: "Significant Loss (-15% to -25%)", rationale: "Rising rates cause steep mark-to-market losses on duration" },
      { assetClass: "High Yield / Credit", expectedImpact: "Moderate Loss (-10% to -15%)", rationale: "Spread widening and rate impact; shorter duration partially mitigates" },
      { assetClass: "Private Equity", expectedImpact: "Moderate Loss (-10% to -20%)", rationale: "Higher cost of capital reduces deal activity and exit multiples" },
      { assetClass: "Hedge Funds", expectedImpact: "Mixed (-5% to +5%)", rationale: "Macro and systematic strategies may benefit; equity long/short faces headwinds" },
      { assetClass: "Real Assets / Commodities", expectedImpact: "Mixed (+5% to -10%)", rationale: "Inflation hedge benefit vs. economic slowdown impact" },
    ],
    duration: "12-18 months of tightening with gradual adjustment as rates stabilize",
    recoveryOutlook: "Markets eventually adjust to the new rate regime. Recovery begins once markets believe the hiking cycle has peaked.",
  },
  "Mild Recession": {
    description: "Models a typical economic contraction with moderate declines across risk assets, representing a garden-variety business cycle downturn without systemic financial stress.",
    historicalContext: "Historically, mild recessions (e.g., 1990-91, 2001) have produced equity declines of 15-25% with relatively contained credit market stress and recovery within 1-2 years.",
    keyAssumptions: [
      "Equity markets decline 20% over 6-9 months as earnings contract",
      "Interest rates fall 100bps as central banks ease policy to support growth",
      "Credit spreads widen 150bps reflecting higher but manageable default rates",
      "USD weakens 5% as rate differentials narrow",
      "Unemployment rises 2-3 percentage points from cyclical lows",
      "No systemic risk to the financial system; banking sector remains solvent",
    ],
    affectedAssets: [
      { assetClass: "Public Equities", expectedImpact: "Moderate Loss (-15% to -25%)", rationale: "Cyclical sectors lead declines; defensive sectors outperform" },
      { assetClass: "Fixed Income (Treasuries)", expectedImpact: "Moderate Gain (+3% to +7%)", rationale: "Rate cuts and flight to quality support bond prices" },
      { assetClass: "High Yield / Credit", expectedImpact: "Moderate Loss (-5% to -12%)", rationale: "Spread widening partially offset by declining base rates" },
      { assetClass: "Private Equity", expectedImpact: "Mild Loss (-5% to -15%)", rationale: "Valuation markdowns; fund managers may deploy dry powder at better entry points" },
      { assetClass: "Hedge Funds", expectedImpact: "Mild Loss (-3% to -10%)", rationale: "Well-hedged strategies may outperform; dispersion creates opportunities" },
      { assetClass: "Real Assets / REITs", expectedImpact: "Moderate Loss (-10% to -20%)", rationale: "Cap rate expansion and weaker demand reduce valuations" },
    ],
    duration: "6-12 months of economic contraction with recovery beginning within 12-18 months",
    recoveryOutlook: "Typical cyclical recovery supported by monetary easing. Portfolio losses are temporary for long-term investors.",
  },
  "Stagflation": {
    description: "Models a challenging economic environment combining stagnant growth with persistent inflation, where central banks are forced to raise rates despite weak economic activity.",
    historicalContext: "The 1970s stagflation saw prolonged periods of high inflation (>10%) with unemployment above 8%. Real returns on stocks and bonds were deeply negative for extended periods. This is widely considered the worst environment for traditional 60/40 portfolios.",
    keyAssumptions: [
      "Equity markets decline 15% as margins compress from rising input costs",
      "Interest rates rise 400bps as central banks prioritize inflation control over growth",
      "Credit spreads widen 300bps as economic weakness raises default concerns",
      "USD weakens 10% due to eroding purchasing power and loss of confidence",
      "Inflation runs persistently above 6%, eroding real returns across asset classes",
      "Traditional diversification between stocks and bonds provides minimal benefit",
    ],
    affectedAssets: [
      { assetClass: "Public Equities", expectedImpact: "Moderate Loss (-10% to -20%)", rationale: "Earnings under pressure from rising costs; nominal returns mask deeper real losses" },
      { assetClass: "Fixed Income (Nominal)", expectedImpact: "Significant Loss (-15% to -25%)", rationale: "Rising rates and inflation erode both price and real value of coupon payments" },
      { assetClass: "TIPS / Inflation-Linked", expectedImpact: "Moderate Gain (+3% to +8%)", rationale: "Inflation linkage provides protection; real yields may still compress" },
      { assetClass: "Commodities / Real Assets", expectedImpact: "Significant Gain (+10% to +25%)", rationale: "Hard assets historically outperform during inflationary periods" },
      { assetClass: "Private Equity", expectedImpact: "Moderate Loss (-10% to -20%)", rationale: "Exit multiples compress; pricing power varies by company" },
      { assetClass: "Hedge Funds (Macro)", expectedImpact: "Moderate Gain (+5% to +15%)", rationale: "Macro strategies historically thrive in dislocated environments" },
    ],
    duration: "18-36 months of persistent inflation with slow economic growth",
    recoveryOutlook: "Resolution depends on central bank credibility in controlling inflation. May require demand destruction before inflation moderates.",
  },
};

function getCustomScenarioAssumptions(scenario: { equityShock: number; rateShock: number; creditSpreadShock: number; fxShock: number }): ScenarioAssumptions {
  const severity = Math.abs(scenario.equityShock) > 0.3 ? "severe" : Math.abs(scenario.equityShock) > 0.15 ? "moderate" : "mild";
  const rateDirection = scenario.rateShock > 0 ? "rising" : scenario.rateShock < 0 ? "falling" : "unchanged";
  const fxDirection = scenario.fxShock > 0 ? "strengthening" : scenario.fxShock < 0 ? "weakening" : "unchanged";

  return {
    description: `Custom stress scenario applying a ${severity} equity shock of ${(scenario.equityShock * 100).toFixed(0)}%, ${rateDirection} interest rates by ${Math.abs(scenario.rateShock * 100).toFixed(1)}%, credit spread widening of ${(scenario.creditSpreadShock * 100).toFixed(1)}%, and ${fxDirection} USD by ${Math.abs(scenario.fxShock * 100).toFixed(0)}%.`,
    historicalContext: "User-defined scenario based on custom parameter inputs.",
    keyAssumptions: [
      `Equity markets ${scenario.equityShock < 0 ? "decline" : "gain"} ${Math.abs(scenario.equityShock * 100).toFixed(0)}% across broad indices`,
      `Interest rates ${rateDirection === "rising" ? "increase" : rateDirection === "falling" ? "decrease" : "remain flat"} by ${Math.abs(scenario.rateShock * 100).toFixed(1)} percentage points`,
      `Credit spreads widen by ${(scenario.creditSpreadShock * 100).toFixed(1)} percentage points, reflecting ${scenario.creditSpreadShock > 0.02 ? "elevated" : "moderate"} default risk`,
      `USD ${fxDirection === "strengthening" ? "strengthens" : fxDirection === "weakening" ? "weakens" : "holds flat"} by ${Math.abs(scenario.fxShock * 100).toFixed(0)}% against major currencies`,
      "Shocks are applied simultaneously and instantaneously to the portfolio",
      "Impact is calculated using current portfolio weights and asset class sensitivities",
    ],
    affectedAssets: [
      { assetClass: "Equities", expectedImpact: `${(scenario.equityShock * 100).toFixed(0)}% direct impact`, rationale: "Full equity shock applied to equity allocation" },
      { assetClass: "Fixed Income", expectedImpact: `Rate sensitivity: ${(scenario.rateShock * 100).toFixed(1)}%`, rationale: "Duration-weighted impact from interest rate change" },
      { assetClass: "Credit", expectedImpact: `Spread impact: -${(scenario.creditSpreadShock * 100).toFixed(1)}%`, rationale: "Credit spread widening reduces value of credit-sensitive holdings" },
      { assetClass: "International / FX-exposed", expectedImpact: `Currency impact: ${(scenario.fxShock * 100).toFixed(0)}%`, rationale: "FX shock applied to non-USD denominated holdings" },
    ],
    duration: "Instantaneous shock applied to current portfolio values",
    recoveryOutlook: "No recovery assumptions included. Results reflect immediate mark-to-market impact only.",
  };
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

const FACTOR_LABELS: Record<string, string> = {
  equity: "Equity",
  rates: "Rates",
  credit: "Credit",
  fx: "FX",
  commodity: "Commodity",
  volatility: "Volatility",
  inflation: "Inflation",
  liquidity: "Liquidity",
};

const FACTOR_COLORS: Record<string, string> = {
  equity: "hsl(var(--chart-1))",
  rates: "hsl(var(--chart-2))",
  credit: "hsl(var(--chart-3))",
  fx: "hsl(var(--chart-4))",
  commodity: "hsl(var(--chart-5))",
  volatility: "hsl(210 70% 50%)",
  inflation: "hsl(35 90% 50%)",
  liquidity: "hsl(280 60% 50%)",
};

const PIE_COLORS = [
  "hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))",
  "hsl(var(--chart-4))", "hsl(var(--chart-5))", "hsl(210 70% 50%)",
  "hsl(35 90% 50%)", "hsl(280 60% 50%)",
];

function getRegimeBadge(regime?: string) {
  if (!regime) return null;
  const variants: Record<string, "default" | "secondary" | "destructive"> = {
    expansion: "default",
    contraction: "secondary",
    crisis: "destructive",
  };
  return <Badge variant={variants[regime] || "secondary"}>{regime}</Badge>;
}

export default function StressTestsPage() {
  const { toast } = useToast();
  const { selectedPortfolioId, selectedPortfolioType, selectedPortfolio } = usePortfolio();
  const [activeTab, setActiveTab] = useState("scenario-builder");
  const [selectedScenario, setSelectedScenario] = useState<string>("");
  const [assumptionsExpanded, setAssumptionsExpanded] = useState(true);
  const [methodologyExpanded, setMethodologyExpanded] = useState(false);
  const [mcMethodologyExpanded, setMcMethodologyExpanded] = useState(false);
  const [localStressTests, setLocalStressTests] = useState<StressTest[]>([]);
  const [customScenario, setCustomScenario] = useState({
    name: "",
    equityShock: -0.20,
    rateShock: 0.01,
    creditSpreadShock: 0.02,
    fxShock: -0.05,
  });

  const [mfShocks, setMfShocks] = useState<Record<string, number>>({
    equity: -0.20, rates: 0.01, credit: 0.02, fx: -0.05,
    commodity: 0.0, volatility: 0.0, inflation: 0.0, liquidity: 0.0,
  });
  const [mfScenarioName, setMfScenarioName] = useState("");
  const [mfCategory, setMfCategory] = useState<"historical" | "hypothetical">("hypothetical");
  const [mfRegime, setMfRegime] = useState<"expansion" | "contraction" | "crisis">("contraction");
  const [mfMonteCarlo, setMfMonteCarlo] = useState(false);
  const [mfNumSims, setMfNumSims] = useState(1000);
  const [mfResult, setMfResult] = useState<ScenarioResult | null>(null);

  const [reverseTargetLoss, setReverseTargetLoss] = useState(-0.20);
  const [reverseResult, setReverseResult] = useState<ReverseStressResult | null>(null);

  const [comparisonResult, setComparisonResult] = useState<ScenarioComparisonResult | null>(null);

  useEffect(() => {
    setLocalStressTests([]);
    setMfResult(null);
    setReverseResult(null);
    setComparisonResult(null);
  }, [selectedPortfolioId]);

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

  const { data: engineConfig } = useQuery<EngineConfig>({
    queryKey: ["/api/scenario-engine/config"],
  });

  const runStressTest = useMutation({
    mutationFn: async (scenario: typeof customScenario) => {
      const response = await apiRequest("POST", "/api/stress-tests", {
        ...scenario,
        portfolioId: selectedPortfolioId,
        portfolioType: selectedPortfolioType,
      });
      return response.json();
    },
    onSuccess: (result: any) => {
      if (selectedPortfolioType === "custom") {
        setLocalStressTests(prev => [...prev, result]);
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/stress-tests"] });
      }
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

  const runEnhancedTest = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/scenario-engine/stress-test", {
        scenario: {
          name: mfScenarioName || "Custom Multi-Factor Scenario",
          description: "",
          category: mfCategory,
          regime: mfRegime,
          shocks: mfShocks,
        },
        portfolioId: selectedPortfolioId,
        portfolioType: selectedPortfolioType,
        monteCarlo: mfMonteCarlo,
        numSimulations: mfNumSims,
        fatTails: true,
        degreesOfFreedom: 5,
      });
      return response.json();
    },
    onSuccess: (data: { stressTest: any; result: ScenarioResult }) => {
      setMfResult(data.result);
      queryClient.invalidateQueries({ queryKey: ["/api/stress-tests"] });
      toast({
        title: "Multi-factor stress test completed",
        description: `Impact: ${(data.result.totalImpact * 100).toFixed(2)}% (${formatCurrency(data.result.impactAmount)})`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to run multi-factor stress test.",
        variant: "destructive",
      });
    },
  });

  const runReverseTest = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/scenario-engine/reverse-stress-test", {
        targetLoss: reverseTargetLoss,
        portfolioId: selectedPortfolioId,
        portfolioType: selectedPortfolioType,
      });
      return response.json();
    },
    onSuccess: (data: ReverseStressResult) => {
      setReverseResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/stress-tests"] });
      toast({
        title: "Reverse stress test completed",
        description: `Found shocks that produce ${(data.achievedLoss * 100).toFixed(1)}% loss.`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to run reverse stress test.",
        variant: "destructive",
      });
    },
  });

  const runAllPresets = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/scenario-engine/run-all-presets", {
        portfolioId: selectedPortfolioId,
        portfolioType: selectedPortfolioType,
      });
      return response.json();
    },
    onSuccess: (data: ScenarioComparisonResult) => {
      setComparisonResult(data);
      toast({
        title: "All presets compared",
        description: `Analyzed ${data.scenarios.length} scenarios. Worst: ${data.worstCase.scenarioName} (${(data.worstCase.totalImpact * 100).toFixed(1)}%)`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to run preset comparison.",
        variant: "destructive",
      });
    },
  });

  interface MonteCarloResult {
    scenarioName: string;
    numPaths: number;
    horizon: number;
    paths: { pathId: number; cumulativeReturns: number[]; finalReturn: number; maxDrawdown: number }[];
    percentiles: { p5: number; p25: number; p50: number; p75: number; p95: number };
    expectedReturn: number;
    expectedVol: number;
    expectedMaxDrawdown: number;
    probabilityOfLoss: number;
    expectedShortfall: number;
  }
  const [monteCarloResults, setMonteCarloResults] = useState<MonteCarloResult[]>([]);
  const [selectedMCScenario, setSelectedMCScenario] = useState<number>(0);

  const runMonteCarlo = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/stress-tests/monte-carlo", {
        portfolioId: selectedPortfolioId,
        portfolioType: selectedPortfolioType,
      });
      return response.json();
    },
    onSuccess: (data: { results: MonteCarloResult[] }) => {
      setMonteCarloResults(data.results || []);
      toast({
        title: "Monte Carlo simulation complete",
        description: `Generated ${data.results?.length || 0} stress scenarios with 200 paths each.`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to run Monte Carlo simulation.",
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

  const handleMfPresetSelect = (preset: ScenarioPreset) => {
    setMfScenarioName(preset.name);
    setMfCategory(preset.category);
    setMfRegime(preset.regime || "contraction");
    setMfShocks({ ...preset.shocks });
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

  const { portfolio, stressTests: fetchedStressTests } = data;
  const stressTests = data.isCustomPortfolio
    ? [...fetchedStressTests, ...localStressTests]
    : fetchedStressTests;
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

  const allPresets = [
    ...(engineConfig?.historicalScenarios || []),
    ...(engineConfig?.hypotheticalScenarios || []),
  ];

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
            {selectedPortfolio?.name || portfolio.name} &bull; Multi-factor scenario analysis, stress testing &amp; reverse stress testing
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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid grid-cols-5 w-full" data-testid="tabs-stress-testing">
          <TabsTrigger value="scenario-builder" data-testid="tab-scenario-builder">
            <Play className="h-4 w-4 mr-1.5 hidden sm:inline-block" />
            Scenario
          </TabsTrigger>
          <TabsTrigger value="multi-factor" data-testid="tab-multi-factor">
            <Layers className="h-4 w-4 mr-1.5 hidden sm:inline-block" />
            Multi-Factor
          </TabsTrigger>
          <TabsTrigger value="compare-all" data-testid="tab-compare-all">
            <BarChart3 className="h-4 w-4 mr-1.5 hidden sm:inline-block" />
            Compare All
          </TabsTrigger>
          <TabsTrigger value="reverse-test" data-testid="tab-reverse-test">
            <RotateCcw className="h-4 w-4 mr-1.5 hidden sm:inline-block" />
            Reverse
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">
            <History className="h-4 w-4 mr-1.5 hidden sm:inline-block" />
            History
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: Original Scenario Builder */}
        <TabsContent value="scenario-builder" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-2" data-testid="card-scenario-builder">
              <CardHeader>
                <CardTitle className="text-base font-medium">Scenario Builder</CardTitle>
                <CardDescription>Configure and run 4-factor stress test scenarios</CardDescription>
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
                  {[
                    { key: "equityShock", label: "Equity Shock", min: -80, max: 20, step: 5, fmt: (v: number) => `${(v * 100).toFixed(0)}%` },
                    { key: "rateShock", label: "Interest Rate Shock", min: -3, max: 5, step: 0.25, fmt: (v: number) => `${(v * 100).toFixed(1)}%` },
                    { key: "creditSpreadShock", label: "Credit Spread Shock", min: 0, max: 5, step: 0.25, fmt: (v: number) => `${(v * 100).toFixed(1)}%` },
                    { key: "fxShock", label: "FX Shock", min: -30, max: 30, step: 5, fmt: (v: number) => `${(v * 100).toFixed(0)}%` },
                  ].map(({ key, label, min, max, step, fmt }) => (
                    <div className="space-y-3" key={key}>
                      <div className="flex justify-between">
                        <Label>{label}</Label>
                        <span className="text-sm font-mono text-muted-foreground">
                          {fmt((customScenario as any)[key])}
                        </span>
                      </div>
                      <Slider
                        value={[(customScenario as any)[key] * 100]}
                        onValueChange={([value]) => setCustomScenario(prev => ({ ...prev, [key]: value / 100 }))}
                        min={min}
                        max={max}
                        step={step}
                        className="w-full"
                        data-testid={`slider-${key}`}
                      />
                    </div>
                  ))}
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

          {(() => {
            const assumptions = selectedScenario && SCENARIO_ASSUMPTIONS[selectedScenario]
              ? SCENARIO_ASSUMPTIONS[selectedScenario]
              : customScenario.name && !SCENARIO_ASSUMPTIONS[customScenario.name]
                ? getCustomScenarioAssumptions(customScenario)
                : null;
            const scenarioLabel = selectedScenario || customScenario.name || "";

            if (!assumptions || !scenarioLabel) return null;

            return (
              <Card data-testid="card-scenario-assumptions">
                <CardHeader className="cursor-pointer" onClick={() => setAssumptionsExpanded(!assumptionsExpanded)}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Info className="h-4 w-4 text-cyan-500 shrink-0" />
                      <CardTitle className="text-base font-medium">Scenario Assumptions: {scenarioLabel}</CardTitle>
                    </div>
                    <Button variant="ghost" size="icon" className="shrink-0" onClick={(e) => { e.stopPropagation(); setAssumptionsExpanded(!assumptionsExpanded); }} data-testid="button-toggle-assumptions">
                      {assumptionsExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                  </div>
                  <CardDescription>{assumptions.description}</CardDescription>
                </CardHeader>
                {assumptionsExpanded && (
                  <CardContent className="space-y-6">
                    {assumptions.historicalContext && assumptions.historicalContext !== "User-defined scenario based on custom parameter inputs." && (
                      <div className="space-y-1.5">
                        <h4 className="text-sm font-medium text-muted-foreground">Historical Context</h4>
                        <p className="text-sm">{assumptions.historicalContext}</p>
                      </div>
                    )}

                    <div className="space-y-2">
                      <h4 className="text-sm font-medium text-muted-foreground">Key Assumptions</h4>
                      <ul className="space-y-1.5">
                        {assumptions.keyAssumptions.map((a, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-cyan-500 shrink-0" />
                            <span>{a}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="space-y-2">
                      <h4 className="text-sm font-medium text-muted-foreground">Expected Impact by Asset Class</h4>
                      <div className="border rounded-md overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-[180px]">Asset Class</TableHead>
                              <TableHead className="w-[200px]">Expected Impact</TableHead>
                              <TableHead>Rationale</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {assumptions.affectedAssets.map((asset, i) => (
                              <TableRow key={i} data-testid={`row-assumption-asset-${i}`}>
                                <TableCell className="font-medium text-sm">{asset.assetClass}</TableCell>
                                <TableCell>
                                  <Badge variant={asset.expectedImpact.toLowerCase().includes("loss") || asset.expectedImpact.includes("-") ? "destructive" : asset.expectedImpact.toLowerCase().includes("gain") || asset.expectedImpact.includes("+") ? "default" : "secondary"}>
                                    {asset.expectedImpact}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">{asset.rationale}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <h4 className="text-sm font-medium text-muted-foreground">Expected Duration</h4>
                        <p className="text-sm">{assumptions.duration}</p>
                      </div>
                      <div className="space-y-1.5">
                        <h4 className="text-sm font-medium text-muted-foreground">Recovery Outlook</h4>
                        <p className="text-sm">{assumptions.recoveryOutlook}</p>
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })()}

          <CalculationMethodologyCard expanded={methodologyExpanded} onToggle={() => setMethodologyExpanded(!methodologyExpanded)} />

          <MonteCarloSection
            monteCarloResults={monteCarloResults}
            selectedMCScenario={selectedMCScenario}
            setSelectedMCScenario={setSelectedMCScenario}
            runMonteCarlo={runMonteCarlo}
          />

          <MonteCarloMethodologyCard expanded={mcMethodologyExpanded} onToggle={() => setMcMethodologyExpanded(!mcMethodologyExpanded)} />
        </TabsContent>

        {/* TAB 2: Multi-Factor Scenario Builder (8-factor with Cholesky) */}
        <TabsContent value="multi-factor" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-2" data-testid="card-mf-builder">
              <CardHeader>
                <CardTitle className="text-base font-medium">Multi-Factor Scenario Builder</CardTitle>
                <CardDescription>8-factor model with Cholesky-decomposed correlated shocks and fat-tailed Monte Carlo</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label>Load Preset</Label>
                  <Select onValueChange={(v) => {
                    const preset = allPresets.find(p => p.name === v);
                    if (preset) handleMfPresetSelect(preset);
                  }}>
                    <SelectTrigger data-testid="select-mf-preset">
                      <SelectValue placeholder="Select a preset scenario" />
                    </SelectTrigger>
                    <SelectContent>
                      {(engineConfig?.historicalScenarios || []).length > 0 && (
                        <>
                          <SelectItem value="__header_hist" disabled>Historical Scenarios</SelectItem>
                          {(engineConfig?.historicalScenarios || []).map(s => (
                            <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>
                          ))}
                        </>
                      )}
                      {(engineConfig?.hypotheticalScenarios || []).length > 0 && (
                        <>
                          <SelectItem value="__header_hypo" disabled>Hypothetical Scenarios</SelectItem>
                          {(engineConfig?.hypotheticalScenarios || []).map(s => (
                            <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>
                          ))}
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Scenario Name</Label>
                  <Input
                    value={mfScenarioName}
                    onChange={(e) => setMfScenarioName(e.target.value)}
                    placeholder="Custom Multi-Factor Scenario"
                    data-testid="input-mf-name"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Regime</Label>
                    <Select value={mfRegime} onValueChange={(v: any) => setMfRegime(v)}>
                      <SelectTrigger data-testid="select-mf-regime">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="expansion">Expansion</SelectItem>
                        <SelectItem value="contraction">Contraction</SelectItem>
                        <SelectItem value="crisis">Crisis</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select value={mfCategory} onValueChange={(v: any) => setMfCategory(v)}>
                      <SelectTrigger data-testid="select-mf-category">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="historical">Historical</SelectItem>
                        <SelectItem value="hypothetical">Hypothetical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-3">
                  <Label className="text-sm font-medium">Factor Shocks (8 Factors)</Label>
                  {Object.entries(FACTOR_LABELS).map(([key, label]) => {
                    const val = mfShocks[key] || 0;
                    const isPercent = ["equity", "fx", "commodity"].includes(key);
                    const isBps = ["rates", "credit"].includes(key);
                    const isMultiplier = ["volatility", "liquidity"].includes(key);

                    let displayVal: string;
                    let min: number, max: number, step: number;

                    if (isPercent) {
                      displayVal = `${(val * 100).toFixed(0)}%`;
                      min = -80; max = 60; step = 5;
                    } else if (isBps) {
                      displayVal = `${(val * 100).toFixed(1)}%`;
                      min = -5; max = 8; step = 0.25;
                    } else if (key === "inflation") {
                      displayVal = `${(val * 100).toFixed(1)}%`;
                      min = -3; max = 8; step = 0.5;
                    } else if (isMultiplier) {
                      displayVal = `${val.toFixed(1)}x`;
                      min = -100; max = 300; step = 10;
                    } else {
                      displayVal = val.toFixed(2);
                      min = -100; max = 100; step = 5;
                    }

                    return (
                      <div key={key} className="space-y-1.5">
                        <div className="flex justify-between">
                          <span className="text-xs text-muted-foreground">{label}</span>
                          <span className="text-xs font-mono text-muted-foreground">{displayVal}</span>
                        </div>
                        <Slider
                          value={isMultiplier ? [val * 100] : [val * 100]}
                          onValueChange={([v]) => setMfShocks(prev => ({ ...prev, [key]: v / 100 }))}
                          min={min}
                          max={max}
                          step={step}
                          className="w-full"
                          data-testid={`slider-mf-${key}`}
                        />
                      </div>
                    );
                  })}
                </div>

                <div className="space-y-3 border-t pt-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Monte Carlo Overlay</Label>
                    <Button
                      variant={mfMonteCarlo ? "default" : "outline"}
                      size="sm"
                      onClick={() => setMfMonteCarlo(!mfMonteCarlo)}
                      className="toggle-elevate"
                      data-testid="button-mf-mc-toggle"
                    >
                      {mfMonteCarlo ? "On" : "Off"}
                    </Button>
                  </div>
                  {mfMonteCarlo && (
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <Label className="text-xs">Simulations</Label>
                        <span className="text-xs font-mono text-muted-foreground">{mfNumSims}</span>
                      </div>
                      <Slider
                        value={[mfNumSims]}
                        onValueChange={([v]) => setMfNumSims(v)}
                        min={100}
                        max={5000}
                        step={100}
                        data-testid="slider-mf-sims"
                      />
                    </div>
                  )}
                </div>

                <Button
                  onClick={() => runEnhancedTest.mutate()}
                  className="w-full"
                  disabled={runEnhancedTest.isPending}
                  data-testid="button-run-mf-test"
                >
                  {runEnhancedTest.isPending ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Running...
                    </>
                  ) : (
                    <>
                      <Layers className="h-4 w-4 mr-2" />
                      Run Multi-Factor Test
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            <div className="lg:col-span-3 space-y-6">
              {mfResult ? (
                <>
                  <Card data-testid="card-mf-summary">
                    <CardHeader>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <CardTitle className="text-base font-medium">
                          {mfResult.scenarioName}
                        </CardTitle>
                        <div className="flex items-center gap-2">
                          {getRegimeBadge(mfResult.regime)}
                          <Badge variant="secondary">{mfResult.scenarioCategory}</Badge>
                        </div>
                      </div>
                      <CardDescription>{mfResult.scenarioDescription}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        {[
                          { label: "Total Impact", value: `${(mfResult.totalImpact * 100).toFixed(2)}%`, color: mfResult.totalImpact < 0 ? "text-red-500" : "text-emerald-500" },
                          { label: "Impact Amount", value: formatCurrency(mfResult.impactAmount), color: mfResult.impactAmount < 0 ? "text-red-500" : "text-emerald-500" },
                          { label: "Stressed Value", value: formatCurrency(mfResult.stressedValue), color: "" },
                          { label: "Severity", value: getSeverityBadge(mfResult.totalImpact).label, color: "" },
                        ].map((item) => (
                          <div key={item.label} className="p-3 border rounded-lg text-center">
                            <span className="text-xs text-muted-foreground">{item.label}</span>
                            <p className={`text-lg font-semibold mt-1 ${item.color}`}>{item.value}</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <div className="grid gap-6 lg:grid-cols-2">
                    <Card data-testid="card-mf-var">
                      <CardHeader>
                        <CardTitle className="text-base font-medium">VaR / CVaR Metrics</CardTitle>
                        <CardDescription>Parametric Value-at-Risk and Expected Shortfall</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 gap-4">
                          {[
                            { label: "VaR 95%", value: formatPercent(mfResult.parametricVaR95) },
                            { label: "VaR 99%", value: formatPercent(mfResult.parametricVaR99) },
                            { label: "CVaR 95%", value: formatPercent(mfResult.cvar95) },
                            { label: "CVaR 99%", value: formatPercent(mfResult.cvar99) },
                          ].map((item) => (
                            <div key={item.label} className="p-3 border rounded-lg">
                              <span className="text-xs text-muted-foreground">{item.label}</span>
                              <p className="text-base font-semibold mt-1 text-red-500">{item.value}</p>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>

                    <Card data-testid="card-mf-factor-decomposition">
                      <CardHeader>
                        <CardTitle className="text-base font-medium">Factor Decomposition</CardTitle>
                        <CardDescription>Impact attributed to each risk factor</CardDescription>
                      </CardHeader>
                      <CardContent>
                        {mfResult.factorImpacts && Object.keys(mfResult.factorImpacts).length > 0 ? (
                          <div className="space-y-3">
                            {Object.entries(mfResult.factorImpacts)
                              .sort(([, a], [, b]) => a - b)
                              .map(([factor, impact]) => {
                                const maxAbsImpact = Math.max(
                                  ...Object.values(mfResult.factorImpacts).map(Math.abs),
                                  0.001
                                );
                                const pct = (Math.abs(impact) / maxAbsImpact) * 100;
                                return (
                                  <div key={factor} className="space-y-1">
                                    <div className="flex justify-between text-sm">
                                      <span>{FACTOR_LABELS[factor] || factor}</span>
                                      <span className={`font-mono ${impact < 0 ? "text-red-500" : "text-emerald-500"}`}>
                                        {(impact * 100).toFixed(2)}%
                                      </span>
                                    </div>
                                    <Progress
                                      value={pct}
                                      className="h-2"
                                    />
                                  </div>
                                );
                              })}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">No factor data available</p>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  {mfResult.assetImpacts && mfResult.assetImpacts.length > 0 && (
                    <Card data-testid="card-mf-asset-impacts">
                      <CardHeader>
                        <CardTitle className="text-base font-medium">Asset-Level Impact</CardTitle>
                        <CardDescription>Per-holding stress impact with factor contributions</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="border rounded-md overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-[160px]">Holding</TableHead>
                                <TableHead>Asset Class</TableHead>
                                <TableHead className="text-right">Weight</TableHead>
                                <TableHead className="text-right">Impact</TableHead>
                                <TableHead className="text-right">Contribution</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {mfResult.assetImpacts
                                .sort((a, b) => a.impact - b.impact)
                                .map((asset, i) => (
                                  <TableRow key={i} data-testid={`row-mf-asset-${i}`}>
                                    <TableCell className="font-medium text-sm">{asset.name}</TableCell>
                                    <TableCell className="text-sm text-muted-foreground">{asset.assetClass}</TableCell>
                                    <TableCell className="text-right font-mono text-sm">{(asset.weight * 100).toFixed(1)}%</TableCell>
                                    <TableCell className={`text-right font-mono text-sm ${asset.impact < 0 ? "text-red-500" : "text-emerald-500"}`}>
                                      {(asset.impact * 100).toFixed(2)}%
                                    </TableCell>
                                    <TableCell className={`text-right font-mono text-sm ${asset.marginalContribution < 0 ? "text-red-500" : "text-emerald-500"}`}>
                                      {(asset.marginalContribution * 100).toFixed(2)}%
                                    </TableCell>
                                  </TableRow>
                                ))}
                            </TableBody>
                          </Table>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {mfResult.componentVaR && Object.keys(mfResult.componentVaR).length > 0 && (
                    <Card data-testid="card-mf-component-var">
                      <CardHeader>
                        <CardTitle className="text-base font-medium">Component VaR (Euler Decomposition)</CardTitle>
                        <CardDescription>Each factor&apos;s contribution to total portfolio VaR</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={250}>
                          <BarChart data={Object.entries(mfResult.componentVaR).map(([factor, val]) => ({
                            factor: FACTOR_LABELS[factor] || factor,
                            value: val * 100,
                          }))}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="factor" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={(v) => `${v.toFixed(1)}%`} />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: "hsl(var(--card))",
                                border: "1px solid hsl(var(--border))",
                                borderRadius: "6px",
                                fontSize: 12,
                              }}
                              formatter={(value: number) => [`${value.toFixed(3)}%`, "Component VaR"]}
                            />
                            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                              {Object.entries(mfResult.componentVaR).map(([factor], i) => (
                                <Cell key={factor} fill={FACTOR_COLORS[factor] || PIE_COLORS[i % PIE_COLORS.length]} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  )}

                  {mfResult.monteCarloStats && (
                    <Card data-testid="card-mf-mc-stats">
                      <CardHeader>
                        <CardTitle className="text-base font-medium">Monte Carlo Simulation Results</CardTitle>
                        <CardDescription>{mfResult.monteCarloStats.numSimulations} simulations with Student-t fat tails</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                          {[
                            { label: "Mean Impact", value: `${(mfResult.monteCarloStats.meanImpact * 100).toFixed(2)}%` },
                            { label: "Median Impact", value: `${(mfResult.monteCarloStats.medianImpact * 100).toFixed(2)}%` },
                            { label: "Std Dev", value: `${(mfResult.monteCarloStats.stdDevImpact * 100).toFixed(2)}%` },
                            { label: "P(Loss)", value: `${(mfResult.monteCarloStats.probabilityOfLoss * 100).toFixed(0)}%` },
                            { label: "Tail ES (5%)", value: `${(mfResult.monteCarloStats.tailExpectedShortfall * 100).toFixed(2)}%` },
                          ].map((item) => (
                            <div key={item.label} className="p-3 border rounded-lg text-center">
                              <span className="text-xs text-muted-foreground">{item.label}</span>
                              <p className="text-base font-semibold mt-1">{item.value}</p>
                            </div>
                          ))}
                        </div>

                        <div className="border rounded-md overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Percentile</TableHead>
                                <TableHead className="text-right">1st</TableHead>
                                <TableHead className="text-right">5th</TableHead>
                                <TableHead className="text-right">10th</TableHead>
                                <TableHead className="text-right">25th</TableHead>
                                <TableHead className="text-right">50th</TableHead>
                                <TableHead className="text-right">75th</TableHead>
                                <TableHead className="text-right">95th</TableHead>
                                <TableHead className="text-right">99th</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              <TableRow>
                                <TableCell className="font-medium text-sm">Impact</TableCell>
                                {[
                                  mfResult.monteCarloStats.percentile1,
                                  mfResult.monteCarloStats.percentile5,
                                  mfResult.monteCarloStats.percentile10,
                                  mfResult.monteCarloStats.percentile25,
                                  mfResult.monteCarloStats.medianImpact,
                                  mfResult.monteCarloStats.percentile75,
                                  mfResult.monteCarloStats.percentile95,
                                  mfResult.monteCarloStats.percentile99,
                                ].map((val, i) => (
                                  <TableCell key={i} className={`text-right font-mono text-sm ${val < 0 ? "text-red-500" : "text-emerald-500"}`}>
                                    {(val * 100).toFixed(2)}%
                                  </TableCell>
                                ))}
                              </TableRow>
                            </TableBody>
                          </Table>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="p-3 border rounded-lg text-center">
                            <span className="text-xs text-muted-foreground">Skewness</span>
                            <p className="text-base font-semibold mt-1">{mfResult.monteCarloStats.skewness.toFixed(3)}</p>
                          </div>
                          <div className="p-3 border rounded-lg text-center">
                            <span className="text-xs text-muted-foreground">Kurtosis</span>
                            <p className="text-base font-semibold mt-1">{mfResult.monteCarloStats.kurtosis.toFixed(3)}</p>
                          </div>
                          <div className="p-3 border rounded-lg text-center">
                            <span className="text-xs text-muted-foreground">P(Loss &gt; 20%)</span>
                            <p className="text-base font-semibold mt-1">{(mfResult.monteCarloStats.probabilityOfLossGt20pct * 100).toFixed(1)}%</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              ) : (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <Layers className="h-12 w-12 mb-4" />
                    <p className="text-base font-medium">Multi-Factor Scenario Engine</p>
                    <p className="text-sm mt-1 text-center max-w-md">
                      Select a preset or customize all 8 risk factors, then run the test to see portfolio impact with Cholesky-correlated shocks, VaR/CVaR, factor decomposition, and component risk
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* TAB 3: Compare All Presets */}
        <TabsContent value="compare-all" className="space-y-6">
          <Card data-testid="card-compare-all">
            <CardHeader>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <CardTitle className="text-base font-medium">Compare All Preset Scenarios</CardTitle>
                  <CardDescription>Run all 14 historical and hypothetical scenarios against your portfolio simultaneously</CardDescription>
                </div>
                <Button
                  onClick={() => runAllPresets.mutate()}
                  disabled={runAllPresets.isPending}
                  data-testid="button-run-all-presets"
                >
                  {runAllPresets.isPending ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <BarChart3 className="h-4 w-4 mr-2" />
                      Run All Presets
                    </>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {comparisonResult ? (
                <div className="space-y-6">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      { label: "Worst Case", value: comparisonResult.worstCase.scenarioName, sub: `${(comparisonResult.worstCase.totalImpact * 100).toFixed(1)}%`, color: "text-red-500" },
                      { label: "Best Case", value: comparisonResult.bestCase.scenarioName, sub: `${(comparisonResult.bestCase.totalImpact * 100).toFixed(1)}%`, color: "text-emerald-500" },
                      { label: "Average Impact", value: `${(comparisonResult.averageImpact * 100).toFixed(2)}%`, sub: `Range: ${(comparisonResult.impactRange * 100).toFixed(1)}%`, color: "" },
                      { label: "Scenarios Tested", value: `${comparisonResult.scenarios.length}`, sub: "historical + hypothetical", color: "" },
                    ].map((item) => (
                      <div key={item.label} className="p-3 border rounded-lg">
                        <span className="text-xs text-muted-foreground">{item.label}</span>
                        <p className={`text-base font-semibold mt-1 ${item.color}`}>{item.value}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{item.sub}</p>
                      </div>
                    ))}
                  </div>

                  <ResponsiveContainer width="100%" height={Math.max(300, comparisonResult.ranking.length * 32)}>
                    <BarChart data={comparisonResult.ranking.map(r => ({
                      name: r.name.length > 25 ? r.name.substring(0, 25) + "..." : r.name,
                      impact: r.impact * 100,
                    }))} layout="vertical">
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
                        fontSize={10}
                        width={180}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "6px",
                          fontSize: 12,
                        }}
                        formatter={(value: number) => [`${value.toFixed(2)}%`, "Impact"]}
                      />
                      <ReferenceLine x={0} stroke="hsl(var(--muted-foreground))" />
                      <Bar dataKey="impact" radius={[0, 4, 4, 0]}>
                        {comparisonResult.ranking.map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={entry.impact < -20 ? "hsl(var(--destructive))" : entry.impact < -10 ? "hsl(var(--chart-4))" : entry.impact < 0 ? "hsl(var(--chart-2))" : "hsl(var(--chart-1))"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>

                  <div className="border rounded-md overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8">Rank</TableHead>
                          <TableHead className="w-[200px]">Scenario</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>Regime</TableHead>
                          <TableHead className="text-right">Impact</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="text-right">VaR 95%</TableHead>
                          <TableHead className="text-right">CVaR 95%</TableHead>
                          <TableHead>Severity</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {comparisonResult.ranking.map((rank) => {
                          const scenario = comparisonResult.scenarios.find(s => s.scenarioName === rank.name);
                          if (!scenario) return null;
                          const severity = getSeverityBadge(scenario.totalImpact);
                          return (
                            <TableRow key={rank.name} data-testid={`row-compare-${rank.rank}`}>
                              <TableCell className="font-mono text-sm">{rank.rank}</TableCell>
                              <TableCell className="font-medium text-sm">{rank.name}</TableCell>
                              <TableCell><Badge variant="secondary">{scenario.scenarioCategory}</Badge></TableCell>
                              <TableCell>{getRegimeBadge(scenario.regime)}</TableCell>
                              <TableCell className={`text-right font-mono text-sm ${scenario.totalImpact < 0 ? "text-red-500" : "text-emerald-500"}`}>
                                {(scenario.totalImpact * 100).toFixed(2)}%
                              </TableCell>
                              <TableCell className={`text-right font-mono text-sm ${scenario.impactAmount < 0 ? "text-red-500" : "text-emerald-500"}`}>
                                {formatCurrency(scenario.impactAmount)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm text-red-500">
                                {formatPercent(scenario.parametricVaR95)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm text-red-500">
                                {formatPercent(scenario.cvar95)}
                              </TableCell>
                              <TableCell>
                                <Badge variant={severity.variant}>{severity.label}</Badge>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <BarChart3 className="h-12 w-12 mb-4" />
                  <p className="text-base font-medium">Scenario Comparison Engine</p>
                  <p className="text-sm mt-1 text-center max-w-md">
                    Click &quot;Run All Presets&quot; to simultaneously stress-test your portfolio against 8 historical and 6 hypothetical scenarios, ranked by severity
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 4: Reverse Stress Test */}
        <TabsContent value="reverse-test" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-2" data-testid="card-reverse-builder">
              <CardHeader>
                <CardTitle className="text-base font-medium">Reverse Stress Test</CardTitle>
                <CardDescription>Find the factor shocks required to produce a target portfolio loss using bisection search</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <Label>Target Loss</Label>
                    <span className="text-sm font-mono text-red-500">
                      {(reverseTargetLoss * 100).toFixed(0)}%
                    </span>
                  </div>
                  <Slider
                    value={[reverseTargetLoss * 100]}
                    onValueChange={([v]) => setReverseTargetLoss(v / 100)}
                    min={-50}
                    max={-5}
                    step={1}
                    data-testid="slider-reverse-target"
                  />
                  <p className="text-xs text-muted-foreground">
                    The engine will search for the combination of factor shocks across all 8 dimensions that produces this level of portfolio loss
                  </p>
                </div>

                <Button
                  onClick={() => runReverseTest.mutate()}
                  className="w-full"
                  disabled={runReverseTest.isPending}
                  data-testid="button-run-reverse"
                >
                  {runReverseTest.isPending ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Searching...
                    </>
                  ) : (
                    <>
                      <Target className="h-4 w-4 mr-2" />
                      Find Breaking Point
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            <div className="lg:col-span-3 space-y-6">
              {reverseResult ? (
                <>
                  <Card data-testid="card-reverse-result">
                    <CardHeader>
                      <CardTitle className="text-base font-medium">Reverse Stress Test Results</CardTitle>
                      <CardDescription>{reverseResult.scenarioDescription}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="grid gap-4 sm:grid-cols-3">
                        <div className="p-3 border rounded-lg text-center">
                          <span className="text-xs text-muted-foreground">Target Loss</span>
                          <p className="text-lg font-semibold mt-1 text-red-500">{(reverseResult.targetLoss * 100).toFixed(0)}%</p>
                        </div>
                        <div className="p-3 border rounded-lg text-center">
                          <span className="text-xs text-muted-foreground">Achieved Loss</span>
                          <p className="text-lg font-semibold mt-1 text-red-500">{(reverseResult.achievedLoss * 100).toFixed(2)}%</p>
                        </div>
                        <div className="p-3 border rounded-lg text-center">
                          <span className="text-xs text-muted-foreground">Dominant Factor</span>
                          <p className="text-lg font-semibold mt-1">{FACTOR_LABELS[reverseResult.dominantFactor] || reverseResult.dominantFactor}</p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <h4 className="text-sm font-medium text-muted-foreground">Required Factor Shocks</h4>
                        <div className="border rounded-md overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Factor</TableHead>
                                <TableHead className="text-right">Required Shock</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {Object.entries(reverseResult.requiredShocks)
                                .filter(([, val]) => Math.abs(val) > 0.0001)
                                .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
                                .map(([factor, val]) => (
                                  <TableRow key={factor}>
                                    <TableCell className="font-medium text-sm">{FACTOR_LABELS[factor] || factor}</TableCell>
                                    <TableCell className={`text-right font-mono text-sm ${val < 0 ? "text-red-500" : "text-emerald-500"}`}>
                                      {["equity", "fx", "commodity"].includes(factor)
                                        ? `${(val * 100).toFixed(1)}%`
                                        : ["rates", "credit", "inflation"].includes(factor)
                                          ? `${(val * 100).toFixed(2)}%`
                                          : `${val.toFixed(2)}x`
                                      }
                                    </TableCell>
                                  </TableRow>
                                ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>

                      {reverseResult.assetImpacts && reverseResult.assetImpacts.length > 0 && (
                        <div className="space-y-2">
                          <h4 className="text-sm font-medium text-muted-foreground">Asset-Level Impacts Under This Scenario</h4>
                          <div className="border rounded-md overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Holding</TableHead>
                                  <TableHead>Class</TableHead>
                                  <TableHead className="text-right">Weight</TableHead>
                                  <TableHead className="text-right">Impact</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {reverseResult.assetImpacts
                                  .sort((a, b) => a.impact - b.impact)
                                  .map((asset, i) => (
                                    <TableRow key={i}>
                                      <TableCell className="font-medium text-sm">{asset.name}</TableCell>
                                      <TableCell className="text-sm text-muted-foreground">{asset.assetClass}</TableCell>
                                      <TableCell className="text-right font-mono text-sm">{(asset.weight * 100).toFixed(1)}%</TableCell>
                                      <TableCell className={`text-right font-mono text-sm ${asset.impact < 0 ? "text-red-500" : "text-emerald-500"}`}>
                                        {(asset.impact * 100).toFixed(2)}%
                                      </TableCell>
                                    </TableRow>
                                  ))}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </>
              ) : (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <RotateCcw className="h-12 w-12 mb-4" />
                    <p className="text-base font-medium">Reverse Stress Testing</p>
                    <p className="text-sm mt-1 text-center max-w-md">
                      Instead of defining shocks and measuring the loss, define the loss you&apos;re concerned about and let the engine find the combination of market shocks that would cause it
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* TAB 5: History */}
        <TabsContent value="history" className="space-y-6">
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
                <div className="border rounded-md overflow-x-auto">
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
                </div>
              )}
            </CardContent>
          </Card>

          <MonteCarloSection
            monteCarloResults={monteCarloResults}
            selectedMCScenario={selectedMCScenario}
            setSelectedMCScenario={setSelectedMCScenario}
            runMonteCarlo={runMonteCarlo}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MonteCarloSection({
  monteCarloResults,
  selectedMCScenario,
  setSelectedMCScenario,
  runMonteCarlo,
}: {
  monteCarloResults: any[];
  selectedMCScenario: number;
  setSelectedMCScenario: (v: number) => void;
  runMonteCarlo: any;
}) {
  return (
    <Card data-testid="card-monte-carlo-stress">
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <Activity className="h-4 w-4 text-cyan-500 shrink-0" />
            <div>
              <CardTitle className="text-base font-medium">Monte Carlo Factor-Model Stress Testing</CardTitle>
              <CardDescription>Simulated 1-year return paths under progressively stressed conditions (200 paths per scenario)</CardDescription>
            </div>
          </div>
          <Button
            onClick={() => runMonteCarlo.mutate()}
            disabled={runMonteCarlo.isPending}
            data-testid="button-run-monte-carlo"
          >
            {runMonteCarlo.isPending ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Simulating...
              </>
            ) : (
              <>
                <Zap className="h-4 w-4 mr-2" />
                Run Monte Carlo
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {monteCarloResults.length > 0 ? (
          <div className="space-y-6">
            <div className="flex items-center gap-2 flex-wrap">
              {monteCarloResults.map((mc: any, i: number) => (
                <Button
                  key={mc.scenarioName}
                  variant={selectedMCScenario === i ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedMCScenario(i)}
                  data-testid={`button-mc-scenario-${i}`}
                >
                  {mc.scenarioName}
                </Button>
              ))}
            </div>

            {(() => {
              const mc = monteCarloResults[selectedMCScenario];
              if (!mc) return null;

              const pathChartData: Record<string, number | string>[] = [];
              const maxSteps = mc.paths[0]?.cumulativeReturns.length || 0;
              for (let step = 0; step < maxSteps; step++) {
                const point: Record<string, number | string> = { step: Math.round((step / Math.max(1, maxSteps - 1)) * 252) };
                mc.paths.forEach((path: any) => {
                  point[`path${path.pathId}`] = path.cumulativeReturns[step] || 0;
                });
                pathChartData.push(point);
              }

              const pathColors = [
                "hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))",
                "hsl(var(--chart-4))", "hsl(var(--chart-5))",
              ];

              return (
                <div className="space-y-6">
                  <div>
                    <h4 className="text-sm font-medium mb-3">Simulated Return Paths</h4>
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={pathChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis
                          dataKey="step"
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={11}
                          tickLine={false}
                          label={{ value: "Trading Days", position: "insideBottom", offset: -5, fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
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
                            fontSize: 11,
                          }}
                          formatter={(value: number) => [`${value.toFixed(1)}%`]}
                          labelFormatter={(label) => `Day ${label}`}
                        />
                        <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                        {mc.paths.map((path: any, i: number) => (
                          <Line
                            key={path.pathId}
                            type="monotone"
                            dataKey={`path${path.pathId}`}
                            stroke={pathColors[i % pathColors.length]}
                            strokeWidth={1}
                            strokeOpacity={0.4}
                            dot={false}
                            name={`Path ${path.pathId + 1}`}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
                    {[
                      { label: "Expected Return", value: `${((mc.expectedReturn ?? 0) * 100).toFixed(1)}%` },
                      { label: "P(Loss)", value: `${((mc.probabilityOfLoss ?? 0) * 100).toFixed(0)}%` },
                      { label: "Expected Shortfall", value: `${((mc.expectedShortfall ?? 0) * 100).toFixed(1)}%` },
                      { label: "Avg Max Drawdown", value: `${((mc.expectedMaxDrawdown ?? 0) * 100).toFixed(1)}%` },
                      { label: "Return Spread", value: `${(((mc.percentiles?.p95 ?? 0) - (mc.percentiles?.p5 ?? 0)) * 100).toFixed(1)}%` },
                    ].map((item) => (
                      <div key={item.label} className="p-3 border rounded-lg text-center">
                        <span className="text-xs text-muted-foreground">{item.label}</span>
                        <p className="text-lg font-semibold mt-1">{item.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="border rounded-md overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Percentile</TableHead>
                          <TableHead className="text-right">5th (Worst)</TableHead>
                          <TableHead className="text-right">25th</TableHead>
                          <TableHead className="text-right">50th (Median)</TableHead>
                          <TableHead className="text-right">75th</TableHead>
                          <TableHead className="text-right">95th (Best)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow>
                          <TableCell className="font-medium text-sm">1-Year Return</TableCell>
                          <TableCell className="text-right font-mono text-sm text-red-500">{((mc.percentiles?.p5 ?? 0) * 100).toFixed(1)}%</TableCell>
                          <TableCell className="text-right font-mono text-sm">{((mc.percentiles?.p25 ?? 0) * 100).toFixed(1)}%</TableCell>
                          <TableCell className="text-right font-mono text-sm">{((mc.percentiles?.p50 ?? 0) * 100).toFixed(1)}%</TableCell>
                          <TableCell className="text-right font-mono text-sm">{((mc.percentiles?.p75 ?? 0) * 100).toFixed(1)}%</TableCell>
                          <TableCell className="text-right font-mono text-sm text-emerald-500">{((mc.percentiles?.p95 ?? 0) * 100).toFixed(1)}%</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </div>
              );
            })()}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Zap className="h-10 w-10 mb-3" />
            <p>Click &quot;Run Monte Carlo&quot; to simulate stressed return paths</p>
            <p className="text-sm mt-1">Uses your portfolio&apos;s actual return distribution with progressively stressed parameters</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CalculationMethodologyCard({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <Card data-testid="card-calculation-methodology">
      <CardHeader className="cursor-pointer" onClick={onToggle}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <BookOpen className="h-4 w-4 text-cyan-500 shrink-0" />
            <CardTitle className="text-base font-medium">Advanced Risk Calculation Methodology</CardTitle>
          </div>
          <Button variant="ghost" size="icon" className="shrink-0" onClick={(e) => { e.stopPropagation(); onToggle(); }} data-testid="button-toggle-methodology">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
        <CardDescription>How stress test impacts are computed for your portfolio</CardDescription>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-6">
          <div className="space-y-1.5">
            <h4 className="text-sm font-medium text-muted-foreground">Overview</h4>
            <p className="text-sm">
              The stress test engine calculates the total portfolio impact by decomposing your portfolio into four asset class buckets, then applying scenario-specific shocks to each bucket using sensitivity factors. The individual impacts are summed to produce the total portfolio-level impact, which is then multiplied by the portfolio value to determine the dollar amount at risk.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Step 1: Portfolio Decomposition</h4>
            <p className="text-sm">
              Each holding in your portfolio is classified into one of four asset class buckets based on its asset class label:
            </p>
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[180px]">Bucket</TableHead>
                    <TableHead className="w-[220px]">Includes</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium text-sm">Equity Weight</TableCell>
                    <TableCell className="text-sm text-muted-foreground">Equity, Stock</TableCell>
                    <TableCell className="text-sm text-muted-foreground">All equity and stock-related holdings</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium text-sm">Fixed Income Weight</TableCell>
                    <TableCell className="text-sm text-muted-foreground">Fixed Income, Bond, Credit</TableCell>
                    <TableCell className="text-sm text-muted-foreground">All bond, credit, and fixed income holdings</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium text-sm">Commodity Weight</TableCell>
                    <TableCell className="text-sm text-muted-foreground">Commodity, Gold, Oil</TableCell>
                    <TableCell className="text-sm text-muted-foreground">All commodity-related holdings</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium text-sm">Alternatives Weight</TableCell>
                    <TableCell className="text-sm text-muted-foreground">Everything else</TableCell>
                    <TableCell className="text-sm text-muted-foreground">Hedge funds, private equity, real estate, and other alternatives</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Step 2: Shock Application</h4>
            <p className="text-sm">
              Four separate impact components are calculated by applying each scenario shock to the relevant asset class bucket, multiplied by a sensitivity factor:
            </p>
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[160px]">Component</TableHead>
                    <TableHead className="w-[300px]">Formula</TableHead>
                    <TableHead>Explanation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium text-sm">Equity Impact</TableCell>
                    <TableCell className="font-mono text-sm">Equity Shock x Equity Weight</TableCell>
                    <TableCell className="text-sm text-muted-foreground">Direct 1:1 sensitivity</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium text-sm">Rate Impact</TableCell>
                    <TableCell className="font-mono text-sm">Rate Shock x (-8) x FI Weight</TableCell>
                    <TableCell className="text-sm text-muted-foreground">Duration-based sensitivity (modified duration ~8)</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium text-sm">Credit Impact</TableCell>
                    <TableCell className="font-mono text-sm">Credit Spread x (-5) x FI Weight</TableCell>
                    <TableCell className="text-sm text-muted-foreground">Spread duration sensitivity (~5)</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium text-sm">FX Impact</TableCell>
                    <TableCell className="font-mono text-sm">FX Shock x 0.3 x (Eq + Alt Weight)</TableCell>
                    <TableCell className="text-sm text-muted-foreground">30% foreign exposure assumption</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Step 3: Aggregation</h4>
            <div className="bg-muted/50 rounded-md p-4 font-mono text-sm space-y-1">
              <p>Total Impact = Equity Impact + Rate Impact + Credit Impact + FX Impact</p>
              <p>Impact Amount ($) = Portfolio Value x Total Impact</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <h4 className="text-sm font-medium text-muted-foreground">Limitations</h4>
            <ul className="space-y-1.5">
              {[
                "Shocks are applied instantaneously and do not model the path or timing of market declines",
                "Sensitivity multipliers are fixed approximations and may not reflect your portfolio's actual characteristics",
                "Cross-asset correlations are not modeled in the basic engine (use Multi-Factor tab for correlated shocks)",
                "The model does not account for nonlinear effects such as option convexity or liquidity spirals",
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function MonteCarloMethodologyCard({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <Card data-testid="card-mc-methodology">
      <CardHeader className="cursor-pointer" onClick={onToggle}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <BookOpen className="h-4 w-4 text-cyan-500 shrink-0" />
            <CardTitle className="text-base font-medium">Monte Carlo Simulation Methodology</CardTitle>
          </div>
          <Button variant="ghost" size="icon" className="shrink-0" onClick={(e) => { e.stopPropagation(); onToggle(); }} data-testid="button-toggle-mc-methodology">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
        <CardDescription>How Monte Carlo factor-model stress simulations are generated and interpreted</CardDescription>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-6">
          <div className="space-y-1.5">
            <h4 className="text-sm font-medium text-muted-foreground">Overview</h4>
            <p className="text-sm">
              The Monte Carlo stress engine generates 200 simulated one-year return paths for your portfolio under five progressively stressed market regimes. Unlike scenario-based stress tests that apply a single instantaneous shock, Monte Carlo simulation models the entire path of returns over time, capturing the compounding effects and volatility clustering that occur during real market events.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Stress Regime Definitions</h4>
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[160px]">Regime</TableHead>
                    <TableHead className="w-[160px]">Mean Shift</TableHead>
                    <TableHead className="w-[160px]">Vol Multiplier</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    { name: "Base Case", shift: "No change", vol: "1.0x", desc: "Normal conditions" },
                    { name: "Mild Stress", shift: "μ - 1σ", vol: "1.5x", desc: "Modest deterioration" },
                    { name: "Moderate Crisis", shift: "μ - 2σ", vol: "2.0x", desc: "Typical bear market" },
                    { name: "Severe Crisis", shift: "μ - 3σ", vol: "2.5x", desc: "Similar to 2008" },
                    { name: "Black Swan", shift: "μ - 4σ", vol: "3.0x", desc: "Beyond historical precedent" },
                  ].map((row) => (
                    <TableRow key={row.name}>
                      <TableCell className="font-medium text-sm">{row.name}</TableCell>
                      <TableCell className="font-mono text-sm">{row.shift}</TableCell>
                      <TableCell className="font-mono text-sm">{row.vol}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{row.desc}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Path Generation (GBM)</h4>
            <div className="bg-muted/50 rounded-md p-4 font-mono text-sm space-y-1">
              <p>r(t) = μ_stressed + σ_stressed x Z(t), where Z(t) ~ N(0,1)</p>
              <p>Cumulative Return(T) = Product(1 + r(t)) - 1</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <h4 className="text-sm font-medium text-muted-foreground">Limitations</h4>
            <ul className="space-y-1.5">
              {[
                "Returns are assumed normally distributed; real markets exhibit fat tails",
                "Daily returns are drawn independently (no autocorrelation or GARCH effects)",
                "200-path sample size may not fully capture extreme tail events",
                "Transaction costs and liquidity constraints are not modeled",
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
