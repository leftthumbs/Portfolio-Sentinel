/**
 * Small presentational pieces reused across the Return Analyzer tabs.
 */

import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A single statistic with its definition attached.
 *
 * Every metric carries a hover definition — a committee reading "Kappa-3" or
 * "Cornish-Fisher VaR" for the first time should not have to leave the page to
 * find out what it means.
 */
export function Stat({
  label,
  value,
  hint,
  tone,
  sub,
  testId,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
  sub?: string;
  testId?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-card/50 p-3" data-testid={testId}>
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {hint && (
          <UiTooltip>
            <TooltipTrigger asChild>
              <button type="button" className="text-muted-foreground/60 hover:text-foreground" aria-label={`About ${label}`}>
                <Info className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs leading-relaxed">{hint}</TooltipContent>
          </UiTooltip>
        )}
      </div>
      <span className={cn("text-xl font-semibold tabular-nums tracking-tight", tone)}>{value}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}

export function SectionCard({
  title,
  description,
  children,
  action,
  className,
  testId,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <Card className={className} data-testid={testId}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base font-medium">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** A labelled row in a definition-style metric table. */
export function MetricRow({
  label,
  value,
  hint,
  tone,
  benchmark,
  showBenchmark,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
  benchmark?: string;
  showBenchmark?: boolean;
}) {
  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-4 text-sm">
        <span className="inline-flex items-center gap-1.5">
          {label}
          {hint && (
            <UiTooltip>
              <TooltipTrigger asChild>
                <button type="button" className="text-muted-foreground/60 hover:text-foreground" aria-label={`About ${label}`}>
                  <Info className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs leading-relaxed">{hint}</TooltipContent>
            </UiTooltip>
          )}
        </span>
      </td>
      <td className={cn("py-2 text-right text-sm font-medium tabular-nums", tone)}>{value}</td>
      {showBenchmark && <td className="py-2 pl-4 text-right text-sm tabular-nums text-muted-foreground">{benchmark ?? "—"}</td>}
    </tr>
  );
}

export function MetricTable({
  children,
  fundLabel,
  benchmarkLabel,
  showBenchmark,
}: {
  children: ReactNode;
  fundLabel?: string;
  benchmarkLabel?: string | null;
  showBenchmark?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        {(fundLabel || showBenchmark) && (
          <thead>
            <tr className="border-b">
              <th className="pb-2 text-left text-xs font-medium text-muted-foreground">Metric</th>
              <th className="pb-2 text-right text-xs font-medium text-muted-foreground">{fundLabel ?? "Value"}</th>
              {showBenchmark && (
                <th className="pb-2 pl-4 text-right text-xs font-medium text-muted-foreground">{benchmarkLabel ?? "Benchmark"}</th>
              )}
            </tr>
          </thead>
        )}
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** Explains what a chart is showing and how to read it. */
export function ChartNote({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[120px] items-center justify-center rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
