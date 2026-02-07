import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
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
} from "recharts";

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
}

interface AnalysisResult {
  fundId: string;
  fundName: string;
  overallScore: number;
  overallRating: string;
  liquidity: {
    repurchaseFrequency: string;
    repurchaseRate: number;
    annualLiquidityAccess: number;
    repurchaseNotice: number;
    liquidityScore: number;
    liquidityRating: string;
  };
  fees: {
    managementFee: number;
    performanceFee: number;
    expenseRatio: number;
    totalCostEstimate: number;
    feeScore: number;
    feeRating: string;
    netReturnAfterFees: number;
  };
  yield: {
    distributionRate: number;
    distributionFrequency: string;
    nav1yrReturn: number;
    yieldVsRiskFree: number;
    yieldSpread: number;
    incomeScore: number;
    incomeRating: string;
  };
  risk: {
    volatility: number;
    sharpeRatio: number;
    sortinoRatio: number;
    maxDrawdown: number;
    beta: number;
    alpha: number;
    riskScore: number;
    riskRating: string;
  };
  portfolioFit: {
    concentrationRisk: number;
    diversificationBenefit: string;
    correlationAssessment: string;
    suitabilityScore: number;
    suitabilityRating: string;
  };
  peerComparison: {
    fundName: string;
    returnRank: number;
    riskRank: number;
    feeRank: number;
    liquidityRank: number;
    overallRank: number;
    totalPeers: number;
  } | null;
  strengths: string[];
  risks: string[];
  recommendation: string;
}

type SortField = "name" | "distributionRate" | "nav1yrReturn" | "sharpeRatio" | "totalAum" | "expenseRatio";
type SortDirection = "asc" | "desc";

function pct(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "N/A";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return "N/A";
  return `${(n * 100).toFixed(2)}%`;
}

function fmt(val: string | number | null | undefined, decimals = 2): string {
  if (val === null || val === undefined) return "N/A";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return "N/A";
  return n.toFixed(decimals);
}

