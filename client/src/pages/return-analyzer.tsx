/**
 * Return Analyzer — upload a manager's return stream and produce the full
 * quantitative pack an investment committee needs to vote on an allocation.
 *
 * The flow is three steps, in order:
 *   1. Upload   — CSV or Excel of periodic returns or NAVs.
 *   2. Map      — confirm which column is the manager, which is the benchmark,
 *                 and how each should be read. Nothing is analysed until the
 *                 user confirms this, because misreading percent as decimal is
 *                 a silent 100x error.
 *   3. Analyse  — the tabbed analytics pack and the committee recommendation.
 *
 * Nothing is persisted server-side; the analysis lives in this page's state.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileUp,
  Gauge,
  Info,
  LineChart,
  Loader2,
  RefreshCw,
  Shield,
  Sparkles,
  Telescope,
  Upload,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { AnalyzeResponse, ColumnKind, ParseResponse } from "@/lib/return-analytics-types";
import {
  downloadFile,
  fmtFullDate,
  fmtPercent,
  fmtRatio,
  slugify,
  toCsv,
  toneForValue,
} from "@/lib/return-analytics-format";
import { PerformanceTab } from "@/components/return-analyzer/performance-tab";
import { RiskTab } from "@/components/return-analyzer/risk-tab";
import { EfficiencyTab } from "@/components/return-analyzer/efficiency-tab";
import { BenchmarkTab } from "@/components/return-analyzer/benchmark-tab";
import { ForwardTab } from "@/components/return-analyzer/forward-tab";
import { CommitteeTab } from "@/components/return-analyzer/committee-tab";
import { Stat } from "@/components/return-analyzer/shared";
import { cn } from "@/lib/utils";

const NO_BENCHMARK = "__none__";
const LIBRARY_PREFIX = "lib:";

const COLUMN_KIND_LABELS: Record<ColumnKind, string> = {
  returnPercent: "Periodic return, percent (1.24 = 1.24%)",
  returnDecimal: "Periodic return, decimal (0.0124 = 1.24%)",
  level: "NAV / index level (1,284.55)",
};

interface LibraryBenchmark {
  id: string;
  name: string;
  category?: string | null;
  isComposite?: boolean;
}

/** Step 1 — the dropzone. */
function UploadPanel({
  onFile,
  isUploading,
  error,
}: {
  onFile: (file: File) => void;
  isUploading: boolean;
  error: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    [onFile]
  );

  return (
    <div className="space-y-6">
      <Card data-testid="card-upload">
        <CardHeader>
          <CardTitle className="text-base font-medium">Upload a return stream</CardTitle>
          <CardDescription>
            A CSV or Excel file with one date column and at least one column of periodic returns or NAV levels.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-12 text-center transition-colors",
              isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50",
              isUploading && "pointer-events-none opacity-60"
            )}
            data-testid="dropzone-return-stream"
          >
            {isUploading ? (
              <>
                <Loader2 className="h-9 w-9 animate-spin text-primary" />
                <p className="text-sm font-medium">Reading the file…</p>
              </>
            ) : (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                  <Upload className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">Drop a file here, or click to browse</p>
                  <p className="mt-1 text-xs text-muted-foreground">CSV, TSV, XLS or XLSX — up to 15 MB</p>
                </div>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.tsv,.txt,.xls,.xlsx,.xlsm"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFile(file);
                e.target.value = "";
              }}
              data-testid="input-file"
            />
          </div>

          {error && (
            <Alert variant="destructive" data-testid="alert-upload-error">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Could not read that file</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" asChild data-testid="link-template">
              <a href="/api/return-stream/template" download>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Download CSV template
              </a>
            </Button>
            <span className="text-xs text-muted-foreground">Start here if you are unsure of the format.</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="space-y-2 p-5">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-medium">Formats it reads</h3>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Percentages (1.24%), decimals (0.0124) or NAV levels. Dates as 2021-01-31, Jan-21, Q1 2021 or 1/31/2021. Newest-first
              files, title rows, thousands separators and accounting negatives are all handled.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-2 p-5">
            <Gauge className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-medium">What it computes</h3>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Return, volatility, drawdown, VaR and CVaR, distribution moments, twelve risk-adjusted ratios, full CAPM regression
              against a benchmark, rolling stability, and a block-bootstrap forward simulation.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-2 p-5">
            <Shield className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-medium">What it checks</h3>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Return smoothing and stale marks, serial dependence, track-record sufficiency, data gaps and outliers — the findings
              that decide whether the headline Sharpe can be trusted at all.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Step 2 — confirm the column mapping and analysis settings. */
function MappingPanel({
  parsed,
  benchmarks,
  onAnalyze,
  onReset,
  isAnalyzing,
  error,
}: {
  parsed: ParseResponse;
  benchmarks: LibraryBenchmark[];
  onAnalyze: (config: {
    fundColumn: number;
    fundKind: ColumnKind;
    benchmarkSelection: string;
    benchmarkKind: ColumnKind;
    fundName: string;
    riskFreeRate: number | null;
    minimumAcceptableReturn: number;
    simulationYears: number;
  }) => void;
  onReset: () => void;
  isAnalyzing: boolean;
  error: string | null;
}) {
  const [fundColumn, setFundColumn] = useState<number>(
    parsed.suggestedFundColumn ?? parsed.columns[0]?.index ?? 0
  );
  const [fundKind, setFundKind] = useState<ColumnKind>(
    parsed.columns.find((c) => c.index === (parsed.suggestedFundColumn ?? parsed.columns[0]?.index))?.detectedKind ??
      "returnDecimal"
  );
  const [benchmarkSelection, setBenchmarkSelection] = useState<string>(
    parsed.suggestedBenchmarkColumn !== null ? String(parsed.suggestedBenchmarkColumn) : NO_BENCHMARK
  );
  const [benchmarkKind, setBenchmarkKind] = useState<ColumnKind>(
    parsed.columns.find((c) => c.index === parsed.suggestedBenchmarkColumn)?.detectedKind ?? "returnDecimal"
  );
  const [fundName, setFundName] = useState(parsed.fileName.replace(/\.[^.]+$/, ""));
  const [useLiveRate, setUseLiveRate] = useState(true);
  const [manualRate, setManualRate] = useState("4.00");
  const [marInput, setMarInput] = useState("0.00");
  const [simulationYears, setSimulationYears] = useState("5");

  const fundCol = parsed.columns.find((c) => c.index === fundColumn);
  const benchCol =
    benchmarkSelection !== NO_BENCHMARK && !benchmarkSelection.startsWith(LIBRARY_PREFIX)
      ? parsed.columns.find((c) => c.index === Number(benchmarkSelection))
      : undefined;

  // Show the first few periods as the user will actually read them, so a
  // percent/decimal mix-up is visible before anything is computed.
  const preview = useMemo(() => {
    if (!fundCol) return [];
    return parsed.dates.slice(0, 6).map((date, i) => {
      const raw = fundCol.rawValues[i];
      let asReturn: number | null = null;
      if (raw !== null) {
        if (fundKind === "returnPercent") asReturn = raw / 100;
        else if (fundKind === "returnDecimal") asReturn = raw;
        else if (i > 0 && fundCol.rawValues[i - 1]) asReturn = raw / (fundCol.rawValues[i - 1] as number) - 1;
      }
      return { date, raw, asReturn };
    });
  }, [fundCol, fundKind, parsed.dates]);

  const standardBenchmarks = benchmarks.filter((b) => !b.isComposite);
  const compositeBenchmarks = benchmarks.filter((b) => b.isComposite);

  const rateValue = useLiveRate ? null : Number(manualRate) / 100;
  const rateIsValid = useLiveRate || (isFinite(Number(manualRate)) && Number(manualRate) >= -5 && Number(manualRate) <= 50);
  const marIsValid = isFinite(Number(marInput));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onReset} data-testid="button-back-upload">
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Different file
          </Button>
          <Separator orientation="vertical" className="h-5" />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{parsed.fileName}</span>
            <Badge variant="secondary" className="text-xs">
              {parsed.rowCount} periods
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {parsed.detectedFrequency}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {fmtFullDate(parsed.dates[0])} – {fmtFullDate(parsed.dates[parsed.dates.length - 1])}
            </span>
          </div>
        </div>
      </div>

      {parsed.warnings.length > 0 && (
        <Alert data-testid="alert-parse-warnings">
          <Info className="h-4 w-4" />
          <AlertTitle>Notes on reading the file</AlertTitle>
          <AlertDescription>
            <ul className="ml-4 list-disc space-y-1 text-sm">
              {parsed.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" data-testid="card-mapping">
          <CardHeader>
            <CardTitle className="text-base font-medium">Confirm the columns</CardTitle>
            <CardDescription>
              Detection is a starting point. Check the preview below before running — reading percent as decimal is a hundredfold
              error that no downstream statistic will flag.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="fund-column">Manager / fund column</Label>
                <Select
                  value={String(fundColumn)}
                  onValueChange={(v) => {
                    const idx = Number(v);
                    setFundColumn(idx);
                    const col = parsed.columns.find((c) => c.index === idx);
                    if (col) setFundKind(col.detectedKind);
                  }}
                >
                  <SelectTrigger id="fund-column" data-testid="select-fund-column">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {parsed.columns.map((c) => (
                      <SelectItem key={c.index} value={String(c.index)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fundCol && <p className="text-xs text-muted-foreground">Detected: {fundCol.detectionReason.toLowerCase()}.</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="fund-kind">How to read it</Label>
                <Select value={fundKind} onValueChange={(v) => setFundKind(v as ColumnKind)}>
                  <SelectTrigger id="fund-kind" data-testid="select-fund-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(COLUMN_KIND_LABELS) as ColumnKind[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {COLUMN_KIND_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="benchmark-column">Benchmark</Label>
                <Select
                  value={benchmarkSelection}
                  onValueChange={(v) => {
                    setBenchmarkSelection(v);
                    if (!v.startsWith(LIBRARY_PREFIX) && v !== NO_BENCHMARK) {
                      const col = parsed.columns.find((c) => c.index === Number(v));
                      if (col) setBenchmarkKind(col.detectedKind);
                    }
                  }}
                >
                  <SelectTrigger id="benchmark-column" data-testid="select-benchmark">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-[320px]">
                    <SelectItem value={NO_BENCHMARK}>No benchmark</SelectItem>
                    {parsed.columns.filter((c) => c.index !== fundColumn).length > 0 && (
                      <SelectGroup>
                        <SelectLabel>From this file</SelectLabel>
                        {parsed.columns
                          .filter((c) => c.index !== fundColumn)
                          .map((c) => (
                            <SelectItem key={c.index} value={String(c.index)}>
                              {c.name}
                            </SelectItem>
                          ))}
                      </SelectGroup>
                    )}
                    {compositeBenchmarks.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Custom benchmarks</SelectLabel>
                        {compositeBenchmarks.map((b) => (
                          <SelectItem key={b.id} value={`${LIBRARY_PREFIX}${b.id}`}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {standardBenchmarks.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Benchmark library</SelectLabel>
                        {standardBenchmarks.map((b) => (
                          <SelectItem key={b.id} value={`${LIBRARY_PREFIX}${b.id}`}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Without one, alpha, beta, capture and information ratio cannot be computed.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="benchmark-kind">How to read the benchmark</Label>
                <Select
                  value={benchmarkKind}
                  onValueChange={(v) => setBenchmarkKind(v as ColumnKind)}
                  disabled={!benchCol}
                >
                  <SelectTrigger id="benchmark-kind" data-testid="select-benchmark-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(COLUMN_KIND_LABELS) as ColumnKind[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {COLUMN_KIND_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!benchCol && (
                  <p className="text-xs text-muted-foreground">
                    {benchmarkSelection.startsWith(LIBRARY_PREFIX)
                      ? "Library benchmarks are already stored as decimal returns."
                      : "Applies only to a benchmark column taken from the file."}
                  </p>
                )}
              </div>
            </div>

            <Separator />

            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Preview — first {preview.length} periods as they will be read
              </h4>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Date</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Value in file</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Interpreted return</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className="border-t" data-testid={`row-preview-${i}`}>
                        <td className="px-3 py-1.5 text-sm">{fmtFullDate(row.date)}</td>
                        <td className="px-3 py-1.5 text-right text-sm tabular-nums text-muted-foreground">
                          {row.raw === null ? "—" : row.raw.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                        </td>
                        <td className={cn("px-3 py-1.5 text-right text-sm font-medium tabular-nums", toneForValue(row.asReturn))}>
                          {row.asReturn === null ? (fundKind === "level" && i === 0 ? "opening NAV" : "—") : fmtPercent(row.asReturn)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                If the interpreted returns look a hundred times too large or too small, change "How to read it" above.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-settings">
          <CardHeader>
            <CardTitle className="text-base font-medium">Analysis settings</CardTitle>
            <CardDescription>Assumptions that feed the ratios</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fund-name">Fund name</Label>
              <Input
                id="fund-name"
                value={fundName}
                onChange={(e) => setFundName(e.target.value)}
                maxLength={160}
                data-testid="input-fund-name"
              />
            </div>

            <div className="space-y-2">
              <Label>Risk-free rate</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={useLiveRate ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setUseLiveRate(true)}
                  data-testid="button-live-rate"
                >
                  Live 3M T-bill
                </Button>
                <Button
                  type="button"
                  variant={useLiveRate ? "outline" : "default"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setUseLiveRate(false)}
                  data-testid="button-manual-rate"
                >
                  Set manually
                </Button>
              </div>
              {!useLiveRate && (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.05"
                    value={manualRate}
                    onChange={(e) => setManualRate(e.target.value)}
                    className="h-8"
                    data-testid="input-risk-free-rate"
                  />
                  <span className="text-sm text-muted-foreground">% p.a.</span>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Sets the hurdle in every Sharpe-family ratio and in Jensen's alpha.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mar">Minimum acceptable return</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="mar"
                  type="number"
                  step="0.5"
                  value={marInput}
                  onChange={(e) => setMarInput(e.target.value)}
                  className="h-8"
                  data-testid="input-mar"
                />
                <span className="text-sm text-muted-foreground">% p.a.</span>
              </div>
              <p className="text-xs text-muted-foreground">
                The threshold below which returns count as downside, used by Sortino, Omega and Kappa-3.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sim-years">Simulation horizon</Label>
              <Select value={simulationYears} onValueChange={setSimulationYears}>
                <SelectTrigger id="sim-years" className="h-8" data-testid="select-sim-years">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 3, 5, 7, 10].map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y} year{y === 1 ? "" : "s"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {error && (
              <Alert variant="destructive" data-testid="alert-analyze-error">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              className="w-full"
              disabled={isAnalyzing || !fundCol || !rateIsValid || !marIsValid || fundName.trim().length === 0}
              onClick={() =>
                onAnalyze({
                  fundColumn,
                  fundKind,
                  benchmarkSelection,
                  benchmarkKind,
                  fundName: fundName.trim(),
                  riskFreeRate: rateValue,
                  minimumAcceptableReturn: Number(marInput) / 100,
                  simulationYears: Number(simulationYears),
                })
              }
              data-testid="button-run-analysis"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Running analysis…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Run full analysis
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Headline strip shown above the results tabs. */
function ResultsHeader({
  result,
  onReset,
  onReconfigure,
}: {
  result: AnalyzeResponse;
  onReset: () => void;
  onReconfigure: () => void;
}) {
  const { analytics, assessment } = result;
  const { meta, performance, risk, riskAdjusted } = analytics;

  const handleExportCsv = () => {
    const rows: (string | number | null)[][] = [
      ["Metric", "Value"],
      ["Fund", meta.fundName],
      ["Benchmark", meta.benchmarkName ?? ""],
      ["Period start", meta.startDate],
      ["Period end", meta.endDate],
      ["Observations", meta.periods],
      ["Frequency", meta.frequencyLabel],
      ["Track record (years)", meta.trackRecordYears.toFixed(2)],
      ["Risk-free rate", meta.riskFreeRate],
      [],
      ["Cumulative return", performance.cumulativeReturn],
      ["Annualized return", performance.annualizedReturn],
      ["Annualized volatility", risk.annualizedVolatility],
      ["Downside deviation", risk.downsideDeviation],
      ["Maximum drawdown", risk.drawdown.maxDrawdown],
      ["Ulcer index", risk.drawdown.ulcerIndex],
      ["Time under water", risk.drawdown.percentTimeUnderwater],
      ["Skewness", risk.skewness],
      ["Excess kurtosis", risk.excessKurtosis],
      ["VaR 95% (historical)", risk.var95.historicalVar],
      ["VaR 95% (Cornish-Fisher)", risk.var95.modifiedVar],
      ["CVaR 95% (historical)", risk.var95.historicalCvar],
      ["VaR 99% (Cornish-Fisher)", risk.var99.modifiedVar],
      [],
      ["Sharpe ratio", riskAdjusted.sharpeRatio],
      ["Adjusted Sharpe ratio", riskAdjusted.adjustedSharpe],
      ["Modified Sharpe ratio", riskAdjusted.modifiedSharpe],
      ["Sortino ratio", riskAdjusted.sortinoRatio],
      ["Calmar ratio", riskAdjusted.calmarRatio],
      ["Sterling ratio", riskAdjusted.sterlingRatio],
      ["Burke ratio", riskAdjusted.burkeRatio],
      ["Martin ratio", riskAdjusted.martinRatio],
      ["Omega ratio", riskAdjusted.omegaRatio],
      ["Kappa-3", riskAdjusted.kappaThree],
      ["Gain-to-pain ratio", riskAdjusted.gainToPainRatio],
      ["Probabilistic Sharpe ratio", riskAdjusted.probabilisticSharpe],
      ["Minimum track record (years)", riskAdjusted.minimumTrackRecordYears],
      [],
      ["Lag-1 autocorrelation", analytics.smoothing.lag1Autocorrelation],
      ["Ljung-Box p-value", analytics.smoothing.ljungBoxPValue],
      ["Unsmoothed volatility", analytics.smoothing.unsmoothed?.volatility ?? null],
      ["Unsmoothed Sharpe", analytics.smoothing.unsmoothed?.sharpe ?? null],
    ];

    if (analytics.relative) {
      const r = analytics.relative;
      rows.push(
        [],
        ["Beta", r.beta],
        ["Up-market beta", r.upBeta],
        ["Down-market beta", r.downBeta],
        ["Alpha (annualized)", r.alpha],
        ["Alpha t-statistic", r.alphaTStat],
        ["Alpha p-value", r.alphaPValue],
        ["Correlation", r.correlation],
        ["R-squared", r.rSquared],
        ["Tracking error", r.trackingError],
        ["Information ratio", r.informationRatio],
        ["Treynor ratio", r.treynorRatio],
        ["Upside capture", r.upCapture],
        ["Downside capture", r.downCapture],
        ["Batting average", r.battingAverage],
        ["Appraisal ratio", r.appraisalRatio],
        ["M-squared", r.m2]
      );
    }

    rows.push(
      [],
      ["IC verdict", assessment.verdict],
      ["Composite score", assessment.compositeScore.toFixed(1)],
      ["Analytics subtotal", assessment.rawScore.toFixed(1)],
      ["Data-integrity deduction", assessment.integrityPenalty.toFixed(1)],
      ["Confidence", assessment.confidence]
    );

    // Append the underlying series so the numbers above can be reproduced.
    rows.push([], ["Date", "Fund return", meta.benchmarkName || "Benchmark return", "Cumulative index", "Drawdown"]);
    // Recover the periodic returns from the wealth index, which is always
    // present (the scatter series only exists when a benchmark was supplied).
    const wealth = analytics.performance.wealthIndex;
    analytics.risk.drawdown.series.forEach((point, i) => {
      const prevFund = i === 0 ? 100 : wealth[i - 1].fund;
      const prevBench = i === 0 ? 100 : wealth[i - 1].benchmark;
      const currBench = wealth[i]?.benchmark ?? null;
      rows.push([
        point.date,
        prevFund ? wealth[i].fund / prevFund - 1 : null,
        currBench !== null && prevBench ? currBench / prevBench - 1 : null,
        wealth[i]?.fund ?? null,
        point.drawdown,
      ]);
    });

    downloadFile(`${slugify(meta.fundName)}-analytics.csv`, toCsv(rows), "text/csv;charset=utf-8");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Button variant="ghost" size="sm" onClick={onReconfigure} data-testid="button-reconfigure">
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Change settings
          </Button>
          <Separator orientation="vertical" className="h-5" />
          <span className="font-medium">{analytics.meta.fundName}</span>
          {analytics.meta.benchmarkName && (
            <Badge variant="secondary" className="text-xs">
              vs {analytics.meta.benchmarkName}
            </Badge>
          )}
          <Badge variant="outline" className="text-xs">
            {analytics.meta.periods} {analytics.meta.frequencyLabel.toLowerCase()} periods
          </Badge>
          <span className="text-xs text-muted-foreground">
            {fmtFullDate(analytics.meta.startDate)} – {fmtFullDate(analytics.meta.endDate)}
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCsv} data-testid="button-export-csv">
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Export metrics
          </Button>
          <Button variant="outline" size="sm" onClick={onReset} data-testid="button-new-analysis">
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            New analysis
          </Button>
        </div>
      </div>

      {result.notes.length > 0 && (
        <Alert data-testid="alert-analysis-notes">
          <Info className="h-4 w-4" />
          <AlertTitle>Notes on this analysis</AlertTitle>
          <AlertDescription>
            <ul className="ml-4 list-disc space-y-1 text-sm">
              {result.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat
          label="Annualized return"
          value={fmtPercent(analytics.performance.annualizedReturn)}
          tone={toneForValue(analytics.performance.annualizedReturn)}
          sub={`Cumulative ${fmtPercent(analytics.performance.cumulativeReturn)}`}
          testId="stat-header-return"
        />
        <Stat
          label="Volatility"
          value={fmtPercent(analytics.risk.annualizedVolatility)}
          sub={`Downside ${fmtPercent(analytics.risk.downsideDeviation)}`}
          testId="stat-header-volatility"
        />
        <Stat
          label="Sharpe"
          value={fmtRatio(analytics.riskAdjusted.sharpeRatio)}
          tone={toneForValue(analytics.riskAdjusted.sharpeRatio)}
          sub={`Sortino ${fmtRatio(analytics.riskAdjusted.sortinoRatio)}`}
          testId="stat-header-sharpe"
        />
        <Stat
          label="Max drawdown"
          value={fmtPercent(analytics.risk.drawdown.maxDrawdown)}
          tone="text-red-500"
          sub={`Calmar ${fmtRatio(analytics.riskAdjusted.calmarRatio)}`}
          testId="stat-header-drawdown"
        />
        <Stat
          label="IC verdict"
          value={`${assessment.compositeScore.toFixed(0)}/100`}
          sub={assessment.verdict}
          tone={
            assessment.compositeScore >= 66
              ? "text-emerald-500"
              : assessment.compositeScore >= 50
                ? "text-amber-500"
                : "text-red-500"
          }
          testId="stat-header-verdict"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Risk-free rate: {fmtPercent(analytics.meta.riskFreeRate)} — {result.riskFreeSource}. Minimum acceptable return:{" "}
        {fmtPercent(analytics.meta.minimumAcceptableReturn)}.
      </p>
    </div>
  );
}

export default function ReturnAnalyzerPage() {
  const { toast } = useToast();
  const [parsed, setParsed] = useState<ParseResponse | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("committee");

  // Both endpoints wrap their arrays in a named key rather than returning a
  // bare array, so unwrap defensively before mapping.
  const { data: benchmarksData } = useQuery<{ benchmarks?: LibraryBenchmark[] }>({
    queryKey: ["/api/benchmarks"],
  });
  const { data: compositesData } = useQuery<{ compositeBenchmarks?: LibraryBenchmark[] }>({
    queryKey: ["/api/composite-benchmarks"],
  });

  const benchmarks = useMemo<LibraryBenchmark[]>(() => {
    const standardList = Array.isArray(benchmarksData?.benchmarks) ? benchmarksData.benchmarks : [];
    const compositeList = Array.isArray(compositesData?.compositeBenchmarks) ? compositesData.compositeBenchmarks : [];
    return [
      ...compositeList.map((b) => ({ ...b, isComposite: true })),
      ...standardList.map((b) => ({ ...b, isComposite: false })),
    ];
  }, [benchmarksData, compositesData]);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/return-stream/parse", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "Could not read the file.");
      return payload as ParseResponse;
    },
    onSuccess: (data) => {
      setUploadError(null);
      setResult(null);
      setParsed(data);
      toast({
        title: "File read successfully",
        description: `${data.rowCount} ${data.detectedFrequency} periods across ${data.columns.length} data column${data.columns.length === 1 ? "" : "s"}.`,
      });
    },
    onError: (error: Error) => setUploadError(error.message),
  });

  const analyzeMutation = useMutation({
    mutationFn: async (body: unknown) => {
      const response = await fetch("/api/return-stream/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "Analysis failed.");
      return payload as AnalyzeResponse;
    },
    onSuccess: (data) => {
      setAnalyzeError(null);
      setResult(data);
      setActiveTab("committee");
      toast({
        title: "Analysis complete",
        description: `${data.assessment.verdict} — composite score ${data.assessment.compositeScore.toFixed(0)}/100.`,
      });
    },
    onError: (error: Error) => setAnalyzeError(error.message),
  });

  const handleAnalyze = (config: {
    fundColumn: number;
    fundKind: ColumnKind;
    benchmarkSelection: string;
    benchmarkKind: ColumnKind;
    fundName: string;
    riskFreeRate: number | null;
    minimumAcceptableReturn: number;
    simulationYears: number;
  }) => {
    if (!parsed) return;
    const fundCol = parsed.columns.find((c) => c.index === config.fundColumn);
    if (!fundCol) {
      setAnalyzeError("The selected fund column is no longer available.");
      return;
    }

    const usesLibrary = config.benchmarkSelection.startsWith(LIBRARY_PREFIX);
    const benchCol =
      !usesLibrary && config.benchmarkSelection !== NO_BENCHMARK
        ? parsed.columns.find((c) => c.index === Number(config.benchmarkSelection))
        : undefined;

    analyzeMutation.mutate({
      dates: parsed.dates,
      fundValues: fundCol.rawValues,
      fundKind: config.fundKind,
      fundName: config.fundName,
      benchmarkValues: benchCol ? benchCol.rawValues : null,
      benchmarkKind: benchCol ? config.benchmarkKind : null,
      benchmarkLabel: benchCol ? benchCol.name : null,
      benchmarkId: usesLibrary ? config.benchmarkSelection.slice(LIBRARY_PREFIX.length) : null,
      riskFreeRate: config.riskFreeRate,
      minimumAcceptableReturn: config.minimumAcceptableReturn,
      periodsPerYear: parsed.periodsPerYear,
      simulationYears: config.simulationYears,
      simulationPaths: 5000,
    });
  };

  const reset = () => {
    setParsed(null);
    setResult(null);
    setUploadError(null);
    setAnalyzeError(null);
  };

  return (
    <div className="space-y-6" data-testid="page-return-analyzer">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <LineChart className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">Return Analyzer</h1>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Upload a manager's return stream and produce the full return, risk and risk-adjusted pack — plus a scored investment
          committee recommendation with the red flags and diligence questions the numbers imply.
        </p>
      </div>

      {!parsed && !result && (
        <UploadPanel onFile={(f) => uploadMutation.mutate(f)} isUploading={uploadMutation.isPending} error={uploadError} />
      )}

      {parsed && !result && (
        <MappingPanel
          parsed={parsed}
          benchmarks={benchmarks}
          onAnalyze={handleAnalyze}
          onReset={reset}
          isAnalyzing={analyzeMutation.isPending}
          error={analyzeError}
        />
      )}

      {analyzeMutation.isPending && !result && (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {result && (
        <div className="space-y-6">
          <ResultsHeader result={result} onReset={reset} onReconfigure={() => setResult(null)} />

          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
              <TabsTrigger value="committee" data-testid="tab-committee">
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                IC Recommendation
              </TabsTrigger>
              <TabsTrigger value="performance" data-testid="tab-performance">
                <BarChart3 className="mr-1.5 h-3.5 w-3.5" />
                Performance
              </TabsTrigger>
              <TabsTrigger value="risk" data-testid="tab-risk">
                <Shield className="mr-1.5 h-3.5 w-3.5" />
                Risk
              </TabsTrigger>
              <TabsTrigger value="efficiency" data-testid="tab-efficiency">
                <Gauge className="mr-1.5 h-3.5 w-3.5" />
                Risk-Adjusted
              </TabsTrigger>
              <TabsTrigger value="benchmark" data-testid="tab-benchmark">
                <FileUp className="mr-1.5 h-3.5 w-3.5" />
                Benchmark
              </TabsTrigger>
              <TabsTrigger value="forward" data-testid="tab-forward">
                <Telescope className="mr-1.5 h-3.5 w-3.5" />
                Forward Look
              </TabsTrigger>
            </TabsList>

            <TabsContent value="committee" className="space-y-6">
              <CommitteeTab analytics={result.analytics} assessment={result.assessment} />
            </TabsContent>
            <TabsContent value="performance" className="space-y-6">
              <PerformanceTab analytics={result.analytics} />
            </TabsContent>
            <TabsContent value="risk" className="space-y-6">
              <RiskTab analytics={result.analytics} />
            </TabsContent>
            <TabsContent value="efficiency" className="space-y-6">
              <EfficiencyTab analytics={result.analytics} />
            </TabsContent>
            <TabsContent value="benchmark" className="space-y-6">
              <BenchmarkTab analytics={result.analytics} />
            </TabsContent>
            <TabsContent value="forward" className="space-y-6">
              <ForwardTab analytics={result.analytics} />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}
