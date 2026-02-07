import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BookOpen, TrendingUp, Shield, BarChart3, Target, Layers } from "lucide-react";

interface MetricDefinition {
  name: string;
  abbreviation?: string;
  definition: string;
  formula?: string;
  interpretation: string;
}

const riskMetrics: MetricDefinition[] = [
  {
    name: "Value at Risk",
    abbreviation: "VaR",
    definition: "The maximum potential loss at a given confidence level over a specific time period. VaR 95% means there's a 5% chance of losses exceeding this amount.",
    formula: "VaR = μ - z × σ",
    interpretation: "Lower VaR indicates lower potential losses. A VaR of $100,000 at 95% means there's only a 5% chance of losing more than $100,000."
  },
  {
    name: "Conditional Value at Risk",
    abbreviation: "CVaR / Expected Shortfall",
    definition: "The expected loss given that losses exceed the VaR threshold. It measures the average of the worst losses beyond VaR.",
    formula: "CVaR = E[Loss | Loss > VaR]",
    interpretation: "CVaR is always larger than VaR and provides a more comprehensive view of tail risk. It answers: 'When things go badly, how bad do they get?'"
  },
  {
    name: "Volatility",
    abbreviation: "σ (Sigma)",
    definition: "The standard deviation of returns, measuring the dispersion of returns around their mean. Higher volatility indicates greater uncertainty.",
    formula: "σ = √(Σ(Rᵢ - R̄)² / (n-1))",
    interpretation: "Annualized volatility of 15% means returns typically vary ±15% from the mean in a year. Lower is generally preferred for risk-averse investors."
  },
  {
    name: "Maximum Drawdown",
    abbreviation: "Max DD",
    definition: "The largest peak-to-trough decline in portfolio value before a new peak is achieved. Measures the worst historical loss.",
    formula: "Max DD = (Trough Value - Peak Value) / Peak Value",
    interpretation: "A max drawdown of -30% means the portfolio lost 30% from its highest point. Important for understanding worst-case scenarios."
  },
  {
    name: "Beta",
    abbreviation: "β",
    definition: "Measures the portfolio's sensitivity to market movements. A beta of 1 means the portfolio moves in line with the market.",
    formula: "β = Cov(Rₚ, Rₘ) / Var(Rₘ)",
    interpretation: "Beta > 1 means more volatile than market, < 1 means less volatile. Negative beta indicates inverse correlation to market."
  },
  {
    name: "Alpha",
    abbreviation: "α",
    definition: "The excess return of the portfolio relative to what would be expected given its beta. Measures manager skill or value added.",
    formula: "α = Rₚ - [Rf + β × (Rₘ - Rf)]",
    interpretation: "Positive alpha indicates outperformance vs. benchmark after adjusting for risk. A key measure of active management success."
  }
];

const performanceRatios: MetricDefinition[] = [
  {
    name: "Sharpe Ratio",
    definition: "Risk-adjusted return measuring excess return per unit of total risk (volatility). The most widely used performance metric.",
    formula: "Sharpe = (Rₚ - Rf) / σₚ",
    interpretation: "Sharpe > 1 is good, > 2 is very good, > 3 is excellent. Higher is better. Allows comparison across different investments."
  },
  {
    name: "Sortino Ratio",
    definition: "Similar to Sharpe but only penalizes downside volatility. More appropriate when returns are not normally distributed.",
    formula: "Sortino = (Rₚ - Rf) / σ_downside",
    interpretation: "Higher is better. More favorable to strategies with positive skew (large gains, small losses) compared to Sharpe."
  },
  {
    name: "Calmar Ratio",
    definition: "Measures return relative to maximum drawdown. Particularly useful for hedge funds and absolute return strategies.",
    formula: "Calmar = Annualized Return / |Max Drawdown|",
    interpretation: "Calmar > 1 means the annualized return exceeds the worst drawdown. Higher ratios indicate better recovery potential."
  },
  {
    name: "Omega Ratio",
    definition: "The ratio of gains above a threshold to losses below it. Captures the entire return distribution, not just mean and variance.",
    formula: "Omega = ∫[threshold to ∞] (1-F(r))dr / ∫[-∞ to threshold] F(r)dr",
    interpretation: "Omega > 1 indicates more gains than losses relative to threshold. Unlike Sharpe, considers all moments of the distribution."
  },
  {
    name: "Treynor Ratio",
    definition: "Measures excess return per unit of systematic risk (beta). Useful for diversified portfolios where unsystematic risk is minimal.",
    formula: "Treynor = (Rₚ - Rf) / β",
    interpretation: "Higher is better. Rewards strategies that achieve high returns with low market sensitivity."
  },
  {
    name: "Information Ratio",
    definition: "Measures active return (alpha) relative to tracking error. Evaluates consistency of outperformance vs. benchmark.",
    formula: "IR = (Rₚ - Rᵦ) / Tracking Error",
    interpretation: "IR > 0.5 is good, > 1.0 is exceptional. Measures how consistently a manager beats the benchmark."
  },
  {
    name: "Sterling Ratio",
    definition: "Similar to Calmar but uses average of largest drawdowns instead of just the maximum.",
    formula: "Sterling = Annualized Return / Avg(Largest Drawdowns)",
    interpretation: "More robust than Calmar as it's less sensitive to a single extreme event. Higher is better."
  },
  {
    name: "Burke Ratio",
    definition: "Uses the square root of the sum of squared drawdowns, penalizing both frequency and magnitude of drawdowns.",
    formula: "Burke = Excess Return / √(Σ Drawdown²)",
    interpretation: "Higher is better. Gives more weight to larger drawdowns, rewarding consistency."
  }
];

