/**
 * API surface for the Return Analyzer.
 *
 * Three endpoints, deliberately stateless:
 *   POST /api/return-stream/parse    — upload a file, get back the columns found
 *   POST /api/return-stream/analyze  — send chosen series, get the full pack
 *   GET  /api/return-stream/template — download a correctly shaped CSV template
 *
 * Nothing is persisted. A manager's return stream under evaluation is sensitive
 * pre-trade information, and the analysis is fully reproducible from the file,
 * so there is no reason to hold it server-side.
 */

import type { Express, Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import { storage } from "./storage";
import { get3MonthTBillRate } from "./treasuryRates";
import { analyzeReturnStream } from "./returnStreamAnalytics";
import { assessForCommittee } from "./icRecommendation";
import {
  buildAlignedSeries,
  detectFrequency,
  parseReturnStreamFile,
  type ColumnKind,
} from "./returnStreamParser";

const returnStreamUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".csv", ".tsv", ".txt", ".xlsx", ".xls", ".xlsm"];
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf("."));
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Upload a CSV, TSV or Excel file containing periodic returns or NAVs."));
    }
  },
});

const columnKindSchema = z.enum(["returnPercent", "returnDecimal", "level"]);

const analyzeSchema = z.object({
  dates: z.array(z.string().min(4)).min(6, "At least 6 periods are required."),
  fundValues: z.array(z.number().nullable()),
  fundKind: columnKindSchema.default("returnDecimal"),
  fundName: z.string().trim().min(1).max(160).default("Uploaded Return Stream"),

  // A benchmark may be supplied as a second column in the file...
  benchmarkValues: z.array(z.number().nullable()).nullable().optional(),
  benchmarkKind: columnKindSchema.nullable().optional(),
  benchmarkLabel: z.string().trim().max(160).nullable().optional(),
  // ...or selected from the app's benchmark library.
  benchmarkId: z.string().trim().min(1).nullable().optional(),

  riskFreeRate: z.number().min(-0.05).max(0.5).nullable().optional(),
  minimumAcceptableReturn: z.number().min(-1).max(1).default(0),
  periodsPerYear: z.number().int().positive().max(365).nullable().optional(),
  simulationYears: z.number().int().min(1).max(20).default(5),
  simulationPaths: z.number().int().min(500).max(20000).default(5000),
});

/**
 * Compounds a benchmark's own (typically daily) return series onto the
 * manager's period boundaries.
 *
 * Each manager period i covers (dates[i-1], dates[i]]. The first period has no
 * preceding boundary, so it uses one nominal period length of lookback. This
 * works for any cadence without needing the benchmark and the fund to share a
 * calendar.
 */
export function alignBenchmarkToPeriods(
  managerDates: string[],
  benchmarkSeries: { date: Date; value: number }[],
  periodsPerYear: number
): { returns: (number | null)[]; matchedPeriods: number } {
  const sorted = [...benchmarkSeries]
    .filter((p) => !isNaN(p.date.getTime()) && isFinite(p.value))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (sorted.length === 0) {
    return { returns: managerDates.map(() => null), matchedPeriods: 0 };
  }

  const nominalMs = (365.25 / periodsPerYear) * 86400000;
  const boundaries = managerDates.map((d) => new Date(d).getTime());

  const out: (number | null)[] = [];
  let matched = 0;
  let cursor = 0;

  for (let i = 0; i < boundaries.length; i++) {
    const end = boundaries[i];
    // Half-open window, so a benchmark point on a boundary belongs to one period only.
    const start = i === 0 ? end - nominalMs : boundaries[i - 1];

    let growth = 1;
    let count = 0;
    while (cursor < sorted.length && sorted[cursor].date.getTime() <= start) cursor++;
    let scan = cursor;
    while (scan < sorted.length && sorted[scan].date.getTime() <= end) {
      growth *= 1 + sorted[scan].value;
      count++;
      scan++;
    }
    cursor = scan;

    if (count > 0) {
      out.push(growth - 1);
      matched++;
    } else {
      out.push(null);
    }
  }

  return { returns: out, matchedPeriods: matched };
}

