/**
 * Risk-adjusted tab: the full ratio pack.
 *
 * Ratios are grouped by what sits in the denominator, because that is what
 * actually distinguishes them — volatility, downside only, drawdown, or a tail
 * measure. Presenting them as one undifferentiated list is how committees end
 * up double-counting the same evidence.
 */

import {
  CartesianGrid,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Line,
  LineChart,
  Legend,
} from "recharts";
import type { Analytics } from "@/lib/return-analytics-types";
import {
  ACCENT_COLOR,
  BENCHMARK_COLOR,
  FUND_COLOR,
  TOOLTIP_STYLE,
  axisInterval,
  fmtDate,
  fmtPercent,
  fmtRatio,
  toneForValue,
} from "@/lib/return-analytics-format";
import { ChartNote, EmptyNote, MetricRow, MetricTable, SectionCard, Stat } from "./shared";

/** Maps a ratio onto 0-100 for the radar, so different scales are comparable. */
function radarScale(value: number | null, good: number): number {
  if (value === null || !isFinite(value)) return 0;
  return Math.max(0, Math.min(100, (value / good) * 70));
}

export function EfficiencyTab({ analytics }: { analytics: Analytics }) {
  const ra = analytics.riskAdjusted;
  const { meta, rolling, smoothing } = analytics;
  const periodWord = meta.periodLabel.toLowerCase();

  const radarData = [
    { axis: "Sharpe", value: radarScale(ra.sharpeRatio, 1.0) },
    { axis: "Sortino", value: radarScale(ra.sortinoRatio, 1.6) },
    { axis: "Calmar", value: radarScale(ra.calmarRatio, 1.0) },
    { axis: "Omega", value: radarScale(ra.omegaRatio === null ? null : ra.omegaRatio - 1, 1.0) },
    { axis: "Martin", value: radarScale(ra.martinRatio, 2.0) },
    { axis: "Gain/Pain", value: radarScale(ra.gainToPainRatio, 1.0) },
  ];

  const rollingSharpe = rolling.points
    .filter((p) => p.sharpe !== null || p.volatility !== null)
    .map((p) => ({
      label: fmtDate(p.date),
      sharpe: p.sharpe,
      volatility: p.volatility === null ? null : p.volatility * 100,
    }));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Sharpe ratio"
          value={fmtRatio(ra.sharpeRatio)}
          tone={toneForValue(ra.sharpeRatio)}
          sub={ra.adjustedSharpe !== null ? `${fmtRatio(ra.adjustedSharpe)} skew-adjusted` : undefined}
          hint="Excess return over cash per unit of total volatility. The industry default, and the one most flattered by smoothed returns."
          testId="stat-sharpe"
        />
        <Stat
          label="Sortino ratio"
          value={fmtRatio(ra.sortinoRatio)}
          tone={toneForValue(ra.sortinoRatio)}
          hint="Like Sharpe but penalising only downside deviation. Rewards strategies whose volatility is mostly upside."
          testId="stat-sortino"
        />
        <Stat
          label="Calmar ratio"
          value={fmtRatio(ra.calmarRatio)}
          tone={toneForValue(ra.calmarRatio)}
          hint="Annualized return divided by maximum drawdown. The ratio that matters when losses trigger redemptions."
          testId="stat-calmar"
        />
        <Stat
          label="Probabilistic Sharpe"
          value={fmtPercent(ra.probabilisticSharpe, 1)}
          tone={ra.probabilisticSharpe === null ? undefined : ra.probabilisticSharpe >= 0.95 ? "text-emerald-500" : "text-amber-500"}
          sub={ra.minimumTrackRecordYears === null ? undefined : `${ra.minimumTrackRecordYears.toFixed(1)} yrs needed for 95%`}
          hint="Probability the true Sharpe exceeds zero, adjusted for track length, skew and kurtosis. Below 95% the result is not statistically established."
          testId="stat-psr"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard
          className="lg:col-span-2"
          title="Risk-adjusted ratio pack"
          description="Grouped by what each ratio treats as risk"
          testId="card-ratio-pack"
        >
          <div className="space-y-5">
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Volatility in the denominator
              </h4>
              <MetricTable>
                <MetricRow
                  label="Sharpe ratio"
                  value={fmtRatio(ra.sharpeRatio)}
                  tone={toneForValue(ra.sharpeRatio)}
                  hint="Mean excess return divided by the standard deviation of excess returns, annualized."
                />
                <MetricRow
                  label="Adjusted Sharpe ratio"
                  value={fmtRatio(ra.adjustedSharpe)}
                  tone={toneForValue(ra.adjustedSharpe)}
                  hint="Pezier-White adjustment that discounts the Sharpe for negative skew and excess kurtosis."
                />
                <MetricRow
                  label="Modified Sharpe (VaR-based)"
                  value={fmtRatio(ra.modifiedSharpe)}
                  tone={toneForValue(ra.modifiedSharpe)}
                  hint="Excess return per unit of Cornish-Fisher 95% VaR rather than volatility. Penalises left-tail risk directly."
                />
              </MetricTable>
            </div>

            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Downside risk in the denominator
              </h4>
              <MetricTable>
                <MetricRow
                  label="Sortino ratio"
                  value={fmtRatio(ra.sortinoRatio)}
                  tone={toneForValue(ra.sortinoRatio)}
                  hint="Excess return over the minimum acceptable return per unit of downside deviation."
                />
                <MetricRow
                  label="Omega ratio"
                  value={fmtRatio(ra.omegaRatio)}
                  tone={toneForValue(ra.omegaRatio === null ? null : ra.omegaRatio - 1)}
                  hint="Probability-weighted gains divided by probability-weighted losses about the threshold. Uses the entire distribution, not just its first two moments. Above 1 is favourable."
                />
                <MetricRow
                  label="Kappa-3"
                  value={fmtRatio(ra.kappaThree)}
                  tone={toneForValue(ra.kappaThree)}
                  hint="Like Sortino but using the third lower partial moment, so it punishes large losses far more than small ones."
                />
                <MetricRow
                  label="Gain-to-pain ratio"
                  value={fmtRatio(ra.gainToPainRatio)}
                  tone={toneForValue(ra.gainToPainRatio)}
                  hint="Net return earned per unit of cumulative loss suffered along the way."
                />
              </MetricTable>
            </div>

            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Drawdown in the denominator
              </h4>
              <MetricTable>
                <MetricRow
                  label="Calmar ratio"
                  value={fmtRatio(ra.calmarRatio)}
                  tone={toneForValue(ra.calmarRatio)}
                  hint="Annualized return divided by the single worst drawdown."
                />
                <MetricRow
                  label="Sterling ratio"
                  value={fmtRatio(ra.sterlingRatio)}
                  tone={toneForValue(ra.sterlingRatio)}
                  hint="Annualized return divided by the average of the three largest drawdowns — less hostage to one outlier than Calmar."
                />
                <MetricRow
                  label="Burke ratio"
                  value={fmtRatio(ra.burkeRatio)}
                  tone={toneForValue(ra.burkeRatio)}
                  hint="Excess return divided by the root sum of squared drawdowns, weighting deep drawdowns most heavily."
                />
                <MetricRow
                  label="Martin ratio (Ulcer index)"
                  value={fmtRatio(ra.martinRatio)}
                  tone={toneForValue(ra.martinRatio)}
                  hint="Excess return per unit of Ulcer index, so both depth and duration of drawdowns count."
                />
              </MetricTable>
            </div>

            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Statistical credibility
              </h4>
              <MetricTable>
                <MetricRow
                  label="Probabilistic Sharpe ratio"
                  value={fmtPercent(ra.probabilisticSharpe, 1)}
                  tone={
                    ra.probabilisticSharpe === null
                      ? undefined
                      : ra.probabilisticSharpe >= 0.95
                        ? "text-emerald-500"
                        : "text-amber-500"
                  }
                  hint="Confidence that the true Sharpe is above zero, given the number of observations and the non-normality of the returns."
                />
                <MetricRow
                  label="Minimum track record length"
                  value={ra.minimumTrackRecordYears === null ? "—" : `${ra.minimumTrackRecordYears.toFixed(1)} years`}
                  hint="History required for 95% confidence that the Sharpe is genuinely positive, at the observed Sharpe and distribution shape."
                />
                <MetricRow
                  label="Common sense ratio"
                  value={fmtRatio(ra.commonSenseRatio)}
                  tone={toneForValue(ra.commonSenseRatio === null ? null : ra.commonSenseRatio - 1)}
                  hint="Tail ratio multiplied by the gain-to-pain ratio. A single figure combining tail asymmetry with cumulative pain."
                />
                {smoothing.unsmoothed && (
                  <MetricRow
                    label="Sharpe after unsmoothing"
                    value={fmtRatio(smoothing.unsmoothed.sharpe)}
                    tone="text-amber-500"
                    hint="Sharpe recomputed on Geltner-unsmoothed returns. This is the figure to underwrite when serial correlation is present."
                  />
                )}
              </MetricTable>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Efficiency profile" description="Each axis scaled so 70 marks a good result" testId="card-radar">
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={radarData} outerRadius="72%">
              <PolarGrid stroke="hsl(var(--border))" />
              <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value: number) => [value.toFixed(0), "Scaled score"]} />
              <Radar dataKey="value" stroke={FUND_COLOR} fill={FUND_COLOR} fillOpacity={0.28} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
          <ChartNote>
            Shape, not size, is the signal. A spike on Sharpe with a collapse on Calmar means volatility is low but the strategy has
            still suffered a large drawdown — a pattern typical of carry and credit strategies.
          </ChartNote>
        </SectionCard>
      </div>

      <SectionCard
        title={`${rolling.windowLabel} Sharpe and volatility`}
        description="Whether efficiency is stable or concentrated in one stretch"
        testId="card-rolling-sharpe"
      >
        {rollingSharpe.length < 2 ? (
          <EmptyNote>Not enough history to build a rolling window.</EmptyNote>
        ) : (
          <>
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rolling Sharpe</h4>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={rollingSharpe} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="label"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                      tickLine={false}
                      interval={axisInterval(rollingSharpe.length)}
                    />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} width={40} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [v.toFixed(2), "Sharpe"]} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                    <ReferenceLine y={1} stroke={BENCHMARK_COLOR} strokeDasharray="4 3" />
                    <Line type="monotone" dataKey="sharpe" name="Rolling Sharpe" stroke={FUND_COLOR} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rolling volatility</h4>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={rollingSharpe} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="label"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                      tickLine={false}
                      interval={axisInterval(rollingSharpe.length)}
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                      tickLine={false}
                      width={44}
                      tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                    />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v.toFixed(2)}%`, "Volatility"]} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line
                      type="monotone"
                      dataKey="volatility"
                      name="Annualized volatility"
                      stroke={ACCENT_COLOR}
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <ChartNote>
              The dashed line on the left marks a Sharpe of 1.0. A rolling Sharpe that swings from strongly positive to negative
              means the headline figure is an average of quite different regimes, not a stable property of the strategy. Rising
              rolling volatility with a flat return is a warning that the manager is taking more risk for the same result.
            </ChartNote>
          </>
        )}
      </SectionCard>
    </div>
  );
}