const alternativeMetrics: MetricDefinition[] = [
  {
    name: "Upside Capture Ratio",
    definition: "Measures how much of the benchmark's gains the portfolio captures during up markets.",
    formula: "Upside Capture = (Portfolio Return when Market Up) / (Market Return when Up) × 100",
    interpretation: "100% means capturing all upside. >100% means outperforming in up markets. Ideally want high upside capture."
  },
  {
    name: "Downside Capture Ratio",
    definition: "Measures how much of the benchmark's losses the portfolio experiences during down markets.",
    formula: "Downside Capture = (Portfolio Return when Market Down) / (Market Return when Down) × 100",
    interpretation: "<100% means losing less than market in downturns. Ideally want low downside capture."
  },
  {
    name: "Ulcer Index",
    definition: "Measures the depth and duration of drawdowns. Named because it represents the 'ulcer-causing' stress of losses.",
    formula: "UI = √(Σ Drawdown² / n)",
    interpretation: "Lower is better. Accounts for both severity and persistence of drawdowns, not just peaks and troughs."
  },
  {
    name: "Pain Index",
    definition: "The average drawdown over the measurement period. Simpler than Ulcer Index but captures similar information.",
    formula: "Pain Index = Σ |Drawdown| / n",
    interpretation: "Lower is better. A Pain Index of 5% means the portfolio was, on average, 5% below its peak."
  },
  {
    name: "Gain-to-Pain Ratio",
    definition: "The ratio of total gains to total losses. Measures the efficiency of converting risk into return.",
    formula: "GPR = Σ Positive Returns / |Σ Negative Returns|",
    interpretation: "GPR > 1 means more gains than losses. GPR of 2 means gaining $2 for every $1 lost."
  },
  {
    name: "MAR Ratio",
    definition: "Managed Account Reports ratio, similar to Calmar but typically uses 36-month returns.",
    formula: "MAR = 36-Month Annualized Return / |Max Drawdown|",
    interpretation: "Higher is better. Industry standard for CTAs and managed futures funds."
  }
];

const tailRiskMetrics: MetricDefinition[] = [
  {
    name: "Skewness",
    definition: "Measures the asymmetry of the return distribution. Positive skew means more extreme positive returns; negative skew means more extreme losses.",
    formula: "Skewness = E[(X - μ)³] / σ³",
    interpretation: "Positive skew is preferred (big wins, small losses). Negative skew is dangerous (small wins, big losses). Normal distribution has skew = 0."
  },
  {
    name: "Kurtosis",
    definition: "Measures the 'tailedness' of the return distribution. High kurtosis means more extreme events than a normal distribution.",
    formula: "Kurtosis = E[(X - μ)⁴] / σ⁴",
    interpretation: "Normal distribution has kurtosis of 3. Higher values indicate 'fat tails' with more extreme events. Important for risk management."
  },
  {
    name: "Tail Ratio",
    definition: "The ratio of the right tail (gains) to left tail (losses) at a given percentile. Measures asymmetry in extreme returns.",
    formula: "Tail Ratio = |95th Percentile| / |5th Percentile|",
    interpretation: "Tail Ratio > 1 means extreme gains exceed extreme losses. Investors prefer high tail ratios."
  }
];

