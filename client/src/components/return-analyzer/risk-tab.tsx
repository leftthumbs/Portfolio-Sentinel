/**
 * Risk tab: drawdown behaviour, distribution shape, tail loss estimates, and
 * the return-smoothing diagnostics that decide whether any of the other risk
 * numbers can be believed.
 */

import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, Info } from "lucide-react";
import type { Analytics } from "@/lib/return-analytics-types";
import {
  ACCENT_COLOR,
  FUND_COLOR,
  NEGATIVE_COLOR,
  TOOLTIP_STYLE,
  axisInterval,
  fmtDate,
  fmtFullDate,
  fmtPercent,
  fmtRatio,
  toneForValue,
} from "@/lib/return-analytics-format";
import { ChartNote, EmptyNote, MetricRow, MetricTable, SectionCard, Stat } from "./shared";
import { cn } from "@/lib/utils";

export function RiskTab({ analytics }: { analytics: Analytics }) {
  const { risk, meta, smoothing } = analytics;
  const dd = risk.drawdown;
  const periodWord = meta.periodLabel.toLowerCase();

  // Same thresholds the server's data-quality check applies, so the alert's
  // severity never contradicts the Pass/Review/Fail badge on the IC tab.
  const rhoAbs = Math.abs(smoothing.lag1Autocorrelation ?? 0);
  const smoothingSeverity: "pass" | "warn" | "fail" = rhoAbs < 0.2 ? "pass" : rhoAbs < 0.35 ? "warn" : "fail";

  const drawdownData = dd.series.map((p) => ({ label: fmtDate(p.date), drawdown: p.drawdown * 100 }));

  const histogramData = risk.histogram.map((b) => ({
    label: b.label,
    count: b.count,
    normal: b.normalCount,
    midpoint: ((b.lowerBound + b.upperBound) / 2) * 100,
  }));

  const acfData = smoothing.autocorrelations
    .filter((a) => a.value !== null)
    .map((a) => ({ lag: `Lag ${a.lag}`, value: (a.value as number) }));

  // Ljung-Box uses ~2/sqrt(n) as the 95% band for an individual lag.
  const acfBand = 1.96 / Math.sqrt(meta.periods);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Annualized volatility"
          value={fmtPercent(risk.annualizedVolatility)}
          sub={smoothing.unsmoothed ? `${fmtPercent(smoothing.unsmoothed.volatility)} unsmoothed` : `${fmtPercent(risk.periodVolatility)} per ${periodWord}`}
          hint="Standard deviation of returns, scaled to a year. It treats upside and downside moves identically."
          testId="stat-volatility"
        />
        <Stat
          label="Maximum drawdown"
          value={fmtPercent(dd.maxDrawdown)}
          tone="text-red-500"
          sub={dd.maxDrawdownDate ? `Trough ${fmtFullDate(dd.maxDrawdownDate)}` : undefined}
          hint="Largest peak-to-trough decline ever suffered. The loss an investor with the worst possible entry actually lived through."
          testId="stat-max-drawdown"
        />
        <Stat
          label="Downside deviation"
          value={fmtPercent(risk.downsideDeviation)}
          sub={`Upside ${fmtPercent(risk.upsideDeviation)}`}
          hint="Volatility computed from losing periods only, measured against the minimum acceptable return."
          testId="stat-downside-deviation"
        />
        <Stat
          label="Current drawdown"
          value={fmtPercent(dd.currentDrawdown)}
          tone={dd.currentDrawdown < -0.001 ? "text-red-500" : "text-emerald-500"}
          sub={dd.currentUnderwaterPeriods > 0 ? `${dd.currentUnderwaterPeriods} ${periodWord}s under water` : "At high-water mark"}
          hint="Distance below the all-time high as at the last observation."
          testId="stat-current-drawdown"
        />
      </div>

      {smoothing.unsmoothed && (
        <Alert
          variant={smoothingSeverity === "fail" ? "destructive" : "default"}
          data-testid="alert-smoothing"
        >
          {smoothingSeverity === "pass" ? <Info className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          <AlertTitle>
            {smoothingSeverity === "fail"
              ? "Reported returns appear smoothed"
              : smoothingSeverity === "warn"
                ? "Some evidence of return smoothing"
                : "Mild serial correlation — unsmoothed comparison"}
          </AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              {smoothingSeverity === "fail"
                ? `Lag-1 autocorrelation of ${fmtRatio(smoothing.lag1Autocorrelation, 3)} indicates the return series is averaged or appraisal-priced rather than independently marked each ${periodWord}. Correcting for it changes the risk picture materially:`
                : smoothingSeverity === "warn"
                  ? `Lag-1 autocorrelation of ${fmtRatio(smoothing.lag1Autocorrelation, 3)} is high enough to flatter the reported risk figures, though not conclusive on its own. For reference, correcting for it gives:`
                  : `Lag-1 autocorrelation of ${fmtRatio(smoothing.lag1Autocorrelation, 3)} is within the normal range, so the reported figures stand. The unsmoothed comparison is shown for completeness:`}
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-md border border-current/20 p-2">
                <div className="text-xs opacity-80">Volatility</div>
                <div className="text-sm font-semibold tabular-nums">
                  {fmtPercent(risk.annualizedVolatility)} → {fmtPercent(smoothing.unsmoothed.volatility)}
                </div>
              </div>
              <div className="rounded-md border border-current/20 p-2">
                <div className="text-xs opacity-80">Sharpe ratio</div>
                <div className="text-sm font-semibold tabular-nums">
                  {fmtRatio(analytics.riskAdjusted.sharpeRatio)} → {fmtRatio(smoothing.unsmoothed.sharpe)}
                </div>
              </div>
              <div className="rounded-md border border-current/20 p-2">
                <div className="text-xs opacity-80">Max drawdown</div>
                <div className="text-sm font-semibold tabular-nums">
                  {fmtPercent(dd.maxDrawdown)} → {fmtPercent(smoothing.unsmoothed.maxDrawdown)}
                </div>
              </div>
            </div>
            <p className="text-xs">
              Figures on the right apply a first-order Geltner unsmoothing.{" "}
              {smoothingSeverity === "pass"
                ? "The difference is small, which is itself evidence the marks are genuine."
                : "Underwrite those, not the reported ones."}
            </p>
          </AlertDescription>
        </Alert>
      )}

      <SectionCard
        title="Underwater curve"
        description="Distance below the running high-water mark at every point in the track record"
        testId="card-underwater"
      >
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={drawdownData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="ra-underwater" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={NEGATIVE_COLOR} stopOpacity={0.4} />
                <stop offset="95%" stopColor={NEGATIVE_COLOR} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="label"
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickLine={false}
              interval={axisInterval(drawdownData.length)}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickLine={false}
              width={46}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value: number) => [`${value.toFixed(2)}%`, "Drawdown"]} />
            <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
            <Area type="monotone" dataKey="drawdown" stroke={NEGATIVE_COLOR} strokeWidth={2} fill="url(#ra-underwater)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
        <ChartNote>
          The curve touches zero only at new highs. Wide flat troughs matter more than deep narrow ones — they are the periods when
          an investor is asked to stay committed with nothing to show for it.
        </ChartNote>
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Worst drawdown episodes" description="Ranked by depth, with recovery timing" testId="card-drawdown-table">
          {dd.episodes.length === 0 ? (
            <EmptyNote>No drawdowns were recorded — the series never fell below a prior high.</EmptyNote>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="pb-2 text-left text-xs font-medium text-muted-foreground">#</th>
                    <th className="pb-2 text-right text-xs font-medium text-muted-foreground">Depth</th>
                    <th className="pb-2 pl-3 text-left text-xs font-medium text-muted-foreground">Peak</th>
                    <th className="pb-2 pl-3 text-left text-xs font-medium text-muted-foreground">Trough</th>
                    <th className="pb-2 pl-3 text-left text-xs font-medium text-muted-foreground">Recovered</th>
                    <th className="pb-2 pl-3 text-right text-xs font-medium text-muted-foreground">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {dd.episodes.slice(0, 6).map((e) => (
                    <tr key={e.rank} className="border-b last:border-0" data-testid={`row-drawdown-${e.rank}`}>
                      <td className="py-2 text-sm text-muted-foreground">{e.rank}</td>
                      <td className="py-2 text-right text-sm font-medium tabular-nums text-red-500">{fmtPercent(e.depth)}</td>
                      <td className="py-2 pl-3 text-sm">{fmtDate(e.peakDate)}</td>
                      <td className="py-2 pl-3 text-sm">{fmtDate(e.troughDate)}</td>
                      <td className="py-2 pl-3 text-sm">
                        {e.recovered ? (
                          fmtDate(e.recoveryDate)
                        ) : (
                          <Badge variant="outline" className="h-5 border-amber-500/40 px-1.5 text-[10px] text-amber-500">
                            ongoing
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 pl-3 text-right text-sm tabular-nums text-muted-foreground">
                        {e.totalPeriods} {periodWord.slice(0, 2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <ChartNote>
            "Total" counts the {periodWord}s from the prior peak to full recovery. An ongoing episode has not yet regained its
            high-water mark.
          </ChartNote>
        </SectionCard>

        <SectionCard title="Drawdown statistics" description="Depth, duration and persistence" testId="card-drawdown-stats">
          <MetricTable>
            <MetricRow
              label="Ulcer index"
              value={fmtPercent(dd.ulcerIndex)}
              hint="Root-mean-square of every drawdown reading. Unlike max drawdown it penalises long shallow declines as well as short deep ones."
            />
            <MetricRow
              label="Pain index"
              value={fmtPercent(dd.painIndex)}
              hint="Average depth below the high-water mark across the whole track record."
            />
            <MetricRow
              label="Conditional drawdown (95%)"
              value={fmtPercent(dd.conditionalDrawdown95)}
              tone="text-red-500"
              hint="Average of the worst 5% of drawdown readings — the expected pain in a bad stretch, not just the single worst point."
            />
            <MetricRow
              label="Time under water"
              value={`${fmtPercent(dd.percentTimeUnderwater, 1)} of periods`}
              hint="Share of the track record spent below a prior peak."
            />
            <MetricRow
              label="Longest underwater stretch"
              value={`${dd.longestUnderwaterPeriods} ${periodWord}s`}
              hint="Longest continuous run below a prior high — the holding-period test for an allocator."
            />
            <MetricRow
              label="Average recovery time"
              value={dd.averageRecoveryPeriods === null ? "—" : `${dd.averageRecoveryPeriods.toFixed(1)} ${periodWord}s`}
              hint="Mean time from trough back to the prior high, across completed episodes."
            />
          </MetricTable>
        </SectionCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Return distribution"
          description="Observed frequency against a fitted normal curve"
          testId="card-distribution"
        >
          {histogramData.length === 0 ? (
            <EmptyNote>Returns show no dispersion, so a distribution cannot be plotted.</EmptyNote>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={histogramData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="label"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={10}
                    tickLine={false}
                    interval={Math.max(0, Math.floor(histogramData.length / 8))}
                  />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} width={36} allowDecimals={false} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(value: number, name: string) => [
                      name === "Normal fit" ? value.toFixed(1) : value,
                      name,
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="count" name={`Observed ${periodWord}s`} radius={[3, 3, 0, 0]} maxBarSize={34}>
                    {histogramData.map((d, i) => (
                      <Cell key={i} fill={d.midpoint >= 0 ? FUND_COLOR : NEGATIVE_COLOR} />
                    ))}
                  </Bar>
                  <Line
                    type="monotone"
                    dataKey="normal"
                    name="Normal fit"
                    stroke={ACCENT_COLOR}
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
              <ChartNote>
                Bars taller than the dashed curve in the left tail mean losses cluster more heavily than a normal distribution
                predicts — exactly the case where volatility-based risk measures understate the exposure.
              </ChartNote>
            </>
          )}
        </SectionCard>

        <SectionCard title="Distribution shape" description="Moments and the normality test" testId="card-moments">
          <MetricTable>
            <MetricRow
              label="Skewness"
              value={fmtRatio(risk.skewness)}
              tone={toneForValue(risk.skewness)}
              hint="Asymmetry of the distribution. Negative means the large moves are losses; positive means they are gains."
            />
            <MetricRow
              label="Excess kurtosis"
              value={fmtRatio(risk.excessKurtosis)}
              tone={toneForValue(risk.excessKurtosis, true)}
              hint="Fatness of the tails relative to a normal distribution (which scores 0). Above 1 means extreme moves are materially more common than normal."
            />
            <MetricRow
              label="Jarque-Bera statistic"
              value={fmtRatio(risk.jarqueBera)}
              hint="Joint test of whether skew and kurtosis are consistent with a normal distribution."
            />
            <MetricRow
              label="Normality p-value"
              value={risk.jarqueBeraPValue === null ? "—" : risk.jarqueBeraPValue.toFixed(4)}
              tone={risk.isNormal === false ? "text-amber-500" : undefined}
              hint="Below 0.05 rejects normality, which invalidates Gaussian VaR and flatters the plain Sharpe ratio."
            />
            <MetricRow
              label="Distribution verdict"
              value={risk.isNormal === null ? "—" : risk.isNormal ? "Normal enough" : "Non-normal"}
              tone={risk.isNormal === false ? "text-amber-500" : "text-emerald-500"}
            />
            <MetricRow
              label="Tail ratio (95th / 5th)"
              value={fmtRatio(risk.tailRatio)}
              tone={toneForValue(risk.tailRatio === null ? null : risk.tailRatio - 1)}
              hint="Size of the best periods relative to the worst. Above 1 means the right tail is bigger than the left."
            />
            <MetricRow
              label="Upside / downside deviation"
              value={fmtRatio(risk.volatilitySkewRatio)}
              hint="Above 1 means most of the volatility is upside volatility, which an investor does not mind."
            />
          </MetricTable>
        </SectionCard>
      </div>

      <SectionCard
        title="Tail risk"
        description={`Loss thresholds per ${periodWord}, on three estimation bases`}
        testId="card-tail-risk"
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="pb-2 text-left text-xs font-medium text-muted-foreground">Confidence</th>
                <th className="pb-2 text-right text-xs font-medium text-muted-foreground">Historical VaR</th>
                <th className="pb-2 pl-3 text-right text-xs font-medium text-muted-foreground">Gaussian VaR</th>
                <th className="pb-2 pl-3 text-right text-xs font-medium text-muted-foreground">Cornish-Fisher VaR</th>
                <th className="pb-2 pl-3 text-right text-xs font-medium text-muted-foreground">Historical CVaR</th>
                <th className="pb-2 pl-3 text-right text-xs font-medium text-muted-foreground">Gaussian CVaR</th>
              </tr>
            </thead>
            <tbody>
              {risk.tailRisk.map((t) => (
                <tr key={t.confidence} className="border-b last:border-0" data-testid={`row-var-${Math.round(t.confidence * 100)}`}>
                  <td className="py-2 text-sm font-medium">{(t.confidence * 100).toFixed(0)}%</td>
                  <td className="py-2 text-right text-sm tabular-nums text-red-500">{fmtPercent(t.historicalVar)}</td>
                  <td className="py-2 pl-3 text-right text-sm tabular-nums">{fmtPercent(t.parametricVar)}</td>
                  <td className={cn("py-2 pl-3 text-right text-sm font-medium tabular-nums", "text-red-500")}>
                    {fmtPercent(t.modifiedVar)}
                  </td>
                  <td className="py-2 pl-3 text-right text-sm tabular-nums text-red-500">{fmtPercent(t.historicalCvar)}</td>
                  <td className="py-2 pl-3 text-right text-sm tabular-nums">{fmtPercent(t.parametricCvar)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ChartNote>
          <span className="font-medium">VaR</span> is the loss threshold breached with the stated probability;{" "}
          <span className="font-medium">CVaR</span> is the average loss once it is breached. Gaussian assumes a normal distribution;
          Cornish-Fisher adjusts for the observed skew and kurtosis and is the figure to underwrite when the normality test fails.
        </ChartNote>
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Worst historical windows" description="Deepest cumulative loss over each holding period" testId="card-worst-windows">
          <MetricTable
            fundLabel={meta.fundName}
            benchmarkLabel={meta.benchmarkName}
            showBenchmark={meta.hasBenchmark}
          >
            {risk.worstWindows.map((w) => (
              <MetricRow
                key={w.label}
                label={w.label}
                value={fmtPercent(w.worstReturn)}
                tone={toneForValue(w.worstReturn)}
                benchmark={fmtPercent(w.benchmarkReturn)}
                showBenchmark={meta.hasBenchmark}
                hint={w.startDate ? `Window: ${fmtFullDate(w.startDate)} to ${fmtFullDate(w.endDate)}` : undefined}
              />
            ))}
          </MetricTable>
          <ChartNote>
            The worst overlapping window of each length. A positive figure means the strategy never lost money over that holding
            period in this history.
          </ChartNote>
        </SectionCard>

        <SectionCard
          title="Serial correlation"
          description="Autocorrelation by lag — the test for smoothed or stale marks"
          testId="card-autocorrelation"
        >
          {acfData.length === 0 ? (
            <EmptyNote>Too few observations to estimate autocorrelation.</EmptyNote>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={acfData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="lag" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    width={44}
                    domain={[-1, 1]}
                    tickFormatter={(v: number) => v.toFixed(1)}
                  />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value: number) => [value.toFixed(3), "Autocorrelation"]} />
                  <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                  <ReferenceLine y={acfBand} stroke={WARN_LINE} strokeDasharray="4 3" />
                  <ReferenceLine y={-acfBand} stroke={WARN_LINE} strokeDasharray="4 3" />
                  <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={40}>
                    {acfData.map((d, i) => (
                      <Cell key={i} fill={Math.abs(d.value) > acfBand ? NEGATIVE_COLOR : FUND_COLOR} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <ChartNote>
                Dashed lines mark the 95% significance band (±{acfBand.toFixed(2)}). Bars outside it are statistically real
                dependence, not noise. Genuine market returns show almost none; smoothed or appraisal-based marks show a large
                positive lag-1 bar. Ljung-Box across {smoothing.ljungBoxLags} lags:{" "}
                <span className="font-medium">p = {smoothing.ljungBoxPValue === null ? "—" : smoothing.ljungBoxPValue.toFixed(4)}</span>
                {smoothing.hasSerialDependence === true && " — independence is rejected."}
              </ChartNote>
            </>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

const WARN_LINE = "hsl(var(--chart-4))";
