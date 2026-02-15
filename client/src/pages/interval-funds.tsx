import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  TrendingUp,
  DollarSign,
  Shield,
  Percent,
  BarChart3,
  Target,
  Droplets,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ArrowUpDown,
  Eye,
  Loader2,
  Search,
  Award,
  Activity,
  PieChart,
  GitCompare,
  FileCheck,
  AlertCircle,
  Info,
  Scale,
  Globe,
  Download,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Database,
  Clock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart as RPieChart,
  Pie,
  Cell,
} from "recharts";

// --- Types ---

interface IntervalFund {
  id: string;
  name: string;
  ticker: string | null;
  fundManager: string | null;
  description: string | null;
  assetClass: string;
  strategyType: string;
  repurchaseFrequency: string;
  repurchaseRate: string | null;
  repurchaseNotice: number | null;
  fundStructure: string | null;
  navPerShare: string | null;
  totalAum: string | null;
  minInvestment: string | null;
  managementFee: string | null;
  performanceFee: string | null;
  expenseRatio: string | null;
  distributionRate: string | null;
  distributionFrequency: string | null;
  nav30dReturn: string | null;
  nav90dReturn: string | null;
  navYtdReturn: string | null;
  nav1yrReturn: string | null;
  nav3yrReturn: string | null;
  nav5yrReturn: string | null;
  inceptionReturn: string | null;
  volatility: string | null;
  sharpeRatio: string | null;
  sortinoRatio: string | null;
  maxDrawdown: string | null;
  beta: string | null;
  alpha: string | null;
  correlation: string | null;
  topHoldingsPct: string | null;
  numHoldings: number | null;
  leverageRatio: string | null;
  weightedAvgCoupon: string | null;
  weightedAvgMaturity: string | null;
  defaultRate: string | null;
  fundDomicile: string | null;
}

interface AnalysisResult {
  fundId: string;
  fundName: string;
  overallScore: number;
  overallRating: string;
  liquidity: { repurchaseFrequency: string; repurchaseRate: number; annualLiquidityAccess: number; repurchaseNotice: number; liquidityScore: number; liquidityRating: string };
  fees: { managementFee: number; performanceFee: number; expenseRatio: number; totalCostEstimate: number; feeScore: number; feeRating: string; netReturnAfterFees: number };
  yield: { distributionRate: number; distributionFrequency: string; nav1yrReturn: number; yieldVsRiskFree: number; yieldSpread: number; incomeScore: number; incomeRating: string };
  risk: { volatility: number; sharpeRatio: number; sortinoRatio: number; maxDrawdown: number; beta: number; alpha: number; riskScore: number; riskRating: string };
  portfolioFit: { concentrationRisk: number; diversificationBenefit: string; correlationAssessment: string; suitabilityScore: number; suitabilityRating: string };
  peerComparison: { fundName: string; returnRank: number; riskRank: number; feeRank: number; liquidityRank: number; overallRank: number; totalPeers: number } | null;
  strengths: string[];
  risks: string[];
  recommendation: string;
}

interface DashboardStats {
  totalFunds: number;
  totalAum: number;
  avgExpenseRatio: number;
  avgDistributionRate: number;
  avg1yrReturn: number;
  avgSharpeRatio: number;
  topPerformers: { id: string; name: string; ticker: string | null; assetClass: string; nav1yrReturn: string | null }[];
  highestYielding: { id: string; name: string; ticker: string | null; assetClass: string; distributionRate: string | null }[];
  bestRiskAdjusted: { id: string; name: string; ticker: string | null; assetClass: string; sharpeRatio: string | null }[];
  lowestCost: { id: string; name: string; ticker: string | null; assetClass: string; expenseRatio: string | null }[];
  categoryBreakdown: Record<string, { count: number; totalAum: number; avgReturn: number }>;
}

interface ValidationResult {
  fundId: string;
  fundName: string;
  status: "clean" | "warning" | "conflict";
  validationScore: number;
  fieldValidations: { field: string; value: string | number | null; source: string; isValid: boolean; issue?: string }[];
  crossFieldChecks: { name: string; passed: boolean; detail: string; severity: string }[];
  recommendations: string[];
}

interface DataQualityReport {
  totalFunds: number;
  cleanFunds: number;
  warningFunds: number;
  conflictFunds: number;
  overallScore: number;
  commonIssues: { issue: string; count: number }[];
  fundResults: ValidationResult[];
}

// --- Helpers ---

const PIE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