/** Loads a benchmark from the library, whether standard or composite. */
async function loadLibraryBenchmark(
  benchmarkId: string
): Promise<{ name: string; series: { date: Date; value: number }[] } | null> {
  const benchmark = await storage.getBenchmark(benchmarkId);
  if (benchmark) {
    const rows = await storage.getBenchmarkReturns(benchmarkId);
    return {
      name: benchmark.name,
      series: rows.map((r) => ({ date: new Date(r.date), value: parseFloat(r.returnValue ?? "0") })),
    };
  }

  // Composite benchmarks are a weighted blend of their components.
  const composite = await storage.getCompositeBenchmark(benchmarkId);
  if (!composite) return null;

  const components = await storage.getCompositeBenchmarkComponents(benchmarkId);
  if (components.length === 0) return null;

  const byDate = new Map<number, number>();
  let totalWeight = 0;

  for (const component of components) {
    const weight = parseFloat(String(component.weight ?? "0"));
    if (!isFinite(weight) || weight === 0) continue;
    totalWeight += weight;
    const rows = await storage.getBenchmarkReturns(component.benchmarkId);
    for (const row of rows) {
      const t = new Date(row.date).getTime();
      const value = parseFloat(row.returnValue ?? "0");
      if (!isFinite(value)) continue;
      byDate.set(t, (byDate.get(t) ?? 0) + value * weight);
    }
  }

  if (totalWeight <= 0) return null;

  const series = Array.from(byDate.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([t, weighted]) => ({ date: new Date(t), value: weighted / totalWeight }));

  return { name: composite.name, series };
}

