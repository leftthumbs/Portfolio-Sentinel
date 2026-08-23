/**
 * Benchmark tab: the decomposition of return into market exposure and skill.
 *
 * The question this tab exists to answer is the one a committee always asks —
 * is this manager producing something the index cannot, and is that something
 * large enough to survive a fee?
 */

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
  Bar,
  BarChart,
} from "recharts";
import { Info } from "lucide-react";
import type { Analytics } from "@/lib/return-analytics-types";
import {
  ACCENT_COLOR,
  BENCHMARK_COLOR,
  FUND_COLOR,
  NEGATIVE_COLOR,
  TOOLTIP_STYLE,
  axisInterval,
  fmtDate,
  fmtFullDate,
  fmtPercent,
  fmtRatio,
  fmtSignedPercent,
  toneForValue,
} from "@/lib/return-analytics-format";
import { ChartNote, EmptyNote, MetricRow, MetricTable, SectionCard, Stat } from "./shared";

export function BenchmarkTab({ analytics }: { analytics: Analytics }) {
  const rel = analytics.relative;
  const { meta, rolling, scatter } = analytics;

  if (!rel) {
    return (
      <EmptyNote>
        No benchmark was supplied for this analysis. Re-run it with a benchmark column in the file, or pick one from the benchmark
        library, to unlock alpha, beta, capture and information ratio.
      </EmptyNote>
    );
  }

  const benchName = meta.benchmarkName ?? "Benchmark";
  const periodWord = meta.periodLabel.toLowerCase();

  const scatterData = (scatter ?? []).map((p) => ({
    x: p.benchmark * 100,
    y: p.fund * 100,
    date: p.date,
  }));

  // Two endpoints are enough to draw the fitted CAPM line across the cloud.
  const xs = scatterData.map((p) => p.x);
  const xMin = xs.length ? Math.min(...xs) : 0;
  const xMax = xs.length ? Math.max(...xs) : 0;
  const rfPeriod = ((1 + meta.riskFreeRate) ** (1 / meta.periodsPerYear) - 1) * 100;
  const alphaPeriod = rel.alpha === null ? 0 : ((1 + rel.alpha) ** (1 / meta.periodsPerYear) - 1) * 100;
  const fitLine =
    rel.beta === null
      ? []
      : [xMin, xMax].map((x) => ({ x, y: alphaPeriod + rel.beta! * (x - rfPeriod) + rfPeriod }));

  const rollingBeta = rolling.points
    .filter((p) => p.beta !== null || p.correlation !== null)
    .map((p) => ({
      label: fmtDate(p.date),
      beta: p.beta,
      correlation: p.correlation,
    }));

  // Round ticks that always bracket the 100% full-participation marker.
  const captureMax = Math.max(120, Math.ceil(Math.max((rel.upCapture ?? 0) * 100, (rel.downCapture ?? 0) * 100) / 25) * 25 + 25);
  const captureTicks = Array.from({ length: Math.floor(captureMax / 25) + 1 }, (_, i) => i * 25);

  const captureData = [
    { name: "Up markets", value: (rel.upCapture ?? 0) * 100, periods: rel.upPeriods },
    { name: "Down markets", value: (rel.downCapture ?? 0) * 100, periods: rel.downPeriods },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Alpha (annualized)"
          value={fmtPercent(rel.alpha)}
          tone={toneForValue(rel.alpha)}
          sub={rel.alphaTStat === null ? undefined : `t = ${fmtRatio(rel.alphaTStat)}, p = ${fmtRatio(rel.alphaPValue, 3)}`}
          hint="Return beyond what the fund's beta to the benchmark would predict. The t-statistic says whether it is distinguishable from luck."
          testId="stat-alpha"
        />
        <Stat
          label="Beta"
          value={fmtRatio(rel.beta)}
          sub={rel.upBeta !== null && rel.downBeta !== null ? `Up ${fmtRatio(rel.upBeta)} / down ${fmtRatio(rel.downBeta)}` : undefined}
          hint="Sensitivity to benchmark moves. Beta of 0.5 means the fund typically moves half as much as the index."
          testId="stat-beta"
        />
        <Stat
          label="Information ratio"
          value={fmtRatio(rel.informationRatio)}
          tone={toneForValue(rel.informationRatio)}
          sub={`Tracking error ${fmtPercent(rel.trackingError)}`}
          hint="Active return per unit of active risk. Above 0.5 is generally considered good over a full cycle."
          testId="stat-information-ratio"
        />
        <Stat
          label="Correlation / R²"
          value={`${fmtRatio(rel.correlation)} / ${fmtRatio(rel.rSquared)}`}
          sub={`Downside corr ${fmtRatio(rel.downsideCorrelation)}`}
          hint="R² is the share of the fund's variance explained by the benchmark. A high R² with low alpha means expensive index exposure."
          testId="stat-correlation"
        />
      </div>

      {rel.alphaIsSignificant === false && (
        <Alert data-testid="alert-alpha-significance">
          <Info className="h-4 w-4" />
          <AlertDescription>
            Alpha of {fmtPercent(rel.alpha)} carries a t-statistic of {fmtRatio(rel.alphaTStat)} (p = {fmtRatio(rel.alphaPValue, 3)}),
            so it cannot be distinguished from zero at the 95% level. Over {rel.observations} observations this track record does not
            yet establish skill against {benchName}, whatever the headline number suggests.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Return regression"
          description={`Each point is one ${periodWord}: fund return against ${benchName}`}
          testId="card-scatter"
        >
          {scatterData.length === 0 ? (
            <EmptyNote>No paired observations available.</EmptyNote>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={300}>
                <ScatterChart margin={{ top: 5, right: 12, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    name={benchName}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                    label={{ value: benchName, position: "insideBottom", offset: -4, fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    name={meta.fundName}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    width={46}
                    tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                  />
                  <ZAxis range={[45, 45]} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    cursor={{ strokeDasharray: "3 3" }}
                    formatter={(value: number, name: string) => [`${value.toFixed(2)}%`, name]}
                    labelFormatter={() => ""}
                  />
                  <ReferenceLine x={0} stroke="hsl(var(--muted-foreground))" />
                  <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                  <Scatter name={`${periodWord} returns`} data={scatterData} fill={FUND_COLOR} fillOpacity={0.6} />
                  {fitLine.length === 2 && (
                    <Scatter name="CAPM fit" data={fitLine} line={{ stroke: ACCENT_COLOR, strokeWidth: 2 }} shape={() => <g />} />
                  )}
                </ScatterChart>
              </ResponsiveContainer>
              <ChartNote>
                The fitted line's slope is beta ({fmtRatio(rel.beta)}) and its intercept is alpha. Points scattered widely around
                the line mean low R² — most of the fund's behaviour is not explained by this benchmark, which is either genuine
                diversification or the wrong benchmark.
              </ChartNote>
            </>
          )}
        </SectionCard>

        <SectionCard
          title="Market capture"
          description={`Share of benchmark moves captured, split by direction`}
          testId="card-capture"
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={captureData} layout="vertical" margin={{ top: 5, right: 40, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis
                type="number"
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickLine={false}
                // Always include 100% so the full-participation reference line is on
                // screen, with round ticks either side of it.
                domain={[0, (dataMax: number) => Math.max(120, Math.ceil(dataMax / 25) * 25 + 25)]}
                ticks={captureTicks}
                tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              />
              <YAxis
                type="category"
                dataKey="name"
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickLine={false}
                width={96}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v.toFixed(1)}%`, "Capture"]} />
              <ReferenceLine x={100} stroke={BENCHMARK_COLOR} strokeDasharray="4 3" />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={38}>
                {captureData.map((d, i) => (
                  <Cell key={i} fill={i === 0 ? FUND_COLOR : NEGATIVE_COLOR} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Upside capture</div>
              <div className="text-lg font-semibold tabular-nums">{fmtPercent(rel.upCapture, 1)}</div>
              <div className="text-xs text-muted-foreground">{rel.upPeriods} up {periodWord}s</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Downside capture</div>
              <div className="text-lg font-semibold tabular-nums">{fmtPercent(rel.downCapture, 1)}</div>
              <div className="text-xs text-muted-foreground">{rel.downPeriods} down {periodWord}s</div>
            </div>
          </div>
          <ChartNote>
            The dashed line is 100% — full participation. The ideal profile is a long blue bar and a short red one. A capture spread
            of {fmtSignedPercent(rel.captureSpread, 1)}{" "}
            {(rel.captureSpread ?? 0) > 0
              ? "means the manager participates more in rallies than in selloffs."
              : "means the manager takes more of the downside than the upside, which erodes value over a cycle."}
          </ChartNote>
        </SectionCard>
      </div>

      <SectionCard
        title={`${rolling.windowLabel} beta and correlation`}
        description="Whether market exposure is stable or drifting"
        testId="card-rolling-beta"
      >
        {rollingBeta.length < 2 ? (
          <EmptyNote>Not enough history to build a rolling window.</EmptyNote>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={rollingBeta} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="label"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={11}
                  tickLine={false}
                  interval={axisInterval(rollingBeta.length)}
                />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} width={44} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, name: string) => [v.toFixed(3), name]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                <Line type="monotone" dataKey="beta" name="Rolling beta" stroke={FUND_COLOR} strokeWidth={2} dot={false} />
                <Line
                  type="monotone"
                  dataKey="correlation"
                  name="Rolling correlation"
                  stroke={BENCHMARK_COLOR}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
            <ChartNote>
              Both series share a unitless scale, so they belong on one axis. Beta drifting upward over time means the manager is
              adding market exposure; correlation rising toward 1 in stressed periods is the classic failure of a diversifier
              precisely when the diversification was needed.
            </ChartNote>
          </>
        )}
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Exposure decomposition" description="How much of the return is market, how much is manager" testId="card-decomposition">
          <MetricTable>
            <MetricRow
              label="Beta (full period)"
              value={fmtRatio(rel.beta)}
              hint="Slope of the regression of fund excess return on benchmark excess return."
            />
            <MetricRow
              label="Up-market beta"
              value={fmtRatio(rel.upBeta)}
              hint="Beta estimated only over periods when the benchmark rose."
            />
            <MetricRow
              label="Down-market beta"
              value={fmtRatio(rel.downBeta)}
              hint="Beta estimated only over periods when the benchmark fell. Lower than up-beta is the desirable asymmetry."
            />
            <MetricRow
              label="Beta asymmetry"
              value={fmtRatio(rel.betaAsymmetry)}
              tone={toneForValue(rel.betaAsymmetry)}
              hint="Up-beta minus down-beta. Positive means the fund is more exposed in rallies than selloffs."
            />
            <MetricRow
              label="R²"
              value={fmtRatio(rel.rSquared)}
              hint="Share of the fund's variance explained by the benchmark. Above 0.9 with little alpha is closet indexing."
            />
            <MetricRow
              label="Residual volatility"
              value={fmtPercent(rel.residualVolatility)}
              hint="Annualized volatility of the part of returns the benchmark does not explain — the manager's own risk."
            />
            <MetricRow
              label="Appraisal ratio"
              value={fmtRatio(rel.appraisalRatio)}
              tone={toneForValue(rel.appraisalRatio)}
              hint="Alpha per unit of residual volatility. Measures skill per unit of idiosyncratic risk taken to get it."
            />
          </MetricTable>
        </SectionCard>

        <SectionCard title="Relative performance statistics" description="Active return, consistency and risk-adjusted comparison" testId="card-relative-stats">
          <MetricTable fundLabel={meta.fundName} benchmarkLabel={benchName} showBenchmark>
            <MetricRow
              label="Annualized return"
              value={fmtPercent(analytics.performance.annualizedReturn)}
              benchmark={fmtPercent(rel.benchmarkAnnualizedReturn)}
              showBenchmark
              tone={toneForValue(analytics.performance.annualizedReturn)}
            />
            <MetricRow
              label="Annualized volatility"
              value={fmtPercent(rel.fundVolatility)}
              benchmark={fmtPercent(rel.benchmarkVolatility)}
              showBenchmark
            />
            <MetricRow
              label="Active premium"
              value={fmtSignedPercent(rel.activePremium)}
              tone={toneForValue(rel.activePremium)}
              showBenchmark
              hint="Fund annualized return minus benchmark annualized return."
            />
            <MetricRow
              label="Tracking error"
              value={fmtPercent(rel.trackingError)}
              showBenchmark
              hint="Volatility of the return difference. Low tracking error with low alpha means the manager is hugging the index."
            />
            <MetricRow
              label="Batting average"
              value={fmtPercent(rel.battingAverage, 1)}
              tone={toneForValue(rel.battingAverage - 0.5)}
              showBenchmark
              hint={`Share of ${periodWord}s in which the fund beat the benchmark.`}
            />
            <MetricRow
              label="Treynor ratio"
              value={fmtPercent(rel.treynorRatio)}
              showBenchmark
              hint="Excess return per unit of beta, rather than per unit of total volatility."
            />
            <MetricRow
              label="M² (Modigliani)"
              value={fmtPercent(rel.m2)}
              showBenchmark
              benchmark={fmtPercent(rel.benchmarkAnnualizedReturn)}
              hint="The return the fund would have earned if leveraged or de-leveraged to the benchmark's volatility. Directly comparable with the benchmark return beside it."
            />
            <MetricRow
              label="M² alpha"
              value={fmtSignedPercent(rel.m2Alpha)}
              tone={toneForValue(rel.m2Alpha)}
              showBenchmark
              hint="M² minus the benchmark return — the value added after equalising for risk."
            />
          </MetricTable>
        </SectionCard>
      </div>

      <SectionCard title="Calendar year relative performance" description={`Fund against ${benchName}, year by year`} testId="card-calendar-relative">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="pb-2 text-left text-xs font-medium text-muted-foreground">Year</th>
                <th className="pb-2 text-right text-xs font-medium text-muted-foreground">{meta.fundName}</th>
                <th className="pb-2 pl-3 text-right text-xs font-medium text-muted-foreground">{benchName}</th>
                <th className="pb-2 pl-3 text-right text-xs font-medium text-muted-foreground">Excess</th>
                <th className="pb-2 pl-3 text-left text-xs font-medium text-muted-foreground">Result</th>
              </tr>
            </thead>
            <tbody>
              {analytics.performance.calendarYears.map((y) => (
                <tr key={y.year} className="border-b last:border-0" data-testid={`row-year-${y.year}`}>
                  <td className="py-2 text-sm">
                    <span className="inline-flex items-center gap-2">
                      {y.year}
                      {y.partial && (
                        <Badge variant="outline" className="h-4 px-1 text-[10px]">
                          partial
                        </Badge>
                      )}
                    </span>
                  </td>
                  <td className={`py-2 text-right text-sm font-medium tabular-nums ${toneForValue(y.fund)}`}>
                    {fmtPercent(y.fund)}
                  </td>
                  <td className="py-2 pl-3 text-right text-sm tabular-nums text-muted-foreground">{fmtPercent(y.benchmark)}</td>
                  <td className={`py-2 pl-3 text-right text-sm tabular-nums ${toneForValue(y.excess)}`}>
                    {fmtSignedPercent(y.excess)}
                  </td>
                  <td className="py-2 pl-3 text-sm">
                    {y.excess === null ? (
                      "—"
                    ) : (
                      <Badge
                        variant="outline"
                        className={
                          y.excess >= 0
                            ? "h-5 border-emerald-500/30 px-1.5 text-[10px] text-emerald-500"
                            : "h-5 border-red-500/30 px-1.5 text-[10px] text-red-500"
                        }
                      >
                        {y.excess >= 0 ? "outperformed" : "trailed"}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ChartNote>
          Consistency across years matters more than the total. A manager who beat the index in most years is telling a different
          story from one whose entire edge came from a single year — even if the cumulative numbers match.
        </ChartNote>
      </SectionCard>
    </div>
  );
}
