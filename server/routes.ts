import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { seedDatabase, ensureDefaultUser, seedBenchmarks, seedAlternativeFunds, seedIntervalFunds } from "./seed";
import { z } from "zod";
import multer from "multer";
import fs from "fs";
import path from "path";
import { parseExcel, parsePDF, convertToHoldings, extractPdfText, extractExcelText, extractCsvText, extractDocxText, type ParsedInvestment } from "./fileParser";
import { generateInvestmentMemo, analyzeDocumentContent } from "./memoGenerator";
import { generateWordDocument, sanitizeFilename } from "./wordGenerator";
import type { MemoTemplateType } from "@shared/schema";
import { listOneDriveFiles, getOneDriveFileContent, searchOneDriveFiles } from "./onedrive";
import { listDriveFiles, searchDriveFiles, getDriveFile, downloadDriveFile } from "./gmail";
import { runBacktest } from "./backtester";
import { analyzeIntervalFund, compareIntervalFunds, type IntervalFundAnalysisOutput } from "./intervalFundAnalyzer";
import { validateIntervalFund, generateDataQualityReport } from "./dataValidation";
import { searchIntervalFundUniverse, reconciledToInsert, type ReconciledFund } from "./intervalFundSources";
import { optimizePortfolio } from "./optimizer";
import { setupAuth } from "./auth";
import { registerReturnStreamRoutes } from "./returnStreamRoutes";
import { getTickerWithMetrics, getHistoricalReturns, calculateAnnualizedMetrics } from "./tickerLookup";
import { get3MonthTBillRate } from "./treasuryRates";
import { calculateBenchmarkMetrics, generateSyntheticBenchmarkReturns, calculateAdvancedTailMetrics, calculateComponentRisk, calculateFactorDecomposition, runMonteCarloStress, type HoldingInfo } from "./riskCalculations";
import { refreshBenchmarkReturns, refreshSingleBenchmark, isRealTicker } from "./benchmarkDataService";
import {
  processReturnsForPeriod,
  processCompositeReturns,
  determineCadence,
  filterReturnsByTimePeriod,
  aggregateReturns,
  calculateMetricsFromAggregated,
  redemptionFrequencyToCadence,
  type TimePeriod as BenchmarkTimePeriod,
  type Cadence,
  type ReturnDataPoint,
} from "./benchmarkCalculations";
import {
  ScenarioEngine,
  holdingsToPortfolioHoldings,
  HISTORICAL_SCENARIOS,
  HYPOTHETICAL_SCENARIOS,
  DEFAULT_FACTORS,
  type ScenarioDefinition,
  type ScenarioShock,
  type PortfolioHolding,
} from "./scenarioEngine";

const MEMOS_DIR = path.join(process.cwd(), "generated_memos");
if (!fs.existsSync(MEMOS_DIR)) {
  fs.mkdirSync(MEMOS_DIR, { recursive: true });
}

function detectPeriodsPerYear(dates: (string | Date)[]): number {
  if (dates.length < 2) return 12;
  const sorted = dates.map(d => new Date(d).getTime()).sort((a, b) => a - b);
  const intervals: number[] = [];
  for (let i = 1; i < Math.min(sorted.length, 20); i++) {
    intervals.push((sorted[i] - sorted[i - 1]) / (1000 * 60 * 60 * 24));
  }
  const avgDays = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  if (avgDays > 60) return 4;
  if (avgDays > 15) return 12;
  return 252;
}

const STRATEGY_FILES_DIR = path.join(process.cwd(), "strategy_files");
if (!fs.existsSync(STRATEGY_FILES_DIR)) {
  fs.mkdirSync(STRATEGY_FILES_DIR, { recursive: true });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      "application/pdf",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
      "application/octet-stream",
    ];
    const allowedExtensions = [".pdf", ".xls", ".xlsx", ".csv", ".doc", ".docx"];
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf("."));
    
    if (allowedMimes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only PDF, Word, Excel, and CSV files are allowed."));
    }
  },
});

const stressTestInputSchema = z.object({
  name: z.string().min(1, "Scenario name is required"),
  equityShock: z.number().min(-1).max(1),
  rateShock: z.number().min(-0.1).max(0.1),
  creditSpreadShock: z.number().min(0).max(0.1),
  fxShock: z.number().min(-0.5).max(0.5),
  portfolioId: z.string().optional(),
  portfolioType: z.enum(["core", "custom"]).optional(),
});

const enhancedStressTestSchema = z.object({
  scenario: z.object({
    name: z.string().min(1),
    description: z.string().optional().default(""),
    category: z.enum(["historical", "hypothetical", "reverse", "monte_carlo"]).default("hypothetical"),
    regime: z.enum(["expansion", "contraction", "crisis"]).optional(),
    shocks: z.object({
      equity: z.number().optional(),
      rates: z.number().optional(),
      credit: z.number().optional(),
      fx: z.number().optional(),
      commodity: z.number().optional(),
      volatility: z.number().optional(),
      inflation: z.number().optional(),
      liquidity: z.number().optional(),
    }),
  }),
  portfolioId: z.string().optional(),
  portfolioType: z.enum(["core", "custom"]).optional(),
  monteCarlo: z.boolean().optional().default(false),
  numSimulations: z.number().min(100).max(10000).optional().default(1000),
  fatTails: z.boolean().optional().default(true),
  degreesOfFreedom: z.number().min(3).max(30).optional().default(5),
});

