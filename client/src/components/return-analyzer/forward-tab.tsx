/**
 * Forward-looking tab: what the realised distribution implies about the future,
 * stated as a range rather than a point estimate.
 *
 * The framing is deliberate. A committee asked to approve capital needs the
 * downside case, not a single expected return — and it needs to see that the
 * projection is a resampling of history, with all the assumption that carries.
 */

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Area,
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
import { Info } from "lucide-react";
import type { Analytics } from "@/lib/return-analytics-types";
import {
  ACCENT_COLOR,
  BENCHMARK_COLOR,
  FUND_COLOR,
  NEGATIVE_COLOR,
  TOOLTIP_STYLE,
  fmtFullDate,
  fmtPercent,
  fmtRatio,
  toneForValue,
} from "@/lib/return-analytics-format";
import { ChartNote, MetricRow, MetricTable, SectionCard, Stat } from "./shared";

export function ForwardTab({ analytics }: { analytics: Analytics }) {
  const sim = analytics.simulation;
  const { meta, risk } = analytics;
  const periodWord = meta.periodLabel.toLowerCase();

  // Recharts stacks bands by drawing cumulative offsets, so convert the
  // percentile levels into widths that stack up to the right boundaries.
  const fanData = sim.percentiles.map((p) => ({
    year: p.yearFraction,
    label: p.yearFraction < 1 ? `${Math.round(p.yearFraction * 12)}m` : `${p.yearFraction.toFixed(1)}y`,
    p5: p.p5 * 100,
    band5to25: (p.p25 - p.p5) * 100,
    band25to75: (p.p75 - p.p25) * 100,
    band75to95: (p.p95 - p.p75) * 100,
    median: p.p50 * 100,
    // Raw levels for the tooltip.
    _p5: p.p5 * 100,
    _p25: p.p25 * 100,
    _p50: p.p50 * 100,
    _p75: p.p75 * 100,
    _p95: p.p95 * 100,
  }));

  const lossData = sim.lossProbabilities.map((l) => ({
    label: `${l.years}y`,
    probability: l.probabilityOfLoss * 100,
    median: l.medianReturn * 100,
  }));

  return (
    <div className="space-y-6">
      <Alert data-testid="alert-simulation-basis">
        <Info className="h-4 w-4" />
        <AlertDescription>
          These projections resample the fund's own realised returns — {sim.paths.toLocaleString()} paths over{" "}
          {sim.horizonYears} years, drawn in blocks of {sim.meanBlockLength} {periodWord}
          {sim.meanBlockLength === 1 ? "" : "s"} on average so that serial dependence in the history is preserved. They assume the
          future distribution resembles the past. That assumption is the thing to interrogate, not the output.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Median outcome"
          value={fmtPercent(sim.terminalAnnualized.p50)}
          tone={toneForValue(sim.terminalAnnualized.p50)}
          sub={`Annualized over ${sim.horizonYears} years`}
          hint="The middle of the simulated distribution — half of paths did better, half worse."
          testId="stat-sim-median"
        />
        <Stat
          label="Downside case (5th pct)"
          value={fmtPercent(sim.terminalAnnualized.p5)}
          tone={toneForValue(sim.terminalAnnualized.p5)}
          sub={`Upside (95th) ${fmtPercent(sim.terminalAnnualized.p95)}`}
          hint="One path in twenty did worse than this. The figure to underwrite against, not the median."
          testId="stat-sim-downside"
        />
        <Stat
          label="Probability of loss"
          value={fmtPercent(sim.probabilityOfLossOverHorizon, 1)}
          tone={sim.probabilityOfLossOverHorizon > 0.15 ? "text-amber-500" : "text-emerald-500"}
          sub={`Over the full ${sim.horizonYears}-year horizon`}
          hint="Share of simulated paths that finished below the starting capital."
          testId="stat-sim-loss-prob"
        />
        <Stat
          label="Expected max drawdown"
          value={fmtPercent(sim.expectedMaxDrawdown.p50)}
          tone="text-red-500"
          sub={`5% chance of worse than ${fmtPercent(sim.expectedMaxDrawdown.p95)}`}
          hint="Median of the worst drawdown reached along each simulated path — typically deeper than the drawdown already realised."
          testId="stat-sim-drawdown"
        />
      </div>

      <SectionCard
        title="Projected outcome range"
        description={`Cumulative return distribution across ${sim.paths.toLocaleString()} simulated paths`}
        testId="card-fan-chart"
      >
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={fanData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="label"
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickLine={false}
              interval={Math.max(0, Math.floor(fanData.length / 10))}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickLine={false}
              width={52}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(_value: number, _name: string, item: any) => {
                const d = item?.payload;
                if (!d) return ["", ""];
                return [
                  `5th ${d._p5.toFixed(1)}% · 25th ${d._p25.toFixed(1)}% · median ${d._p50.toFixed(1)}% · 75th ${d._p75.toFixed(1)}% · 95th ${d._p95.toFixed(1)}%`,
                  "Cumulative return",
                ];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
            {/* Invisible base so the visible bands sit at their true levels. */}
            <Area dataKey="p5" stackId="fan" stroke="none" fill="none" legendType="none" name="" />
            <Area
              dataKey="band5to25"
              stackId="fan"
              stroke="none"
              fill={FUND_COLOR}
              fillOpacity={0.13}
              name="5th–25th percentile"
            />
            <Area
              dataKey="band25to75"
              stackId="fan"
              stroke="none"
              fill={FUND_COLOR}
              fillOpacity={0.28}
              name="25th–75th percentile"
            />
            <Area
              dataKey="band75to95"
              stackId="fan"
              stroke="none"
              fill={FUND_COLOR}
              fillOpacity={0.13}
              name="75th–95th percentile"
            />
            <Line
              type="monotone"
              dataKey="median"
              stroke={ACCENT_COLOR}
              strokeWidth={2.5}
              dot={false}
              name="Median path"
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
        <ChartNote>
          The widening cone is the honest picture: uncertainty compounds with time. The darker central band holds half of all
          outcomes. What matters for sizing is the distance from the median to the lower edge, not the median itself.
        </ChartNote>
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Probability of loss by horizon" description="Share of paths finishing below cost at each anniversary" testId="card-loss-probability">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={lossData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickLine={false}
                width={44}
                tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v.toFixed(1)}%`, "Probability of loss"]} />
              <Bar dataKey="probability" radius={[4, 4, 0, 0]} maxBarSize={48}>
                {lossData.map((d, i) => (
                  <Cell key={i} fill={d.probability > 20 ? NEGATIVE_COLOR : d.probability > 10 ? "hsl(var(--chart-4))" : BENCHMARK_COLOR} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <ChartNote>
            A falling bar profile means time in the strategy reduces loss risk — the signature of a positive-drift strategy. A flat
            or rising profile means holding longer does not rescue the investor.
          </ChartNote>
        </SectionCard>

        <SectionCard title="Simulated outcome percentiles" description={`Annualized return over ${sim.horizonYears} years`} testId="card-sim-percentiles">
          <MetricTable>
            <MetricRow label="95th percentile" value={fmtPercent(sim.terminalAnnualized.p95)} tone="text-emerald-500" hint="Strong outcome: only one path in twenty did better." />
            <MetricRow label="75th percentile" value={fmtPercent(sim.terminalAnnualized.p75)} tone={toneForValue(sim.terminalAnnualized.p75)} />
            <MetricRow label="Median" value={fmtPercent(sim.terminalAnnualized.p50)} tone={toneForValue(sim.terminalAnnualized.p50)} />
            <MetricRow label="25th percentile" value={fmtPercent(sim.terminalAnnualized.p25)} tone={toneForValue(sim.terminalAnnualized.p25)} />
            <MetricRow label="5th percentile" value={fmtPercent(sim.terminalAnnualized.p5)} tone="text-red-500" hint="Adverse outcome: one path in twenty did worse. Size the position so this case is survivable." />
            <MetricRow label="Mean" value={fmtPercent(sim.terminalAnnualized.mean)} hint="Arithmetic average across paths; sits above the median when the distribution is right-skewed." />
            <MetricRow
              label="Worst simulated drawdown"
              value={fmtPercent(sim.expectedMaxDrawdown.worst)}
              tone="text-red-500"
              hint="Deepest drawdown reached on any single simulated path."
            />
          </MetricTable>
          <ChartNote>
            Compare the 5th percentile against the realised maximum drawdown of {fmtPercent(risk.drawdown.maxDrawdown)}. If the
            simulated downside is materially worse than anything in the history, the track record simply has not been long enough to
            have shown the strategy's bad case yet.
          </ChartNote>
        </SectionCard>
      </div>

      <SectionCard
        title="Historical stress windows"
        description="The worst outcomes the strategy has actually delivered"
        testId="card-stress-windows"
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="pb-2 text-left text-xs font-medium text-muted-foreground">Holding period</th>
                <th className="pb-2 text-right text-xs font-medium text-muted-foreground">Worst outcome</th>
                <th className="pb-2 pl-3 text-left text-xs font-medium text-muted-foreground">Window</th>
                {meta.hasBenchmark && (
                  <th className="pb-2 pl-3 text-right text-xs font-medium text-muted-foreground">{meta.benchmarkName}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {risk.worstWindows.map((w) => (
                <tr key={w.label} className="border-b last:border-0" data-testid={`row-stress-${w.periods}`}>
                  <td className="py-2 text-sm">{w.label.replace("Worst ", "")}</td>
                  <td className={`py-2 text-right text-sm font-medium tabular-nums ${toneForValue(w.worstReturn)}`}>
                    {fmtPercent(w.worstReturn)}
                  </td>
                  <td className="py-2 pl-3 text-sm text-muted-foreground">
                    {w.startDate ? `${fmtFullDate(w.startDate)} – ${fmtFullDate(w.endDate)}` : "—"}
                  </td>
                  {meta.hasBenchmark && (
                    <td className="py-2 pl-3 text-right text-sm tabular-nums text-muted-foreground">
                      {fmtPercent(w.benchmarkReturn)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ChartNote>
          These are realised outcomes, not simulations. The worst twelve-month window is the single most useful number for setting a
          redemption-terms expectation: it is the loss a real investor carried for a full year.
        </ChartNote>
      </SectionCard>

      <SectionCard title="Liquidity and terms implications" description="What the loss profile implies for structuring the allocation" testId="card-terms">
        <MetricTable>
          <MetricRow
            label="Longest underwater stretch"
            value={`${risk.drawdown.longestUnderwaterPeriods} ${periodWord}s`}
            hint="Lock-up and gate provisions must be short enough that the investor is not forced to sell inside this window, and long enough that the manager is not forced to."
          />
          <MetricRow
            label="Average recovery time"
            value={risk.drawdown.averageRecoveryPeriods === null ? "—" : `${risk.drawdown.averageRecoveryPeriods.toFixed(1)} ${periodWord}s`}
            hint="Typical time from trough back to high-water mark across completed drawdowns."
          />
          <MetricRow
            label="Time under water"
            value={fmtPercent(risk.drawdown.percentTimeUnderwater, 1)}
            hint="Share of the track record spent below a prior peak — the fraction of the holding period an investor spends waiting."
          />
          <MetricRow
            label="Current position vs high-water mark"
            value={fmtPercent(risk.drawdown.currentDrawdown)}
            tone={risk.drawdown.currentDrawdown < -0.001 ? "text-amber-500" : "text-emerald-500"}
            hint="Below the high-water mark, the manager earns no incentive fee until it is regained — which affects both economics and team retention."
          />
          <MetricRow
            label="Track record length"
            value={`${meta.trackRecordYears.toFixed(1)} years (${meta.periods} ${periodWord}s)`}
            hint="Shorter records leave more of the strategy's bad case unobserved, which is why the simulated downside can exceed anything realised."
          />
          <MetricRow
            label="Minimum track record for statistical confidence"
            value={
              analytics.riskAdjusted.minimumTrackRecordYears === null
                ? "—"
                : `${analytics.riskAdjusted.minimumTrackRecordYears.toFixed(1)} years`
            }
            tone={
              analytics.riskAdjusted.minimumTrackRecordYears !== null &&
              analytics.riskAdjusted.minimumTrackRecordYears > meta.trackRecordYears
                ? "text-amber-500"
                : "text-emerald-500"
            }
            hint="History needed for 95% confidence that the Sharpe is positive. If this exceeds the track record, the result is promising but unproven."
          />
        </MetricTable>
        <ChartNote>
          Structuring follows from this table. A strategy whose longest underwater stretch exceeds the redemption notice period will
          eventually put an investor in the position of wanting out at exactly the moment they cannot get out.
        </ChartNote>
      </SectionCard>
    </div>
  );
}
