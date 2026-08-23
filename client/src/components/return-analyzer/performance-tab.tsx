/**
 * Performance tab: growth of capital, trailing and calendar returns, and the
 * monthly return grid that fund selectors expect to see on a tear sheet.
 */

import { Badge } from "@/components/ui/badge";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Analytics } from "@/lib/return-analytics-types";
import {
  ACCENT_COLOR,
  BENCHMARK_COLOR,
  FUND_COLOR,
  MONTH_LABELS,
  TOOLTIP_STYLE,
  axisInterval,
  fmtDate,
  fmtFullDate,
  fmtPercent,
  fmtRatio,
  fmtSignedPercent,
  toneForValue,
} from "@/lib/return-analytics-format";
import { ChartNote, EmptyNote, SectionCard, Stat } from "./shared";
import { cn } from "@/lib/utils";

/** Background shade for a cell in the monthly grid, scaled to the largest move. */
function heatStyle(value: number | null, scale: number): React.CSSProperties {
  if (value === null || scale <= 0) return {};
  const intensity = Math.min(Math.abs(value) / scale, 1);
  // Alpha floor keeps small moves visible without washing the text out.
  const alpha = 0.1 + intensity * 0.45;
  return value >= 0
    ? { backgroundColor: `hsl(152 60% 42% / ${alpha})` }
    : { backgroundColor: `hsl(0 72% 55% / ${alpha})` };
}