function aumFmt(val: string | null | undefined): string {
  if (!val) return "N/A";
  const n = parseFloat(val);
  if (isNaN(n)) return "N/A";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toLocaleString()}`;
}

function ratingBadge(rating: string) {
  const colors: Record<string, string> = {
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
  return (
    <Badge className={colors[rating] || "bg-muted text-muted-foreground"}>
      {rating}
    </Badge>
  );
}

function scoreColor(score: number): string {
  if (score >= 80) return "text-green-600 dark:text-green-400";
  if (score >= 65) return "text-blue-600 dark:text-blue-400";
  if (score >= 50) return "text-yellow-600 dark:text-yellow-400";
  if (score >= 35) return "text-orange-600 dark:text-orange-400";
  return "text-red-600 dark:text-red-400";
}

function ScoreGauge({ score, label }: { score: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`text-2xl font-bold ${scoreColor(score)}`}>{score}</div>
      <Progress value={score} className="h-2 w-full" />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function AnalysisDialog({ fund, open, onClose }: { fund: IntervalFund; open: boolean; onClose: () => void }) {
  const { data, isLoading } = useQuery<{ analysis: AnalysisResult }>({
    queryKey: [`/api/interval-funds/${fund.id}/analyze`],
    enabled: open,
  });

  const analysis = data?.analysis;

  const radarData = analysis
    ? [
        { metric: "Liquidity", score: analysis.liquidity.liquidityScore },
        { metric: "Fees", score: analysis.fees.feeScore },
        { metric: "Income", score: analysis.yield.incomeScore },
        { metric: "Risk-Adj", score: analysis.risk.riskScore },
        { metric: "Portfolio Fit", score: analysis.portfolioFit.suitabilityScore },
      ]
    : [];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            {fund.name} - Fund Analysis
          </DialogTitle>
          <DialogDescription>
            {fund.ticker && <Badge variant="outline" className="mr-2">{fund.ticker}</Badge>}
            {fund.strategyType} | {fund.assetClass}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {analysis && (
          <div className="space-y-6">
            {/* Overall Score */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center">
                    <div className={`text-4xl font-bold ${scoreColor(analysis.overallScore)}`}>
                      {analysis.overallScore}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">Overall Score</div>
                    <div className="mt-2">{ratingBadge(analysis.overallRating)}</div>
                  </div>
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

            {/* Radar Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Multi-Factor Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData}>
                      <PolarGrid />
                      <PolarAngleAxis dataKey="metric" tick={{ fontSize: 12 }} />
                      <PolarRadiusAxis domain={[0, 10]} tick={{ fontSize: 10 }} />
                      <Radar
                        dataKey="score"
                        stroke="hsl(var(--chart-1))"
                        fill="hsl(var(--chart-1))"
                        fillOpacity={0.3}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Analysis Details Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Liquidity */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Droplets className="h-4 w-4" /> Liquidity Profile
                    {ratingBadge(analysis.liquidity.liquidityRating)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Repurchase Frequency</span>
                    <span>{analysis.liquidity.repurchaseFrequency}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Repurchase Rate</span>
                    <span>{(analysis.liquidity.repurchaseRate * 100).toFixed(0)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Annual Liquidity Access</span>
                    <span>{(analysis.liquidity.annualLiquidityAccess * 100).toFixed(0)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Notice Period</span>
                    <span>{analysis.liquidity.repurchaseNotice} days</span>
                  </div>
                </CardContent>
              </Card>

              {/* Fees */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <DollarSign className="h-4 w-4" /> Fee Analysis
                    {ratingBadge(analysis.fees.feeRating)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Management Fee</span>
                    <span>{(analysis.fees.managementFee * 100).toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Performance Fee</span>
                    <span>{(analysis.fees.performanceFee * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Expense Ratio</span>
                    <span>{(analysis.fees.expenseRatio * 100).toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Est. Total Cost</span>
                    <span>{(analysis.fees.totalCostEstimate * 100).toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between font-medium">
                    <span className="text-muted-foreground">Net Return After Fees</span>
                    <span className={analysis.fees.netReturnAfterFees >= 0 ? "text-green-600" : "text-red-600"}>
                      {(analysis.fees.netReturnAfterFees * 100).toFixed(2)}%
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* Yield */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Percent className="h-4 w-4" /> Income & Yield
                    {ratingBadge(analysis.yield.incomeRating)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Distribution Rate</span>
                    <span>{(analysis.yield.distributionRate * 100).toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Distribution Freq.</span>
                    <span>{analysis.yield.distributionFrequency}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">1-Year NAV Return</span>
                    <span>{(analysis.yield.nav1yrReturn * 100).toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Yield Spread vs Risk-Free</span>
                    <span className={analysis.yield.yieldVsRiskFree >= 0 ? "text-green-600" : "text-red-600"}>
                      {(analysis.yield.yieldVsRiskFree * 100).toFixed(2)}%
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* Risk */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Shield className="h-4 w-4" /> Risk Profile
                    {ratingBadge(analysis.risk.riskRating)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Volatility</span>
                    <span>{(analysis.risk.volatility * 100).toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Sharpe Ratio</span>
                    <span>{analysis.risk.sharpeRatio.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Sortino Ratio</span>
                    <span>{analysis.risk.sortinoRatio.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Max Drawdown</span>
                    <span className="text-red-600">{(analysis.risk.maxDrawdown * 100).toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Beta</span>
                    <span>{analysis.risk.beta.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Alpha</span>
                    <span className={analysis.risk.alpha >= 0 ? "text-green-600" : "text-red-600"}>
                      {(analysis.risk.alpha * 100).toFixed(2)}%
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Portfolio Fit */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target className="h-4 w-4" /> Portfolio Fit Assessment
                  {ratingBadge(analysis.portfolioFit.suitabilityRating)}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Diversification Benefit</span>
                  <span className="text-right max-w-xs">{analysis.portfolioFit.diversificationBenefit}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Correlation Assessment</span>
                  <span className="text-right max-w-xs">{analysis.portfolioFit.correlationAssessment}</span>
                </div>
              </CardContent>
            </Card>

            {/* Peer Comparison */}
            {analysis.peerComparison && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ArrowUpDown className="h-4 w-4" /> Peer Ranking
                    <Badge variant="outline">
                      #{analysis.peerComparison.overallRank} of {analysis.peerComparison.totalPeers}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 gap-4 text-center text-sm">
                    <div>
                      <div className="font-bold">#{analysis.peerComparison.returnRank}</div>
                      <div className="text-xs text-muted-foreground">Return</div>
                    </div>
                    <div>
                      <div className="font-bold">#{analysis.peerComparison.riskRank}</div>
                      <div className="text-xs text-muted-foreground">Risk-Adj</div>
                    </div>
                    <div>
                      <div className="font-bold">#{analysis.peerComparison.feeRank}</div>
                      <div className="text-xs text-muted-foreground">Fees</div>
                    </div>
                    <div>
                      <div className="font-bold">#{analysis.peerComparison.liquidityRank}</div>
                      <div className="text-xs text-muted-foreground">Liquidity</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Strengths & Risks */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" /> Strengths
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm">
                    {analysis.strengths.length > 0 ? (
                      analysis.strengths.map((s, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <CheckCircle className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />
                          <span>{s}</span>
                        </li>
                      ))
                    ) : (
                      <li className="text-muted-foreground">No notable strengths identified</li>
                    )}
                  </ul>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-orange-600" /> Risks
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm">
                    {analysis.risks.length > 0 ? (
                      analysis.risks.map((r, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <XCircle className="h-3 w-3 text-orange-500 mt-0.5 shrink-0" />
                          <span>{r}</span>
                        </li>
                      ))
                    ) : (
                      <li className="text-muted-foreground">No significant risks identified</li>
                    )}
                  </ul>
                </CardContent>
              </Card>
            </div>

            {/* Recommendation */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Recommendation</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{analysis.recommendation}</p>
              </CardContent>
            </Card>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompareView() {
  const { data, isLoading } = useQuery<{ analyses: AnalysisResult[] }>({
    queryKey: ["/api/interval-funds-compare"],
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  const analyses = data?.analyses || [];

  if (analyses.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No interval funds available for comparison. Add funds to get started.
        </CardContent>
      </Card>
    );
  }

  const sortedByScore = [...analyses].sort((a, b) => b.overallScore - a.overallScore);

  const barData = sortedByScore.map((a) => ({
    name: a.fundName.length > 20 ? a.fundName.slice(0, 20) + "..." : a.fundName,
    fullName: a.fundName,
    Liquidity: a.liquidity.liquidityScore,
    Fees: a.fees.feeScore,
    Income: a.yield.incomeScore,
    Risk: a.risk.riskScore,
    Fit: a.portfolioFit.suitabilityScore,
  }));

  return (
    <div className="space-y-6">
      {/* Score Comparison Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Multi-Factor Comparison</CardTitle>
          <CardDescription>Side-by-side scoring across five dimensions (1-10 scale)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" domain={[0, 10]} />
                <YAxis dataKey="name" type="category" width={150} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(value: number, name: string) => [value.toFixed(1), name]}
                  labelFormatter={(label: string) => {
                    const item = barData.find((d) => d.name === label);
                    return item?.fullName || label;
                  }}
                />
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

      {/* Ranking Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Fund Rankings</CardTitle>
          <CardDescription>Overall scores and ratings sorted by composite score</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rank</TableHead>
                <TableHead>Fund</TableHead>
                <TableHead className="text-center">Score</TableHead>
                <TableHead className="text-center">Rating</TableHead>
                <TableHead className="text-center">Liquidity</TableHead>
                <TableHead className="text-center">Fees</TableHead>
                <TableHead className="text-center">Income</TableHead>
                <TableHead className="text-center">Risk-Adj</TableHead>
                <TableHead className="text-center">Fit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedByScore.map((a, idx) => (
                <TableRow key={a.fundId}>
                  <TableCell className="font-medium">#{idx + 1}</TableCell>
                  <TableCell>
                    <div className="font-medium">{a.fundName}</div>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className={`font-bold ${scoreColor(a.overallScore)}`}>{a.overallScore}</span>
                  </TableCell>
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

export default function IntervalFundsPage() {
  const [selectedFund, setSelectedFund] = useState<IntervalFund | null>(null);
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  const { data, isLoading } = useQuery<{ funds: IntervalFund[] }>({
    queryKey: ["/api/interval-funds"],
  });

  const funds = data?.funds || [];

  const sortedFunds = [...funds].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortField) {
      case "name":
        return dir * a.name.localeCompare(b.name);
      case "distributionRate":
        return dir * (parseFloat(a.distributionRate || "0") - parseFloat(b.distributionRate || "0"));
      case "nav1yrReturn":
        return dir * (parseFloat(a.nav1yrReturn || "0") - parseFloat(b.nav1yrReturn || "0"));
      case "sharpeRatio":
        return dir * (parseFloat(a.sharpeRatio || "0") - parseFloat(b.sharpeRatio || "0"));
      case "totalAum":
        return dir * (parseFloat(a.totalAum || "0") - parseFloat(b.totalAum || "0"));
      case "expenseRatio":
        return dir * (parseFloat(a.expenseRatio || "0") - parseFloat(b.expenseRatio || "0"));
      default:
        return 0;
    }
  });

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  function SortableHeader({ field, children }: { field: SortField; children: React.ReactNode }) {
    return (
      <TableHead
        className="cursor-pointer select-none hover:text-foreground"
        onClick={() => toggleSort(field)}
      >
        <div className="flex items-center gap-1">
          {children}
          {sortField === field && (
            <ArrowUpDown className="h-3 w-3" />
          )}
        </div>
      </TableHead>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Droplets className="h-6 w-6" />
            Interval Funds Analyzer
          </h1>
          <p className="text-muted-foreground mt-1">
            Analyze and compare interval fund liquidity, fees, yields, and risk profiles
          </p>
        </div>
        <Badge variant="outline" className="text-sm">
          {funds.length} Funds
        </Badge>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Fund Overview</TabsTrigger>
          <TabsTrigger value="compare">Comparative Analysis</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : funds.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No interval funds available. Funds will be seeded automatically on next server restart.
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Total AUM</span>
                    </div>
                    <div className="text-2xl font-bold mt-1">
                      {aumFmt(
                        String(funds.reduce((s, f) => s + parseFloat(f.totalAum || "0"), 0))
                      )}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2">
                      <Percent className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Avg Distribution Rate</span>
                    </div>
                    <div className="text-2xl font-bold mt-1">
                      {pct(
                        String(
                          funds.reduce((s, f) => s + parseFloat(f.distributionRate || "0"), 0) /
                            funds.length
                        )
                      )}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Avg 1-Year Return</span>
                    </div>
                    <div className="text-2xl font-bold mt-1">
                      {pct(
                        String(
                          funds.reduce((s, f) => s + parseFloat(f.nav1yrReturn || "0"), 0) /
                            funds.length
                        )
                      )}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Avg Sharpe Ratio</span>
                    </div>
                    <div className="text-2xl font-bold mt-1">
                      {fmt(
                        String(
                          funds.reduce((s, f) => s + parseFloat(f.sharpeRatio || "0"), 0) /
                            funds.length
                        )
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Funds Table */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Interval Fund Inventory</CardTitle>
                  <CardDescription>Click on any fund to view detailed analysis</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <SortableHeader field="name">Fund Name</SortableHeader>
                        <TableHead>Type</TableHead>
                        <SortableHeader field="totalAum">AUM</SortableHeader>
                        <SortableHeader field="distributionRate">Dist. Rate</SortableHeader>
                        <SortableHeader field="nav1yrReturn">1Y Return</SortableHeader>
                        <SortableHeader field="sharpeRatio">Sharpe</SortableHeader>
                        <SortableHeader field="expenseRatio">Expense</SortableHeader>
                        <TableHead>Liquidity</TableHead>
                        <TableHead className="text-center">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedFunds.map((fund) => (
                        <TableRow
                          key={fund.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setSelectedFund(fund)}
                        >
                          <TableCell>
                            <div>
                              <div className="font-medium">{fund.name}</div>
                              <div className="text-xs text-muted-foreground">{fund.fundManager}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {fund.strategyType}
                            </Badge>
                          </TableCell>
                          <TableCell>{aumFmt(fund.totalAum)}</TableCell>
                          <TableCell className="font-medium">{pct(fund.distributionRate)}</TableCell>
                          <TableCell
                            className={
                              parseFloat(fund.nav1yrReturn || "0") >= 0
                                ? "text-green-600"
                                : "text-red-600"
                            }
                          >
                            {pct(fund.nav1yrReturn)}
                          </TableCell>
                          <TableCell>{fmt(fund.sharpeRatio)}</TableCell>
                          <TableCell>{pct(fund.expenseRatio)}</TableCell>
                          <TableCell>
                            <span className="text-xs">
                              {fund.repurchaseFrequency} /{" "}
                              {parseFloat(fund.repurchaseRate || "0") * 100}%
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedFund(fund);
                              }}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="compare">
          <CompareView />
        </TabsContent>
      </Tabs>

      {/* Analysis Dialog */}
      {selectedFund && (
        <AnalysisDialog
          fund={selectedFund}
          open={!!selectedFund}
          onClose={() => setSelectedFund(null)}
        />
      )}
    </div>
  );
}