const reverseStressTestSchema = z.object({
  targetLoss: z.number().min(-1).max(0),
  portfolioId: z.string().optional(),
  portfolioType: z.enum(["core", "custom"]).optional(),
  direction: z.object({
    equity: z.number().optional(),
    rates: z.number().optional(),
    credit: z.number().optional(),
    fx: z.number().optional(),
    commodity: z.number().optional(),
    volatility: z.number().optional(),
    inflation: z.number().optional(),
    liquidity: z.number().optional(),
  }).optional(),
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupAuth(app);
  
  // Ensure default user exists on startup
  await ensureDefaultUser();
  
  // Seed default benchmarks
  await seedBenchmarks();
  await seedAlternativeFunds();
  await seedIntervalFunds();
  
  function aggregateToMonthly(dailyData: any[]): any[] {
    if (dailyData.length <= 36) return dailyData;
    
    const monthlyBuckets = new Map<string, any[]>();
    for (const point of dailyData) {
      const d = new Date(point.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyBuckets.has(key)) monthlyBuckets.set(key, []);
      monthlyBuckets.get(key)!.push(point);
    }

    const result: any[] = [];
    const sortedKeys = [...monthlyBuckets.keys()].sort();
    for (const key of sortedKeys) {
      const points = monthlyBuckets.get(key)!;
      const lastPoint = points[points.length - 1];
      const firstPoint = points[0];
      const startVal = parseFloat(firstPoint.portfolioValue);
      const endVal = parseFloat(lastPoint.portfolioValue);
      const monthlyReturn = startVal > 0 ? (endVal - startVal) / startVal : 0;
      
      result.push({
        ...lastPoint,
        id: `perf-month-${key}`,
        date: `${key}-01`,
        dailyReturn: String(monthlyReturn),
      });
    }
    return result;
  }

  let defaultPortfolioId: string | null = null;

  async function getDefaultPortfolioId(): Promise<string> {
    if (defaultPortfolioId) return defaultPortfolioId;
    
    const portfolio = await seedDatabase();
    defaultPortfolioId = portfolio.id;
    return defaultPortfolioId;
  }

  // Get all portfolios for selection
  app.get("/api/portfolios", async (req, res) => {
    try {
      // Ensure seed data exists
      await getDefaultPortfolioId();
      const portfoliosList = await storage.getPortfolios();
      res.json(portfoliosList);
    } catch (error) {
      console.error("Portfolios list error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get all portfolio options (both core and custom) for unified selection
  app.get("/api/portfolio-options", async (req, res) => {
    try {
      await getDefaultPortfolioId();
      const [corePortfolios, customPortfolios] = await Promise.all([
        storage.getPortfolios(),
        storage.getCustomPortfolios()
      ]);

      const options = [
        ...corePortfolios.map(p => ({
          id: p.id,
          name: p.name,
          type: "core" as const,
          totalValue: p.totalValue,
          description: p.description
        })),
        ...customPortfolios.map(p => ({
          id: p.id,
          name: p.name,
          type: "custom" as const,
          totalValue: null,
          description: p.description
        }))
      ];

      res.json({ options });
    } catch (error) {
      console.error("Portfolio options error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/portfolios", async (req, res) => {
    try {
      const { name, description, totalValue, currency } = req.body;
      
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return res.status(400).json({ message: "Portfolio name is required" });
      }

      const portfolio = await storage.createPortfolio({
        name: name.trim(),
        description: description || null,
        totalValue: totalValue ? String(totalValue) : "0",
        currency: currency || "USD",
      });

      res.status(201).json(portfolio);
    } catch (error) {
      console.error("Create portfolio error:", error);
      res.status(500).json({ message: "Failed to create portfolio" });
    }
  });

  // Get holdings for a portfolio
  app.get("/api/portfolios/:id/holdings", async (req, res) => {
    try {
      const { id } = req.params;
      const holdings = await storage.getHoldings(id);
      res.json(holdings);
    } catch (error) {
      console.error("Get holdings error:", error);
      res.status(500).json({ message: "Failed to get holdings" });
    }
  });

  // Add a holding to a portfolio
  app.post("/api/portfolios/:id/holdings", async (req, res) => {
    try {
      const { id: portfolioId } = req.params;
      const { fundName, ticker, assetClass, marketValue, costBasis } = req.body;

      if (!fundName || typeof fundName !== "string" || fundName.trim().length === 0) {
        return res.status(400).json({ message: "Fund name is required" });
      }
      if (!assetClass) {
        return res.status(400).json({ message: "Asset class is required" });
      }
      if (marketValue === undefined || marketValue === null) {
        return res.status(400).json({ message: "Market value is required" });
      }

      const marketValueNum = parseFloat(marketValue) || 0;
      const costBasisNum = parseFloat(costBasis) || marketValueNum;
      const unrealizedGain = marketValueNum - costBasisNum;

      // Get current portfolio total to calculate allocation
      const portfolio = await storage.getPortfolio(portfolioId);
      if (!portfolio) {
        return res.status(404).json({ message: "Portfolio not found" });
      }

      const currentHoldings = await storage.getHoldings(portfolioId);
      const currentTotal = currentHoldings.reduce((sum, h) => sum + parseFloat(h.marketValue), 0);
      const newTotal = currentTotal + marketValueNum;

      // Calculate allocation percentage for new holding
      const allocation = newTotal > 0 ? (marketValueNum / newTotal) * 100 : 100;

      const holding = await storage.createHolding({
        portfolioId,
        fundName: fundName.trim(),
        ticker: ticker || null,
        assetClass,
        allocation: "0", // Will be recalculated below
        marketValue: String(marketValueNum),
        costBasis: String(costBasisNum),
        unrealizedGain: String(unrealizedGain),
        returnYtd: null,
        return1yr: null,
        return3yr: null,
      });

      // Update portfolio total value
      await storage.updatePortfolioValue(portfolioId, String(newTotal));

      // Recalculate allocations for all holdings
      const allHoldings = await storage.getHoldings(portfolioId);
      for (const h of allHoldings) {
        const newAllocation = newTotal > 0 ? (parseFloat(h.marketValue) / newTotal) * 100 : 0;
        await storage.updateHoldingAllocation(h.id, String(newAllocation.toFixed(2)));
      }

      // Return the updated holding
      const updatedHolding = await storage.getHolding(holding.id);
      res.status(201).json(updatedHolding || holding);
    } catch (error) {
      console.error("Create holding error:", error);
      res.status(500).json({ message: "Failed to add holding" });
    }
  });

  // Delete a holding from a portfolio
  app.delete("/api/portfolios/:portfolioId/holdings/:holdingId", async (req, res) => {
    try {
      const { portfolioId, holdingId } = req.params;
      await storage.deleteHolding(holdingId);

      // Recalculate portfolio total
      const holdings = await storage.getHoldings(portfolioId);
      const newTotal = holdings.reduce((sum, h) => sum + parseFloat(h.marketValue), 0);
      await storage.updatePortfolioValue(portfolioId, String(newTotal));

      // Recalculate allocations for remaining holdings
      for (const h of holdings) {
        const newAllocation = newTotal > 0 ? (parseFloat(h.marketValue) / newTotal) * 100 : 0;
        await storage.updateHoldingAllocation(h.id, String(newAllocation.toFixed(2)));
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Delete holding error:", error);
      res.status(500).json({ message: "Failed to delete holding" });
    }
  });

  app.get("/api/dashboard", async (req, res) => {
    try {
      const portfolioType = (req.query.portfolioType as string) || "core";
      const portfolioId = req.query.portfolioId as string;

      if (portfolioType === "custom" && portfolioId) {
        // Handle custom portfolio dashboard
        const customPortfolio = await storage.getCustomPortfolio(portfolioId);
        if (!customPortfolio) {
          return res.status(404).json({ message: "Custom portfolio not found" });
        }

        const items = await storage.getCustomPortfolioItems(portfolioId);
        const backtests = await storage.getBacktestResults(portfolioId);
        const latestBacktest = backtests.length > 0 ? backtests[0] : null;

        // Map to dashboard-compatible format
        const portfolio = {
          id: customPortfolio.id,
          name: customPortfolio.name,
          totalValue: latestBacktest?.finalValue || "1000000",
          currency: "USD",
          description: customPortfolio.description,
          createdAt: customPortfolio.createdAt,
          isCustom: true
        };

        // Convert custom items to holdings format
        const holdings = items.map((item, idx) => ({
          id: item.id,
          portfolioId: customPortfolio.id,
          fundName: item.name,
          ticker: item.ticker || null,
          assetClass: item.assetClass,
          marketValue: String(parseFloat(item.weight) * (parseFloat(latestBacktest?.finalValue || "1000000") / 100)),
          costBasis: null,
          allocation: item.weight,
          ytdReturn: item.expectedReturn || "0",
          oneYearReturn: item.expectedReturn || "0",
          threeYearReturn: item.expectedReturn || "0",
          fiveYearReturn: item.expectedReturn || "0",
          sharpeRatio: null,
          sortino: null,
          maxDrawdown: null,
          createdAt: new Date()
        }));

        // Generate risk metrics from backtest results
        const riskMetrics = latestBacktest ? {
          id: `custom-${customPortfolio.id}`,
          portfolioId: customPortfolio.id,
          var95: null,
          var99: null,
          cvar95: null,
          cvar99: null,
          volatility: latestBacktest.volatility,
          sharpeRatio: latestBacktest.sharpeRatio,
          sortinoRatio: null,
          calmarRatio: null,
          maxDrawdown: latestBacktest.maxDrawdown,
          beta: null,
          alpha: null,
          trackingError: null,
          informationRatio: null,
          omegaRatio: null,
          sterlingRatio: null,
          burkeRatio: null,
          upsideCapture: null,
          downsideCapture: null,
          ulcerIndex: null,
          painIndex: null,
          gainToPainRatio: null,
          marRatio: null,
          skewness: null,
          kurtosis: null,
          tailRatio: null,
          herfindahlIndex: null,
          diversificationRatio: null,
          treynorRatio: null,
          calculatedAt: latestBacktest.runDate
        } : null;

        // Generate performance history from backtest data, aggregated to monthly
        let performanceHistory: any[] = [];
        if (latestBacktest?.performanceData && Array.isArray(latestBacktest.performanceData)) {
          const rawData = (latestBacktest.performanceData as any[]).map((p: any, idx: number) => ({
            id: `perf-${idx}`,
            portfolioId: customPortfolio.id,
            date: p.date || new Date(Date.now() - (latestBacktest.performanceData as any[]).length * 24*60*60*1000 + idx * 24*60*60*1000),
            portfolioValue: String(p.portfolioValue || p.value || 1000000),
            dailyReturn: p.dailyReturn || "0",
            cumulativeReturn: p.cumulativeReturn || "0",
            benchmark: null,
            benchmarkReturn: null
          }));
          performanceHistory = aggregateToMonthly(rawData);
        }

        res.json({
          portfolio,
          holdings,
          riskMetrics,
          performanceHistory,
          isCustomPortfolio: true
        });
      } else {
        // Handle core portfolio dashboard - dynamically calculate all metrics
        const defaultId = await getDefaultPortfolioId();
        const pid = portfolioId || defaultId;
        const benchmarkId = req.query.benchmarkId as string;

        const rateData = await get3MonthTBillRate();
        const riskFreeRate = rateData.rate;
        
        const [portfolio, holdings, performanceHistory] = await Promise.all([
          storage.getPortfolio(pid),
          storage.getHoldings(pid),
          storage.getPerformanceHistory(pid),
        ]);

        if (!portfolio) {
          return res.status(404).json({ message: "Portfolio not found" });
        }

        const sortedHistory = performanceHistory.sort((a, b) => 
          new Date(a.date).getTime() - new Date(b.date).getTime()
        );

        const dailyReturns = sortedHistory.map(p => parseFloat(p.dailyReturn || "0"));
        const dashboardPPY = detectPeriodsPerYear(sortedHistory.map(p => p.date));

        // Dynamically calculate risk metrics from period returns
        let riskMetrics: any = null;
        if (dailyReturns.length >= 10) {
          const avgReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
          const totalPeriods = dailyReturns.length;
          const years = totalPeriods / dashboardPPY;

          const firstEntry = sortedHistory[0];
          const lastEntry = sortedHistory[sortedHistory.length - 1];
          const startValue = parseFloat(firstEntry.portfolioValue);
          const endValue = parseFloat(lastEntry.portfolioValue);
          const totalReturn = startValue > 0 ? (endValue - startValue) / startValue : 0;
          const annualizedReturn = years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0;

          const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (dailyReturns.length - 1);
          const periodVol = Math.sqrt(variance);
          const annualVolatility = periodVol * Math.sqrt(dashboardPPY);

          const sharpeRatio = annualVolatility > 0 ? (annualizedReturn - riskFreeRate) / annualVolatility : 0;

          let peakValue = startValue;
          let maxDrawdown = 0;
          for (const p of sortedHistory) {
            const val = parseFloat(p.portfolioValue);
            if (val > peakValue) peakValue = val;
            const dd = (peakValue - val) / peakValue;
            if (dd > maxDrawdown) maxDrawdown = dd;
          }

          const sortedReturns = [...dailyReturns].sort((a, b) => a - b);
          const var95Pct = sortedReturns[Math.floor(dailyReturns.length * 0.05)];

          riskMetrics = {
            id: `calc-${pid}`,
            portfolioId: pid,
            var95: var95Pct != null ? String(var95Pct) : null,
            volatility: annualVolatility.toFixed(4),
            sharpeRatio: sharpeRatio.toFixed(4),
            maxDrawdown: (-maxDrawdown).toFixed(4),
            calculatedAt: new Date()
          };
        }

        // Overlay benchmark returns on performance history using date alignment
        let benchReturnsData: any[] = [];
        if (benchmarkId) {
          benchReturnsData = await storage.getBenchmarkReturns(benchmarkId);
        }
        if (benchReturnsData.length === 0) {
          const benchmarks = await storage.getBenchmarks();
          const spyBenchmark = benchmarks.find(b => b.ticker === "SPY") || benchmarks[0];
          if (spyBenchmark) {
            benchReturnsData = await storage.getBenchmarkReturns(spyBenchmark.id);
          }
        }

        // Build date-keyed map for benchmark returns
        const benchReturnsByDate = new Map<string, number>();
        for (const br of benchReturnsData) {
          const dateKey = new Date(br.date).toISOString().split("T")[0];
          benchReturnsByDate.set(dateKey, parseFloat(br.returnValue || "0"));
        }

        const startPortfolioValue = sortedHistory.length > 0 ? parseFloat(sortedHistory[0].portfolioValue) : 1000000;
        let benchmarkCumulativeValue = startPortfolioValue;
        const historyWithBenchmark = sortedHistory.map((p) => {
          const dateKey = new Date(p.date).toISOString().split("T")[0];
          const benchDailyReturn = benchReturnsByDate.get(dateKey) || 0;
          benchmarkCumulativeValue *= (1 + benchDailyReturn);
          return {
            ...p,
            benchmarkValue: String(benchmarkCumulativeValue),
          };
        });

        res.json({
          portfolio,
          holdings,
          riskMetrics,
          performanceHistory: historyWithBenchmark,
          isCustomPortfolio: false
        });
      }
    } catch (error) {
      console.error("Dashboard error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/portfolio", async (req, res) => {
    try {
      const portfolioId = (req.query.portfolioId as string) || await getDefaultPortfolioId();
      
      // First try to get as a core portfolio
      const [corePortfolio, coreHoldings] = await Promise.all([
        storage.getPortfolio(portfolioId),
        storage.getHoldings(portfolioId),
      ]);

      if (corePortfolio) {
        return res.json({ portfolio: corePortfolio, holdings: coreHoldings, isCustomPortfolio: false });
      }

      // If not found as core portfolio, check if it's a custom portfolio
      const customPortfolio = await storage.getCustomPortfolio(portfolioId);
      if (customPortfolio) {
        const customItems = await storage.getCustomPortfolioItems(portfolioId);
        const backtests = await storage.getBacktestResults(portfolioId);
        const latestBacktest = backtests.length > 0 ? backtests[0] : null;

        // Convert custom portfolio to standard portfolio format
        const portfolio = {
          id: customPortfolio.id,
          name: customPortfolio.name,
          description: customPortfolio.description || "",
          totalValue: latestBacktest?.finalValue || latestBacktest?.initialValue || "1000000",
          currency: "USD",
          createdAt: customPortfolio.createdAt,
        };

        // Convert custom portfolio items to holdings format
        const holdings = await Promise.all(customItems.map(async (item) => {
          // Get strategy details if available
          let strategy = null;
          if (item.strategyId) {
            strategy = await storage.getStrategy(item.strategyId);
          }

          const allocationPercent = parseFloat(item.weight) / 100;
          const marketValue = parseFloat(portfolio.totalValue) * allocationPercent;

          return {
            id: item.id,
            portfolioId: customPortfolio.id,
            fundName: item.name,
            ticker: item.ticker || "",
            assetClass: item.assetClass,
            allocation: item.weight,
            marketValue: marketValue.toFixed(2),
            costBasis: marketValue.toFixed(2),
            unrealizedGain: "0",
            returnYtd: item.expectedReturn || "0",
            return1yr: item.expectedReturn || "0",
            return3yr: null,
            return5yr: null,
            returnItd: null,
            volatility: item.volatility || "0",
            sharpeRatio: null,
            maxDrawdown: null,
            beta: null,
            correlation: null,
            createdAt: customPortfolio.createdAt,
          };
        }));

        return res.json({ portfolio, holdings, isCustomPortfolio: true });
      }

      return res.status(404).json({ message: "Portfolio not found" });
    } catch (error) {
      console.error("Portfolio error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/performance", async (req, res) => {
    try {
      const portfolioType = (req.query.portfolioType as string) || "core";
      const portfolioId = req.query.portfolioId as string;

      if (portfolioType === "custom" && portfolioId) {
        // Handle custom portfolio performance
        const customPortfolio = await storage.getCustomPortfolio(portfolioId);
        if (!customPortfolio) {
          return res.status(404).json({ message: "Custom portfolio not found" });
        }

        const backtests = await storage.getBacktestResults(portfolioId);
        const latestBacktest = backtests.length > 0 ? backtests[0] : null;

        const portfolio = {
          id: customPortfolio.id,
          name: customPortfolio.name,
          totalValue: latestBacktest?.finalValue || "1000000",
          currency: "USD",
          description: customPortfolio.description,
          createdAt: customPortfolio.createdAt,
          isCustom: true
        };

        let performanceHistory: any[] = [];
        if (latestBacktest?.performanceData && Array.isArray(latestBacktest.performanceData)) {
          const rawData = (latestBacktest.performanceData as any[]).map((p: any, idx: number) => ({
            id: `perf-${idx}`,
            portfolioId: customPortfolio.id,
            date: p.date || new Date(Date.now() - (latestBacktest.performanceData as any[]).length * 24*60*60*1000 + idx * 24*60*60*1000),
            portfolioValue: String(p.portfolioValue || p.value || 1000000),
            dailyReturn: p.dailyReturn || "0",
            cumulativeReturn: p.cumulativeReturn || "0",
            benchmark: null,
            benchmarkReturn: null
          }));

          performanceHistory = aggregateToMonthly(rawData);
        }

        const totalReturn = latestBacktest?.totalReturn ? parseFloat(latestBacktest.totalReturn) : 0;
        const annualizedReturn = latestBacktest?.annualizedReturn ? parseFloat(latestBacktest.annualizedReturn) : 0;

        res.json({
          portfolio,
          performanceHistory,
          selectedBenchmarks: [],
          metrics: {
            totalReturn,
            annualizedReturn,
            benchmarkReturn: 0,
            alpha: 0,
            bestDay: 0,
            worstDay: 0,
            positivedays: 0,
            totalDays: performanceHistory.length,
          },
          isCustomPortfolio: true
        });
      } else {
        // Handle core portfolio performance - dynamically calculate from selected benchmark
        const pid = portfolioId || await getDefaultPortfolioId();
        const timePeriod = req.query.timePeriod as BenchmarkTimePeriod | undefined;
        const cadence = req.query.cadence as Cadence | undefined;
        const benchmarkId = req.query.benchmarkId as string;

        const [portfolio, performanceHistory, portfolioBenchmarksList, allBenchmarks] = await Promise.all([
          storage.getPortfolio(pid),
          storage.getPerformanceHistory(pid),
          storage.getPortfolioBenchmarks(pid),
          storage.getBenchmarks(),
        ]);

        if (!portfolio) {
          return res.status(404).json({ message: "Portfolio not found" });
        }

        const sortedHistory = performanceHistory.sort((a, b) => 
          new Date(a.date).getTime() - new Date(b.date).getTime()
        );

        const dailyReturns = sortedHistory
          .map(p => p.dailyReturn ? parseFloat(p.dailyReturn) : 0)
          .filter(r => r !== 0);

        const positivedays = dailyReturns.filter(r => r > 0).length;
        const totalDays = dailyReturns.length;
        const bestDay = dailyReturns.length > 0 ? Math.max(...dailyReturns) : 0;
        const worstDay = dailyReturns.length > 0 ? Math.min(...dailyReturns) : 0;

        const firstEntry = sortedHistory[0];
        const lastEntry = sortedHistory[sortedHistory.length - 1];
        const startValue = firstEntry ? parseFloat(firstEntry.portfolioValue) : 0;
        const endValue = lastEntry ? parseFloat(lastEntry.portfolioValue) : 0;
        const totalReturn = startValue > 0 ? (endValue - startValue) / startValue : 0;
        
        const startDateMs = firstEntry ? new Date(firstEntry.date).getTime() : 0;
        const endDateMs = lastEntry ? new Date(lastEntry.date).getTime() : 0;
        const yearsElapsed = (endDateMs - startDateMs) / (365.25 * 24 * 60 * 60 * 1000);
        const annualizedReturn = yearsElapsed > 0 ? Math.pow(1 + totalReturn, 1 / yearsElapsed) - 1 : 0;

        let benchmarkReturn = 0;
        let benchReturnsData: any[] = [];
        if (benchmarkId) {
          benchReturnsData = await storage.getBenchmarkReturns(benchmarkId);
        }
        if (benchReturnsData.length === 0) {
          const spyBenchmark = allBenchmarks.find(b => b.ticker === "SPY") || allBenchmarks[0];
          if (spyBenchmark) {
            benchReturnsData = await storage.getBenchmarkReturns(spyBenchmark.id);
          }
        }
        if (benchReturnsData.length > 0) {
          const sortedBench = benchReturnsData
            .map(br => ({ date: new Date(br.date).getTime(), cumReturn: parseFloat(br.cumulativeReturn || "0") }))
            .sort((a, b) => a.date - b.date);

          const portfolioStart = startDateMs;
          const portfolioEnd = endDateMs;

          const benchInRange = sortedBench.filter(b => b.date >= portfolioStart - 7 * 24*60*60*1000 && b.date <= portfolioEnd + 7 * 24*60*60*1000);
          if (benchInRange.length >= 2) {
            const firstBench = benchInRange[0];
            const lastBench = benchInRange[benchInRange.length - 1];
            benchmarkReturn = (1 + lastBench.cumReturn) / (1 + firstBench.cumReturn) - 1;
          }
        }

        let alpha = totalReturn - benchmarkReturn;
        if (benchReturnsData.length > 0 && benchmarkReturn !== 0) {
          const sortedBenchForOverlap = benchReturnsData
            .map(br => ({ date: new Date(br.date).getTime() }))
            .sort((a, b) => a.date - b.date);
          const benchWindowStart = sortedBenchForOverlap[0].date;
          const benchWindowEnd = sortedBenchForOverlap[sortedBenchForOverlap.length - 1].date;
          const overlapHistory = sortedHistory.filter(p => {
            const t = new Date(p.date).getTime();
            return t >= benchWindowStart - 7 * 24*60*60*1000 && t <= benchWindowEnd + 7 * 24*60*60*1000;
          });
          if (overlapHistory.length >= 2) {
            const oStartVal = parseFloat(overlapHistory[0].portfolioValue);
            const oEndVal = parseFloat(overlapHistory[overlapHistory.length - 1].portfolioValue);
            const portfolioOverlapReturn = oStartVal > 0 ? (oEndVal - oStartVal) / oStartVal : 0;
            alpha = portfolioOverlapReturn - benchmarkReturn;
          }
        }

        // Get benchmark return data for selected benchmarks
        // Download full time series and process based on time period and cadence
        const selectedBenchmarkData: Array<{
          benchmark: typeof allBenchmarks[0];
          returns: any[];
          cadence?: Cadence;
          metrics?: { totalReturn: number; annualizedReturn: number; annualizedVolatility: number; periodCount: number };
        }> = [];

        for (const pb of portfolioBenchmarksList) {
          const benchmark = allBenchmarks.find(b => b.id === pb.benchmarkId);
          if (benchmark) {
            const rawReturns = await storage.getBenchmarkReturns(benchmark.id);
            if (timePeriod) {
              const result = processReturnsForPeriod(
                rawReturns.map(r => ({ date: r.date, returnValue: r.returnValue || "0", cumulativeReturn: r.cumulativeReturn })),
                timePeriod,
                cadence
              );
              selectedBenchmarkData.push({ benchmark, returns: result.returns, cadence: result.cadence, metrics: result.metrics });
            } else {
              selectedBenchmarkData.push({ benchmark, returns: rawReturns });
            }
          }
        }

        res.json({
          portfolio,
          performanceHistory: sortedHistory,
          selectedBenchmarks: selectedBenchmarkData,
          metrics: {
            totalReturn,
            annualizedReturn,
            benchmarkReturn,
            alpha,
            bestDay,
            worstDay,
            positivedays,
            totalDays,
          },
          isCustomPortfolio: false
        });
      }
    } catch (error) {
      console.error("Performance error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/risk", async (req, res) => {
    try {
      const portfolioType = (req.query.portfolioType as string) || "core";
      const portfolioId = req.query.portfolioId as string;

      // Fetch current risk-free rate for Sharpe/Sortino calculations
      const rateData = await get3MonthTBillRate();
      const riskFreeRate = rateData.rate;

      if (portfolioType === "custom" && portfolioId) {
        // Handle custom portfolio risk
        const customPortfolio = await storage.getCustomPortfolio(portfolioId);
        if (!customPortfolio) {
          return res.status(404).json({ message: "Custom portfolio not found" });
        }

        const backtests = await storage.getBacktestResults(portfolioId);
        const latestBacktest = backtests.length > 0 ? backtests[0] : null;
        const items = await storage.getCustomPortfolioItems(portfolioId);

        const portfolio = {
          id: customPortfolio.id,
          name: customPortfolio.name,
          totalValue: latestBacktest?.finalValue || "1000000",
          currency: "USD",
          description: customPortfolio.description,
          createdAt: customPortfolio.createdAt,
          isCustom: true
        };

        // Calculate comprehensive risk metrics from backtest data
        let riskMetrics: any = null;
        if (latestBacktest) {
          const mcStats = latestBacktest.monteCarloStats as any;
          const perfData = latestBacktest.performanceData as any[];
          
          // Detect cadence from performance data dates
          const customPeriodsPerYear = perfData && perfData.length >= 2 
            ? detectPeriodsPerYear(perfData.map((p: any) => p.date))
            : 12;
          
          // Extract returns for additional calculations
          const dailyReturns = perfData?.map((p: any) => parseFloat(p.dailyReturn) || 0) || [];
          const negativeReturns = dailyReturns.filter(r => r < 0);
          
          // Calculate Sortino (downside deviation)
          const avgReturn = dailyReturns.length > 0 ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
          const downsideVariance = negativeReturns.length > 0 
            ? negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length 
            : 0;
          const downsideDeviation = Math.sqrt(downsideVariance) * Math.sqrt(customPeriodsPerYear);
          const annualizedReturn = latestBacktest.annualizedReturn ? parseFloat(latestBacktest.annualizedReturn) : 0;
          const sortinoRatio = downsideDeviation > 0 ? (annualizedReturn - riskFreeRate) / downsideDeviation : null;
          
          // Calculate Calmar (return / abs(max drawdown))
          const maxDrawdown = latestBacktest.maxDrawdown ? Math.abs(parseFloat(latestBacktest.maxDrawdown)) : 0;
          const calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : null;
          
          // Calculate skewness and kurtosis
          let skewness = null;
          let kurtosis = null;
          if (dailyReturns.length > 3) {
            const n = dailyReturns.length;
            const mean = avgReturn;
            const stdDev = Math.sqrt(dailyReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / n);
            if (stdDev > 0) {
              const m3 = dailyReturns.reduce((sum, r) => sum + Math.pow((r - mean) / stdDev, 3), 0) / n;
              const m4 = dailyReturns.reduce((sum, r) => sum + Math.pow((r - mean) / stdDev, 4), 0) / n;
              skewness = m3;
              kurtosis = m4 - 3; // Excess kurtosis
            }
          }
          
          // Calculate gain-to-pain ratio
          const gains = dailyReturns.filter(r => r > 0).reduce((a, b) => a + b, 0);
          const pains = Math.abs(dailyReturns.filter(r => r < 0).reduce((a, b) => a + b, 0));
          const gainToPainRatio = pains > 0 ? gains / pains : null;
          
          // Calculate Omega ratio (threshold-based: sum of returns above threshold / abs(sum of returns below threshold))
          // Using 0 as threshold (standard approach)
          const threshold = 0;
          const gainsAboveThreshold = dailyReturns.filter(r => r > threshold).reduce((a, b) => a + (b - threshold), 0);
          const lossesBelowThreshold = Math.abs(dailyReturns.filter(r => r < threshold).reduce((a, b) => a + (b - threshold), 0));
          const omegaRatio = lossesBelowThreshold > 0 ? gainsAboveThreshold / lossesBelowThreshold : null;
          
          // Calculate Herfindahl Index (concentration) from portfolio weights
          const herfindahlIndex = items.reduce((sum, item) => {
            const weight = parseFloat(item.weight) / 100;
            return sum + weight * weight;
          }, 0);
          
          // VaR and CVaR from Monte Carlo stats (dollar amounts)
          const var95 = mcStats?.valueAtRisk95 ? String(mcStats.valueAtRisk95) : null;
          const cvar95 = mcStats?.expectedShortfall ? String(mcStats.expectedShortfall) : null;
          
          // Get portfolio value for dollar-based VaR calculations
          const currentPortfolioValue = latestBacktest?.finalValue 
            ? parseFloat(latestBacktest.finalValue) 
            : 1000000;
          
          // Calculate VaR99 and CVaR99 from daily returns (as percentages, then convert to dollar amounts)
          let var99: string | null = null;
          let cvar99: string | null = null;
          if (dailyReturns.length >= 10) {
            const sortedReturns = [...dailyReturns].sort((a, b) => a - b);
            const var99Percentile = sortedReturns[Math.floor(dailyReturns.length * 0.01)];
            // Convert period VaR to annual and then to dollar amount
            const var99Annual = var99Percentile * Math.sqrt(customPeriodsPerYear);
            var99 = String(Math.abs(var99Annual) * currentPortfolioValue);
            
            // CVaR99: average of returns below the 1st percentile
            const threshold99 = sortedReturns[Math.floor(dailyReturns.length * 0.01)];
            const tailReturns99 = sortedReturns.filter(r => r <= threshold99);
            if (tailReturns99.length > 0) {
              const avgTailReturn99 = tailReturns99.reduce((sum, r) => sum + r, 0) / tailReturns99.length;
              const cvar99Annual = avgTailReturn99 * Math.sqrt(customPeriodsPerYear);
              cvar99 = String(Math.abs(cvar99Annual) * currentPortfolioValue);
            }
          }
          
          // Get benchmark returns for comparison metrics - use selected benchmark or default to SPY
          const benchmarks = await storage.getBenchmarks();
          const selectedBenchmarkId = req.query.benchmarkId as string;
          let benchReturnsRaw: any[] = [];
          
          if (selectedBenchmarkId) {
            benchReturnsRaw = await storage.getBenchmarkReturns(selectedBenchmarkId);
          }
          if (benchReturnsRaw.length === 0) {
            const spyBenchmark = benchmarks.find(b => b.ticker === "SPY") || benchmarks[0];
            if (spyBenchmark) {
              benchReturnsRaw = await storage.getBenchmarkReturns(spyBenchmark.id);
            }
          }

          let benchmarkReturns: number[] = [];
          let annualizedBenchmarkReturn = 0.10;

          if (benchReturnsRaw.length > 0) {
            const benchReturnsByDate = new Map<string, number>();
            for (const br of benchReturnsRaw) {
              const dateKey = new Date(br.date).toISOString().split("T")[0];
              benchReturnsByDate.set(dateKey, parseFloat(br.returnValue || "0"));
            }
            // Use perfData dates for alignment (or backtestData dates as fallback)
            let alignmentDates: string[] = [];
            if (perfData && perfData.length > 0) {
              alignmentDates = perfData.map(p => new Date(p.date).toISOString().split("T")[0]);
            } else if (latestBacktest?.backtestData) {
              alignmentDates = (JSON.parse(latestBacktest.backtestData) as any[])
                .map(d => new Date(d.date || d.Date).toISOString().split("T")[0]);
            }
            if (alignmentDates.length > 0) {
              benchmarkReturns = alignmentDates.map(dateKey => benchReturnsByDate.get(dateKey) || 0);
            } else {
              benchmarkReturns = benchReturnsRaw.map(r => parseFloat(r.returnValue || "0"));
            }
            const totalBenchReturn = benchmarkReturns.reduce((sum, r) => sum + r, 0);
            annualizedBenchmarkReturn = benchmarkReturns.length > 0 ? totalBenchReturn * (customPeriodsPerYear / benchmarkReturns.length) : 0.10;
          }

          // If no benchmark returns available, generate synthetic benchmark returns
          if (benchmarkReturns.length < 10) {
            benchmarkReturns = generateSyntheticBenchmarkReturns(dailyReturns.length, 0.10, 0.16, customPeriodsPerYear);
            annualizedBenchmarkReturn = 0.10;
          }

          // Calculate benchmark-related metrics
          const benchmarkMetrics = calculateBenchmarkMetrics({
            portfolioReturns: dailyReturns,
            benchmarkReturns,
            riskFreeRate,
            annualizedPortfolioReturn: annualizedReturn,
            annualizedBenchmarkReturn,
            periodsPerYear: customPeriodsPerYear,
          });

          // Calculate Ulcer Index (RMS of drawdowns)
          let ulcerIndex = null;
          if (perfData && perfData.length > 0) {
            let runningMax = 0;
            const drawdowns: number[] = [];
            for (const p of perfData) {
              const value = parseFloat(p.portfolioValue || p.value || "0");
              if (value > runningMax) runningMax = value;
              if (runningMax > 0) {
                drawdowns.push((runningMax - value) / runningMax);
              }
            }
            if (drawdowns.length > 0) {
              const meanSquareDrawdown = drawdowns.reduce((sum, d) => sum + d * d, 0) / drawdowns.length;
              ulcerIndex = Math.sqrt(meanSquareDrawdown);
            }
          }

          // Calculate Pain Index (average drawdown)
          let painIndex = null;
          if (perfData && perfData.length > 0) {
            let runningMax = 0;
            const drawdowns: number[] = [];
            for (const p of perfData) {
              const value = parseFloat(p.portfolioValue || p.value || "0");
              if (value > runningMax) runningMax = value;
              if (runningMax > 0) {
                drawdowns.push((runningMax - value) / runningMax);
              }
            }
            if (drawdowns.length > 0) {
              painIndex = drawdowns.reduce((sum, d) => sum + d, 0) / drawdowns.length;
            }
          }

          // Calculate Sterling Ratio (return / avg drawdown - 10%)
          // Sterling Ratio: use max(painIndex, average drawdown) as denominator
          // Traditional formula subtracts 10% risk-free, but we use direct painIndex if it's positive
          const sterlingRatio = painIndex && painIndex > 0.001 ? annualizedReturn / painIndex : null;

          // Calculate diversification ratio
          let diversificationRatio = null;
          if (items.length > 1) {
            const effectiveN = 1 / herfindahlIndex;
            diversificationRatio = effectiveN / items.length;
          }
          
          riskMetrics = {
            id: `custom-${customPortfolio.id}`,
            portfolioId: customPortfolio.id,
            var95,
            var99,
            cvar95,
            cvar99,
            volatility: latestBacktest.volatility,
            sharpeRatio: latestBacktest.sharpeRatio,
            sortinoRatio: sortinoRatio?.toFixed(4) || null,
            calmarRatio: calmarRatio?.toFixed(4) || null,
            maxDrawdown: latestBacktest.maxDrawdown,
            beta: benchmarkMetrics.beta?.toFixed(4) || null,
            alpha: benchmarkMetrics.alpha?.toFixed(4) || null,
            correlation: benchmarkMetrics.correlation?.toFixed(4) || null,
            downsideCorrelation: benchmarkMetrics.downsideCorrelation?.toFixed(4) || null,
            trackingError: benchmarkMetrics.trackingError?.toFixed(4) || null,
            informationRatio: benchmarkMetrics.informationRatio?.toFixed(4) || null,
            omegaRatio: omegaRatio?.toFixed(4) || null,
            sterlingRatio: sterlingRatio?.toFixed(4) || null,
            burkeRatio: null,
            upsideCapture: benchmarkMetrics.upsideCapture?.toFixed(4) || null,
            downsideCapture: benchmarkMetrics.downsideCapture?.toFixed(4) || null,
            ulcerIndex: ulcerIndex?.toFixed(4) || null,
            painIndex: painIndex?.toFixed(4) || null,
            gainToPainRatio: gainToPainRatio?.toFixed(4) || null,
            marRatio: calmarRatio?.toFixed(4) || null,
            skewness: skewness?.toFixed(4) || null,
            kurtosis: kurtosis?.toFixed(4) || null,
            tailRatio: benchmarkMetrics.tailRatio?.toFixed(4) || null,
            herfindahlIndex: herfindahlIndex?.toFixed(4) || null,
            diversificationRatio: diversificationRatio?.toFixed(4) || null,
            treynorRatio: benchmarkMetrics.treynorRatio?.toFixed(4) || null,
            calculatedAt: latestBacktest.runDate
          };
        }

        let performanceHistory: any[] = [];
        if (latestBacktest?.performanceData && Array.isArray(latestBacktest.performanceData)) {
          // Get benchmark data for performance comparison
          const benchmarks = await storage.getBenchmarks();
          const spyBenchmark = benchmarks.find(b => b.ticker === "SPY") || benchmarks[0];
          let benchReturnsData: any[] = [];
          if (spyBenchmark) {
            benchReturnsData = await storage.getBenchmarkReturns(spyBenchmark.id);
          }

          let cumulativeBenchReturn = 0;
          performanceHistory = (latestBacktest.performanceData as any[]).map((p: any, idx: number) => {
            const benchDailyReturn = benchReturnsData[idx]?.returnValue ? parseFloat(benchReturnsData[idx].returnValue) : 0;
            cumulativeBenchReturn += benchDailyReturn;
            return {
              id: `perf-${idx}`,
              portfolioId: customPortfolio.id,
              date: p.date || new Date(Date.now() - (latestBacktest.performanceData as any[]).length * 24*60*60*1000 + idx * 24*60*60*1000),
              portfolioValue: String(p.portfolioValue || p.value || 1000000),
              dailyReturn: p.dailyReturn || "0",
              cumulativeReturn: p.cumulativeReturn || "0",
              benchmark: spyBenchmark?.ticker || "SPY",
              benchmarkReturn: cumulativeBenchReturn.toFixed(6)
            };
          });
        }

        res.json({
          portfolio,
          riskMetrics,
          performanceHistory,
          isCustomPortfolio: true
        });
      } else {
        // Handle core portfolio risk - dynamically calculate all metrics
        const pid = portfolioId || await getDefaultPortfolioId();
        const benchmarkId = req.query.benchmarkId as string;
        
        const [portfolio, performanceHistory, holdings] = await Promise.all([
          storage.getPortfolio(pid),
          storage.getPerformanceHistory(pid),
          storage.getHoldings(pid),
        ]);

        if (!portfolio) {
          return res.status(404).json({ message: "Portfolio not found" });
        }

        const sortedHistory = performanceHistory.sort((a, b) => 
          new Date(a.date).getTime() - new Date(b.date).getTime()
        );

        const periodsPerYear = detectPeriodsPerYear(sortedHistory.map(p => p.date));
        const periodReturns = sortedHistory.map(p => parseFloat(p.dailyReturn || "0"));

        let riskMetrics: any = null;
        if (periodReturns.length >= 10) {
          const negativeReturns = periodReturns.filter(r => r < 0);
          const avgReturn = periodReturns.reduce((a, b) => a + b, 0) / periodReturns.length;
          const totalPeriods = periodReturns.length;
          const years = totalPeriods / periodsPerYear;

          const firstEntry = sortedHistory[0];
          const lastEntry = sortedHistory[sortedHistory.length - 1];
          const startValue = parseFloat(firstEntry.portfolioValue);
          const endValue = parseFloat(lastEntry.portfolioValue);
          const totalReturn = startValue > 0 ? (endValue - startValue) / startValue : 0;
          const annualizedReturn = years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0;

          const variance = periodReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (periodReturns.length - 1);
          const periodVol = Math.sqrt(variance);
          const annualVolatility = periodVol * Math.sqrt(periodsPerYear);

          const sharpeRatio = annualVolatility > 0 ? (annualizedReturn - riskFreeRate) / annualVolatility : 0;

          const downsideVariance = negativeReturns.length > 0
            ? negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length
            : 0;
          const downsideDeviation = Math.sqrt(downsideVariance) * Math.sqrt(periodsPerYear);
          const sortinoRatio = downsideDeviation > 0 ? (annualizedReturn - riskFreeRate) / downsideDeviation : null;

          let peakValue = startValue;
          let maxDrawdown = 0;
          for (const p of sortedHistory) {
            const val = parseFloat(p.portfolioValue);
            if (val > peakValue) peakValue = val;
            const dd = (peakValue - val) / peakValue;
            if (dd > maxDrawdown) maxDrawdown = dd;
          }

          const calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : null;

          let skewness = null;
          let kurtosis = null;
          if (periodReturns.length > 3) {
            const n = periodReturns.length;
            const stdDev = Math.sqrt(periodReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / n);
            if (stdDev > 0) {
              skewness = periodReturns.reduce((sum, r) => sum + Math.pow((r - avgReturn) / stdDev, 3), 0) / n;
              kurtosis = periodReturns.reduce((sum, r) => sum + Math.pow((r - avgReturn) / stdDev, 4), 0) / n - 3;
            }
          }

          const gains = periodReturns.filter(r => r > 0).reduce((a, b) => a + b, 0);
          const pains = Math.abs(periodReturns.filter(r => r < 0).reduce((a, b) => a + b, 0));
          const gainToPainRatio = pains > 0 ? gains / pains : null;

          const gainsAboveThreshold = periodReturns.filter(r => r > 0).reduce((a, b) => a + b, 0);
          const lossesBelowThreshold = Math.abs(periodReturns.filter(r => r < 0).reduce((a, b) => a + b, 0));
          const omegaRatio = lossesBelowThreshold > 0 ? gainsAboveThreshold / lossesBelowThreshold : null;

          const sortedReturns = [...periodReturns].sort((a, b) => a - b);
          const var95Pct = sortedReturns[Math.floor(periodReturns.length * 0.05)];
          const var99Pct = sortedReturns[Math.floor(periodReturns.length * 0.01)];
          const var95 = var95Pct != null ? String(var95Pct) : null;
          const var99 = var99Pct != null ? String(var99Pct) : null;

          const tailReturns95 = sortedReturns.filter(r => r <= (var95Pct || 0));
          const cvar95 = tailReturns95.length > 0
            ? String(tailReturns95.reduce((sum, r) => sum + r, 0) / tailReturns95.length)
            : null;
          const tailReturns99 = sortedReturns.filter(r => r <= (var99Pct || 0));
          const cvar99 = tailReturns99.length > 0
            ? String(tailReturns99.reduce((sum, r) => sum + r, 0) / tailReturns99.length)
            : null;

          let ulcerIndex = null;
          let painIndex = null;
          {
            let runningMax = 0;
            const drawdowns: number[] = [];
            for (const p of sortedHistory) {
              const value = parseFloat(p.portfolioValue);
              if (value > runningMax) runningMax = value;
              if (runningMax > 0) drawdowns.push((runningMax - value) / runningMax);
            }
            if (drawdowns.length > 0) {
              ulcerIndex = Math.sqrt(drawdowns.reduce((sum, d) => sum + d * d, 0) / drawdowns.length);
              painIndex = drawdowns.reduce((sum, d) => sum + d, 0) / drawdowns.length;
            }
          }

          const sterlingRatio = painIndex && painIndex > 0.001 ? annualizedReturn / painIndex : null;

          const herfindahlIndex = holdings.reduce((sum, h) => {
            const weight = parseFloat(h.allocation) / 100;
            return sum + weight * weight;
          }, 0);

          let diversificationRatio = null;
          if (holdings.length > 1 && herfindahlIndex > 0) {
            diversificationRatio = (1 / herfindahlIndex) / holdings.length;
          }

          let benchmarkReturns: number[] = [];
          let annualizedBenchmarkReturn = 0.10;

          // Get benchmark returns and date-align with portfolio returns
          let benchReturnsRaw: any[] = [];
          if (benchmarkId) {
            benchReturnsRaw = await storage.getBenchmarkReturns(benchmarkId);
          }
          if (benchReturnsRaw.length === 0) {
            const benchmarks = await storage.getBenchmarks();
            const spyBenchmark = benchmarks.find(b => b.ticker === "SPY") || benchmarks[0];
            if (spyBenchmark) {
              benchReturnsRaw = await storage.getBenchmarkReturns(spyBenchmark.id);
            }
          }

          if (benchReturnsRaw.length > 0) {
            const benchReturnsByDate = new Map<string, number>();
            for (const br of benchReturnsRaw) {
              const dateKey = new Date(br.date).toISOString().split("T")[0];
              benchReturnsByDate.set(dateKey, parseFloat(br.returnValue || "0"));
            }
            benchmarkReturns = sortedHistory.map(p => {
              const dateKey = new Date(p.date).toISOString().split("T")[0];
              return benchReturnsByDate.get(dateKey) || 0;
            });
            const totalBenchReturn = benchmarkReturns.reduce((sum, r) => sum + r, 0);
            annualizedBenchmarkReturn = totalBenchReturn * (periodsPerYear / benchmarkReturns.length);
          }

          if (benchmarkReturns.length < 10) {
            benchmarkReturns = generateSyntheticBenchmarkReturns(periodReturns.length, 0.10, 0.16, periodsPerYear);
            annualizedBenchmarkReturn = 0.10;
          }

          const benchmarkMetrics = calculateBenchmarkMetrics({
            portfolioReturns: periodReturns,
            benchmarkReturns,
            riskFreeRate,
            annualizedPortfolioReturn: annualizedReturn,
            annualizedBenchmarkReturn,
            periodsPerYear,
          });

          riskMetrics = {
            id: `calc-${pid}`,
            portfolioId: pid,
            var95,
            var99,
            cvar95,
            cvar99,
            volatility: annualVolatility.toFixed(4),
            sharpeRatio: sharpeRatio.toFixed(4),
            sortinoRatio: sortinoRatio?.toFixed(4) || null,
            calmarRatio: calmarRatio?.toFixed(4) || null,
            maxDrawdown: (-maxDrawdown).toFixed(4),
            beta: benchmarkMetrics.beta?.toFixed(4) || null,
            alpha: benchmarkMetrics.alpha?.toFixed(4) || null,
            correlation: benchmarkMetrics.correlation?.toFixed(4) || null,
            downsideCorrelation: benchmarkMetrics.downsideCorrelation?.toFixed(4) || null,
            trackingError: benchmarkMetrics.trackingError?.toFixed(4) || null,
            informationRatio: benchmarkMetrics.informationRatio?.toFixed(4) || null,
            omegaRatio: omegaRatio?.toFixed(4) || null,
            sterlingRatio: sterlingRatio?.toFixed(4) || null,
            burkeRatio: null,
            upsideCapture: benchmarkMetrics.upsideCapture?.toFixed(4) || null,
            downsideCapture: benchmarkMetrics.downsideCapture?.toFixed(4) || null,
            ulcerIndex: ulcerIndex?.toFixed(4) || null,
            painIndex: painIndex?.toFixed(4) || null,
            gainToPainRatio: gainToPainRatio?.toFixed(4) || null,
            marRatio: calmarRatio?.toFixed(4) || null,
            skewness: skewness?.toFixed(4) || null,
            kurtosis: kurtosis?.toFixed(4) || null,
            tailRatio: benchmarkMetrics.tailRatio?.toFixed(4) || null,
            herfindahlIndex: herfindahlIndex?.toFixed(4) || null,
            diversificationRatio: diversificationRatio?.toFixed(4) || null,
            treynorRatio: benchmarkMetrics.treynorRatio?.toFixed(4) || null,
            jensensAlpha: benchmarkMetrics.alpha?.toFixed(4) || null,
            calculatedAt: new Date()
          };
        }

        res.json({
          portfolio,
          riskMetrics,
          performanceHistory: sortedHistory,
          isCustomPortfolio: false
        });
      }
    } catch (error) {
      console.error("Risk error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/risk/advanced", async (req, res) => {
    try {
      const portfolioType = (req.query.portfolioType as string) || "core";
      const portfolioId = req.query.portfolioId as string;
      const benchmarkId = req.query.benchmarkId as string;

      let riskFreeRate = 0.05;
      try {
        const tbillData = await get3MonthTBillRate();
        riskFreeRate = tbillData.rate;
      } catch (e) {}

      let periodReturns: number[] = [];
      let portfolioValues: number[] = [];
      let holdingInfos: HoldingInfo[] = [];
      let benchmarkReturns: number[] = [];
      let advPeriodsPerYear = 12;

      if (portfolioType === "custom" && portfolioId) {
        const customPortfolio = await storage.getCustomPortfolio(portfolioId);
        if (!customPortfolio) {
          return res.status(404).json({ message: "Custom portfolio not found" });
        }
        const backtests = await storage.getBacktestResults(portfolioId);
        const latestBacktest = backtests.length > 0 ? backtests[0] : null;
        if (latestBacktest?.equityCurve) {
          const curve = Array.isArray(latestBacktest.equityCurve)
            ? latestBacktest.equityCurve as number[]
            : [];
          portfolioValues = curve;
          for (let i = 1; i < curve.length; i++) {
            if (curve[i - 1] > 0) {
              periodReturns.push((curve[i] - curve[i - 1]) / curve[i - 1]);
            }
          }
        }
        if (latestBacktest?.performanceData && Array.isArray(latestBacktest.performanceData)) {
          const perfDates = (latestBacktest.performanceData as any[]).map((p: any) => p.date).filter(Boolean);
          if (perfDates.length >= 2) {
            advPeriodsPerYear = detectPeriodsPerYear(perfDates);
          }
        }

        const items = await storage.getCustomPortfolioItems(portfolioId);
        holdingInfos = items.map(item => ({
          name: item.name,
          assetClass: item.assetClass || "Alternative",
          weight: parseFloat(item.weight) / 100,
          returns: [],
        }));
      } else {
        const pid = portfolioId || await getDefaultPortfolioId();
        const performanceHistory = await storage.getPerformanceHistory(pid);

        if (performanceHistory.length > 0) {
          const sorted = performanceHistory.sort((a, b) =>
            new Date(a.date).getTime() - new Date(b.date).getTime()
          );
          periodReturns = sorted.map(p => parseFloat(p.dailyReturn || "0"));
          portfolioValues = sorted.map(p => parseFloat(p.portfolioValue));
          advPeriodsPerYear = detectPeriodsPerYear(sorted.map(p => p.date));
        }

        const holdings = await storage.getHoldings(pid || "");
        holdingInfos = holdings.map(h => ({
          name: h.name,
          assetClass: h.assetClass || "Alternative",
          weight: parseFloat(h.allocation) / 100,
          returns: [],
        }));
      }

      if (benchmarkId) {
        const benchReturnsRaw = await storage.getBenchmarkReturns(benchmarkId);
        benchmarkReturns = benchReturnsRaw.map(br => parseFloat(br.returnValue || "0"));
      }
      if (benchmarkReturns.length < 10) {
        benchmarkReturns = generateSyntheticBenchmarkReturns(periodReturns.length, 0.10, 0.16, advPeriodsPerYear);
      }

      const advancedTail = calculateAdvancedTailMetrics(periodReturns, portfolioValues, riskFreeRate, advPeriodsPerYear);
      const componentRisk = calculateComponentRisk(holdingInfos, periodReturns, advPeriodsPerYear);
      const factorDecomp = calculateFactorDecomposition(periodReturns, benchmarkReturns, advPeriodsPerYear);

      const stressScenarios = [
        { name: "Baseline (No Stress)", meanShift: 0, volMultiplier: 1.0 },
        { name: "Mild Stress (Vol +50%)", meanShift: -0.03, volMultiplier: 1.5 },
        { name: "Moderate Stress (Vol 2x)", meanShift: -0.08, volMultiplier: 2.0 },
        { name: "Severe Stress (Vol 3x)", meanShift: -0.15, volMultiplier: 3.0 },
      ];

      const monteCarloResults = periodReturns.length >= 20
        ? stressScenarios.map(scenario => runMonteCarloStress(periodReturns, scenario, 200, advPeriodsPerYear, advPeriodsPerYear))
        : [];

      res.json({
        advancedTail,
        componentRisk,
        factorDecomposition: factorDecomp,
        monteCarloStress: monteCarloResults,
      });
    } catch (error) {
      console.error("Advanced risk error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/stress-tests", async (req, res) => {
    try {
      const portfolioType = (req.query.portfolioType as string) || "core";
      const portfolioId = req.query.portfolioId as string;

      if (portfolioType === "custom" && portfolioId) {
        // Handle custom portfolio stress tests
        const customPortfolio = await storage.getCustomPortfolio(portfolioId);
        if (!customPortfolio) {
          return res.status(404).json({ message: "Custom portfolio not found" });
        }

        const backtests = await storage.getBacktestResults(portfolioId);
        const latestBacktest = backtests.length > 0 ? backtests[0] : null;
        const items = await storage.getCustomPortfolioItems(portfolioId);

        // Calculate total value from backtest or default
        const totalValue = latestBacktest?.finalValue || "1000000";

        const portfolio = {
          id: customPortfolio.id,
          name: customPortfolio.name,
          totalValue,
          currency: "USD",
          description: customPortfolio.description,
          createdAt: customPortfolio.createdAt,
          isCustom: true
        };

        // Get stress tests for this custom portfolio
        const stressTests = await storage.getStressTests(portfolioId);

        res.json({ portfolio, stressTests, isCustomPortfolio: true, portfolioItems: items });
      } else {
        // Handle core portfolio stress tests
        const pid = portfolioId || await getDefaultPortfolioId();
        
        const [portfolio, stressTests] = await Promise.all([
          storage.getPortfolio(pid),
          storage.getStressTests(pid),
        ]);

        if (!portfolio) {
          return res.status(404).json({ message: "Portfolio not found" });
        }

        res.json({ portfolio, stressTests, isCustomPortfolio: false });
      }
    } catch (error) {
      console.error("Stress tests error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/stress-tests", async (req, res) => {
    try {
      const validationResult = stressTestInputSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Invalid input", 
          errors: validationResult.error.flatten().fieldErrors 
        });
      }

      const { name, equityShock, rateShock, creditSpreadShock, fxShock, portfolioId: reqPortfolioId, portfolioType } = validationResult.data as any;

      let portfolioValue: number;
      let portfolioId: string;
      let equityWeight = 0.56;
      let fixedIncomeWeight = 0.12;
      let alternativeWeight = 0.18;
      let commodityWeight = 0.14;

      if (portfolioType === "custom" && reqPortfolioId) {
        // Handle custom portfolio
        const customPortfolio = await storage.getCustomPortfolio(reqPortfolioId);
        if (!customPortfolio) {
          return res.status(404).json({ message: "Custom portfolio not found" });
        }

        portfolioId = reqPortfolioId;
        const backtests = await storage.getBacktestResults(portfolioId);
        const latestBacktest = backtests.length > 0 ? backtests[0] : null;
        portfolioValue = latestBacktest?.finalValue ? parseFloat(latestBacktest.finalValue) : 1000000;

        // Get actual weights from portfolio items
        const items = await storage.getCustomPortfolioItems(portfolioId);
        if (items.length > 0) {
          // Calculate asset class weights from portfolio items
          equityWeight = 0;
          fixedIncomeWeight = 0;
          alternativeWeight = 0;
          commodityWeight = 0;

          for (const item of items) {
            const weight = parseFloat(item.weight) / 100;
            const assetClass = (item.assetClass || "").toLowerCase();
            
            if (assetClass.includes("equity") || assetClass.includes("stock")) {
              equityWeight += weight;
            } else if (assetClass.includes("fixed") || assetClass.includes("bond") || assetClass.includes("credit")) {
              fixedIncomeWeight += weight;
            } else if (assetClass.includes("commodit") || assetClass.includes("gold") || assetClass.includes("oil")) {
              commodityWeight += weight;
            } else {
              // Alternatives: hedge funds, private equity, real estate, etc.
              alternativeWeight += weight;
            }
          }
        }
      } else {
        // Handle core portfolio
        portfolioId = reqPortfolioId || await getDefaultPortfolioId();
        const portfolio = await storage.getPortfolio(portfolioId);
        
        if (!portfolio) {
          return res.status(404).json({ message: "Portfolio not found" });
        }
        portfolioValue = parseFloat(portfolio.totalValue);

        // Calculate actual weights from portfolio holdings
        const holdings = await storage.getHoldings(portfolioId);
        if (holdings.length > 0) {
          equityWeight = 0;
          fixedIncomeWeight = 0;
          alternativeWeight = 0;
          commodityWeight = 0;

          for (const holding of holdings) {
            const allocation = parseFloat(holding.allocation) / 100;
            const assetClass = (holding.assetClass || "").toLowerCase();
            
            if (assetClass.includes("equity") || assetClass.includes("stock")) {
              equityWeight += allocation;
            } else if (assetClass.includes("fixed") || assetClass.includes("bond") || assetClass.includes("credit")) {
              fixedIncomeWeight += allocation;
            } else if (assetClass.includes("commodit") || assetClass.includes("gold") || assetClass.includes("oil")) {
              commodityWeight += allocation;
            } else {
              // Alternatives: hedge funds, private equity, real estate, etc.
              alternativeWeight += allocation;
            }
          }
        }
      }
      
      // Calculate stress test impacts using actual weights
      const equityImpact = equityShock * equityWeight;
      const rateImpact = rateShock * -8 * fixedIncomeWeight;
      const creditImpact = creditSpreadShock * -5 * fixedIncomeWeight;
      const fxImpact = fxShock * 0.3 * (equityWeight + alternativeWeight);
      
      const totalImpact = equityImpact + rateImpact + creditImpact + fxImpact;
      const impactAmount = portfolioValue * totalImpact;

      const stressTestData = {
        portfolioId,
        scenarioName: name,
        scenarioType: "Custom",
        description: `Custom stress test: Equity ${(equityShock * 100).toFixed(0)}%, Rates ${(rateShock * 100).toFixed(1)}%, Credit ${(creditSpreadShock * 100).toFixed(1)}%, FX ${(fxShock * 100).toFixed(0)}%`,
        equityShock: equityShock.toString(),
        rateShock: rateShock.toString(),
        creditSpreadShock: creditSpreadShock.toString(),
        fxShock: fxShock.toString(),
        portfolioImpact: totalImpact.toFixed(6),
        impactAmount: impactAmount.toFixed(2),
      };

      if (portfolioType === "custom") {
        const inMemoryResult = {
          id: `custom-stress-${Date.now()}`,
          ...stressTestData,
          runDate: new Date(),
        };
        res.status(201).json(inMemoryResult);
      } else {
        const stressTest = await storage.createStressTest(stressTestData);
        res.status(201).json(stressTest);
      }
    } catch (error) {
      console.error("Create stress test error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  async function resolvePortfolioForScenario(
    reqPortfolioId?: string,
    portfolioType?: string
  ): Promise<{ holdings: PortfolioHolding[]; portfolioValue: number; portfolioId: string }> {
    if (portfolioType === "custom" && reqPortfolioId) {
      const customPortfolio = await storage.getCustomPortfolio(reqPortfolioId);
      if (!customPortfolio) throw new Error("Custom portfolio not found");

      const items = await storage.getCustomPortfolioItems(reqPortfolioId);
      const backtests = await storage.getBacktestResults(reqPortfolioId);
      const latestBacktest = backtests.length > 0 ? backtests[0] : null;
      const portfolioValue = latestBacktest?.finalValue ? parseFloat(latestBacktest.finalValue) : 1000000;

      return {
        holdings: holdingsToPortfolioHoldings(items),
        portfolioValue,
        portfolioId: reqPortfolioId,
      };
    } else {
      const portfolioId = reqPortfolioId || await getDefaultPortfolioId();
      const portfolio = await storage.getPortfolio(portfolioId);
      if (!portfolio) throw new Error("Portfolio not found");

      const dbHoldings = await storage.getHoldings(portfolioId);
      return {
        holdings: holdingsToPortfolioHoldings(dbHoldings),
        portfolioValue: parseFloat(portfolio.totalValue),
        portfolioId,
      };
    }
  }

  app.get("/api/scenario-engine/config", (_req, res) => {
    res.json({
      factors: DEFAULT_FACTORS,
      historicalScenarios: HISTORICAL_SCENARIOS,
      hypotheticalScenarios: HYPOTHETICAL_SCENARIOS,
    });
  });

  app.post("/api/scenario-engine/stress-test", async (req, res) => {
    try {
      const validation = enhancedStressTestSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          message: "Invalid input",
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const { scenario, portfolioId: reqPortfolioId, portfolioType, monteCarlo, numSimulations, fatTails, degreesOfFreedom } = validation.data;

      const { holdings, portfolioValue, portfolioId } = await resolvePortfolioForScenario(
        reqPortfolioId, portfolioType
      );

      if (holdings.length === 0) {
        return res.status(400).json({ message: "Portfolio has no holdings" });
      }

      const engine = new ScenarioEngine();
      const scenarioDef: ScenarioDefinition = {
        name: scenario.name,
        description: scenario.description || "",
        category: scenario.category,
        regime: scenario.regime,
        shocks: scenario.shocks,
      };

      let result;
      if (monteCarlo) {
        result = engine.runMonteCarloScenario(holdings, scenarioDef, portfolioValue, {
          numSimulations,
          fatTails,
          degreesOfFreedom,
        });
      } else {
        result = engine.runScenario(holdings, scenarioDef, portfolioValue);
      }

      const stressTest = await storage.createStressTest({
        portfolioId,
        scenarioName: scenario.name,
        scenarioType: scenario.category,
        description: result.scenarioDescription,
        equityShock: (scenario.shocks.equity ?? 0).toString(),
        rateShock: (scenario.shocks.rates ?? 0).toString(),
        creditSpreadShock: (scenario.shocks.credit ?? 0).toString(),
        fxShock: (scenario.shocks.fx ?? 0).toString(),
        portfolioImpact: result.totalImpact.toFixed(6),
        impactAmount: result.impactAmount.toFixed(2),
        regime: result.regime || null,
        scenarioCategory: result.scenarioCategory,
        commodityShock: (scenario.shocks.commodity ?? 0).toString(),
        volatilityShock: (scenario.shocks.volatility ?? 0).toString(),
        inflationShock: (scenario.shocks.inflation ?? 0).toString(),
        liquidityShock: (scenario.shocks.liquidity ?? 0).toString(),
        parametricVaR95: result.parametricVaR95.toFixed(6),
        parametricVaR99: result.parametricVaR99.toFixed(6),
        cvar95: result.cvar95.toFixed(6),
        cvar99: result.cvar99.toFixed(6),
        stressedValue: result.stressedValue.toFixed(2),
        factorDecomposition: result.factorImpacts,
        assetImpacts: result.assetImpacts,
        componentVaR: result.componentVaR,
        monteCarloStats: result.monteCarloStats || null,
      });

      res.status(201).json({ stressTest, result });
    } catch (error: any) {
      console.error("Enhanced stress test error:", error);
      if (error.message === "Portfolio not found" || error.message === "Custom portfolio not found") {
        return res.status(404).json({ message: error.message });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/scenario-engine/reverse-stress-test", async (req, res) => {
    try {
      const validation = reverseStressTestSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          message: "Invalid input",
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const { targetLoss, portfolioId: reqPortfolioId, portfolioType, direction } = validation.data;

      const { holdings, portfolioValue, portfolioId } = await resolvePortfolioForScenario(
        reqPortfolioId, portfolioType
      );

      if (holdings.length === 0) {
        return res.status(400).json({ message: "Portfolio has no holdings" });
      }

      const engine = new ScenarioEngine();
      const result = engine.reverseStressTest(holdings, targetLoss, portfolioValue, direction);

      const shocks = result.requiredShocks;
      await storage.createStressTest({
        portfolioId,
        scenarioName: `Reverse: ${(targetLoss * 100).toFixed(0)}% loss`,
        scenarioType: "reverse",
        description: result.scenarioDescription,
        equityShock: (shocks.equity ?? 0).toString(),
        rateShock: (shocks.rates ?? 0).toString(),
        creditSpreadShock: (shocks.credit ?? 0).toString(),
        fxShock: (shocks.fx ?? 0).toString(),
        portfolioImpact: result.achievedLoss.toFixed(6),
        impactAmount: (portfolioValue * result.achievedLoss).toFixed(2),
        regime: "crisis",
        scenarioCategory: "reverse",
        commodityShock: (shocks.commodity ?? 0).toString(),
        volatilityShock: (shocks.volatility ?? 0).toString(),
        inflationShock: (shocks.inflation ?? 0).toString(),
        liquidityShock: (shocks.liquidity ?? 0).toString(),
      });

      res.json(result);
    } catch (error: any) {
      console.error("Reverse stress test error:", error);
      if (error.message === "Portfolio not found" || error.message === "Custom portfolio not found") {
        return res.status(404).json({ message: error.message });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/scenario-engine/compare", async (req, res) => {
    try {
      const schema = z.object({
        scenarios: z.array(z.object({
          name: z.string(),
          description: z.string().optional().default(""),
          category: z.enum(["historical", "hypothetical", "reverse", "monte_carlo"]).default("hypothetical"),
          regime: z.enum(["expansion", "contraction", "crisis"]).optional(),
          shocks: z.object({
            equity: z.number().optional(),
            rates: z.number().optional(),
            credit: z.number().optional(),
            fx: z.number().optional(),
            commodity: z.number().optional(),
            volatility: z.number().optional(),
            inflation: z.number().optional(),
            liquidity: z.number().optional(),
          }),
        })).min(1).max(20),
        portfolioId: z.string().optional(),
        portfolioType: z.enum(["core", "custom"]).optional(),
      });

      const validation = schema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          message: "Invalid input",
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const { scenarios, portfolioId: reqPortfolioId, portfolioType } = validation.data;

      const { holdings, portfolioValue } = await resolvePortfolioForScenario(
        reqPortfolioId, portfolioType
      );

      if (holdings.length === 0) {
        return res.status(400).json({ message: "Portfolio has no holdings" });
      }

      const engine = new ScenarioEngine();
      const scenarioDefs: ScenarioDefinition[] = scenarios.map(s => ({
        name: s.name,
        description: s.description || "",
        category: s.category,
        regime: s.regime,
        shocks: s.shocks,
      }));

      const result = engine.compareScenarios(holdings, scenarioDefs, portfolioValue);
      res.json(result);
    } catch (error: any) {
      console.error("Scenario comparison error:", error);
      if (error.message === "Portfolio not found" || error.message === "Custom portfolio not found") {
        return res.status(404).json({ message: error.message });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/scenario-engine/run-all-presets", async (req, res) => {
    try {
      const schema = z.object({
        portfolioId: z.string().optional(),
        portfolioType: z.enum(["core", "custom"]).optional(),
      });

      const validation = schema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid input" });
      }

      const { portfolioId: reqPortfolioId, portfolioType } = validation.data;

      const { holdings, portfolioValue } = await resolvePortfolioForScenario(
        reqPortfolioId, portfolioType
      );

      if (holdings.length === 0) {
        return res.status(400).json({ message: "Portfolio has no holdings" });
      }

      const engine = new ScenarioEngine();
      const result = engine.runAllPresets(holdings, portfolioValue);
      res.json(result);
    } catch (error: any) {
      console.error("Run all presets error:", error);
      if (error.message === "Portfolio not found" || error.message === "Custom portfolio not found") {
        return res.status(404).json({ message: error.message });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/stress-tests/monte-carlo", async (req, res) => {
    try {
      const { portfolioId, portfolioType, scenarios } = req.body;

      let dailyReturns: number[] = [];

      let mcPeriodsPerYear = 12;
      if (portfolioType === "custom" && portfolioId) {
        const backtests = await storage.getBacktestResults(portfolioId);
        const latestBacktest = backtests.length > 0 ? backtests[0] : null;
        if (latestBacktest?.equityCurve) {
          const curve = Array.isArray(latestBacktest.equityCurve)
            ? latestBacktest.equityCurve as number[]
            : [];
          for (let i = 1; i < curve.length; i++) {
            if (curve[i - 1] > 0) {
              dailyReturns.push((curve[i] - curve[i - 1]) / curve[i - 1]);
            }
          }
        }
        if (latestBacktest?.performanceData && Array.isArray(latestBacktest.performanceData)) {
          const perfDates = (latestBacktest.performanceData as any[]).map((p: any) => p.date).filter(Boolean);
          if (perfDates.length >= 2) mcPeriodsPerYear = detectPeriodsPerYear(perfDates);
        }
      } else {
        const pid = portfolioId || await getDefaultPortfolioId();
        const performanceHistory = await storage.getPerformanceHistory(pid);
        if (performanceHistory.length > 0) {
          const sorted = performanceHistory.sort((a, b) =>
            new Date(a.date).getTime() - new Date(b.date).getTime()
          );
          dailyReturns = sorted.map(p => parseFloat(p.dailyReturn || "0"));
          mcPeriodsPerYear = detectPeriodsPerYear(sorted.map(p => p.date));
        }
      }

      if (dailyReturns.length < 20) {
        return res.json({ results: [], message: "Insufficient return history for Monte Carlo simulation" });
      }

      const defaultScenarios = scenarios || [
        { name: "Base Case", meanShift: 0, volMultiplier: 1.0 },
        { name: "Mild Stress", meanShift: -0.05, volMultiplier: 1.5 },
        { name: "Moderate Crisis", meanShift: -0.10, volMultiplier: 2.0 },
        { name: "Severe Crisis", meanShift: -0.20, volMultiplier: 3.0 },
        { name: "Black Swan", meanShift: -0.35, volMultiplier: 4.0 },
      ];

      const results = defaultScenarios.map((scenario: any) =>
        runMonteCarloStress(dailyReturns, scenario, 200, mcPeriodsPerYear, mcPeriodsPerYear)
      );

      res.json({ results });
    } catch (error) {
      console.error("Monte Carlo stress error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/import/parse", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { mimetype, buffer } = req.file;
      let investments: ParsedInvestment[] = [];

      if (mimetype === "application/pdf") {
        investments = await parsePDF(buffer);
      } else {
        investments = parseExcel(buffer);
      }

      if (investments.length === 0) {
        return res.status(400).json({ 
          message: "No investment data could be extracted from the file. Please ensure the file contains investment line items with fund names and market values." 
        });
      }

      res.json({ 
        investments,
        summary: {
          totalItems: investments.length,
          totalValue: investments.reduce((sum, inv) => sum + inv.marketValue, 0),
          assetClasses: Array.from(new Set(investments.map(inv => inv.assetClass))),
        }
      });
    } catch (error) {
      console.error("File parse error:", error);
      res.status(500).json({ message: "Failed to parse file. Please check the file format." });
    }
  });

  app.post("/api/import/confirm", async (req, res) => {
    try {
      const portfolioId = await getDefaultPortfolioId();
      
      const investmentsSchema = z.array(z.object({
        fundName: z.string().min(1),
        ticker: z.string().optional(),
        assetClass: z.string().min(1),
        marketValue: z.number().positive(),
        costBasis: z.number().optional(),
        allocation: z.number().optional(),
      }));

      const validationResult = investmentsSchema.safeParse(req.body.investments);
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Invalid investment data", 
          errors: validationResult.error.flatten().fieldErrors 
        });
      }

      const holdingsData = convertToHoldings(validationResult.data, portfolioId);
      const createdHoldings = await storage.createHoldings(holdingsData);

      const portfolio = await storage.getPortfolio(portfolioId);
      if (portfolio) {
        const allHoldings = await storage.getHoldings(portfolioId);
        const newTotalValue = allHoldings.reduce((sum, h) => sum + parseFloat(h.marketValue), 0);
      }

      res.status(201).json({ 
        message: `Successfully imported ${createdHoldings.length} investments`,
        holdings: createdHoldings,
      });
    } catch (error) {
      console.error("Import confirm error:", error);
      res.status(500).json({ message: "Failed to import investments" });
    }
  });

  app.get("/api/data-room", async (req, res) => {
    try {
      const portfolioId = await getDefaultPortfolioId();
      const documents = await storage.getDataRoomDocuments(portfolioId);
      res.json({ documents });
    } catch (error) {
      console.error("Data room error:", error);
      res.status(500).json({ message: "Failed to fetch data room documents" });
    }
  });

  app.post("/api/data-room/upload", upload.single("file"), async (req, res) => {
    try {
      const portfolioId = await getDefaultPortfolioId();
      
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { originalname, mimetype, size, buffer } = req.file;
      
      const uploadMetadataSchema = z.object({
        fileName: z.string().min(1).max(500),
        fileType: z.string().min(1),
        fileSize: z.number().positive().max(50 * 1024 * 1024),
      });
      
      const metadataResult = uploadMetadataSchema.safeParse({ 
        fileName: originalname, 
        fileType: mimetype, 
        fileSize: size 
      });
      
      if (!metadataResult.success) {
        return res.status(400).json({ 
          message: "Invalid file metadata", 
          errors: metadataResult.error.flatten().fieldErrors 
        });
      }
      
      let textContent = "";
      if (mimetype === "application/pdf") {
        textContent = await extractPdfText(buffer);
      } else if (mimetype.includes("csv") || originalname.toLowerCase().endsWith(".csv")) {
        textContent = extractCsvText(buffer);
      } else if (mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || 
                 mimetype === "application/msword" || 
                 originalname.toLowerCase().endsWith(".docx") || 
                 originalname.toLowerCase().endsWith(".doc")) {
        textContent = await extractDocxText(buffer);
      } else {
        textContent = extractExcelText(buffer);
      }
      
      if (!textContent || textContent.trim().length < 20) {
        return res.status(400).json({ 
          message: "Could not extract meaningful content from the file. Please ensure the file contains readable text or data." 
        });
      }

      let extractedContent = textContent;
      let documentType = "General Document";
      
      try {
        const analysis = await analyzeDocumentContent(originalname, textContent, mimetype);
        extractedContent = analysis.extractedContent;
        documentType = analysis.documentType;
      } catch (aiError) {
        console.error("AI analysis error:", aiError);
      }

      const document = await storage.createDataRoomDocument({
        portfolioId,
        fileName: originalname,
        fileType: mimetype,
        fileSize: size,
        extractedContent,
        documentType,
      });

      res.status(201).json({ document });
    } catch (error) {
      console.error("Data room upload error:", error);
      res.status(500).json({ message: "Failed to upload document" });
    }
  });

  app.delete("/api/data-room/:id", async (req, res) => {
    try {
      await storage.deleteDataRoomDocument(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Data room delete error:", error);
      res.status(500).json({ message: "Failed to delete document" });
    }
  });

  app.get("/api/memos", async (req, res) => {
    try {
      const portfolioId = await getDefaultPortfolioId();
      const memos = await storage.getInvestmentMemos(portfolioId);
      res.json({ memos });
    } catch (error) {
      console.error("Memos error:", error);
      res.status(500).json({ message: "Failed to fetch memos" });
    }
  });

  app.get("/api/memos/:id", async (req, res) => {
    try {
      const memo = await storage.getInvestmentMemo(req.params.id);
      if (!memo) {
        return res.status(404).json({ message: "Memo not found" });
      }
      res.json({ memo });
    } catch (error) {
      console.error("Memo fetch error:", error);
      res.status(500).json({ message: "Failed to fetch memo" });
    }
  });

  app.post("/api/memos/generate", async (req, res) => {
    try {
      const generateSchema = z.object({
        templateType: z.enum(["institutional", "everest_investment_summary", "verita_investment_memo", "investment_summary", "verita_investment_summary"]).optional().default("institutional"),
        folderId: z.string().nullable().optional(),
      });
      
      const validationResult = generateSchema.safeParse(req.body);
      const templateType = validationResult.success ? validationResult.data.templateType : "institutional";
      const folderId = validationResult.success ? validationResult.data.folderId : null;
      
      const portfolioId = await getDefaultPortfolioId();
      
      const [portfolio, holdings, riskMetrics, allDocuments] = await Promise.all([
        storage.getPortfolio(portfolioId),
        storage.getHoldings(portfolioId),
        storage.getRiskMetrics(portfolioId),
        storage.getDataRoomDocuments(portfolioId),
      ]);

      if (!portfolio) {
        return res.status(404).json({ message: "Portfolio not found" });
      }

      // Filter documents by folder if specified
      const documents = folderId 
        ? allDocuments.filter(doc => doc.folderId === folderId)
        : allDocuments;

      if (documents.length === 0 && holdings.length === 0) {
        const folderMessage = folderId ? " in the selected folder" : "";
        return res.status(400).json({ message: `Cannot generate memo without data. Please upload documents${folderMessage} or import holdings first.` });
      }

      const { title, content, templateType: usedTemplate } = await generateInvestmentMemo({
        portfolio,
        holdings,
        riskMetrics: riskMetrics || null,
        documents,
        templateType,
      });

      const wordBuffer = await generateWordDocument({
        title,
        content,
        templateType: usedTemplate,
      });

      const filename = `${sanitizeFilename(title)}_${Date.now()}.docx`;
      const filePath = path.join(MEMOS_DIR, filename);
      fs.writeFileSync(filePath, wordBuffer);

      const memo = await storage.createInvestmentMemo({
        portfolioId,
        title,
        content,
        status: "draft",
        templateType: usedTemplate,
        docFilePath: filePath,
        generatedFromDocuments: documents.map(d => d.id),
        autoGenerated: true,
      });

      res.status(201).json({ memo });
    } catch (error) {
      console.error("Memo generation error:", error);
      res.status(500).json({ message: "Failed to generate memo" });
    }
  });

  app.patch("/api/memos/:id", async (req, res) => {
    try {
      const memoUpdateSchema = z.object({
        title: z.string().min(1).max(500).optional(),
        content: z.string().optional(),
        status: z.enum(["draft", "review", "final"]).optional(),
      });
      
      const validationResult = memoUpdateSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Invalid memo data", 
          errors: validationResult.error.flatten().fieldErrors 
        });
      }
      
      const { title, content, status } = validationResult.data;
      const memo = await storage.updateInvestmentMemo(req.params.id, {
        title,
        content,
        status,
      });
      if (!memo) {
        return res.status(404).json({ message: "Memo not found" });
      }
      res.json({ memo });
    } catch (error) {
      console.error("Memo update error:", error);
      res.status(500).json({ message: "Failed to update memo" });
    }
  });

  app.delete("/api/memos/:id", async (req, res) => {
    try {
      const memo = await storage.getInvestmentMemo(req.params.id);
      if (memo?.docFilePath && fs.existsSync(memo.docFilePath)) {
        fs.unlinkSync(memo.docFilePath);
      }
      await storage.deleteInvestmentMemo(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Memo delete error:", error);
      res.status(500).json({ message: "Failed to delete memo" });
    }
  });

  app.get("/api/memos/:id/download", async (req, res) => {
    try {
      const memo = await storage.getInvestmentMemo(req.params.id);
      if (!memo) {
        return res.status(404).json({ message: "Memo not found" });
      }

      if (!memo.docFilePath || !fs.existsSync(memo.docFilePath)) {
        const wordBuffer = await generateWordDocument({
          title: memo.title,
          content: memo.content,
          templateType: memo.templateType as MemoTemplateType,
        });

        const filename = `${sanitizeFilename(memo.title)}_${Date.now()}.docx`;
        const filePath = path.join(MEMOS_DIR, filename);
        fs.writeFileSync(filePath, wordBuffer);

        await storage.updateInvestmentMemo(memo.id, { docFilePath: filePath } as any);

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFilename(memo.title)}.docx"`);
        return res.send(wordBuffer);
      }

      const fileBuffer = fs.readFileSync(memo.docFilePath);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFilename(memo.title)}.docx"`);
      res.send(fileBuffer);
    } catch (error) {
      console.error("Memo download error:", error);
      res.status(500).json({ message: "Failed to download memo" });
    }
  });

  app.get("/api/onedrive/files", async (req, res) => {
    try {
      const folderPath = (req.query.path as string) || '/';
      const files = await listOneDriveFiles(folderPath);
      res.json({ files });
    } catch (error: any) {
      console.error("OneDrive files error:", error);
      if (error.message?.includes('not connected')) {
        return res.status(401).json({ message: "OneDrive not connected. Please connect your account." });
      }
      res.status(500).json({ message: "Failed to fetch OneDrive files" });
    }
  });

  app.get("/api/onedrive/search", async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        return res.status(400).json({ message: "Search query is required" });
      }
      const files = await searchOneDriveFiles(query);
      res.json({ files });
    } catch (error: any) {
      console.error("OneDrive search error:", error);
      res.status(500).json({ message: "Failed to search OneDrive" });
    }
  });

  app.post("/api/onedrive/import/:fileId", async (req, res) => {
    try {
      const portfolioId = await getDefaultPortfolioId();
      const { fileId } = req.params;
      const { fileName, mimeType } = req.body;

      const buffer = await getOneDriveFileContent(fileId);
      
      let textContent = "";
      if (mimeType?.includes("pdf")) {
        textContent = await extractPdfText(buffer);
      } else if (mimeType?.includes("csv") || fileName?.toLowerCase().endsWith(".csv")) {
        textContent = extractCsvText(buffer);
      } else {
        textContent = extractExcelText(buffer);
      }
      
      if (!textContent || textContent.trim().length < 20) {
        return res.status(400).json({ 
          message: "Could not extract meaningful content from the file." 
        });
      }

      let extractedContent = textContent;
      let documentType = "General Document";
      
      try {
        const analysis = await analyzeDocumentContent(fileName, textContent, mimeType || "");
        extractedContent = analysis.extractedContent;
        documentType = analysis.documentType;
      } catch (aiError) {
        console.error("AI analysis error:", aiError);
      }

      const document = await storage.createDataRoomDocument({
        portfolioId,
        fileName: fileName || "OneDrive Document",
        fileType: mimeType || "application/octet-stream",
        fileSize: buffer.length,
        extractedContent,
        documentType,
      });

      res.status(201).json({ document });
    } catch (error: any) {
      console.error("OneDrive import error:", error);
      res.status(500).json({ message: "Failed to import file from OneDrive" });
    }
  });

  // Investment Library (Google Drive) routes
  app.get("/api/drive/files", async (req, res) => {
    try {
      const folderId = req.query.folderId as string | undefined;
      const files = await listDriveFiles(folderId);
      res.json({ files });
    } catch (error: any) {
      console.error("Drive list files error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch files" });
    }
  });

  app.get("/api/drive/files/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const file = await getDriveFile(id);
      res.json(file);
    } catch (error: any) {
      console.error("Drive get file error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch file" });
    }
  });

  app.get("/api/drive/files/:id/download", async (req, res) => {
    try {
      const { id } = req.params;
      const result = await downloadDriveFile(id);
      res.setHeader("Content-Type", result.mimeType);
      res.setHeader("Content-Disposition", `attachment; filename="${result.name}"`);
      result.stream.pipe(res);
    } catch (error: any) {
      console.error("Drive download error:", error);
      res.status(500).json({ message: error.message || "Failed to download file" });
    }
  });

  app.get("/api/drive/search", async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        return res.status(400).json({ message: "Search query is required" });
      }
      const files = await searchDriveFiles(query);
      res.json({ files });
    } catch (error: any) {
      console.error("Drive search error:", error);
      res.status(500).json({ message: error.message || "Failed to search files" });
    }
  });

  // Treasury Rate endpoint (for risk-free rate)
  app.get("/api/treasury-rates/3month", async (req, res) => {
    try {
      const rateData = await get3MonthTBillRate();
      res.json(rateData);
    } catch (error: any) {
      console.error("Treasury rate fetch error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch Treasury rate" });
    }
  });

  // Ticker Lookup routes
  app.get("/api/ticker/:symbol", async (req, res) => {
    try {
      const { symbol } = req.params;
      const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
      
      if (!apiKey) {
        return res.status(400).json({ 
          message: "Alpha Vantage API key not configured. Please add ALPHA_VANTAGE_API_KEY to your secrets." 
        });
      }

      const tickerData = await getTickerWithMetrics(symbol.toUpperCase(), apiKey);
      
      if (!tickerData) {
        return res.status(404).json({ message: `No data found for ticker ${symbol}` });
      }

      res.json({ ticker: tickerData });
    } catch (error: any) {
      console.error("Ticker lookup error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch ticker data" });
    }
  });

  app.get("/api/ticker/:symbol/returns", async (req, res) => {
    try {
      const { symbol } = req.params;
      const period = (req.query.period as "monthly" | "daily") || "monthly";
      const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
      
      if (!apiKey) {
        return res.status(400).json({ 
          message: "Alpha Vantage API key not configured. Please add ALPHA_VANTAGE_API_KEY to your secrets." 
        });
      }

      const returns = await getHistoricalReturns(symbol.toUpperCase(), apiKey, period);
      const metrics = calculateAnnualizedMetrics(returns, period === "monthly");

      res.json({ 
        symbol: symbol.toUpperCase(),
        returns,
        annualizedReturn: metrics.annualizedReturn,
        annualizedVolatility: metrics.annualizedVolatility
      });
    } catch (error: any) {
      console.error("Ticker returns error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch ticker returns" });
    }
  });

  // Fund Folders routes
  app.get("/api/folders", async (req, res) => {
    try {
      const folderType = req.query.type as string | undefined;
      const folders = await storage.getFundFolders(folderType);
      res.json({ folders });
    } catch (error: any) {
      console.error("Get folders error:", error);
      res.status(500).json({ message: "Failed to fetch folders" });
    }
  });

  app.get("/api/folders/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const folder = await storage.getFundFolder(id);
      if (!folder) {
        return res.status(404).json({ message: "Folder not found" });
      }
      res.json({ folder });
    } catch (error: any) {
      console.error("Get folder error:", error);
      res.status(500).json({ message: "Failed to fetch folder" });
    }
  });

  app.post("/api/folders", async (req, res) => {
    try {
      const { name, description, parentId, color, icon, sortOrder, folderType } = req.body;
      if (!name) {
        return res.status(400).json({ message: "Folder name is required" });
      }
      const folder = await storage.createFundFolder({
        name,
        description: description || null,
        parentId: parentId || null,
        color: color || null,
        icon: icon || null,
        folderType: folderType || "fund",
        sortOrder: sortOrder || 0,
      });
      res.status(201).json({ folder });
    } catch (error: any) {
      console.error("Create folder error:", error);
      res.status(500).json({ message: "Failed to create folder" });
    }
  });

  app.patch("/api/folders/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      const folder = await storage.updateFundFolder(id, updates);
      if (!folder) {
        return res.status(404).json({ message: "Folder not found" });
      }
      res.json({ folder });
    } catch (error: any) {
      console.error("Update folder error:", error);
      res.status(500).json({ message: "Failed to update folder" });
    }
  });

  app.delete("/api/folders/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteFundFolder(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete folder error:", error);
      res.status(500).json({ message: "Failed to delete folder" });
    }
  });

  app.get("/api/folders/:id/strategies", async (req, res) => {
    try {
      const { id } = req.params;
      const strategies = await storage.getStrategiesByFolder(id === "unfiled" ? null : id);
      res.json({ strategies });
    } catch (error: any) {
      console.error("Get strategies by folder error:", error);
      res.status(500).json({ message: "Failed to fetch strategies" });
    }
  });

  app.patch("/api/strategies/:id/folder", async (req, res) => {
    try {
      const { id } = req.params;
      const { folderId } = req.body;
      const strategy = await storage.moveStrategyToFolder(id, folderId);
      if (!strategy) {
        return res.status(404).json({ message: "Strategy not found" });
      }
      res.json({ strategy });
    } catch (error: any) {
      console.error("Move strategy error:", error);
      res.status(500).json({ message: "Failed to move strategy" });
    }
  });

  app.patch("/api/data-room/documents/:id/folder", async (req, res) => {
    try {
      const { id } = req.params;
      const { folderId } = req.body;
      const document = await storage.moveDocumentToFolder(id, folderId);
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      res.json({ document });
    } catch (error: any) {
      console.error("Move document error:", error);
      res.status(500).json({ message: "Failed to move document" });
    }
  });

  app.patch("/api/memos/:id/folder", async (req, res) => {
    try {
      const { id } = req.params;
      const { folderId } = req.body;
      const memo = await storage.moveMemoToFolder(id, folderId);
      if (!memo) {
        return res.status(404).json({ message: "Memo not found" });
      }
      res.json({ memo });
    } catch (error: any) {
      console.error("Move memo error:", error);
      res.status(500).json({ message: "Failed to move memo" });
    }
  });

  // Strategy Library routes
  app.get("/api/strategies", async (req, res) => {
    try {
      const strategies = await storage.getStrategies();
      res.json({ strategies });
    } catch (error: any) {
      console.error("Get strategies error:", error);
      res.status(500).json({ message: "Failed to fetch strategies" });
    }
  });

  app.get("/api/strategies/search", async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        const strategies = await storage.getStrategies();
        return res.json({ strategies });
      }
      const strategies = await storage.searchStrategies(query);
      res.json({ strategies });
    } catch (error: any) {
      console.error("Search strategies error:", error);
      res.status(500).json({ message: "Failed to search strategies" });
    }
  });

  app.get("/api/strategies/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const strategy = await storage.getStrategy(id);
      if (!strategy) {
        return res.status(404).json({ message: "Strategy not found" });
      }
      res.json({ strategy });
    } catch (error: any) {
      console.error("Get strategy error:", error);
      res.status(500).json({ message: "Failed to fetch strategy" });
    }
  });

  const createStrategySchema = z.object({
    name: z.string().min(1, "Name is required"),
    ticker: z.string().optional(),
    strategyType: z.string().min(1, "Strategy type is required"),
    assetClass: z.string().min(1, "Asset class is required"),
    description: z.string().optional(),
    expectedReturn: z.string().or(z.number()).optional().transform(v => v ? String(v) : undefined),
    volatility: z.string().or(z.number()).optional().transform(v => v ? String(v) : undefined),
    sourceFile: z.string().optional(),
    metadata: z.any().optional(),
  });

  app.post("/api/strategies", async (req, res) => {
    try {
      const data = createStrategySchema.parse(req.body);
      const strategy = await storage.createStrategy(data);
      res.status(201).json({ strategy });
    } catch (error: any) {
      console.error("Create strategy error:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: "Failed to create strategy" });
    }
  });

  // Strategy creation with file upload
  app.post("/api/strategies/with-file", upload.single("file"), async (req, res) => {
    try {
      const { name, ticker, strategyType, assetClass, description, expectedReturn, volatility } = req.body;
      
      if (!name || !strategyType || !assetClass) {
        return res.status(400).json({ message: "Name, strategy type, and asset class are required" });
      }

      let sourceFile: string | null = null;
      
      // Handle file upload
      if (req.file) {
        const timestamp = Date.now();
        const safeFileName = sanitizeFilename(req.file.originalname);
        const fileName = `${timestamp}_${safeFileName}`;
        const filePath = path.join(STRATEGY_FILES_DIR, fileName);
        fs.writeFileSync(filePath, req.file.buffer);
        sourceFile = fileName;
      }

      const strategyData = {
        name,
        ticker: ticker || null,
        strategyType,
        assetClass,
        description: description || null,
        expectedReturn: expectedReturn ? expectedReturn : null,
        volatility: volatility ? volatility : null,
        sourceFile,
      };

      const strategy = await storage.createStrategy(strategyData);
      res.status(201).json({ strategy });
    } catch (error: any) {
      console.error("Create strategy with file error:", error);
      res.status(500).json({ message: "Failed to create strategy" });
    }
  });

  // Extract strategy info from uploaded file using AI
  // Also extracts historical returns from Excel/CSV files
  app.post("/api/strategies/extract-info", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { originalname, mimetype, buffer } = req.file;
      let textContent = "";
      const ext = originalname.toLowerCase().slice(originalname.lastIndexOf("."));
      let historicalReturns: { date: string; returnValue: string }[] = [];
      let detectedFrequency: string | null = null;

      // Helper to infer frequency from date spacing
      const inferFrequencyFromDates = (returns: { date: string }[]): string => {
        if (returns.length < 2) return "monthly";
        const sorted = [...returns].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const gaps: number[] = [];
        for (let i = 1; i < Math.min(sorted.length, 10); i++) {
          const diff = (new Date(sorted[i].date).getTime() - new Date(sorted[i - 1].date).getTime()) / (1000 * 60 * 60 * 24);
          gaps.push(diff);
        }
        const medianGap = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
        if (medianGap <= 5) return "daily";
        if (medianGap <= 10) return "weekly";
        if (medianGap <= 45) return "monthly";
        if (medianGap <= 120) return "quarterly";
        return "annual";
      };

      // Helper to parse return values
      const parseReturnValue = (val: string | number): number | null => {
        if (typeof val === "number") return val;
        let str = String(val).trim();
        str = str.replace(/^\uFEFF/, "");
        if (str.endsWith("%")) {
          const num = parseFloat(str.replace("%", "").replace(",", "."));
          return isNaN(num) ? null : num / 100;
        }
        const num = parseFloat(str.replace(",", "."));
        return isNaN(num) ? null : num;
      };

      // Helper to find date and return columns
      const findColumns = (headers: string[]): { dateCol: number; returnCol: number } => {
        let dateCol = -1;
        let returnCol = -1;
        for (let i = 0; i < headers.length; i++) {
          const h = (headers[i] || "").toString().toLowerCase().trim();
          if (dateCol === -1 && (h.includes("date") || h.includes("period") || h.includes("time") || h.includes("month") || h.includes("year"))) {
            dateCol = i;
          }
          if (returnCol === -1 && (h.includes("return") || h.includes("value") || h.includes("performance") || h.includes("yield") || h.includes("pct") || h.includes("%"))) {
            returnCol = i;
          }
        }
        if (dateCol === -1) dateCol = 0;
        if (returnCol === -1) returnCol = headers.length > 1 ? 1 : 0;
        return { dateCol, returnCol };
      };

      // Extract text and historical returns based on file type
      if (mimetype === "application/pdf" || ext === ".pdf") {
        textContent = await extractPdfText(buffer);
        
        // Use AI to scan PDF text for historical return data (tables, performance series)
        if (textContent && textContent.trim().length >= 50) {
          try {
            const OpenAI = (await import("openai")).default;
            const openai = new OpenAI({
              apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
              baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
            });

            const ocrPrompt = `You are analyzing an investment document for historical return data. Scan the text below for any tables, lists, or series of periodic returns (monthly, quarterly, or annual performance data).

Look for patterns like:
- Monthly/quarterly/annual return tables with dates and percentage returns
- Performance history sections with date-return pairs
- NAV history that can be converted to returns
- Track record data showing periodic performance

Extract ALL individual return data points you can find. Return them as a JSON array of objects with "date" (ISO format YYYY-MM-DD) and "returnValue" (as a decimal, e.g., 0.05 for 5%).

If you find NAV/price data instead of returns, calculate period-over-period returns from the NAV values.

IMPORTANT:
- Return ONLY valid JSON: { "returns": [...], "frequency": "daily|weekly|monthly|quarterly|annual" }
- If NO historical return data is found, return: { "returns": [], "frequency": null }
- Convert all percentages to decimals (5% = 0.05, -2.3% = -0.023)
- Include as many data points as possible
- For dates without a specific day, use the 1st of the month (e.g., "Jan 2023" -> "2023-01-01")
- The "frequency" field should indicate how often the returns are reported: daily, weekly, monthly, quarterly, or annual

Document text:
${textContent.substring(0, 12000)}`;

            const ocrResponse = await openai.chat.completions.create({
              model: "gpt-4o",
              messages: [
                { role: "system", content: "You are a financial data extraction specialist. Extract structured return data from investment documents. Return only valid JSON." },
                { role: "user", content: ocrPrompt }
              ],
              temperature: 0.1,
              max_tokens: 4000,
            });

            const ocrContent = ocrResponse.choices[0]?.message?.content || "{}";
            const cleanOcr = ocrContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
            const ocrData = JSON.parse(cleanOcr);
            
            if (ocrData.returns && Array.isArray(ocrData.returns) && ocrData.returns.length >= 3) {
              for (const entry of ocrData.returns) {
                const dateObj = new Date(entry.date);
                const returnNum = typeof entry.returnValue === "number" ? entry.returnValue : parseFloat(String(entry.returnValue));
                if (!isNaN(dateObj.getTime()) && !isNaN(returnNum)) {
                  historicalReturns.push({
                    date: dateObj.toISOString(),
                    returnValue: returnNum.toString(),
                  });
                }
              }
              if (ocrData.frequency) {
                detectedFrequency = ocrData.frequency;
              }
            }
          } catch (ocrError) {
            console.error("PDF return data extraction error:", ocrError);
          }
        }
      } else if (mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || ext === ".docx") {
        textContent = await extractDocxText(buffer);
        
        // Use AI to scan DOCX text for historical return data
        if (textContent && textContent.trim().length >= 50) {
          try {
            const OpenAI = (await import("openai")).default;
            const openai = new OpenAI({
              apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
              baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
            });

            const ocrPrompt = `You are analyzing an investment document for historical return data. Scan the text below for any tables, lists, or series of periodic returns (daily, weekly, monthly, quarterly, or annual performance data).

Look for patterns like:
- Return tables with dates and percentage returns at any frequency
- Performance history sections with date-return pairs
- NAV/price history that can be converted to returns
- Track record data showing periodic performance

Extract ALL individual return data points you can find. Return them as a JSON array of objects with "date" (ISO format YYYY-MM-DD) and "returnValue" (as a decimal, e.g., 0.05 for 5%).

If you find NAV/price data instead of returns, calculate period-over-period returns from the NAV values.

IMPORTANT:
- Return ONLY valid JSON: { "returns": [...], "frequency": "daily|weekly|monthly|quarterly|annual" }
- If NO historical return data is found, return: { "returns": [], "frequency": null }
- Convert all percentages to decimals (5% = 0.05, -2.3% = -0.023)
- Include as many data points as possible
- For dates without a specific day, use the 1st of the month (e.g., "Jan 2023" -> "2023-01-01")
- The "frequency" field should indicate how often the returns are reported: daily, weekly, monthly, quarterly, or annual

Document text:
${textContent.substring(0, 12000)}`;

            const ocrResponse = await openai.chat.completions.create({
              model: "gpt-4o",
              messages: [
                { role: "system", content: "You are a financial data extraction specialist. Extract structured return data from investment documents. Return only valid JSON." },
                { role: "user", content: ocrPrompt }
              ],
              temperature: 0.1,
              max_tokens: 4000,
            });

            const ocrContent = ocrResponse.choices[0]?.message?.content || "{}";
            const cleanOcr = ocrContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
            const ocrData = JSON.parse(cleanOcr);
            
            if (ocrData.returns && Array.isArray(ocrData.returns) && ocrData.returns.length >= 3) {
              for (const entry of ocrData.returns) {
                const dateObj = new Date(entry.date);
                const returnNum = typeof entry.returnValue === "number" ? entry.returnValue : parseFloat(String(entry.returnValue));
                if (!isNaN(dateObj.getTime()) && !isNaN(returnNum)) {
                  historicalReturns.push({
                    date: dateObj.toISOString(),
                    returnValue: returnNum.toString(),
                  });
                }
              }
              if (ocrData.frequency) {
                detectedFrequency = ocrData.frequency;
              }
            }
          } catch (ocrError) {
            console.error("DOCX return data extraction error:", ocrError);
          }
        }
      } else if (ext === ".xlsx" || ext === ".xls") {
        textContent = extractExcelText(buffer);
        
        // Also try to extract historical returns from Excel
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, dateNF: "yyyy-mm-dd" }) as any[][];

        if (data.length >= 2) {
          const headers = (data[0] || []).map((h: any) => String(h || ""));
          const { dateCol, returnCol } = findColumns(headers);

          for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (row && row.length > Math.max(dateCol, returnCol)) {
              const dateVal = row[dateCol];
              const returnVal = row[returnCol];

              let dateObj: Date;
              if (dateVal instanceof Date) {
                dateObj = dateVal;
              } else if (typeof dateVal === "number") {
                dateObj = new Date((dateVal - 25569) * 86400 * 1000);
              } else {
                dateObj = new Date(String(dateVal));
              }

              const returnNum = parseReturnValue(returnVal);

              if (!isNaN(dateObj.getTime()) && returnNum !== null) {
                historicalReturns.push({
                  date: dateObj.toISOString(),
                  returnValue: returnNum.toString(),
                });
              }
            }
          }
        }
      } else if (ext === ".csv") {
        textContent = extractCsvText(buffer);
        
        // Also try to extract historical returns from CSV
        const { parse } = await import("csv-parse/sync");
        const csvText = buffer.toString("utf-8").replace(/^\uFEFF/, "");
        
        const records = parse(csvText, {
          columns: false,
          skip_empty_lines: true,
          relax_column_count: true,
          trim: true,
        }) as string[][];

        if (records.length >= 2) {
          const { dateCol, returnCol } = findColumns(records[0]);

          for (let i = 1; i < records.length; i++) {
            const row = records[i];
            if (row.length > Math.max(dateCol, returnCol)) {
              const dateStr = row[dateCol];
              const returnNum = parseReturnValue(row[returnCol]);
              
              const dateValue = new Date(dateStr);
              if (!isNaN(dateValue.getTime()) && returnNum !== null) {
                historicalReturns.push({
                  date: dateValue.toISOString(),
                  returnValue: returnNum.toString(),
                });
              }
            }
          }
        }
      } else if (ext === ".doc") {
        return res.status(400).json({ 
          message: "Legacy .doc format is not supported. Please convert to .docx format."
        });
      } else {
        return res.status(400).json({ 
          message: "Unsupported file format. Please upload PDF, DOCX, XLSX, or CSV files."
        });
      }

      // Calculate expected return and volatility from historical returns if we have them
      let calculatedVolatility: number | null = null;
      let calculatedExpectedReturn: number | null = null;
      if (historicalReturns.length >= 3) {
        const returns = historicalReturns.map(r => parseFloat(r.returnValue));
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
        const stdDev = Math.sqrt(variance);
        
        // Determine annualization factor: use AI-detected frequency, or infer from date spacing
        const frequency = detectedFrequency || inferFrequencyFromDates(historicalReturns);
        let periodsPerYear = 12; // default: monthly
        if (frequency === "quarterly") {
          periodsPerYear = 4;
        } else if (frequency === "annual" || frequency === "yearly") {
          periodsPerYear = 1;
        } else if (frequency === "weekly") {
          periodsPerYear = 52;
        } else if (frequency === "daily") {
          periodsPerYear = 252;
        }
        
        calculatedVolatility = stdDev * Math.sqrt(periodsPerYear);
        calculatedExpectedReturn = mean * periodsPerYear;
      }

      // Use OpenAI to extract strategy details including performance figures from the document
      let extractedInfo: any = {};
      
      if (textContent && textContent.trim().length >= 20) {
        const OpenAI = (await import("openai")).default;
        const openai = new OpenAI({
          apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
          baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
        });

        const extractionPrompt = `Analyze the following investment document and extract key strategy information for a strategy library entry.

Extract the following fields if available (return null for fields not found):

{
  "name": "Strategy/Fund name",
  "ticker": "Ticker symbol if public (e.g., SPY, QQQ)",
  "strategyType": "One of: Investment, ETF, Mutual Fund, Hedge Fund, Private Equity, Venture Capital, Real Assets Fund, Credit Strategy, Macro Strategy, Long/Short Equity, Event Driven, Distressed, Multi-Strategy, Managed Account, Co-Investment, Direct Investment, Custom Strategy, Other",
  "assetClass": "One of: US Equity, International Equity, Emerging Markets, Fixed Income, High Yield, Real Estate, Commodities, Alternatives, Private Equity, Hedge Funds, Cash, Other",
  "description": "Brief description of the strategy focus and approach (2-3 sentences)",
  "expectedReturn": "Target or historical annualized net return as a decimal (e.g., 0.12 for 12%). Look for terms like 'target return', 'net IRR', 'annualized return', 'net annual return', 'target net return'. Convert percentages to decimals.",
  "volatility": "Annualized volatility/standard deviation as a decimal (e.g., 0.15 for 15%). Look for terms like 'volatility', 'standard deviation', 'annualized risk'."
}

IMPORTANT: 
- Match strategyType and assetClass exactly to one of the provided options
- Return valid JSON only, no additional text
- If a field cannot be determined, use null
- For expectedReturn and volatility, express as decimals not percentages (e.g., 12% = 0.12)
- For expectedReturn, prefer NET returns over gross. If a range is given (e.g., "10-15%"), use the midpoint (0.125)

Document content:
${textContent.substring(0, 8000)}`;

        try {
          const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
              { role: "system", content: "You are a financial document analyst. Extract structured investment information from documents. Return only valid JSON." },
              { role: "user", content: extractionPrompt }
            ],
            temperature: 0.2,
            max_tokens: 1000,
          });

          const content = response.choices[0]?.message?.content || "{}";
          const cleanContent = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          extractedInfo = JSON.parse(cleanContent);
        } catch (aiError) {
          console.error("AI extraction error:", aiError);
        }
      }

      // Calculated values from historical returns take priority over AI-extracted values
      // since they're derived from actual data
      if (calculatedExpectedReturn !== null) {
        extractedInfo.expectedReturn = calculatedExpectedReturn;
        extractedInfo.expectedReturnSource = "calculated";
      } else if (extractedInfo.expectedReturn != null) {
        extractedInfo.expectedReturnSource = "document";
      }

      if (calculatedVolatility !== null) {
        extractedInfo.volatility = calculatedVolatility;
        extractedInfo.volatilitySource = "calculated";
      } else if (extractedInfo.volatility != null) {
        extractedInfo.volatilitySource = "document";
      }

      // Use date-inferred frequency as final fallback for response
      const reportedFrequency = detectedFrequency || (historicalReturns.length >= 2 ? inferFrequencyFromDates(historicalReturns) : null);

      res.json({ 
        extracted: extractedInfo,
        historicalReturns: historicalReturns,
        returnsCount: historicalReturns.length,
        returnFrequency: reportedFrequency,
        fileName: originalname
      });
    } catch (error: any) {
      console.error("Extract strategy info error:", error);
      res.status(500).json({ message: "Failed to extract strategy information from file" });
    }
  });

  // Strategy file download
  app.get("/api/strategies/:id/file", async (req, res) => {
    try {
      const { id } = req.params;
      const strategy = await storage.getStrategy(id);
      
      if (!strategy || !strategy.sourceFile) {
        return res.status(404).json({ message: "Strategy or file not found" });
      }

      const filePath = path.join(STRATEGY_FILES_DIR, strategy.sourceFile);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "File not found on disk" });
      }

      res.download(filePath, strategy.sourceFile.replace(/^\d+_/, ""));
    } catch (error: any) {
      console.error("Download strategy file error:", error);
      res.status(500).json({ message: "Failed to download file" });
    }
  });

  // Strategy file upload (update existing strategy)
  app.post("/api/strategies/:id/file", upload.single("file"), async (req, res) => {
    try {
      const id = req.params.id as string;
      const strategy = await storage.getStrategy(id);
      
      if (!strategy) {
        return res.status(404).json({ message: "Strategy not found" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      // Delete old file if exists
      if (strategy.sourceFile) {
        const oldFilePath = path.join(STRATEGY_FILES_DIR, strategy.sourceFile);
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
        }
      }

      const timestamp = Date.now();
      const safeFileName = sanitizeFilename(req.file.originalname);
      const fileName = `${timestamp}_${safeFileName}`;
      const filePath = path.join(STRATEGY_FILES_DIR, fileName);
      fs.writeFileSync(filePath, req.file.buffer);

      const updated = await storage.updateStrategy(id, { sourceFile: fileName });
      res.json({ strategy: updated });
    } catch (error: any) {
      console.error("Upload strategy file error:", error);
      res.status(500).json({ message: "Failed to upload file" });
    }
  });

  // Delete strategy file
  app.delete("/api/strategies/:id/file", async (req, res) => {
    try {
      const id = req.params.id as string;
      const strategy = await storage.getStrategy(id);
      
      if (!strategy) {
        return res.status(404).json({ message: "Strategy not found" });
      }

      if (strategy.sourceFile) {
        const filePath = path.join(STRATEGY_FILES_DIR, strategy.sourceFile);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }

      const updated = await storage.updateStrategy(id, { sourceFile: null });
      res.json({ strategy: updated });
    } catch (error: any) {
      console.error("Delete strategy file error:", error);
      res.status(500).json({ message: "Failed to delete file" });
    }
  });

  const importStrategiesSchema = z.object({
    strategies: z.array(createStrategySchema).min(1, "At least one strategy is required"),
  });

  app.post("/api/strategies/import", async (req, res) => {
    try {
      const data = importStrategiesSchema.parse(req.body);
      const strategies = await storage.createStrategies(data.strategies);
      res.status(201).json({ strategies, count: strategies.length });
    } catch (error: any) {
      console.error("Import strategies error:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: "Failed to import strategies" });
    }
  });

  // Fund Document Upload with AI Extraction
  app.post("/api/funds/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { originalname, mimetype, buffer } = req.file;
      let textContent = "";
      const ext = originalname.toLowerCase().slice(originalname.lastIndexOf("."));

      // Extract text based on file type
      if (mimetype === "application/pdf" || ext === ".pdf") {
        textContent = await extractPdfText(buffer);
      } else if (mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || ext === ".docx") {
        textContent = await extractDocxText(buffer);
      } else if (ext === ".xlsx" || ext === ".xls") {
        textContent = extractExcelText(buffer);
      } else if (ext === ".csv") {
        textContent = extractCsvText(buffer);
      } else if (ext === ".doc") {
        return res.status(400).json({ 
          message: "Legacy .doc format is not supported. Please convert to .docx format and try again."
        });
      } else {
        return res.status(400).json({ 
          message: "Unsupported file format. Please upload PDF, DOCX, XLSX, or CSV files."
        });
      }

      if (!textContent || textContent.trim().length < 50) {
        return res.status(400).json({ 
          message: "Could not extract meaningful content from the file. Please ensure the document contains readable fund information."
        });
      }

      // Use OpenAI to extract fund details from the document
      const OpenAI = (await import("openai")).default;
      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });

      const extractionPrompt = `Analyze the following fund document and extract key information. This may be an LPA (Limited Partnership Agreement), marketing deck, factsheet, or other fund documentation.

Extract the following fields if available (return null for fields not found):

{
  "name": "Fund name",
  "ticker": "Ticker symbol if public",
  "strategyType": "One of: Hedge Fund, Long/Short Equity, Macro Strategy, Event Driven, Distressed, Multi-Strategy, Credit Strategy, Private Credit, Direct Lending, Mezzanine, Distressed Debt, Private Equity, Venture Capital, Real Estate, Infrastructure",
  "assetClass": "One of: Equity, Fixed Income, Alternatives, Real Estate, Private Credit, Multi-Asset",
  "description": "Brief description of the fund strategy and focus",
  "expectedReturn": "Target/expected return as decimal (e.g., 0.12 for 12%)",
  "volatility": "Expected volatility as decimal if mentioned",
  "managementFee": "Management fee as decimal (e.g., 0.02 for 2%)",
  "performanceFee": "Performance/incentive fee as decimal (e.g., 0.20 for 20%)",
  "hurdleRate": "Hurdle rate as decimal if applicable",
  "highWaterMark": true or false,
  "lockupPeriod": "Lockup period in months",
  "redemptionFrequency": "Monthly, Quarterly, Annually, etc.",
  "redemptionNotice": "Notice period in days",
  "gateProvision": "Gate percentage as decimal if applicable",
  "fundAum": "Fund AUM as number",
  "inceptionDate": "Fund inception date in ISO format",
  "fundManager": "Manager/GP name",
  "fundDomicile": "Fund jurisdiction/domicile",
  "targetYield": "Target yield for credit funds as decimal",
  "currentYield": "Current yield as decimal",
  "loanToValue": "LTV ratio as decimal for credit",
  "seniorityLevel": "Senior, Mezzanine, Subordinated, etc.",
  "vintageYear": "Vintage year for PE/Credit",
  "fundLifeYears": "Fund life in years"
}

Document content:
${textContent.slice(0, 15000)}

Return ONLY a valid JSON object with the extracted fields. For any field not found in the document, use null.`;

      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [
          { role: "system", content: "You are a financial analyst expert at extracting structured data from fund documents. Always return valid JSON." },
          { role: "user", content: extractionPrompt }
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 2000,
      });

      const extractedData = JSON.parse(response.choices[0]?.message?.content || "{}");

      if (!extractedData.name) {
        return res.status(400).json({ 
          message: "Could not extract fund name from the document. Please ensure the document contains fund information."
        });
      }

      // Prepare strategy data
      const strategyData: any = {
        name: extractedData.name,
        ticker: extractedData.ticker || null,
        strategyType: extractedData.strategyType || "Alternatives",
        assetClass: extractedData.assetClass || "Alternatives",
        description: extractedData.description || null,
        expectedReturn: extractedData.expectedReturn?.toString() || null,
        volatility: extractedData.volatility?.toString() || null,
        sourceFile: originalname,
        metadata: { extractedFrom: originalname, extractedAt: new Date().toISOString(), rawExtraction: extractedData },
        managementFee: extractedData.managementFee?.toString() || null,
        performanceFee: extractedData.performanceFee?.toString() || null,
        hurdleRate: extractedData.hurdleRate?.toString() || null,
        highWaterMark: extractedData.highWaterMark || null,
        lockupPeriod: extractedData.lockupPeriod || null,
        redemptionFrequency: extractedData.redemptionFrequency || null,
        redemptionNotice: extractedData.redemptionNotice || null,
        gateProvision: extractedData.gateProvision?.toString() || null,
        fundAum: extractedData.fundAum?.toString() || null,
        inceptionDate: extractedData.inceptionDate ? new Date(extractedData.inceptionDate) : null,
        fundManager: extractedData.fundManager || null,
        fundDomicile: extractedData.fundDomicile || null,
        targetYield: extractedData.targetYield?.toString() || null,
        currentYield: extractedData.currentYield?.toString() || null,
        loanToValue: extractedData.loanToValue?.toString() || null,
        seniorityLevel: extractedData.seniorityLevel || null,
        vintageYear: extractedData.vintageYear || null,
        fundLifeYears: extractedData.fundLifeYears || null,
      };

      // Create the strategy/fund in the database
      const strategy = await storage.createStrategy(strategyData);

      res.status(201).json({ 
        strategy, 
        extractedFields: extractedData,
        message: `Successfully extracted fund information from ${originalname}`
      });
    } catch (error: any) {
      console.error("Fund upload error:", error);
      res.status(500).json({ message: error.message || "Failed to process fund document" });
    }
  });

  app.patch("/api/strategies/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const updates = createStrategySchema.partial().parse(req.body);
      const strategy = await storage.updateStrategy(id, updates);
      if (!strategy) {
        return res.status(404).json({ message: "Strategy not found" });
      }
      res.json({ strategy });
    } catch (error: any) {
      console.error("Update strategy error:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: "Failed to update strategy" });
    }
  });

  app.delete("/api/strategies/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteStrategy(id);
      res.status(204).send();
    } catch (error: any) {
      console.error("Delete strategy error:", error);
      res.status(500).json({ message: "Failed to delete strategy" });
    }
  });

  // Strategy Historical Returns routes
  app.get("/api/strategies/:id/returns", async (req, res) => {
    try {
      const { id } = req.params;
      const returns = await storage.getStrategyReturns(id);
      const count = returns.length;
      res.json({ returns, count });
    } catch (error: any) {
      console.error("Get strategy returns error:", error);
      res.status(500).json({ message: "Failed to fetch strategy returns" });
    }
  });

  const importReturnsSchema = z.object({
    returns: z.array(z.object({
      date: z.string(),
      returnValue: z.string(),
      source: z.string().optional(),
    })),
  });

  app.post("/api/strategies/:id/returns", async (req, res) => {
    try {
      const { id } = req.params;
      const strategy = await storage.getStrategy(id);
      if (!strategy) {
        return res.status(404).json({ message: "Strategy not found" });
      }
      
      const parsed = importReturnsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }

      const returnsData = parsed.data.returns.map(r => ({
        strategyId: id,
        date: new Date(r.date),
        returnValue: r.returnValue,
        source: r.source,
      }));

      const created = await storage.createStrategyReturns(returnsData);
      res.status(201).json({ count: created.length, returns: created });
    } catch (error: any) {
      console.error("Import strategy returns error:", error);
      res.status(500).json({ message: "Failed to import strategy returns" });
    }
  });

  app.delete("/api/strategies/:id/returns", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteStrategyReturns(id);
      res.status(204).send();
    } catch (error: any) {
      console.error("Delete strategy returns error:", error);
      res.status(500).json({ message: "Failed to delete strategy returns" });
    }
  });

  const returnsUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf("."));
      const allowedExtensions = [".csv", ".xlsx", ".xls", ".pdf"];
      if (allowedExtensions.includes(ext)) {
        cb(null, true);
      } else {
        cb(new Error("Invalid file type. Only CSV, Excel, and PDF files are allowed."));
      }
    },
  });

  app.post("/api/strategies/:id/returns/upload", returnsUpload.single("file"), async (req, res) => {
    try {
      const strategyId = req.params.id as string;
      const strategy = await storage.getStrategy(strategyId);
      if (!strategy) {
        return res.status(404).json({ message: "Strategy not found" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const fileName = req.file.originalname.toLowerCase();
      const buffer = req.file.buffer;
      let parsedReturns: { date: string; returnValue: string }[] = [];

      const parseReturnValue = (val: string | number): number | null => {
        if (typeof val === "number") return val;
        let str = String(val).trim();
        str = str.replace(/^\uFEFF/, "");
        if (str.endsWith("%")) {
          const num = parseFloat(str.replace("%", "").replace(",", "."));
          return isNaN(num) ? null : num / 100;
        }
        const num = parseFloat(str.replace(",", "."));
        return isNaN(num) ? null : num;
      };

      const findColumns = (headers: string[]): { dateCol: number; returnCol: number } => {
        let dateCol = -1;
        let returnCol = -1;
        for (let i = 0; i < headers.length; i++) {
          const h = headers[i].toLowerCase().trim();
          if (dateCol === -1 && (h.includes("date") || h.includes("period") || h.includes("time"))) {
            dateCol = i;
          }
          if (returnCol === -1 && (h.includes("return") || h.includes("value") || h.includes("performance") || h.includes("yield"))) {
            returnCol = i;
          }
        }
        if (dateCol === -1) dateCol = 0;
        if (returnCol === -1) returnCol = headers.length > 1 ? 1 : 0;
        return { dateCol, returnCol };
      };

      if (fileName.endsWith(".csv")) {
        const { parse } = await import("csv-parse/sync");
        const csvText = buffer.toString("utf-8").replace(/^\uFEFF/, "");
        
        const records = parse(csvText, {
          columns: false,
          skip_empty_lines: true,
          relax_column_count: true,
          trim: true,
        }) as string[][];

        if (records.length < 2) {
          return res.status(400).json({ message: "File must have header row and at least one data row" });
        }

        const { dateCol, returnCol } = findColumns(records[0]);

        for (let i = 1; i < records.length; i++) {
          const row = records[i];
          if (row.length > Math.max(dateCol, returnCol)) {
            const dateStr = row[dateCol];
            const returnNum = parseReturnValue(row[returnCol]);
            
            const dateValue = new Date(dateStr);
            if (!isNaN(dateValue.getTime()) && returnNum !== null) {
              parsedReturns.push({
                date: dateValue.toISOString(),
                returnValue: returnNum.toString(),
              });
            }
          }
        }
      } else if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, dateNF: "yyyy-mm-dd" }) as any[][];

        if (data.length < 2) {
          return res.status(400).json({ message: "File must have header row and at least one data row" });
        }

        const headers = (data[0] || []).map((h: any) => String(h));
        const { dateCol, returnCol } = findColumns(headers);

        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          if (row && row.length > Math.max(dateCol, returnCol)) {
            const dateVal = row[dateCol];
            const returnVal = row[returnCol];

            let dateObj: Date;
            if (dateVal instanceof Date) {
              dateObj = dateVal;
            } else if (typeof dateVal === "number") {
              dateObj = new Date((dateVal - 25569) * 86400 * 1000);
            } else {
              dateObj = new Date(String(dateVal));
            }

            const returnNum = parseReturnValue(returnVal);

            if (!isNaN(dateObj.getTime()) && returnNum !== null) {
              parsedReturns.push({
                date: dateObj.toISOString(),
                returnValue: returnNum.toString(),
              });
            }
          }
        }
      } else if (fileName.endsWith(".pdf")) {
        const { extractPdfText } = await import("./fileParser");
        const pdfText = await extractPdfText(buffer);
        
        if (!pdfText || pdfText.trim().length === 0) {
          return res.status(400).json({ message: "Could not extract text from PDF file" });
        }

        const lines = pdfText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        
        const datePattern = /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})|(\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})|(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s\-,]*\d{1,2}[\s\-,]*\d{2,4}\b)|(\d{4}[\s\-](?:Q[1-4]|[A-Z][a-z]{2}))/gi;
        const returnPattern = /[-+]?\d+[\.,]?\d*\s*%|[-+]?\d+[\.,]\d+/g;

        for (const line of lines) {
          const dateMatches = line.match(datePattern);
          const returnMatches = line.match(returnPattern);

          if (dateMatches && dateMatches.length > 0 && returnMatches && returnMatches.length > 0) {
            const dateStr = dateMatches[0];
            let dateObj = new Date(dateStr);
            
            if (isNaN(dateObj.getTime())) {
              const parts = dateStr.match(/\d+/g);
              if (parts && parts.length >= 3) {
                if (parseInt(parts[0]) > 31) {
                  dateObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
                } else if (parseInt(parts[2]) > 31) {
                  dateObj = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
                } else {
                  dateObj = new Date(parseInt(parts[2]) + 2000, parseInt(parts[0]) - 1, parseInt(parts[1]));
                }
              }
            }

            if (isNaN(dateObj.getTime())) continue;

            const returnStr = returnMatches[0];
            const returnNum = parseReturnValue(returnStr);

            if (returnNum !== null) {
              parsedReturns.push({
                date: dateObj.toISOString(),
                returnValue: returnNum.toString(),
              });
            }
          }
        }
      } else {
        return res.status(400).json({ message: "Unsupported file type. Please upload CSV, Excel, or PDF file." });
      }

      if (parsedReturns.length === 0) {
        return res.status(400).json({ message: "No valid returns data found in file. Ensure file has Date and Return columns (for CSV/Excel) or date and return values on the same line (for PDF)." });
      }

      parsedReturns.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      const returnsData = parsedReturns.map(r => ({
        strategyId: strategyId,
        date: new Date(r.date),
        returnValue: r.returnValue,
        source: req.file!.originalname,
      }));

      const created = await storage.createStrategyReturns(returnsData);
      res.status(201).json({ 
        count: created.length, 
        message: `Successfully imported ${created.length} historical returns`,
        fileName: req.file.originalname,
      });
    } catch (error: any) {
      console.error("Upload strategy returns error:", error);
      res.status(500).json({ message: "Failed to parse and import returns file" });
    }
  });

  // Portfolio Comparison endpoint
  app.get("/api/portfolio-compare", async (req, res) => {
    try {
      const portfolioIds = req.query.portfolioIds;
      if (!portfolioIds) {
        return res.json({ comparisons: [] });
      }
      
      const ids = Array.isArray(portfolioIds) ? portfolioIds : [portfolioIds];
      const comparisons = [];
      
      // Fetch risk-free rate and benchmark data once for all portfolios
      const riskFreeRate = await get3MonthTBillRate();
      const benchmarks = await storage.getBenchmarks();
      const spyBenchmark = benchmarks.find(b => b.ticker === "SPY");
      let benchmarkReturnsMap: Map<string, number> = new Map();
      
      if (spyBenchmark) {
        const benchReturnsData = await storage.getBenchmarkReturns(spyBenchmark.id);
        benchReturnsData.forEach(r => {
          const dateKey = new Date(r.date).toISOString().split('T')[0];
          benchmarkReturnsMap.set(dateKey, parseFloat(r.returnValue || "0"));
        });
      }
      
      for (const id of ids.slice(0, 3)) {
        const portfolio = await storage.getCustomPortfolio(id as string);
        if (!portfolio) continue;
        
        const items = await storage.getCustomPortfolioItems(id as string);
        const backtests = await storage.getBacktestResults(id as string);
        const latestBacktest = backtests.length > 0 ? backtests[0] : null;
        
        let riskMetrics = null;
        if (latestBacktest) {
          const perfData = latestBacktest.performanceData as any[] || [];
          
          // Align portfolio returns with benchmark returns by date
          const alignedData: { portfolioReturn: number; benchmarkReturn: number }[] = [];
          for (const p of perfData) {
            const dateKey = new Date(p.date).toISOString().split('T')[0];
            const benchReturn = benchmarkReturnsMap.get(dateKey);
            if (benchReturn !== undefined) {
              alignedData.push({
                portfolioReturn: parseFloat(p.dailyReturn) || 0,
                benchmarkReturn: benchReturn,
              });
            }
          }
          
          const dailyReturns = alignedData.map(d => d.portfolioReturn);
          const benchmarkReturns = alignedData.map(d => d.benchmarkReturn);
          const negativeReturns = dailyReturns.filter(r => r < 0);
          
          const annualizedReturn = latestBacktest.annualizedReturn ? parseFloat(latestBacktest.annualizedReturn) : 0;
          const downsideVariance = negativeReturns.length > 0 
            ? negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length 
            : 0;
          const dashPeriodsPerYear = alignedData.length >= 2
            ? detectPeriodsPerYear(alignedData.map(d => d.date))
            : 12;
          const downsideDeviation = Math.sqrt(downsideVariance) * Math.sqrt(dashPeriodsPerYear);
          const sortinoRatio = downsideDeviation > 0 ? (annualizedReturn - riskFreeRate) / downsideDeviation : null;
          
          const maxDrawdown = latestBacktest.maxDrawdown ? Math.abs(parseFloat(latestBacktest.maxDrawdown)) : 0;
          const calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : null;
          
          // Use centralized risk calculations for benchmark metrics
          let beta = null;
          let alpha = null;
          
          if (dailyReturns.length >= 10 && benchmarkReturns.length >= 10) {
            const annualizedBenchReturn = benchmarkReturns.reduce((a, b) => a + b, 0) * (dashPeriodsPerYear / benchmarkReturns.length);
            const benchmarkMetrics = calculateBenchmarkMetrics({
              portfolioReturns: dailyReturns,
              benchmarkReturns: benchmarkReturns,
              riskFreeRate,
              annualizedPortfolioReturn: annualizedReturn,
              annualizedBenchmarkReturn: annualizedBenchReturn,
              periodsPerYear: dashPeriodsPerYear,
            });
            beta = benchmarkMetrics.beta;
            alpha = benchmarkMetrics.alpha;
          }
          
          riskMetrics = {
            sharpeRatio: latestBacktest.sharpeRatio,
            sortinoRatio: sortinoRatio?.toFixed(4) || null,
            volatility: latestBacktest.volatility,
            maxDrawdown: latestBacktest.maxDrawdown,
            beta: beta?.toFixed(4) || null,
            alpha: alpha?.toFixed(4) || null,
            calmarRatio: calmarRatio?.toFixed(4) || null,
          };
        }
        
        comparisons.push({
          portfolio,
          backtest: latestBacktest,
          items,
          riskMetrics,
        });
      }
      
      res.json({ comparisons });
    } catch (error: any) {
      console.error("Portfolio compare error:", error);
      res.status(500).json({ message: "Failed to compare portfolios" });
    }
  });

  // Custom Portfolio routes
  app.get("/api/custom-portfolios", async (req, res) => {
    try {
      const portfolios = await storage.getCustomPortfolios();
      res.json({ portfolios });
    } catch (error: any) {
      console.error("Get custom portfolios error:", error);
      res.status(500).json({ message: "Failed to fetch custom portfolios" });
    }
  });

  app.get("/api/custom-portfolios/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const portfolio = await storage.getCustomPortfolio(id);
      if (!portfolio) {
        return res.status(404).json({ message: "Portfolio not found" });
      }
      const items = await storage.getCustomPortfolioItems(id);
      const backtests = await storage.getBacktestResults(id);
      res.json({ portfolio, items, backtests });
    } catch (error: any) {
      console.error("Get custom portfolio error:", error);
      res.status(500).json({ message: "Failed to fetch custom portfolio" });
    }
  });

  const createCustomPortfolioSchema = z.object({
    name: z.string().min(1, "Name is required"),
    description: z.string().optional(),
    items: z.array(z.object({
      strategyId: z.string().optional(),
      ticker: z.string().optional(),
      name: z.string().min(1, "Name is required"),
      strategyType: z.string().default("investment"),
      assetClass: z.string().min(1, "Asset class is required"),
      weight: z.string().or(z.number()).transform(v => String(v)),
      expectedReturn: z.string().or(z.number()).optional().transform(v => v ? String(v) : undefined),
      volatility: z.string().or(z.number()).optional().transform(v => v ? String(v) : undefined),
    })).min(1, "At least one item is required"),
  });

  app.post("/api/custom-portfolios", async (req, res) => {
    try {
      const parsed = createCustomPortfolioSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }

      const { name, description, items } = parsed.data;
      
      const portfolio = await storage.createCustomPortfolio({ name, description });
      
      for (const item of items) {
        await storage.createCustomPortfolioItem({
          customPortfolioId: portfolio.id,
          strategyId: item.strategyId,
          ticker: item.ticker,
          name: item.name,
          assetClass: item.assetClass,
          weight: item.weight,
          expectedReturn: item.expectedReturn,
          volatility: item.volatility,
        });
      }
      
      const createdItems = await storage.getCustomPortfolioItems(portfolio.id);
      res.status(201).json({ portfolio, items: createdItems });
    } catch (error: any) {
      console.error("Create custom portfolio error:", error);
      res.status(500).json({ message: "Failed to create custom portfolio" });
    }
  });

  app.patch("/api/custom-portfolios/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const parsed = createCustomPortfolioSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }

      const { name, description, items } = parsed.data;
      
      const portfolio = await storage.updateCustomPortfolio(id, { name, description });
      if (!portfolio) {
        return res.status(404).json({ message: "Portfolio not found" });
      }
      
      await storage.deleteCustomPortfolioItems(id);
      
      for (const item of items) {
        await storage.createCustomPortfolioItem({
          customPortfolioId: id,
          strategyId: item.strategyId,
          ticker: item.ticker,
          name: item.name,
          assetClass: item.assetClass,
          weight: item.weight,
          expectedReturn: item.expectedReturn,
          volatility: item.volatility,
        });
      }
      
      const updatedItems = await storage.getCustomPortfolioItems(id);
      res.json({ portfolio, items: updatedItems });
    } catch (error: any) {
      console.error("Update custom portfolio error:", error);
      res.status(500).json({ message: "Failed to update custom portfolio" });
    }
  });

  app.delete("/api/custom-portfolios/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteCustomPortfolio(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete custom portfolio error:", error);
      res.status(500).json({ message: "Failed to delete custom portfolio" });
    }
  });

  // Backtest routes
  const backtestSchema = z.object({
    startDate: z.string(),
    endDate: z.string(),
    initialValue: z.number().positive("Initial value must be positive"),
    riskFreeRate: z.number().min(0).max(1).optional(), // Optional risk-free rate (e.g., 0.04 for 4%)
  });

  app.post("/api/custom-portfolios/:id/backtest", async (req, res) => {
    try {
      const { id } = req.params;
      const parsed = backtestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }

      const portfolio = await storage.getCustomPortfolio(id);
      if (!portfolio) {
        return res.status(404).json({ message: "Portfolio not found" });
      }

      const items = await storage.getCustomPortfolioItems(id);
      if (items.length === 0) {
        return res.status(400).json({ message: "Portfolio has no items" });
      }

      const { startDate, endDate, initialValue, riskFreeRate } = parsed.data;
      
      const strategyIds = items
        .filter(item => item.strategyId)
        .map(item => item.strategyId as string);
      
      const historicalReturns = new Map<string, number[]>();
      
      if (strategyIds.length > 0) {
        const allReturns = await storage.getReturnsForStrategies(strategyIds);
        for (const ret of allReturns) {
          const existing = historicalReturns.get(ret.strategyId) || [];
          existing.push(parseFloat(ret.returnValue));
          historicalReturns.set(ret.strategyId, existing);
        }
      }
      
      const backtestOutput = runBacktest({
        items,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        initialValue,
        historicalReturns: historicalReturns.size > 0 ? historicalReturns : undefined,
        riskFreeRate,
      });

      const result = await storage.createBacktestResult({
        customPortfolioId: id,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        initialValue: String(initialValue),
        finalValue: String(backtestOutput.finalValue),
        totalReturn: String(backtestOutput.totalReturn),
        annualizedReturn: String(backtestOutput.annualizedReturn),
        volatility: String(backtestOutput.volatility),
        sharpeRatio: String(backtestOutput.sharpeRatio),
        maxDrawdown: String(backtestOutput.maxDrawdown),
        performanceData: backtestOutput.performanceData,
        monteCarloStats: backtestOutput.monteCarloStats,
        simulationFinalValues: backtestOutput.simulationFinalValues,
        numSimulations: 100,
      });

      res.status(201).json({ 
        result, 
        performanceData: backtestOutput.performanceData,
        monteCarloStats: backtestOutput.monteCarloStats,
        simulationFinalValues: backtestOutput.simulationFinalValues,
      });
    } catch (error: any) {
      console.error("Backtest error:", error);
      res.status(500).json({ message: "Failed to run backtest" });
    }
  });

  app.get("/api/backtests/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const result = await storage.getBacktestResult(id);
      if (!result) {
        return res.status(404).json({ message: "Backtest result not found" });
      }
      res.json({ result });
    } catch (error: any) {
      console.error("Get backtest error:", error);
      res.status(500).json({ message: "Failed to fetch backtest result" });
    }
  });

  app.delete("/api/backtests/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteBacktestResult(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete backtest error:", error);
      res.status(500).json({ message: "Failed to delete backtest result" });
    }
  });

  // Export portfolio audit data to Excel
  app.get("/api/custom-portfolios/:id/export-audit", async (req, res) => {
    try {
      const { id } = req.params;
      
      const portfolio = await storage.getCustomPortfolio(id);
      if (!portfolio) {
        return res.status(404).json({ message: "Portfolio not found" });
      }

      const items = await storage.getCustomPortfolioItems(id);
      const backtests = await storage.getBacktestResults(id);
      const latestBacktest = backtests.length > 0 ? backtests[0] : null;

      // Get historical returns for each strategy
      const strategyIds = items.filter(item => item.strategyId).map(item => item.strategyId as string);
      const allReturns = strategyIds.length > 0 ? await storage.getReturnsForStrategies(strategyIds) : [];

      // Group returns by strategy
      const returnsByStrategy = new Map<string, { date: Date; returnValue: string }[]>();
      for (const ret of allReturns) {
        const existing = returnsByStrategy.get(ret.strategyId) || [];
        existing.push({ date: ret.date, returnValue: ret.returnValue });
        returnsByStrategy.set(ret.strategyId, existing);
      }

      // Build Excel workbook
      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();

      // Sheet 1: Portfolio Summary
      const summaryData = [
        ["PORTFOLIO AUDIT REPORT"],
        [""],
        ["Portfolio Name", portfolio.name],
        ["Description", portfolio.description || "N/A"],
        ["Created Date", portfolio.createdAt ? new Date(portfolio.createdAt).toISOString().split("T")[0] : "N/A"],
        ["Export Date", new Date().toISOString().split("T")[0]],
        [""],
        ["BACKTEST SUMMARY"],
        latestBacktest ? ["Start Date", new Date(latestBacktest.startDate).toISOString().split("T")[0]] : ["Start Date", "No backtest run"],
        latestBacktest ? ["End Date", new Date(latestBacktest.endDate).toISOString().split("T")[0]] : ["End Date", "N/A"],
        latestBacktest ? ["Initial Value", `$${parseFloat(latestBacktest.initialValue).toLocaleString()}`] : ["Initial Value", "N/A"],
        latestBacktest ? ["Final Value", `$${parseFloat(latestBacktest.finalValue).toLocaleString()}`] : ["Final Value", "N/A"],
        latestBacktest ? ["Total Return", `${(parseFloat(latestBacktest.totalReturn) * 100).toFixed(2)}%`] : ["Total Return", "N/A"],
        latestBacktest ? ["Annualized Return", `${(parseFloat(latestBacktest.annualizedReturn || "0") * 100).toFixed(2)}%`] : ["Annualized Return", "N/A"],
        latestBacktest ? ["Volatility", `${(parseFloat(latestBacktest.volatility || "0") * 100).toFixed(2)}%`] : ["Volatility", "N/A"],
        latestBacktest ? ["Sharpe Ratio", parseFloat(latestBacktest.sharpeRatio || "0").toFixed(3)] : ["Sharpe Ratio", "N/A"],
        latestBacktest ? ["Max Drawdown", `${(parseFloat(latestBacktest.maxDrawdown || "0") * 100).toFixed(2)}%`] : ["Max Drawdown", "N/A"],
      ];
      const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

      // Sheet 2: Holdings
      const holdingsData = [
        ["PORTFOLIO HOLDINGS"],
        [""],
        ["Name", "Ticker", "Asset Class", "Strategy Type", "Weight (%)", "Expected Return (%)", "Volatility (%)"],
        ...items.map(item => [
          item.name,
          item.ticker || "N/A",
          item.assetClass,
          item.strategyType,
          (parseFloat(item.weight) * 100).toFixed(2),
          item.expectedReturn ? (parseFloat(item.expectedReturn) * 100).toFixed(2) : "N/A",
          item.volatility ? (parseFloat(item.volatility) * 100).toFixed(2) : "N/A",
        ]),
      ];
      const holdingsSheet = XLSX.utils.aoa_to_sheet(holdingsData);
      XLSX.utils.book_append_sheet(workbook, holdingsSheet, "Holdings");

      // Sheet 3: Historical Returns (all strategies combined)
      const returnsData: any[][] = [
        ["HISTORICAL RETURNS DATA"],
        [""],
        ["Date", "Strategy Name", "Return (%)"],
      ];
      
      for (const item of items) {
        if (item.strategyId) {
          const returns = returnsByStrategy.get(item.strategyId) || [];
          const sortedReturns = returns.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
          for (const ret of sortedReturns) {
            returnsData.push([
              new Date(ret.date).toISOString().split("T")[0],
              item.name,
              (parseFloat(ret.returnValue) * 100).toFixed(4),
            ]);
          }
        }
      }
      const returnsSheet = XLSX.utils.aoa_to_sheet(returnsData);
      XLSX.utils.book_append_sheet(workbook, returnsSheet, "Historical Returns");

      // Sheet 4: Performance Time Series (if backtest exists)
      if (latestBacktest && latestBacktest.performanceData) {
        const perfData = latestBacktest.performanceData as any[];
        const perfSheetData: any[][] = [
          ["PORTFOLIO PERFORMANCE TIME SERIES"],
          [""],
          ["Date", "Portfolio Value", "Daily Return (%)", "Cumulative Return (%)"],
          ...perfData.map((p: any) => [
            new Date(p.date).toISOString().split("T")[0],
            parseFloat(p.value).toFixed(2),
            ((parseFloat(p.dailyReturn) || 0) * 100).toFixed(4),
            ((parseFloat(p.cumulativeReturn) || 0) * 100).toFixed(2),
          ]),
        ];
        const perfSheet = XLSX.utils.aoa_to_sheet(perfSheetData);
        XLSX.utils.book_append_sheet(workbook, perfSheet, "Performance");
      }

      // Generate buffer
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

      const filename = `${portfolio.name.replace(/[^a-zA-Z0-9]/g, "_")}_Audit_${new Date().toISOString().split("T")[0]}.xlsx`;
      
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (error: any) {
      console.error("Export audit error:", error);
      res.status(500).json({ message: "Failed to export audit data" });
    }
  });

  // Portfolio optimization
  const optimizeSchema = z.object({
    goal: z.enum(["max_return", "max_sharpe", "max_convexity"]),
    items: z.array(z.object({
      name: z.string(),
      expectedReturn: z.number(),
      volatility: z.number(),
      weight: z.number(),
    })),
  });

  app.post("/api/optimize-portfolio", async (req, res) => {
    try {
      const parsed = optimizeSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }

      const { goal, items } = parsed.data;
      
      if (items.length === 0) {
        return res.status(400).json({ message: "No items to optimize" });
      }

      const result = optimizePortfolio(items, goal);
      res.json(result);
    } catch (error: any) {
      console.error("Optimization error:", error);
      res.status(500).json({ message: "Failed to optimize portfolio" });
    }
  });

  // Benchmark management routes
  app.get("/api/benchmarks", async (req, res) => {
    try {
      const benchmarksList = await storage.getBenchmarks();
      res.json({ benchmarks: benchmarksList });
    } catch (error: any) {
      console.error("Get benchmarks error:", error);
      res.status(500).json({ message: "Failed to fetch benchmarks" });
    }
  });

  app.get("/api/benchmarks/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const benchmark = await storage.getBenchmark(id);
      if (!benchmark) {
        return res.status(404).json({ message: "Benchmark not found" });
      }
      res.json({ benchmark });
    } catch (error: any) {
      console.error("Get benchmark error:", error);
      res.status(500).json({ message: "Failed to fetch benchmark" });
    }
  });

  const createBenchmarkSchema = z.object({
    name: z.string().min(1, "Name is required"),
    ticker: z.string().min(1, "Ticker is required"),
    description: z.string().optional(),
    category: z.string().default("Equity"),
    color: z.string().optional(),
    isDefault: z.boolean().optional(),
  });

  app.post("/api/benchmarks", async (req, res) => {
    try {
      const parsed = createBenchmarkSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }
      const benchmark = await storage.createBenchmark(parsed.data);
      res.status(201).json({ benchmark });
    } catch (error: any) {
      console.error("Create benchmark error:", error);
      res.status(500).json({ message: "Failed to create benchmark" });
    }
  });

  app.patch("/api/benchmarks/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const benchmark = await storage.updateBenchmark(id, req.body);
      if (!benchmark) {
        return res.status(404).json({ message: "Benchmark not found" });
      }
      res.json({ benchmark });
    } catch (error: any) {
      console.error("Update benchmark error:", error);
      res.status(500).json({ message: "Failed to update benchmark" });
    }
  });

  app.delete("/api/benchmarks/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteBenchmark(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete benchmark error:", error);
      res.status(500).json({ message: "Failed to delete benchmark" });
    }
  });

  // Portfolio benchmark associations
  app.get("/api/portfolios/:portfolioId/benchmarks", async (req, res) => {
    try {
      const { portfolioId } = req.params;
      const associations = await storage.getPortfolioBenchmarks(portfolioId);
      const benchmarksList = await storage.getBenchmarks();
      
      const selectedBenchmarks = associations.map(a => {
        const benchmark = benchmarksList.find(b => b.id === a.benchmarkId);
        return {
          ...a,
          benchmark,
        };
      });
      
      res.json({ benchmarks: selectedBenchmarks, allBenchmarks: benchmarksList });
    } catch (error: any) {
      console.error("Get portfolio benchmarks error:", error);
      res.status(500).json({ message: "Failed to fetch portfolio benchmarks" });
    }
  });

  app.post("/api/portfolios/:portfolioId/benchmarks", async (req, res) => {
    try {
      const { portfolioId } = req.params;
      const { benchmarkId, isPrimary } = req.body;
      
      if (!benchmarkId) {
        return res.status(400).json({ message: "Benchmark ID is required" });
      }
      
      const association = await storage.addPortfolioBenchmark({
        portfolioId,
        benchmarkId,
        isPrimary: isPrimary || false,
      });
      
      res.status(201).json({ association });
    } catch (error: any) {
      console.error("Add portfolio benchmark error:", error);
      res.status(500).json({ message: "Failed to add benchmark to portfolio" });
    }
  });

  app.delete("/api/portfolios/:portfolioId/benchmarks/:benchmarkId", async (req, res) => {
    try {
      const { portfolioId, benchmarkId } = req.params;
      await storage.removePortfolioBenchmark(portfolioId, benchmarkId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Remove portfolio benchmark error:", error);
      res.status(500).json({ message: "Failed to remove benchmark from portfolio" });
    }
  });

  app.post("/api/portfolios/:portfolioId/benchmarks/:benchmarkId/primary", async (req, res) => {
    try {
      const { portfolioId, benchmarkId } = req.params;
      await storage.setPrimaryBenchmark(portfolioId, benchmarkId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Set primary benchmark error:", error);
      res.status(500).json({ message: "Failed to set primary benchmark" });
    }
  });

  // Benchmark returns
  app.get("/api/benchmarks/:id/returns", async (req, res) => {
    try {
      const { id } = req.params;
      const timePeriodParam = req.query.timePeriod as BenchmarkTimePeriod | undefined;
      const cadenceParam = req.query.cadence as Cadence | undefined;
      const benchmark = await storage.getBenchmark(id);
      const apiKey = process.env.ALPHA_VANTAGE_API_KEY || "";

      if (benchmark && apiKey) {
        const existingReturns = await storage.getBenchmarkReturns(id);
        if (existingReturns.length === 0) {
          await refreshBenchmarkReturns(id, benchmark.ticker, apiKey);
        }
      }

      const returns = await storage.getBenchmarkReturns(id);
      if (timePeriodParam) {
        const result = processReturnsForPeriod(
          returns.map(r => ({ date: r.date, returnValue: r.returnValue || "0", cumulativeReturn: r.cumulativeReturn })),
          timePeriodParam,
          cadenceParam
        );
        res.json({ returns: result.returns, cadence: result.cadence, timePeriod: timePeriodParam, metrics: result.metrics });
      } else {
        res.json({ returns });
      }
    } catch (error: any) {
      console.error("Get benchmark returns error:", error);
      res.status(500).json({ message: "Failed to fetch benchmark returns" });
    }
  });

  app.post("/api/benchmarks/:id/refresh", async (req, res) => {
    try {
      const { id } = req.params;
      const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
      if (!apiKey) {
        return res.status(400).json({ message: "Alpha Vantage API key not configured" });
      }
      const success = await refreshSingleBenchmark(id, apiKey);
      if (success) {
        const returns = await storage.getBenchmarkReturns(id);
        res.json({ message: "Benchmark data refreshed", returnsCount: returns.length });
      } else {
        res.status(500).json({ message: "Failed to refresh benchmark data" });
      }
    } catch (error: any) {
      console.error("Refresh benchmark error:", error);
      res.status(500).json({ message: "Failed to refresh benchmark data" });
    }
  });

  // Composite benchmarks (custom blended benchmarks)
  app.get("/api/composite-benchmarks", async (req, res) => {
    try {
      const composites = await storage.getCompositeBenchmarks();
      const compositesWithComponents = await Promise.all(
        composites.map(async (composite) => {
          const components = await storage.getCompositeBenchmarkComponents(composite.id);
          const allBenchmarks = await storage.getBenchmarks();
          const enrichedComponents = components.map(c => ({
            ...c,
            benchmark: allBenchmarks.find(b => b.id === c.benchmarkId),
          }));
          return { ...composite, components: enrichedComponents };
        })
      );
      res.json({ compositeBenchmarks: compositesWithComponents });
    } catch (error: any) {
      console.error("Get composite benchmarks error:", error);
      res.status(500).json({ message: "Failed to fetch composite benchmarks" });
    }
  });

  app.get("/api/composite-benchmarks/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const composite = await storage.getCompositeBenchmark(id);
      if (!composite) {
        return res.status(404).json({ message: "Composite benchmark not found" });
      }
      const components = await storage.getCompositeBenchmarkComponents(id);
      const allBenchmarks = await storage.getBenchmarks();
      const enrichedComponents = components.map(c => ({
        ...c,
        benchmark: allBenchmarks.find(b => b.id === c.benchmarkId),
      }));
      res.json({ compositeBenchmark: { ...composite, components: enrichedComponents } });
    } catch (error: any) {
      console.error("Get composite benchmark error:", error);
      res.status(500).json({ message: "Failed to fetch composite benchmark" });
    }
  });

  app.post("/api/composite-benchmarks", async (req, res) => {
    try {
      const { name, description, color, components } = req.body;
      
      if (!name || !components || !Array.isArray(components) || components.length === 0) {
        return res.status(400).json({ message: "Name and at least one component are required" });
      }
      
      const totalWeight = components.reduce((sum: number, c: any) => sum + parseFloat(c.weight), 0);
      if (Math.abs(totalWeight - 1) > 0.001) {
        return res.status(400).json({ message: "Component weights must sum to 100%" });
      }
      
      const composite = await storage.createCompositeBenchmark(
        { name, description, color },
        components.map((c: any) => ({ benchmarkId: c.benchmarkId, weight: String(c.weight) }))
      );
      
      const savedComponents = await storage.getCompositeBenchmarkComponents(composite.id);
      res.status(201).json({ compositeBenchmark: { ...composite, components: savedComponents } });
    } catch (error: any) {
      console.error("Create composite benchmark error:", error);
      res.status(500).json({ message: "Failed to create composite benchmark" });
    }
  });

  app.patch("/api/composite-benchmarks/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, color, components } = req.body;
      
      if (components) {
        const totalWeight = components.reduce((sum: number, c: any) => sum + parseFloat(c.weight), 0);
        if (Math.abs(totalWeight - 1) > 0.001) {
          return res.status(400).json({ message: "Component weights must sum to 100%" });
        }
      }
      
      const composite = await storage.updateCompositeBenchmark(
        id,
        { name, description, color },
        components ? components.map((c: any) => ({ benchmarkId: c.benchmarkId, weight: String(c.weight) })) : undefined
      );
      
      if (!composite) {
        return res.status(404).json({ message: "Composite benchmark not found" });
      }
      
      const savedComponents = await storage.getCompositeBenchmarkComponents(id);
      res.json({ compositeBenchmark: { ...composite, components: savedComponents } });
    } catch (error: any) {
      console.error("Update composite benchmark error:", error);
      res.status(500).json({ message: "Failed to update composite benchmark" });
    }
  });

  app.delete("/api/composite-benchmarks/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteCompositeBenchmark(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete composite benchmark error:", error);
      res.status(500).json({ message: "Failed to delete composite benchmark" });
    }
  });

  app.get("/api/composite-benchmarks/:id/returns", async (req, res) => {
    try {
      const { id } = req.params;
      const timePeriodParam = req.query.timePeriod as BenchmarkTimePeriod | undefined;
      const cadenceParam = req.query.cadence as Cadence | undefined;
      const composite = await storage.getCompositeBenchmark(id);
      if (!composite) {
        return res.status(404).json({ message: "Composite benchmark not found" });
      }
      
      const components = await storage.getCompositeBenchmarkComponents(id);
      if (components.length === 0) {
        return res.json({ returns: [] });
      }
      
      const componentReturns = await Promise.all(
        components.map(async (c) => ({
          weight: parseFloat(c.weight),
          returns: await storage.getBenchmarkReturns(c.benchmarkId),
        }))
      );
      
      const dateMap = new Map<string, number>();
      componentReturns.forEach(({ weight, returns }) => {
        returns.forEach((r) => {
          const dateKey = new Date(r.date).toISOString().split('T')[0];
          const existingReturn = dateMap.get(dateKey) || 0;
          dateMap.set(dateKey, existingReturn + parseFloat(r.returnValue) * weight);
        });
      });
      
      let cumulativeReturnVal = 0;
      const compositeReturns = Array.from(dateMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, returnValue]) => {
          cumulativeReturnVal = (1 + cumulativeReturnVal) * (1 + returnValue) - 1;
          return {
            date: new Date(date),
            returnValue: String(returnValue),
            cumulativeReturn: String(cumulativeReturnVal),
          };
        });
      
      if (timePeriodParam) {
        const result = processReturnsForPeriod(
          compositeReturns.map(r => ({ date: r.date, returnValue: r.returnValue, cumulativeReturn: r.cumulativeReturn })),
          timePeriodParam,
          cadenceParam
        );
        res.json({ returns: result.returns, cadence: result.cadence, timePeriod: timePeriodParam, metrics: result.metrics });
      } else {
        res.json({ returns: compositeReturns });
      }
    } catch (error: any) {
      console.error("Get composite benchmark returns error:", error);
      res.status(500).json({ message: "Failed to fetch composite benchmark returns" });
    }
  });

  // ===== Interval Funds Routes =====

  app.get("/api/interval-funds", async (req, res) => {
    try {
      const funds = await storage.getIntervalFunds();
      res.json({ funds });
    } catch (error: any) {
      console.error("Get interval funds error:", error);
      res.status(500).json({ message: "Failed to fetch interval funds" });
    }
  });

  app.get("/api/interval-funds-stats", async (req, res) => {
    try {
      const funds = await storage.getIntervalFunds();
      const n = funds.length;
      if (n === 0) {
        return res.json({ stats: { totalFunds: 0, totalAum: 0, avgExpenseRatio: 0, avgDistributionRate: 0, avg1yrReturn: 0, avgSharpeRatio: 0, topPerformers: [], highestYielding: [], bestRiskAdjusted: [], lowestCost: [], categoryBreakdown: {} } });
      }
      const totalAum = funds.reduce((sum, f) => sum + (parseFloat(f.totalAum || "0")), 0);
      const avgExpenseRatio = funds.reduce((sum, f) => sum + (parseFloat(f.expenseRatio || "0")), 0) / n;
      const avgDistributionRate = funds.reduce((sum, f) => sum + (parseFloat(f.distributionRate || "0")), 0) / n;
      const avg1yrReturn = funds.reduce((sum, f) => sum + (parseFloat(f.nav1yrReturn || "0")), 0) / n;
      const avgSharpeRatio = funds.reduce((sum, f) => sum + (parseFloat(f.sharpeRatio || "0")), 0) / n;
      const sorted = (key: string, dir: "asc" | "desc" = "desc") => [...funds].sort((a, b) => dir === "desc" ? parseFloat((b as any)[key] || "0") - parseFloat((a as any)[key] || "0") : parseFloat((a as any)[key] || "0") - parseFloat((b as any)[key] || "0")).slice(0, 5).map(f => ({ id: f.id, name: f.name, ticker: f.ticker, assetClass: f.assetClass, [key]: (f as any)[key] }));
      const categoryBreakdown: Record<string, { count: number; totalAum: number; avgReturn: number }> = {};
      funds.forEach(f => {
        if (!categoryBreakdown[f.assetClass]) categoryBreakdown[f.assetClass] = { count: 0, totalAum: 0, avgReturn: 0 };
        categoryBreakdown[f.assetClass].count++;
        categoryBreakdown[f.assetClass].totalAum += parseFloat(f.totalAum || "0");
        categoryBreakdown[f.assetClass].avgReturn += parseFloat(f.nav1yrReturn || "0");
      });
      Object.keys(categoryBreakdown).forEach(k => { categoryBreakdown[k].avgReturn /= categoryBreakdown[k].count; });
      res.json({ stats: { totalFunds: n, totalAum, avgExpenseRatio, avgDistributionRate, avg1yrReturn, avgSharpeRatio, topPerformers: sorted("nav1yrReturn"), highestYielding: sorted("distributionRate"), bestRiskAdjusted: sorted("sharpeRatio"), lowestCost: sorted("expenseRatio", "asc"), categoryBreakdown } });
    } catch (error: any) {
      console.error("Get interval funds stats error:", error);
      res.status(500).json({ message: "Failed to fetch interval fund statistics" });
    }
  });

  app.get("/api/interval-funds-compare", async (req, res) => {
    try {
      const funds = await storage.getIntervalFunds();
      const riskFreeRate = 0.0359;
      const analyses = compareIntervalFunds(funds, riskFreeRate);
      res.json({ analyses });
    } catch (error: any) {
      console.error("Compare interval funds error:", error);
      res.status(500).json({ message: "Failed to compare interval funds" });
    }
  });

  app.get("/api/interval-funds-data-quality", async (req, res) => {
    try {
      const funds = await storage.getIntervalFunds();
      const report = generateDataQualityReport(funds);
      res.json({ report });
    } catch (error: any) {
      console.error("Validate interval funds error:", error);
      res.status(500).json({ message: "Failed to validate interval funds" });
    }
  });

  app.get("/api/interval-funds/:id/analyze", async (req, res) => {
    try {
      const fund = await storage.getIntervalFund(req.params.id);
      if (!fund) return res.status(404).json({ message: "Interval fund not found" });
      const allFunds = await storage.getIntervalFunds();
      const riskFreeRate = 0.0359;
      const analysis = analyzeIntervalFund({ fund, riskFreeRate, peerFunds: allFunds });
      res.json({ analysis });
    } catch (error: any) {
      console.error("Analyze interval fund error:", error);
      res.status(500).json({ message: "Failed to analyze interval fund" });
    }
  });

  app.get("/api/interval-funds/:id/validate", async (req, res) => {
    try {
      const fund = await storage.getIntervalFund(req.params.id);
      if (!fund) return res.status(404).json({ message: "Interval fund not found" });
      const validation = validateIntervalFund(fund);
      res.json({ validation });
    } catch (error: any) {
      console.error("Validate interval fund error:", error);
      res.status(500).json({ message: "Failed to validate interval fund" });
    }
  });

  app.get("/api/interval-funds/:id", async (req, res) => {
    try {
      const fund = await storage.getIntervalFund(req.params.id);
      if (!fund) return res.status(404).json({ message: "Interval fund not found" });
      res.json(fund);
    } catch (error: any) {
      console.error("Get interval fund error:", error);
      res.status(500).json({ message: "Failed to fetch interval fund" });
    }
  });

  app.post("/api/interval-funds", async (req, res) => {
    try {
      const fund = await storage.createIntervalFund(req.body);
      res.status(201).json(fund);
    } catch (error: any) {
      console.error("Create interval fund error:", error);
      res.status(500).json({ message: "Failed to create interval fund" });
    }
  });

  app.patch("/api/interval-funds/:id", async (req, res) => {
    try {
      const fund = await storage.updateIntervalFund(req.params.id, req.body);
      if (!fund) return res.status(404).json({ message: "Interval fund not found" });
      res.json(fund);
    } catch (error: any) {
      console.error("Update interval fund error:", error);
      res.status(500).json({ message: "Failed to update interval fund" });
    }
  });

  app.delete("/api/interval-funds/:id", async (req, res) => {
    try {
      await storage.deleteIntervalFund(req.params.id);
      res.json({ message: "Interval fund deleted" });
    } catch (error: any) {
      console.error("Delete interval fund error:", error);
      res.status(500).json({ message: "Failed to delete interval fund" });
    }
  });

  // ===== Interval Fund Universe Search Routes =====

  app.get("/api/interval-funds-universe/search", async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query || query.trim().length < 2) {
        return res.status(400).json({ message: "Search query must be at least 2 characters" });
      }
      const alphaVantageKey = process.env.ALPHA_VANTAGE_API_KEY || "";
      const results = await searchIntervalFundUniverse(query.trim(), alphaVantageKey);
      res.json(results);
    } catch (error: any) {
      console.error("Universe search error:", error);
      res.status(500).json({ message: "Failed to search interval fund universe" });
    }
  });

  app.post("/api/interval-funds-universe/import", async (req, res) => {
    try {
      const { fund } = req.body as { fund: ReconciledFund };
      if (!fund || !fund.name) {
        return res.status(400).json({ message: "Fund data is required" });
      }

      const existing = await storage.getIntervalFunds();
      const duplicate = existing.find(e =>
        (fund.ticker && e.ticker && e.ticker.toUpperCase() === fund.ticker.toUpperCase()) ||
        e.name.toLowerCase() === fund.name.toLowerCase()
      );
      if (duplicate) {
        return res.status(409).json({ message: `Fund "${duplicate.name}" already exists in your database`, existingFund: duplicate });
      }

      const insertData = reconciledToInsert(fund);
      const created = await storage.createIntervalFund(insertData);
      res.status(201).json({ fund: created, message: "Fund imported successfully" });
    } catch (error: any) {
      console.error("Import fund error:", error);
      res.status(500).json({ message: "Failed to import fund" });
    }
  });

  registerReturnStreamRoutes(app);

  return httpServer;
}