export function PerformanceTab({ analytics }: { analytics: Analytics }) {
  const { performance, meta, relative, rolling } = analytics;
  const hasBenchmark = meta.hasBenchmark;
  const periodWord = meta.periodLabel.toLowerCase();

  const growthData = performance.wealthIndex.map((p) => ({
    date: p.date,
    label: fmtDate(p.date),
    fund: p.fund,
    benchmark: p.benchmark,
  }));

  const calendarData = performance.calendarYears.map((y) => ({
    year: String(y.year),
    fund: y.fund * 100,
    benchmark: y.benchmark === null ? null : y.benchmark * 100,
    partial: y.partial,
  }));

  const rollingData = rolling.points.map((p) => ({
    label: fmtDate(p.date),
    fund: p.return === null ? null : p.return * 100,
    benchmark: p.benchmarkReturn === null ? null : p.benchmarkReturn * 100,
  }));

  const grid = performance.monthlyGrid;
  const heatScale = grid
    ? Math.max(
        ...grid.flatMap((row) => row.months.filter((m): m is number => m !== null).map(Math.abs)),
        0.01
      )
    : 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Cumulative return"
          value={fmtPercent(performance.cumulativeReturn)}
          tone={toneForValue(performance.cumulativeReturn)}
          sub={`${fmtFullDate(meta.startDate)} – ${fmtFullDate(meta.endDate)}`}
          hint="Total compounded growth over the whole track record."
          testId="stat-cumulative"
        />
        <Stat
          label="Annualized return (CAGR)"
          value={fmtPercent(performance.annualizedReturn)}
          tone={toneForValue(performance.annualizedReturn)}
          sub={`Arithmetic ${fmtPercent(performance.arithmeticAnnualizedReturn)}`}
          hint="Geometric mean return per year. It is always at or below the arithmetic mean; the gap widens with volatility."
          testId="stat-cagr"
        />
        <Stat
          label={`Positive ${periodWord}s`}
          value={fmtPercent(performance.hitRate, 1)}
          sub={`${performance.positivePeriods} up / ${performance.negativePeriods} down${performance.flatPeriods ? ` / ${performance.flatPeriods} flat` : ""}`}
          hint="Share of periods with a gain. A high hit rate paired with a low gain-to-loss ratio means many small wins and a few large losses."
          testId="stat-hit-rate"
        />
        <Stat
          label="Gain / loss ratio"
          value={fmtRatio(performance.gainLossRatio)}
          sub={`Avg gain ${fmtPercent(performance.averageGain)} vs avg loss ${fmtPercent(performance.averageLoss)}`}
          hint="Average winning period divided by the absolute average losing period."
          testId="stat-gain-loss"
        />
      </div>

      <SectionCard
        title="Growth of 100"
        description={`Compounded value of an initial 100 invested at inception${hasBenchmark ? `, against ${meta.benchmarkName}` : ""}`}
        testId="card-growth"
      >
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={growthData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="ra-growth-fund" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={FUND_COLOR} stopOpacity={0.35} />
                <stop offset="95%" stopColor={FUND_COLOR} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="label"
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickLine={false}
              interval={axisInterval(growthData.length)}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickLine={false}
              width={52}
              // Anchor to the data rather than zero — for an index the meaningful
              // baseline is the starting value of 100, which the reference line marks.
              domain={[(dataMin: number) => Math.floor(Math.min(dataMin, 100) * 0.96), "auto"]}
              tickFormatter={(v: number) => v.toFixed(0)}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value: number, name: string) => [value.toFixed(2), name]}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine y={100} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
            <Area
              type="monotone"
              dataKey="fund"
              name={meta.fundName}
              stroke={FUND_COLOR}
              strokeWidth={2}
              fill="url(#ra-growth-fund)"
              dot={false}
            />
            {hasBenchmark && (
              <Area
                type="monotone"
                dataKey="benchmark"
                name={meta.benchmarkName ?? "Benchmark"}
                stroke={BENCHMARK_COLOR}
                strokeWidth={2}
                fill="none"
                strokeDasharray="5 4"
                dot={false}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
        <ChartNote>
          Indexed to 100 at the first period. The gap between the lines is cumulative relative performance, which compounds — a
          consistent small edge separates the lines more than one large year does.
        </ChartNote>
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Trailing returns"
          description="Annualized beyond one year; cumulative for shorter windows"
          testId="card-trailing"
        >
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="pb-2 text-left text-xs font-medium text-muted-foreground">Period</th>
                  <th className="pb-2 text-right text-xs font-medium text-muted-foreground">{meta.fundName}</th>
                  {hasBenchmark && (
                    <th className="pb-2 pl-3 text-right text-xs font-medium text-muted-foreground">{meta.benchmarkName}</th>
                  )}
                  {hasBenchmark && <th className="pb-2 pl-3 text-right text-xs font-medium text-muted-foreground">Excess</th>}
                </tr>
              </thead>
              <tbody>
                {performance.periodReturns.map((p) => {
                  const headline = p.annualized ?? p.cumulative;
                  const bench = p.benchmarkAnnualized ?? p.benchmarkCumulative;
                  return (
                    <tr key={p.label} className="border-b last:border-0" data-testid={`row-trailing-${p.label.replace(/\s+/g, "-").toLowerCase()}`}>
                      <td className="py-2 text-sm">
                        <span className="inline-flex items-center gap-2">
                          {p.label}
                          {p.annualized !== null && <span className="text-xs text-muted-foreground">p.a.</span>}
                          {!p.complete && (
                            <Badge variant="outline" className="h-4 px-1 text-[10px]">
                              partial
                            </Badge>
                          )}
                        </span>
                      </td>
                      <td className={cn("py-2 text-right text-sm font-medium tabular-nums", toneForValue(headline))}>
                        {fmtPercent(headline)}
                      </td>
                      {hasBenchmark && (
                        <td className="py-2 pl-3 text-right text-sm tabular-nums text-muted-foreground">{fmtPercent(bench)}</td>
                      )}
                      {hasBenchmark && (
                        <td className={cn("py-2 pl-3 text-right text-sm tabular-nums", toneForValue(p.excess))}>
                          {fmtSignedPercent(p.excess)}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ChartNote>
            A window marked <span className="font-medium">partial</span> holds fewer periods than its label implies, so it is not
            comparable with a full window of the same name.
          </ChartNote>
        </SectionCard>

        <SectionCard title="Calendar year returns" description="Discrete annual performance" testId="card-calendar">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={calendarData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="year" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickLine={false}
                width={46}
                tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value: number, name: string) => [`${value.toFixed(2)}%`, name]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
              <Bar dataKey="fund" name={meta.fundName} radius={[4, 4, 0, 0]} maxBarSize={38}>
                {calendarData.map((d, i) => (
                  <Cell key={i} fill={d.fund >= 0 ? FUND_COLOR : "hsl(var(--chart-5))"} fillOpacity={d.partial ? 0.55 : 1} />
                ))}
              </Bar>
              {hasBenchmark && (
                <Bar
                  dataKey="benchmark"
                  name={meta.benchmarkName ?? "Benchmark"}
                  fill={BENCHMARK_COLOR}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={38}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
          <ChartNote>
            Faded bars are partial years with fewer observations than a full year. Losses are shown in red so a down year reads at a
            glance without relying on the axis.
          </ChartNote>
        </SectionCard>
      </div>

      <SectionCard
        title={`${rolling.windowLabel} returns`}
        description={`Overlapping ${rolling.window}-${periodWord} windows — how the experience varied by entry point`}
        testId="card-rolling-returns"
      >
        {rollingData.length < 2 ? (
          <EmptyNote>Not enough history to build a rolling window.</EmptyNote>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={rollingData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="label"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={11}
                  tickLine={false}
                  interval={axisInterval(rollingData.length)}
                />
                <YAxis
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={11}
                  tickLine={false}
                  width={46}
                  tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value: number, name: string) => [`${value.toFixed(2)}%`, name]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                <Line type="monotone" dataKey="fund" name={meta.fundName} stroke={FUND_COLOR} strokeWidth={2} dot={false} />
                {hasBenchmark && (
                  <Line
                    type="monotone"
                    dataKey="benchmark"
                    name={meta.benchmarkName ?? "Benchmark"}
                    stroke={BENCHMARK_COLOR}
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    dot={false}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
            <ChartNote>
              Each point is the return an investor would have earned over the preceding {rolling.window} {periodWord}s. Points below
              zero are entry dates that were still under water a full window later.
            </ChartNote>
          </>
        )}
      </SectionCard>

      {grid && grid.length > 0 && (
        <SectionCard
          title="Monthly return grid"
          description="Every month of the track record, shaded by magnitude"
          testId="card-monthly-grid"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-separate border-spacing-[2px]">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-left text-xs font-medium text-muted-foreground">Year</th>
                  {MONTH_LABELS.map((m) => (
                    <th key={m} className="px-1 py-1 text-center text-xs font-medium text-muted-foreground">
                      {m}
                    </th>
                  ))}
                  <th className="px-2 py-1 text-right text-xs font-medium text-muted-foreground">Year</th>
                </tr>
              </thead>
              <tbody>
                {grid.map((row) => (
                  <tr key={row.year}>
                    <td className="px-2 py-1 text-xs font-medium tabular-nums">{row.year}</td>
                    {row.months.map((m, i) => (
                      <td
                        key={i}
                        className="rounded px-1 py-1 text-center text-[11px] tabular-nums"
                        style={heatStyle(m, heatScale)}
                        title={m === null ? "No data" : `${MONTH_LABELS[i]} ${row.year}: ${(m * 100).toFixed(2)}%`}
                      >
                        {m === null ? <span className="text-muted-foreground/40">·</span> : (m * 100).toFixed(1)}
                      </td>
                    ))}
                    <td
                      className={cn("px-2 py-1 text-right text-xs font-semibold tabular-nums", toneForValue(row.total))}
                    >
                      {row.total === null ? "—" : `${(row.total * 100).toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ChartNote>
            Values are percent. Shading runs from the largest gain to the largest loss in the grid; a dot marks a month with no
            observation. Sub-monthly data is compounded up to whole months.
          </ChartNote>
        </SectionCard>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={`Best ${periodWord}`}
          value={fmtPercent(performance.bestPeriod)}
          tone="text-emerald-500"
          sub={fmtFullDate(performance.bestPeriodDate)}
          testId="stat-best-period"
        />
        <Stat
          label={`Worst ${periodWord}`}
          value={fmtPercent(performance.worstPeriod)}
          tone="text-red-500"
          sub={fmtFullDate(performance.worstPeriodDate)}
          testId="stat-worst-period"
        />
        <Stat
          label="Longest winning run"
          value={`${performance.longestWinStreak} ${periodWord}s`}
          hint="Longest unbroken sequence of positive periods."
          testId="stat-win-streak"
        />
        <Stat
          label="Longest losing run"
          value={`${performance.longestLossStreak} ${periodWord}s`}
          hint="Longest unbroken sequence of negative periods — a proxy for how long an investor must hold conviction."
          testId="stat-loss-streak"
        />
      </div>

      {hasBenchmark && relative && (
        <SectionCard
          title="Cumulative relative performance"
          description={`Growth of the fund divided by growth of ${meta.benchmarkName}`}
          testId="card-relative-cumulative"
        >
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart
              data={performance.wealthIndex.map((p, i) => ({
                label: fmtDate(p.date),
                relative: (relative.activeCumulative[i] ?? 0) * 100,
              }))}
              margin={{ top: 5, right: 8, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="ra-relative" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={ACCENT_COLOR} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={ACCENT_COLOR} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="label"
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickLine={false}
                interval={axisInterval(performance.wealthIndex.length)}
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
                formatter={(value: number) => [`${value.toFixed(2)}%`, "Cumulative excess"]}
              />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
              <Area type="monotone" dataKey="relative" stroke={ACCENT_COLOR} strokeWidth={2} fill="url(#ra-relative)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
          <ChartNote>
            A rising line means the fund is compounding faster than the benchmark. A long flat stretch means the manager is tracking
            the index rather than adding value, whatever the absolute return looks like.
          </ChartNote>
        </SectionCard>
      )}
    </div>
  );
}