const diversificationMetrics: MetricDefinition[] = [
  {
    name: "Herfindahl Index",
    abbreviation: "HHI",
    definition: "Measures portfolio concentration. Sum of squared weights of each holding. Higher values indicate more concentration.",
    formula: "HHI = Σ wᵢ²",
    interpretation: "HHI = 1 means 100% in one asset (max concentration). HHI = 1/n for equal weights. Lower is more diversified."
  },
  {
    name: "Diversification Ratio",
    definition: "Ratio of weighted average volatility to portfolio volatility. Measures the benefit of diversification.",
    formula: "DR = Σ(wᵢ × σᵢ) / σₚ",
    interpretation: "DR > 1 indicates diversification benefit. DR = 1 means no benefit (perfect correlation). Higher is better."
  },
  {
    name: "Effective Number of Bets",
    abbreviation: "ENB",
    definition: "The number of independent risk factors in a portfolio. Measures true diversification beyond simple position count.",
    formula: "ENB = 1 / Σ(PC_weight²)",
    interpretation: "Higher ENB means more independent sources of return. A portfolio of 20 correlated stocks might have ENB of only 3-4."
  }
];

function MetricCard({ metric }: { metric: MetricDefinition }) {
  return (
    <Card className="hover-elevate" data-testid={`card-metric-${metric.name.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">{metric.name}</CardTitle>
          {metric.abbreviation && (
            <Badge variant="secondary" className="font-mono text-xs">{metric.abbreviation}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{metric.definition}</p>
        {metric.formula && (
          <div className="p-2 rounded-md bg-muted/50 border">
            <p className="text-xs text-muted-foreground mb-1">Formula</p>
            <code className="text-sm font-mono">{metric.formula}</code>
          </div>
        )}
        <div className="pt-2 border-t">
          <p className="text-xs text-muted-foreground mb-1">Interpretation</p>
          <p className="text-sm">{metric.interpretation}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricSection({ title, description, icon: Icon, metrics }: { 
  title: string; 
  description: string;
  icon: typeof TrendingUp;
  metrics: MetricDefinition[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {metrics.map((metric) => (
          <MetricCard key={metric.name} metric={metric} />
        ))}
      </div>
    </div>
  );
}

export default function AnalyticsGlossary() {
  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <BookOpen className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Analytics Glossary</h1>
            <p className="text-muted-foreground">Definitions and formulas for all analytics used in InvestIQ</p>
          </div>
        </div>

        <Tabs defaultValue="risk" className="space-y-6">
          <TabsList className="grid w-full grid-cols-5 lg:w-auto lg:grid-cols-none lg:flex" data-testid="tabs-analytics-categories">
            <TabsTrigger value="risk" data-testid="tab-risk-metrics">
              <Shield className="h-4 w-4 mr-2" />
              Risk
            </TabsTrigger>
            <TabsTrigger value="performance" data-testid="tab-performance-ratios">
              <TrendingUp className="h-4 w-4 mr-2" />
              Performance
            </TabsTrigger>
            <TabsTrigger value="alternative" data-testid="tab-alternative-metrics">
              <BarChart3 className="h-4 w-4 mr-2" />
              Alternative
            </TabsTrigger>
            <TabsTrigger value="tail" data-testid="tab-tail-risk">
              <Target className="h-4 w-4 mr-2" />
              Tail Risk
            </TabsTrigger>
            <TabsTrigger value="diversification" data-testid="tab-diversification">
              <Layers className="h-4 w-4 mr-2" />
              Diversification
            </TabsTrigger>
          </TabsList>

          <TabsContent value="risk" className="space-y-6">
            <MetricSection
              title="Risk Metrics"
              description="Core measures of portfolio risk and exposure"
              icon={Shield}
              metrics={riskMetrics}
            />
          </TabsContent>

          <TabsContent value="performance" className="space-y-6">
            <MetricSection
              title="Performance Ratios"
              description="Risk-adjusted return measurements"
              icon={TrendingUp}
              metrics={performanceRatios}
            />
          </TabsContent>

          <TabsContent value="alternative" className="space-y-6">
            <MetricSection
              title="Alternative Metrics"
              description="Additional performance and risk analytics"
              icon={BarChart3}
              metrics={alternativeMetrics}
            />
          </TabsContent>

          <TabsContent value="tail" className="space-y-6">
            <MetricSection
              title="Tail Risk Metrics"
              description="Measures of extreme events and distribution shape"
              icon={Target}
              metrics={tailRiskMetrics}
            />
          </TabsContent>

          <TabsContent value="diversification" className="space-y-6">
            <MetricSection
              title="Diversification Metrics"
              description="Portfolio concentration and diversification measures"
              icon={Layers}
              metrics={diversificationMetrics}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