function pct(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "N/A";
  const n = typeof val === "string" ? parseFloat(val) : val;
  return isNaN(n) ? "N/A" : `${(n * 100).toFixed(2)}%`;
}
function fmt(val: string | number | null | undefined, d = 2): string {
  if (val === null || val === undefined) return "N/A";
  const n = typeof val === "string" ? parseFloat(val) : val;
  return isNaN(n) ? "N/A" : n.toFixed(d);
}
function aumFmt(val: string | null | undefined): string {
  if (!val) return "N/A";
  const n = parseFloat(val);
  if (isNaN(n)) return "N/A";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toLocaleString()}`;
}
function num(val: string | null | undefined): number { return val ? parseFloat(val) || 0 : 0; }

function ratingBadge(rating: string) {
  const m: Record<string, string> = {
    "Excellent": "bg-green-500/15 text-green-700 dark:text-green-400",
    "Good": "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    "Average": "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
    "Below Average": "bg-orange-500/15 text-orange-700 dark:text-orange-400",
    "Poor": "bg-red-500/15 text-red-700 dark:text-red-400",
    "Strong Buy": "bg-green-500/15 text-green-700 dark:text-green-400",
    "Buy": "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    "Hold": "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
    "Underweight": "bg-orange-500/15 text-orange-700 dark:text-orange-400",
    "Avoid": "bg-red-500/15 text-red-700 dark:text-red-400",
  };
  return <Badge className={m[rating] || "bg-muted text-muted-foreground"}>{rating}</Badge>;
}
function scoreColor(s: number): string {
  if (s >= 80) return "text-green-600 dark:text-green-400";
  if (s >= 65) return "text-blue-600 dark:text-blue-400";
  if (s >= 50) return "text-yellow-600 dark:text-yellow-400";
  if (s >= 35) return "text-orange-600 dark:text-orange-400";
  return "text-red-600 dark:text-red-400";
}
function statusBadge(status: string) {
  if (status === "clean") return <Badge className="bg-green-500/15 text-green-700 dark:text-green-400">Clean</Badge>;
  if (status === "warning") return <Badge className="bg-yellow-500/15 text-yellow-700 dark:text-yellow-400">Warning</Badge>;
  return <Badge className="bg-red-500/15 text-red-700 dark:text-red-400">Conflict</Badge>;
}

// --- Sub-components ---

function ScoreGauge({ score, label }: { score: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`text-2xl font-bold ${scoreColor(score)}`}>{score}</div>
      <Progress value={score} className="h-2 w-full" />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function LeaderboardCard({ title, icon: Icon, items, valueKey, formatter }: {
  title: string;
  icon: React.ElementType;
  items: { id: string; name: string; ticker: string | null; assetClass: string; [k: string]: any }[];
  valueKey: string;
  formatter: (v: any) => string;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2"><Icon className="h-4 w-4" />{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={item.id} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-4">#{i + 1}</span>
                <span className="font-medium truncate max-w-[180px]">{item.name}</span>
              </div>
              <span className="font-mono text-xs">{formatter(item[valueKey])}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// --- Details Dialog ---

function FundDetailsDialog({ fund, open, onClose }: { fund: IntervalFund; open: boolean; onClose: () => void }) {
  const { data, isLoading } = useQuery<{ analysis: AnalysisResult }>({
    queryKey: [`/api/interval-funds/${fund.id}/analyze`],
    enabled: open,
  });
  const { data: valData } = useQuery<{ validation: ValidationResult }>({
    queryKey: [`/api/interval-funds/${fund.id}/validate`],
    enabled: open,
  });
  const analysis = data?.analysis;
  const validation = valData?.validation;

  const radarData = analysis ? [
    { metric: "Liquidity", score: analysis.liquidity.liquidityScore },
    { metric: "Fees", score: analysis.fees.feeScore },
    { metric: "Income", score: analysis.yield.incomeScore },
    { metric: "Risk-Adj", score: analysis.risk.riskScore },
    { metric: "Portfolio Fit", score: analysis.portfolioFit.suitabilityScore },
  ] : [];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            {fund.name}
          </DialogTitle>
          <DialogDescription>
            {fund.ticker && <Badge variant="outline" className="mr-2">{fund.ticker}</Badge>}
            <Badge variant="outline" className="mr-2">{fund.assetClass}</Badge>
            <Badge variant="outline">{fund.strategyType}</Badge>
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
        ) : analysis ? (
          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="performance">Performance</TabsTrigger>
              <TabsTrigger value="terms">Terms & Fees</TabsTrigger>
              <TabsTrigger value="risk">Risk & Fit</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              {/* Description */}
              {fund.description && <p className="text-sm text-muted-foreground">{fund.description}</p>}

              {/* Score row */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="pt-6 text-center">
                    <div className={`text-4xl font-bold ${scoreColor(analysis.overallScore)}`}>{analysis.overallScore}</div>
                    <div className="text-sm text-muted-foreground mt-1">Overall Score</div>
                    <div className="mt-2">{ratingBadge(analysis.overallRating)}</div>
                  </CardContent>
                </Card>
                <Card className="col-span-1 md:col-span-2">
                  <CardContent className="pt-6">
                    <div className="grid grid-cols-5 gap-3">
                      <ScoreGauge score={analysis.liquidity.liquidityScore * 10} label="Liquidity" />
                      <ScoreGauge score={analysis.fees.feeScore * 10} label="Fees" />
                      <ScoreGauge score={analysis.yield.incomeScore * 10} label="Income" />
                      <ScoreGauge score={analysis.risk.riskScore * 10} label="Risk-Adj" />
                      <ScoreGauge score={analysis.portfolioFit.suitabilityScore * 10} label="Fit" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Radar */}
              <Card>
                <CardContent className="pt-4">
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={radarData}>
                        <PolarGrid />
                        <PolarAngleAxis dataKey="metric" tick={{ fontSize: 12 }} />
                        <PolarRadiusAxis domain={[0, 10]} tick={{ fontSize: 10 }} />
                        <Radar dataKey="score" stroke="hsl(var(--chart-1))" fill="hsl(var(--chart-1))" fillOpacity={0.3} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Strengths & Risks */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-600" /> Strengths</CardTitle></CardHeader>
                  <CardContent><ul className="space-y-1.5 text-sm">{analysis.strengths.length > 0 ? analysis.strengths.map((s, i) => <li key={i} className="flex items-start gap-2"><CheckCircle className="h-3 w-3 text-green-500 mt-0.5 shrink-0" /><span>{s}</span></li>) : <li className="text-muted-foreground">No notable strengths identified</li>}</ul></CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-orange-600" /> Risks</CardTitle></CardHeader>
                  <CardContent><ul className="space-y-1.5 text-sm">{analysis.risks.length > 0 ? analysis.risks.map((r, i) => <li key={i} className="flex items-start gap-2"><XCircle className="h-3 w-3 text-orange-500 mt-0.5 shrink-0" /><span>{r}</span></li>) : <li className="text-muted-foreground">No significant risks identified</li>}</ul></CardContent>
                </Card>
              </div>

              <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Recommendation</CardTitle></CardHeader><CardContent><p className="text-sm">{analysis.recommendation}</p></CardContent></Card>

              {/* Data Validation */}
              {validation && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><FileCheck className="h-4 w-4" />Data Validation {statusBadge(validation.status)}</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex items-center gap-2"><span className="text-muted-foreground">Score:</span><span className="font-bold">{validation.validationScore}/100</span></div>
                    {validation.crossFieldChecks.filter(c => !c.passed || c.severity === "warning").map((c, i) => (
                      <div key={i} className="flex items-start gap-2">
                        {c.severity === "error" ? <XCircle className="h-3 w-3 text-red-500 mt-0.5" /> : <AlertCircle className="h-3 w-3 text-yellow-500 mt-0.5" />}
                        <span>{c.detail}</span>
                      </div>
                    ))}
                    {validation.status === "clean" && <div className="flex items-center gap-2 text-green-600"><CheckCircle className="h-3 w-3" /><span>All validation checks passed</span></div>}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="performance" className="space-y-4">
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-sm">Performance Returns</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    {[["1 Month", fund.nav30dReturn], ["3 Month", fund.nav90dReturn], ["YTD", fund.navYtdReturn], ["1 Year", fund.nav1yrReturn], ["3 Year (Ann.)", fund.nav3yrReturn], ["5 Year (Ann.)", fund.nav5yrReturn], ["Since Inception", fund.inceptionReturn]].map(([label, val]) => (
                      <div key={label as string}>
                        <div className="text-muted-foreground">{label}</div>
                        <div className={`font-bold ${num(val as string) >= 0 ? "text-green-600" : "text-red-600"}`}>{pct(val as string)}</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
              <div className="grid grid-cols-2 gap-4">
                <Card><CardContent className="pt-6"><div className="text-muted-foreground text-sm">NAV Per Share</div><div className="text-2xl font-bold">${fmt(fund.navPerShare)}</div></CardContent></Card>
                <Card><CardContent className="pt-6"><div className="text-muted-foreground text-sm">Total AUM</div><div className="text-2xl font-bold">{aumFmt(fund.totalAum)}</div></CardContent></Card>
              </div>
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-sm">Income</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-muted-foreground">Distribution Rate</span><div className="font-bold">{pct(fund.distributionRate)}</div></div>
                  <div><span className="text-muted-foreground">Distribution Freq.</span><div className="font-bold">{fund.distributionFrequency}</div></div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="terms" className="space-y-4">
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-sm">Fee Structure</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {[["Management Fee", pct(fund.managementFee)], ["Incentive/Performance Fee", pct(fund.performanceFee)], ["Total Expense Ratio", pct(fund.expenseRatio)], ["Est. Total Cost", pct(analysis.fees.totalCostEstimate)], ["Net Return After Fees", pct(analysis.fees.netReturnAfterFees)]].map(([l, v]) => (
                    <div key={l} className="flex justify-between"><span className="text-muted-foreground">{l}</span><span className="font-medium">{v}</span></div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-sm">Repurchase Terms</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {[["Frequency", fund.repurchaseFrequency], ["Repurchase Limit", pct(fund.repurchaseRate)], ["Annual Liquidity Access", pct(analysis.liquidity.annualLiquidityAccess)], ["Notice Period", `${fund.repurchaseNotice || 30} days`]].map(([l, v]) => (
                    <div key={l} className="flex justify-between"><span className="text-muted-foreground">{l}</span><span className="font-medium">{v}</span></div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-sm">Investment Details</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {[["Min. Investment", fund.minInvestment ? `$${parseFloat(fund.minInvestment).toLocaleString()}` : "N/A"], ["Fund Structure", fund.fundStructure || "Interval Fund"], ["Fund Manager", fund.fundManager || "N/A"], ["Domicile", fund.fundDomicile || "N/A"]].map(([l, v]) => (
                    <div key={l} className="flex justify-between"><span className="text-muted-foreground">{l}</span><span className="font-medium">{v}</span></div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="risk" className="space-y-4">
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Shield className="h-4 w-4" /> Risk Metrics {ratingBadge(analysis.risk.riskRating)}</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {[["Volatility", pct(analysis.risk.volatility)], ["Sharpe Ratio", fmt(analysis.risk.sharpeRatio)], ["Sortino Ratio", fmt(analysis.risk.sortinoRatio)], ["Max Drawdown", pct(analysis.risk.maxDrawdown)], ["Beta", fmt(analysis.risk.beta)], ["Alpha", pct(analysis.risk.alpha)], ["Correlation", fmt(fund.correlation)]].map(([l, v]) => (
                    <div key={l} className="flex justify-between"><span className="text-muted-foreground">{l}</span><span className="font-medium">{v}</span></div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Target className="h-4 w-4" /> Portfolio Fit {ratingBadge(analysis.portfolioFit.suitabilityRating)}</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div><span className="text-muted-foreground">Diversification</span><div className="mt-0.5">{analysis.portfolioFit.diversificationBenefit}</div></div>
                  <div><span className="text-muted-foreground">Correlation</span><div className="mt-0.5">{analysis.portfolioFit.correlationAssessment}</div></div>
                  <div className="flex justify-between"><span className="text-muted-foreground"># Holdings</span><span>{fund.numHoldings || "N/A"}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Top Holdings %</span><span>{pct(fund.topHoldingsPct)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Leverage</span><span>{fmt(fund.leverageRatio)}x</span></div>
                </CardContent>
              </Card>
              {analysis.peerComparison && (
                <Card>
                  <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><ArrowUpDown className="h-4 w-4" /> Peer Ranking <Badge variant="outline">#{analysis.peerComparison.overallRank} of {analysis.peerComparison.totalPeers}</Badge></CardTitle></CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-4 gap-4 text-center text-sm">
                      <div><div className="font-bold">#{analysis.peerComparison.returnRank}</div><div className="text-xs text-muted-foreground">Return</div></div>
                      <div><div className="font-bold">#{analysis.peerComparison.riskRank}</div><div className="text-xs text-muted-foreground">Risk-Adj</div></div>
                      <div><div className="font-bold">#{analysis.peerComparison.feeRank}</div><div className="text-xs text-muted-foreground">Fees</div></div>
                      <div><div className="font-bold">#{analysis.peerComparison.liquidityRank}</div><div className="text-xs text-muted-foreground">Liquidity</div></div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        ) : null}
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Comparison Dialog ---

function ComparisonPanel({ fundIds, funds }: { fundIds: string[]; funds: IntervalFund[] }) {
  const selected = funds.filter((f) => fundIds.includes(f.id));
  if (selected.length < 2) return <p className="text-sm text-muted-foreground py-8 text-center">Select at least 2 funds to compare (up to 5).</p>;

  const rows: { label: string; key: string; fmt: (f: IntervalFund) => string }[] = [
    { label: "Asset Class", key: "assetClass", fmt: (f) => f.assetClass },
    { label: "Strategy", key: "strategyType", fmt: (f) => f.strategyType },
    { label: "NAV", key: "navPerShare", fmt: (f) => `$${parseFloat(f.navPerShare || "0").toFixed(2)}` },
    { label: "AUM", key: "totalAum", fmt: (f) => aumFmt(f.totalAum) },
    { label: "1Y Return", key: "nav1yrReturn", fmt: (f) => pct(f.nav1yrReturn) },
    { label: "3Y Return", key: "nav3yrReturn", fmt: (f) => pct(f.nav3yrReturn) },
    { label: "5Y Return", key: "nav5yrReturn", fmt: (f) => pct(f.nav5yrReturn) },
    { label: "Distribution", key: "distributionRate", fmt: (f) => pct(f.distributionRate) },
    { label: "Expense Ratio", key: "expenseRatio", fmt: (f) => pct(f.expenseRatio) },
    { label: "Mgmt Fee", key: "managementFee", fmt: (f) => pct(f.managementFee) },
    { label: "Perf Fee", key: "performanceFee", fmt: (f) => pct(f.performanceFee) },
    { label: "Sharpe", key: "sharpeRatio", fmt: (f) => fmt(f.sharpeRatio) },
    { label: "Volatility", key: "volatility", fmt: (f) => pct(f.volatility) },
    { label: "Max Drawdown", key: "maxDrawdown", fmt: (f) => pct(f.maxDrawdown) },
    { label: "Beta", key: "beta", fmt: (f) => fmt(f.beta) },
    { label: "Alpha", key: "alpha", fmt: (f) => pct(f.alpha) },
    { label: "Repurchase Freq.", key: "repurchaseFrequency", fmt: (f) => f.repurchaseFrequency },
    { label: "Repurchase Rate", key: "repurchaseRate", fmt: (f) => pct(f.repurchaseRate) },
    { label: "Notice Period", key: "repurchaseNotice", fmt: (f) => `${f.repurchaseNotice || 30}d` },
    { label: "Min Investment", key: "minInvestment", fmt: (f) => f.minInvestment ? `$${parseFloat(f.minInvestment).toLocaleString()}` : "N/A" },
    { label: "# Holdings", key: "numHoldings", fmt: (f) => String(f.numHoldings || "N/A") },
    { label: "Leverage", key: "leverageRatio", fmt: (f) => `${fmt(f.leverageRatio)}x` },
  ];

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 bg-background z-10 min-w-[140px]">Metric</TableHead>
            {selected.map((f) => <TableHead key={f.id} className="text-center min-w-[140px]"><div className="font-medium">{f.name}</div><div className="text-xs text-muted-foreground">{f.ticker}</div></TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell className="sticky left-0 bg-background z-10 font-medium text-sm">{r.label}</TableCell>
              {selected.map((f) => <TableCell key={f.id} className="text-center text-sm">{r.fmt(f)}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// --- Dashboard Tab ---

function DashboardTab({ onViewFund }: { onViewFund: (id: string) => void }) {
  const { data: statsData, isLoading } = useQuery<{ stats: DashboardStats | null }>({ queryKey: ["/api/interval-funds-stats"] });
  const stats = statsData?.stats;

  if (isLoading) return <div className="space-y-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  if (!stats) return <Card><CardContent className="py-12 text-center text-muted-foreground">No interval funds data available.</CardContent></Card>;

  const catData = Object.entries(stats.categoryBreakdown).map(([name, d], i) => ({ name, value: d.count, aum: d.totalAum, color: PIE_COLORS[i % PIE_COLORS.length] }));

  return (
    <div className="space-y-6">
      {/* Market Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: "Total Funds", value: String(stats.totalFunds), icon: Activity },
          { label: "Total AUM", value: aumFmt(String(stats.totalAum)), icon: DollarSign },
          { label: "Avg Expense", value: pct(stats.avgExpenseRatio), icon: Percent },
          { label: "Avg Yield", value: pct(stats.avgDistributionRate), icon: TrendingUp },
          { label: "Avg 1Y Return", value: pct(stats.avg1yrReturn), icon: BarChart3 },
          { label: "Avg Sharpe", value: fmt(stats.avgSharpeRatio), icon: Shield },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-1.5 mb-1"><s.icon className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-xs text-muted-foreground">{s.label}</span></div>
              <div className="text-xl font-bold">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Leaderboards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <LeaderboardCard title="Top 1Y Return" icon={TrendingUp} items={stats.topPerformers} valueKey="nav1yrReturn" formatter={pct} />
        <LeaderboardCard title="Highest Yield" icon={Percent} items={stats.highestYielding} valueKey="distributionRate" formatter={pct} />
        <LeaderboardCard title="Best Risk-Adj" icon={Award} items={stats.bestRiskAdjusted} valueKey="sharpeRatio" formatter={(v) => fmt(v)} />
        <LeaderboardCard title="Lowest Cost" icon={DollarSign} items={stats.lowestCost} valueKey="expenseRatio" formatter={pct} />
      </div>

      {/* Category Breakdown */}
      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><PieChart className="h-4 w-4" /> Category Breakdown</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row items-center gap-6">
            <div className="h-56 w-56">
              <ResponsiveContainer width="100%" height="100%">
                <RPieChart>
                  <Pie data={catData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${value}`}>
                    {catData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip />
                </RPieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 w-full">
              <Table>
                <TableHeader><TableRow><TableHead>Category</TableHead><TableHead className="text-center">Funds</TableHead><TableHead className="text-right">AUM</TableHead><TableHead className="text-right">Avg 1Y</TableHead></TableRow></TableHeader>
                <TableBody>
                  {Object.entries(stats.categoryBreakdown).map(([cat, d], i) => (
                    <TableRow key={cat}>
                      <TableCell className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />{cat}</TableCell>
                      <TableCell className="text-center">{d.count}</TableCell>
                      <TableCell className="text-right">{aumFmt(String(d.totalAum))}</TableCell>
                      <TableCell className="text-right">{pct(d.avgReturn)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// --- All Funds Tab ---

function AllFundsTab({ funds, onViewFund, compareIds, onToggleCompare }: {
  funds: IntervalFund[];
  onViewFund: (f: IntervalFund) => void;
  compareIds: string[];
  onToggleCompare: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [assetFilter, setAssetFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [minInvFilter, setMinInvFilter] = useState("all");
  const [sortField, setSortField] = useState<string>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const assetClasses = useMemo(() => Array.from(new Set(funds.map((f) => f.assetClass))).sort(), [funds]);

  const filtered = useMemo(() => {
    let list = funds;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((f) => f.name.toLowerCase().includes(q) || f.ticker?.toLowerCase().includes(q) || f.fundManager?.toLowerCase().includes(q) || f.assetClass.toLowerCase().includes(q));
    }
    if (assetFilter !== "all") list = list.filter((f) => f.assetClass === assetFilter);
    if (riskFilter !== "all") {
      if (riskFilter === "low") list = list.filter((f) => num(f.volatility) < 0.05);
      else if (riskFilter === "medium") list = list.filter((f) => num(f.volatility) >= 0.05 && num(f.volatility) < 0.08);
      else list = list.filter((f) => num(f.volatility) >= 0.08);
    }
    if (minInvFilter !== "all") {
      if (minInvFilter === "low") list = list.filter((f) => num(f.minInvestment) <= 2500);
      else if (minInvFilter === "mid") list = list.filter((f) => num(f.minInvestment) > 2500 && num(f.minInvestment) <= 25000);
      else list = list.filter((f) => num(f.minInvestment) > 25000);
    }
    return list;
  }, [funds, search, assetFilter, riskFilter, minInvFilter]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortField) {
        case "name": return dir * a.name.localeCompare(b.name);
        case "nav1yrReturn": return dir * (num(a.nav1yrReturn) - num(b.nav1yrReturn));
        case "distributionRate": return dir * (num(a.distributionRate) - num(b.distributionRate));
        case "sharpeRatio": return dir * (num(a.sharpeRatio) - num(b.sharpeRatio));
        case "totalAum": return dir * (num(a.totalAum) - num(b.totalAum));
        case "expenseRatio": return dir * (num(a.expenseRatio) - num(b.expenseRatio));
        default: return 0;
      }
    });
  }, [filtered, sortField, sortDir]);

  function toggleSort(field: string) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("desc"); }
  }

  function SH({ field, children }: { field: string; children: React.ReactNode }) {
    return <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort(field)}><div className="flex items-center gap-1">{children}{sortField === field && <ArrowUpDown className="h-3 w-3" />}</div></TableHead>;
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search funds..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={assetFilter} onValueChange={setAssetFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Asset Class" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Classes</SelectItem>{assetClasses.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={riskFilter} onValueChange={setRiskFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Risk Level" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Risk</SelectItem><SelectItem value="low">Low (&lt;5%)</SelectItem><SelectItem value="medium">Medium (5-8%)</SelectItem><SelectItem value="high">High (&gt;8%)</SelectItem></SelectContent>
        </Select>
        <Select value={minInvFilter} onValueChange={setMinInvFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Min Investment" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Any Min</SelectItem><SelectItem value="low">{"<= $2,500"}</SelectItem><SelectItem value="mid">$2.5K - $25K</SelectItem><SelectItem value="high">{"> $25,000"}</SelectItem></SelectContent>
        </Select>
      </div>

      <div className="text-xs text-muted-foreground">{sorted.length} fund{sorted.length !== 1 && "s"} shown</div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <SH field="name">Fund</SH>
                <TableHead>Class</TableHead>
                <SH field="totalAum">AUM</SH>
                <SH field="distributionRate">Yield</SH>
                <SH field="nav1yrReturn">1Y Return</SH>
                <SH field="sharpeRatio">Sharpe</SH>
                <SH field="expenseRatio">Expense</SH>
                <TableHead>Liquidity</TableHead>
                <TableHead className="text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((f) => (
                <TableRow key={f.id} className="cursor-pointer hover:bg-muted/50" onClick={() => onViewFund(f)}>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={compareIds.includes(f.id)} disabled={!compareIds.includes(f.id) && compareIds.length >= 5} onCheckedChange={() => onToggleCompare(f.id)} />
                  </TableCell>
                  <TableCell><div className="font-medium">{f.name}</div><div className="text-xs text-muted-foreground">{f.fundManager}{f.ticker && ` | ${f.ticker}`}</div></TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{f.assetClass}</Badge></TableCell>
                  <TableCell>{aumFmt(f.totalAum)}</TableCell>
                  <TableCell className="font-medium">{pct(f.distributionRate)}</TableCell>
                  <TableCell className={num(f.nav1yrReturn) >= 0 ? "text-green-600" : "text-red-600"}>{pct(f.nav1yrReturn)}</TableCell>
                  <TableCell>{fmt(f.sharpeRatio)}</TableCell>
                  <TableCell>{pct(f.expenseRatio)}</TableCell>
                  <TableCell><span className="text-xs">{f.repurchaseFrequency} / {pct(f.repurchaseRate)}</span></TableCell>
                  <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" onClick={() => onViewFund(f)}><Eye className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {sorted.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">No funds match your filters.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// --- Analysis Tab ---

function AnalysisTab() {
  const { data, isLoading } = useQuery<{ analyses: AnalysisResult[] }>({ queryKey: ["/api/interval-funds-compare"] });
  const [rankBy, setRankBy] = useState("overallScore");
  const analyses = data?.analyses || [];

  const sortedAnalyses = useMemo(() => {
    return [...analyses].sort((a, b) => {
      switch (rankBy) {
        case "overallScore": return b.overallScore - a.overallScore;
        case "return": return b.yield.nav1yrReturn - a.yield.nav1yrReturn;
        case "sharpe": return b.risk.riskScore - a.risk.riskScore;
        case "yield": return b.yield.incomeScore - a.yield.incomeScore;
        case "fees": return b.fees.feeScore - a.fees.feeScore;
        case "liquidity": return b.liquidity.liquidityScore - a.liquidity.liquidityScore;
        default: return 0;
      }
    });
  }, [analyses, rankBy]);

  if (isLoading) return <div className="space-y-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  if (analyses.length === 0) return <Card><CardContent className="py-12 text-center text-muted-foreground">No funds available for analysis.</CardContent></Card>;

  const barData = sortedAnalyses.map((a) => ({
    name: a.fundName.length > 18 ? a.fundName.slice(0, 18) + "..." : a.fundName,
    fullName: a.fundName,
    Liquidity: a.liquidity.liquidityScore,
    Fees: a.fees.feeScore,
    Income: a.yield.incomeScore,
    Risk: a.risk.riskScore,
    Fit: a.portfolioFit.suitabilityScore,
  }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Multi-Factor Comparison</CardTitle>
            <CardDescription className="text-xs">Side-by-side scoring (1-10 scale)</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" domain={[0, 10]} />
                <YAxis dataKey="name" type="category" width={150} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number, name: string) => [v.toFixed(1), name]} labelFormatter={(l: string) => barData.find((d) => d.name === l)?.fullName || l} />
                <Legend />
                <Bar dataKey="Liquidity" fill="hsl(var(--chart-1))" />
                <Bar dataKey="Fees" fill="hsl(var(--chart-2))" />
                <Bar dataKey="Income" fill="hsl(var(--chart-3))" />
                <Bar dataKey="Risk" fill="hsl(var(--chart-4))" />
                <Bar dataKey="Fit" fill="hsl(var(--chart-5))" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Fund Rankings</CardTitle>
            <Select value={rankBy} onValueChange={setRankBy}>
              <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="overallScore">Overall Score</SelectItem>
                <SelectItem value="return">1Y Return</SelectItem>
                <SelectItem value="sharpe">Risk-Adjusted</SelectItem>
                <SelectItem value="yield">Income/Yield</SelectItem>
                <SelectItem value="fees">Fee Efficiency</SelectItem>
                <SelectItem value="liquidity">Liquidity</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>#</TableHead><TableHead>Fund</TableHead>
              <TableHead className="text-center">Score</TableHead><TableHead className="text-center">Rating</TableHead>
              <TableHead className="text-center">Liq</TableHead><TableHead className="text-center">Fee</TableHead>
              <TableHead className="text-center">Inc</TableHead><TableHead className="text-center">Risk</TableHead>
              <TableHead className="text-center">Fit</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {sortedAnalyses.map((a, i) => (
                <TableRow key={a.fundId}>
                  <TableCell className="font-medium">#{i + 1}</TableCell>
                  <TableCell><div className="font-medium">{a.fundName}</div></TableCell>
                  <TableCell className="text-center"><span className={`font-bold ${scoreColor(a.overallScore)}`}>{a.overallScore}</span></TableCell>
                  <TableCell className="text-center">{ratingBadge(a.overallRating)}</TableCell>
                  <TableCell className="text-center">{a.liquidity.liquidityScore.toFixed(1)}</TableCell>
                  <TableCell className="text-center">{a.fees.feeScore.toFixed(1)}</TableCell>
                  <TableCell className="text-center">{a.yield.incomeScore.toFixed(1)}</TableCell>
                  <TableCell className="text-center">{a.risk.riskScore.toFixed(1)}</TableCell>
                  <TableCell className="text-center">{a.portfolioFit.suitabilityScore.toFixed(1)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// --- Data Quality Tab ---

function DataQualityTab() {
  const { data, isLoading } = useQuery<{ report: DataQualityReport }>({ queryKey: ["/api/interval-funds-data-quality"] });
  if (isLoading) return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /></div>;
  const report = data?.report;
  if (!report) return null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card><CardContent className="pt-4 pb-3"><div className="text-xs text-muted-foreground">Overall Score</div><div className={`text-2xl font-bold ${scoreColor(report.overallScore)}`}>{report.overallScore}/100</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><div className="text-xs text-muted-foreground">Total Funds</div><div className="text-2xl font-bold">{report.totalFunds}</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><div className="text-xs text-muted-foreground flex items-center gap-1"><CheckCircle className="h-3 w-3 text-green-500" />Clean</div><div className="text-2xl font-bold text-green-600">{report.cleanFunds}</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><div className="text-xs text-muted-foreground flex items-center gap-1"><AlertCircle className="h-3 w-3 text-yellow-500" />Warning</div><div className="text-2xl font-bold text-yellow-600">{report.warningFunds}</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><div className="text-xs text-muted-foreground flex items-center gap-1"><XCircle className="h-3 w-3 text-red-500" />Conflict</div><div className="text-2xl font-bold text-red-600">{report.conflictFunds}</div></CardContent></Card>
      </div>

      {report.commonIssues.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Common Issues</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {report.commonIssues.map((ci, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span>{ci.issue}</span>
                  <Badge variant="outline">{ci.count} fund{ci.count > 1 && "s"}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Fund-Level Validation</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Fund</TableHead><TableHead className="text-center">Status</TableHead><TableHead className="text-center">Score</TableHead><TableHead>Issues</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {report.fundResults.map((fr) => (
                <TableRow key={fr.fundId}>
                  <TableCell className="font-medium">{fr.fundName}</TableCell>
                  <TableCell className="text-center">{statusBadge(fr.status)}</TableCell>
                  <TableCell className="text-center"><span className={`font-bold ${scoreColor(fr.validationScore)}`}>{fr.validationScore}</span></TableCell>
                  <TableCell>
                    {fr.recommendations.length > 0 ? (
                      <ul className="text-xs space-y-0.5">
                        {fr.recommendations.slice(0, 2).map((r, i) => <li key={i} className="text-muted-foreground">{r}</li>)}
                        {fr.recommendations.length > 2 && <li className="text-muted-foreground">+{fr.recommendations.length - 2} more</li>}
                      </ul>
                    ) : <span className="text-xs text-muted-foreground">-</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// --- Universe Search Types ---

interface ExternalFundResult {
  source: string;
  ticker: string | null;
  name: string;
  fundManager: string | null;
  assetClass: string | null;
  strategyType: string | null;
  totalAum: number | null;
  navPerShare: number | null;
  expenseRatio: number | null;
  managementFee: number | null;
  performanceFee: number | null;
  distributionRate: number | null;
  distributionFrequency: string | null;
  minInvestment: number | null;
  repurchaseFrequency: string | null;
  repurchaseRate: number | null;
  repurchaseNotice: number | null;
  fundStructure: string | null;
  nav30dReturn: number | null;
  nav90dReturn: number | null;
  navYtdReturn: number | null;
  nav1yrReturn: number | null;
  nav3yrReturn: number | null;
  nav5yrReturn: number | null;
  inceptionReturn: number | null;
  volatility: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  maxDrawdown: number | null;
  beta: number | null;
  alpha: number | null;
  correlation: number | null;
  inceptionDate: string | null;
  description: string | null;
  cik: string | null;
  cusip: string | null;
  isin: string | null;
  figi: string | null;
  raw: Record<string, any>;
}

interface FieldAgreement {
  field: string;
  values: { source: string; value: any }[];
  agreed: boolean;
  selectedValue: any;
  selectedSource: string;
}

interface DataConflict {
  field: string;
  values: { source: string; value: any }[];
  resolution: string;
  resolvedValue: any;
}

interface ReconciliationReport {
  matchedSources: number;
  totalSources: number;
  fieldAgreements: FieldAgreement[];
  overallConfidence: number;
  conflicts: DataConflict[];
  selectedValues: Record<string, { value: any; source: string; confidence: number }>;
}

interface ReconciledFund {
  ticker: string | null;
  name: string;
  fundManager: string | null;
  assetClass: string;
  strategyType: string;
  totalAum: number | null;
  navPerShare: number | null;
  expenseRatio: number | null;
  managementFee: number | null;
  performanceFee: number | null;
  distributionRate: number | null;
  distributionFrequency: string | null;
  minInvestment: number | null;
  repurchaseFrequency: string | null;
  repurchaseRate: number | null;
  repurchaseNotice: number | null;
  fundStructure: string | null;
  nav30dReturn: number | null;
  nav90dReturn: number | null;
  navYtdReturn: number | null;
  nav1yrReturn: number | null;
  nav3yrReturn: number | null;
  nav5yrReturn: number | null;
  inceptionReturn: number | null;
  volatility: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  maxDrawdown: number | null;
  beta: number | null;
  alpha: number | null;
  correlation: number | null;
  inceptionDate: string | null;
  description: string | null;
  sources: ExternalFundResult[];
  reconciliation: ReconciliationReport;
  confidence: number;
}

interface SourceStatus {
  source: string;
  status: "success" | "error" | "no_results";
  count: number;
  responseTime: number;
}

interface UniverseSearchResult {
  results: ExternalFundResult[];
  reconciled: ReconciledFund[];
  sourceStatus: SourceStatus[];
}

// --- Universe Search Tab ---

function UniverseSearchTab() {
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UniverseSearchResult | null>(null);
  const [expandedFund, setExpandedFund] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const { toast } = useToast();

  const searchMutation = useMutation({
    mutationFn: async (q: string) => {
      const res = await fetch(`/api/interval-funds-universe/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error("Search failed");
      return res.json() as Promise<UniverseSearchResult>;
    },
    onSuccess: (data) => setSearchResults(data),
    onError: () => toast({ title: "Search failed", description: "Could not reach data sources. Please try again.", variant: "destructive" }),
  });

  const importMutation = useMutation({
    mutationFn: async (fund: ReconciledFund) => {
      const res = await apiRequest("POST", "/api/interval-funds-universe/import", { fund });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Fund imported", description: `${data.fund?.name || "Fund"} has been added to your database.` });
      queryClient.invalidateQueries({ queryKey: ["/api/interval-funds"] });
      queryClient.invalidateQueries({ queryKey: ["/api/interval-funds-stats"] });
      setImporting(null);
    },
    onError: (err: any) => {
      const msg = err?.message || "Import failed";
      toast({ title: "Import failed", description: msg.includes("already exists") ? msg : "Could not import this fund.", variant: "destructive" });
      setImporting(null);
    },
  });

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length < 2) return;
    searchMutation.mutate(query.trim());
  }

  function handleImport(fund: ReconciledFund) {
    setImporting(fund.name);
    importMutation.mutate(fund);
  }

  const sourceColors: Record<string, string> = {
    "SEC EDGAR (Filing Search)": "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    "SEC EDGAR (Full-Text)": "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400",
    "SEC EDGAR": "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    "Alpha Vantage": "bg-green-500/15 text-green-700 dark:text-green-400",
    "OpenFIGI": "bg-purple-500/15 text-purple-700 dark:text-purple-400",
    "Known Universe": "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><Globe className="h-4 w-4" />Search Interval Fund Universe</CardTitle>
          <CardDescription>Search across SEC EDGAR, Alpha Vantage, OpenFIGI, and known interval fund databases. Results are cross-referenced and reconciled for data accuracy.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="flex gap-2" data-testid="form-universe-search">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by fund name, ticker, or strategy (e.g., PIMCO, BREIT, private credit)..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
                data-testid="input-universe-search"
              />
            </div>
            <Button type="submit" disabled={searchMutation.isPending || query.trim().length < 2} data-testid="button-universe-search">
              {searchMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Searching...</> : <><Search className="h-4 w-4 mr-2" />Search</>}
            </Button>
          </form>

          {searchMutation.isPending && (
            <div className="mt-6 space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span>Querying multiple data sources... This may take 10-15 seconds due to API rate limits.</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {["SEC EDGAR (Filing Search)", "SEC EDGAR (Full-Text)", "Alpha Vantage", "OpenFIGI", "Known Universe"].map((s) => (
                  <div key={s} className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span className="text-xs truncate">{s}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {searchResults && !searchMutation.isPending && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2"><Database className="h-4 w-4" />Data Sources Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {searchResults.sourceStatus.map((s) => (
                  <div key={s.source} className="p-3 rounded-md border space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-medium truncate">{s.source}</span>
                      {s.status === "success" ? <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" /> : s.status === "error" ? <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />}
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{s.count} result{s.count !== 1 ? "s" : ""}</span>
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{(s.responseTime / 1000).toFixed(1)}s</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                {searchResults.results.length} total results across {searchResults.sourceStatus.filter(s => s.status === "success").length} sources, reconciled into {searchResults.reconciled.length} unique fund{searchResults.reconciled.length !== 1 ? "s" : ""}
              </div>
            </CardContent>
          </Card>

          {searchResults.reconciled.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">No interval funds found matching your search. Try different keywords or a ticker symbol.</CardContent></Card>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">{searchResults.reconciled.length} Reconciled Fund{searchResults.reconciled.length !== 1 ? "s" : ""}</h3>
                <Badge variant="outline" className="text-xs">Sorted by confidence</Badge>
              </div>

              {searchResults.reconciled.map((fund, idx) => {
                const expanded = expandedFund === `${idx}-${fund.name}`;
                const confidenceColor = fund.confidence >= 80 ? "text-green-600 dark:text-green-400" : fund.confidence >= 60 ? "text-yellow-600 dark:text-yellow-400" : "text-orange-600 dark:text-orange-400";

                return (
                  <Card key={`${idx}-${fund.name}`} data-testid={`card-reconciled-fund-${idx}`}>
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">{fund.name}</span>
                            {fund.ticker && <Badge variant="outline" className="font-mono text-xs">{fund.ticker}</Badge>}
                            <Badge className={fund.confidence >= 80 ? "bg-green-500/15 text-green-700 dark:text-green-400" : fund.confidence >= 60 ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400" : "bg-orange-500/15 text-orange-700 dark:text-orange-400"}>
                              <ShieldCheck className="h-3 w-3 mr-1" />{fund.confidence.toFixed(0)}% confidence
                            </Badge>
                          </div>

                          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                            {fund.assetClass && <span>{fund.assetClass}</span>}
                            {fund.strategyType && <span>{fund.strategyType}</span>}
                            {fund.fundManager && <span>{fund.fundManager}</span>}
                          </div>

                          <div className="flex items-center gap-1 flex-wrap">
                            <span className="text-xs text-muted-foreground mr-1">Sources:</span>
                            {fund.sources.map((s, si) => (
                              <Badge key={si} variant="outline" className={`text-xs ${sourceColors[s.source] || ""}`}>{s.source}</Badge>
                            ))}
                          </div>

                          {fund.description && (
                            <p className="text-xs text-muted-foreground line-clamp-2">{fund.description}</p>
                          )}

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs">
                            {fund.totalAum != null && <div><span className="text-muted-foreground">AUM:</span> <span className="font-medium">{fund.totalAum >= 1e9 ? `$${(fund.totalAum / 1e9).toFixed(1)}B` : fund.totalAum >= 1e6 ? `$${(fund.totalAum / 1e6).toFixed(0)}M` : `$${fund.totalAum.toLocaleString()}`}</span></div>}
                            {fund.expenseRatio != null && <div><span className="text-muted-foreground">Expense:</span> <span className="font-medium">{(fund.expenseRatio * 100).toFixed(2)}%</span></div>}
                            {fund.distributionRate != null && <div><span className="text-muted-foreground">Distribution:</span> <span className="font-medium">{(fund.distributionRate * 100).toFixed(2)}%</span></div>}
                            {fund.nav1yrReturn != null && <div><span className="text-muted-foreground">1Y Return:</span> <span className="font-medium">{(fund.nav1yrReturn * 100).toFixed(2)}%</span></div>}
                            {fund.beta != null && <div><span className="text-muted-foreground">Beta:</span> <span className="font-medium">{fund.beta.toFixed(2)}</span></div>}
                            {fund.volatility != null && <div><span className="text-muted-foreground">Volatility:</span> <span className="font-medium">{(fund.volatility * 100).toFixed(1)}%</span></div>}
                            {fund.sharpeRatio != null && <div><span className="text-muted-foreground">Sharpe:</span> <span className="font-medium">{fund.sharpeRatio.toFixed(2)}</span></div>}
                            {fund.maxDrawdown != null && <div><span className="text-muted-foreground">Max DD:</span> <span className="font-medium">{(fund.maxDrawdown * 100).toFixed(1)}%</span></div>}
                          </div>

                          {fund.reconciliation.conflicts.length > 0 && (
                            <div className="flex items-center gap-1 text-xs">
                              <AlertTriangle className="h-3 w-3 text-yellow-500" />
                              <span className="text-yellow-600 dark:text-yellow-400">{fund.reconciliation.conflicts.length} data conflict{fund.reconciliation.conflicts.length !== 1 ? "s" : ""} resolved</span>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-col gap-2 shrink-0">
                          <Button
                            size="sm"
                            onClick={() => handleImport(fund)}
                            disabled={importMutation.isPending && importing === fund.name}
                            data-testid={`button-import-fund-${idx}`}
                          >
                            {importMutation.isPending && importing === fund.name
                              ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Importing</>
                              : <><Download className="h-3.5 w-3.5 mr-1" />Import</>}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setExpandedFund(expanded ? null : `${idx}-${fund.name}`)}
                            data-testid={`button-details-fund-${idx}`}
                          >
                            <Eye className="h-3.5 w-3.5 mr-1" />{expanded ? "Hide" : "Details"}
                          </Button>
                        </div>
                      </div>

                      {expanded && (
                        <div className="mt-4 space-y-4 border-t pt-4">
                          <div>
                            <h4 className="text-xs font-semibold mb-2 flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" />Reconciliation Report</h4>
                            <div className="grid grid-cols-3 gap-3 mb-3">
                              <div className="p-2 rounded-md bg-muted/50 text-center">
                                <div className={`text-lg font-bold ${confidenceColor}`}>{fund.reconciliation.overallConfidence.toFixed(0)}%</div>
                                <div className="text-xs text-muted-foreground">Confidence</div>
                              </div>
                              <div className="p-2 rounded-md bg-muted/50 text-center">
                                <div className="text-lg font-bold">{fund.reconciliation.matchedSources}</div>
                                <div className="text-xs text-muted-foreground">Sources</div>
                              </div>
                              <div className="p-2 rounded-md bg-muted/50 text-center">
                                <div className="text-lg font-bold">{fund.reconciliation.conflicts.length}</div>
                                <div className="text-xs text-muted-foreground">Conflicts</div>
                              </div>
                            </div>
                          </div>

                          <div>
                            <h4 className="text-xs font-semibold mb-2">Field-by-Field Verification</h4>
                            <div className="overflow-x-auto">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="text-xs">Field</TableHead>
                                    <TableHead className="text-xs">Status</TableHead>
                                    <TableHead className="text-xs">Selected Value</TableHead>
                                    <TableHead className="text-xs">Source</TableHead>
                                    <TableHead className="text-xs">All Values</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {fund.reconciliation.fieldAgreements.filter(f => f.values.length > 0).map((fa) => (
                                    <TableRow key={fa.field}>
                                      <TableCell className="text-xs font-medium capitalize">{fa.field.replace(/([A-Z])/g, " $1").trim()}</TableCell>
                                      <TableCell>
                                        {fa.agreed
                                          ? <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 text-xs">Agreed</Badge>
                                          : <Badge className="bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 text-xs">Conflict</Badge>}
                                      </TableCell>
                                      <TableCell className="text-xs font-mono max-w-[200px] truncate">
                                        {fa.selectedValue != null ? String(fa.selectedValue) : "N/A"}
                                      </TableCell>
                                      <TableCell>
                                        <Badge variant="outline" className={`text-xs ${sourceColors[fa.selectedSource] || ""}`}>{fa.selectedSource}</Badge>
                                      </TableCell>
                                      <TableCell className="text-xs">
                                        <div className="space-y-0.5">
                                          {fa.values.map((v, vi) => (
                                            <div key={vi} className="flex items-center gap-1">
                                              <span className="text-muted-foreground">{v.source}:</span>
                                              <span className="font-mono truncate max-w-[120px]">{v.value != null ? String(v.value) : "N/A"}</span>
                                            </div>
                                          ))}
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </div>

                          {fund.reconciliation.conflicts.length > 0 && (
                            <div>
                              <h4 className="text-xs font-semibold mb-2 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />Data Conflicts & Resolutions</h4>
                              <div className="space-y-2">
                                {fund.reconciliation.conflicts.map((c, ci) => (
                                  <div key={ci} className="p-3 rounded-md border border-yellow-500/20 bg-yellow-500/5 space-y-1">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-medium capitalize">{c.field.replace(/([A-Z])/g, " $1").trim()}</span>
                                      <Badge className="bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 text-xs">Resolved</Badge>
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {c.values.map(v => `${v.source}: ${v.value}`).join(" vs ")}
                                    </div>
                                    <div className="text-xs">
                                      <span className="text-muted-foreground">Resolution:</span> {c.resolution} (value: <span className="font-mono">{String(c.resolvedValue)}</span>)
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <div>
                            <h4 className="text-xs font-semibold mb-2">Raw Source Data</h4>
                            <div className="space-y-2">
                              {fund.sources.map((s, si) => (
                                <details key={si} className="group">
                                  <summary className="cursor-pointer text-xs flex items-center gap-2 p-2 rounded-md hover-elevate">
                                    <ExternalLink className="h-3 w-3" />
                                    <Badge variant="outline" className={`text-xs ${sourceColors[s.source] || ""}`}>{s.source}</Badge>
                                    <span className="text-muted-foreground">{s.name}</span>
                                  </summary>
                                  <pre className="mt-1 p-3 rounded-md bg-muted/50 text-xs overflow-x-auto max-h-48 whitespace-pre-wrap">{JSON.stringify(s.raw, null, 2)}</pre>
                                </details>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {!searchResults && !searchMutation.isPending && (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <Globe className="h-12 w-12 mx-auto text-muted-foreground/50" />
            <div>
              <h3 className="font-medium mb-1">Search the Interval Fund Universe</h3>
              <p className="text-sm text-muted-foreground max-w-lg mx-auto">
                Search across 5 data sources simultaneously. Results are automatically cross-referenced
                and reconciled, with conflicts flagged and resolved using source priority rankings.
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 max-w-2xl mx-auto">
              {[
                { name: "SEC EDGAR Filings", desc: "Official SEC fund filings" },
                { name: "SEC EDGAR Full-Text", desc: "Full-text document search" },
                { name: "Alpha Vantage", desc: "Market data & overviews" },
                { name: "OpenFIGI", desc: "Financial instrument IDs" },
                { name: "Known Universe", desc: "Curated fund database" },
              ].map((s) => (
                <div key={s.name} className="p-3 rounded-md border text-center space-y-1">
                  <Database className="h-4 w-4 mx-auto text-muted-foreground" />
                  <div className="text-xs font-medium">{s.name}</div>
                  <div className="text-xs text-muted-foreground">{s.desc}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// --- Main Page ---

export default function IntervalFundsPage() {
  const [selectedFund, setSelectedFund] = useState<IntervalFund | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);

  const { data, isLoading } = useQuery<{ funds: IntervalFund[] }>({ queryKey: ["/api/interval-funds"] });
  const funds = data?.funds || [];

  function toggleCompare(id: string) {
    setCompareIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 5 ? [...prev, id] : prev);
  }

  function viewFundById(id: string) {
    const f = funds.find((x) => x.id === id);
    if (f) setSelectedFund(f);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Droplets className="h-6 w-6" />Interval Funds Analyzer</h1>
          <p className="text-muted-foreground mt-1">Comprehensive analysis of interval fund liquidity, fees, yields, risk, and data quality</p>
        </div>
        <Badge variant="outline" className="text-sm">{funds.length} Funds</Badge>
      </div>

      <Tabs defaultValue="dashboard">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="funds">All Funds</TabsTrigger>
          <TabsTrigger value="compare" className="flex items-center gap-1">
            Compare{compareIds.length > 0 && <Badge className="ml-1 h-5 w-5 p-0 text-xs justify-center">{compareIds.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="analysis">Analysis</TabsTrigger>
          <TabsTrigger value="quality">Data Quality</TabsTrigger>
          <TabsTrigger value="universe" className="flex items-center gap-1" data-testid="tab-universe-search">
            <Globe className="h-3.5 w-3.5" />Universe Search
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard"><DashboardTab onViewFund={viewFundById} /></TabsContent>

        <TabsContent value="funds">
          {isLoading ? <div className="space-y-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
            : <AllFundsTab funds={funds} onViewFund={setSelectedFund} compareIds={compareIds} onToggleCompare={toggleCompare} />}
        </TabsContent>

        <TabsContent value="compare">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2"><GitCompare className="h-4 w-4" />Fund Comparison</CardTitle>
                {compareIds.length > 0 && <Button variant="outline" size="sm" onClick={() => setCompareIds([])}>Clear All</Button>}
              </div>
              <CardDescription>Select funds from the All Funds tab (up to 5) to compare side-by-side.</CardDescription>
            </CardHeader>
            <CardContent>
              <ComparisonPanel fundIds={compareIds} funds={funds} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analysis"><AnalysisTab /></TabsContent>
        <TabsContent value="quality"><DataQualityTab /></TabsContent>
        <TabsContent value="universe"><UniverseSearchTab /></TabsContent>
      </Tabs>

      {selectedFund && <FundDetailsDialog fund={selectedFund} open={!!selectedFund} onClose={() => setSelectedFund(null)} />}
    </div>
  );
}