export function registerReturnStreamRoutes(app: Express): void {
  /** Step 1 — read the uploaded file and report what was found. */
  app.post(
    "/api/return-stream/parse",
    returnStreamUpload.single("file"),
    async (req: Request, res: Response) => {
      try {
        if (!req.file) {
          return res.status(400).json({ message: "No file was uploaded." });
        }

        const parsed = await parseReturnStreamFile(req.file.originalname, req.file.buffer);

        // Guess which column is the manager and which is the benchmark so the
        // common two-column case needs no user input at all.
        const benchmarkHint = /\b(benchmark|index|s&p|msci|russell|hfri|barclays|bloomberg|agg|acwi|spx|nasdaq|peer)\b/i;
        const suggestedBenchmark = parsed.columns.find(
          (c) => benchmarkHint.test(c.name) && c.detectedKind !== "level"
        );
        const suggestedFund =
          parsed.columns.find((c) => c !== suggestedBenchmark && c.detectedKind !== "level") ??
          parsed.columns.find((c) => c !== suggestedBenchmark) ??
          parsed.columns[0];

        res.json({
          fileName: req.file.originalname,
          dates: parsed.dates,
          rowCount: parsed.rowCount,
          detectedFrequency: parsed.detectedFrequency,
          periodsPerYear: parsed.periodsPerYear,
          warnings: parsed.warnings,
          columns: parsed.columns,
          suggestedFundColumn: suggestedFund ? suggestedFund.index : null,
          suggestedBenchmarkColumn: suggestedBenchmark ? suggestedBenchmark.index : null,
        });
      } catch (error: any) {
        console.error("Return stream parse error:", error);
        res.status(400).json({ message: error?.message || "Could not read the uploaded file." });
      }
    }
  );

  /** Step 2 — run the analytics and the committee assessment. */
  app.post("/api/return-stream/analyze", async (req: Request, res: Response) => {
    try {
      const parseResult = analyzeSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          message: parseResult.error.errors[0]?.message ?? "Invalid analysis request.",
          errors: parseResult.error.errors,
        });
      }
      const body = parseResult.data;

      if (body.dates.length !== body.fundValues.length) {
        return res.status(400).json({ message: "Dates and fund values must be the same length." });
      }

      const notes: string[] = [];
      const periodsPerYear =
        body.periodsPerYear && body.periodsPerYear > 0
          ? body.periodsPerYear
          : detectFrequency(body.dates).periodsPerYear;

      // Resolve the benchmark: an in-file column takes precedence over the library.
      let benchmarkRaw: (number | null)[] | null = null;
      let benchmarkKind: ColumnKind | null = null;
      let benchmarkName: string | null = null;

      if (body.benchmarkValues && body.benchmarkValues.length === body.dates.length) {
        benchmarkRaw = body.benchmarkValues;
        benchmarkKind = body.benchmarkKind ?? "returnDecimal";
        benchmarkName = body.benchmarkLabel || "Benchmark";
      } else if (body.benchmarkId) {
        const library = await loadLibraryBenchmark(body.benchmarkId);
        if (!library) {
          notes.push("The selected benchmark could not be loaded; relative analytics were skipped.");
        } else if (library.series.length === 0) {
          notes.push(
            `"${library.name}" has no stored return history yet. Refresh it on the Custom Benchmarks page, then re-run this analysis.`
          );
        } else {
          const aligned = alignBenchmarkToPeriods(body.dates, library.series, periodsPerYear);
          if (aligned.matchedPeriods < Math.max(6, body.dates.length * 0.6)) {
            notes.push(
              `"${library.name}" only overlaps ${aligned.matchedPeriods} of ${body.dates.length} periods, too little to support relative analytics.`
            );
          } else {
            benchmarkRaw = aligned.returns;
            benchmarkKind = "returnDecimal";
            benchmarkName = library.name;
            if (aligned.matchedPeriods < body.dates.length) {
              notes.push(
                `"${library.name}" covers ${aligned.matchedPeriods} of ${body.dates.length} periods; non-overlapping periods were excluded from every statistic.`
              );
            }
          }
        }
      }

      const aligned = buildAlignedSeries(
        body.dates,
        body.fundValues,
        body.fundKind,
        benchmarkRaw,
        benchmarkKind
      );
      notes.push(...aligned.notes);

      if (aligned.returns.length < 6) {
        return res.status(400).json({
          message: `Only ${aligned.returns.length} usable periods remain after alignment. At least 6 are required.`,
        });
      }

      // Fall back to the live 3-month T-bill when the caller does not pin a rate.
      let riskFreeRate = body.riskFreeRate;
      let riskFreeSource = "User supplied";
      if (riskFreeRate === null || riskFreeRate === undefined) {
        try {
          const tbill = await get3MonthTBillRate();
          riskFreeRate = tbill.rate;
          riskFreeSource = `3-month T-bill, ${tbill.source} (as of ${tbill.date})`;
        } catch {
          riskFreeRate = 0.04;
          riskFreeSource = "Fallback (4.00%) — live rate unavailable";
        }
      }

      const analytics = analyzeReturnStream({
        dates: aligned.dates,
        returns: aligned.returns,
        benchmarkReturns: aligned.benchmarkReturns,
        benchmarkName: aligned.benchmarkReturns ? benchmarkName : null,
        fundName: body.fundName,
        riskFreeRate,
        minimumAcceptableReturn: body.minimumAcceptableReturn,
        periodsPerYear,
        simulationYears: body.simulationYears,
        simulationPaths: body.simulationPaths,
      });

      const assessment = assessForCommittee(analytics);

      res.json({ analytics, assessment, riskFreeSource, notes });
    } catch (error: any) {
      console.error("Return stream analyze error:", error);
      res.status(400).json({ message: error?.message || "Analysis failed." });
    }
  });

  /** A correctly shaped starter file, so the first upload succeeds. */
  app.get("/api/return-stream/template", (_req: Request, res: Response) => {
    const rows = [
      "Date,Fund Net Return,Benchmark Return",
      "2021-01-31,0.0215,0.0112",
      "2021-02-28,-0.0084,0.0261",
      "2021-03-31,0.0132,0.0424",
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="return-stream-template.csv"');
    res.send(
      `${rows.join("\n")}\n` +
        "# Replace the rows above with your own history.\n" +
        "# Date: any recognisable period end (2021-01-31, Jan-21, Q1 2021, 1/31/2021).\n" +
        "# Values: decimals (0.0215), percentages (2.15%), or NAV levels (104.22) — the app detects which.\n" +
        "# The benchmark column is optional; you can also pick a benchmark from the library instead.\n"
    );
  });
}
