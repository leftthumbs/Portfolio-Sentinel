import { sql } from "drizzle-orm";
import { pgTable, text, varchar, decimal, integer, timestamp, jsonb, serial, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const portfolios = pgTable("portfolios", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  totalValue: decimal("total_value", { precision: 20, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("USD"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const holdings = pgTable("holdings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  portfolioId: varchar("portfolio_id").references(() => portfolios.id).notNull(),
  fundName: text("fund_name").notNull(),
  ticker: text("ticker"),
  assetClass: text("asset_class").notNull(),
  allocation: decimal("allocation", { precision: 5, scale: 2 }).notNull(),
  marketValue: decimal("market_value", { precision: 20, scale: 2 }).notNull(),
  costBasis: decimal("cost_basis", { precision: 20, scale: 2 }).notNull(),
  unrealizedGain: decimal("unrealized_gain", { precision: 20, scale: 2 }).notNull(),
  returnYtd: decimal("return_ytd", { precision: 8, scale: 4 }),
  return1yr: decimal("return_1yr", { precision: 8, scale: 4 }),
  return3yr: decimal("return_3yr", { precision: 8, scale: 4 }),
});

export const performanceHistory = pgTable("performance_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  portfolioId: varchar("portfolio_id").references(() => portfolios.id).notNull(),
  date: timestamp("date").notNull(),
  portfolioValue: decimal("portfolio_value", { precision: 20, scale: 2 }).notNull(),
  dailyReturn: decimal("daily_return", { precision: 10, scale: 6 }),
  cumulativeReturn: decimal("cumulative_return", { precision: 10, scale: 6 }),
  benchmarkValue: decimal("benchmark_value", { precision: 20, scale: 2 }),
  benchmarkReturn: decimal("benchmark_return", { precision: 10, scale: 6 }),
});

export const riskMetrics = pgTable("risk_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  portfolioId: varchar("portfolio_id").references(() => portfolios.id).notNull(),
  calculationDate: timestamp("calculation_date").defaultNow(),
  volatility: decimal("volatility", { precision: 10, scale: 6 }),
  sharpeRatio: decimal("sharpe_ratio", { precision: 8, scale: 4 }),
  sortinoRatio: decimal("sortino_ratio", { precision: 8, scale: 4 }),
  maxDrawdown: decimal("max_drawdown", { precision: 10, scale: 6 }),
  var95: decimal("var_95", { precision: 10, scale: 6 }),
  var99: decimal("var_99", { precision: 10, scale: 6 }),
  cvar95: decimal("cvar_95", { precision: 10, scale: 6 }),
  beta: decimal("beta", { precision: 8, scale: 4 }),
  alpha: decimal("alpha", { precision: 8, scale: 4 }),
  treynorRatio: decimal("treynor_ratio", { precision: 8, scale: 4 }),
  informationRatio: decimal("information_ratio", { precision: 8, scale: 4 }),
  trackingError: decimal("tracking_error", { precision: 10, scale: 6 }),
  correlation: decimal("correlation", { precision: 8, scale: 4 }),
  downsideCorrelation: decimal("downside_correlation", { precision: 8, scale: 4 }),
  jensensAlpha: decimal("jensens_alpha", { precision: 8, scale: 4 }),
  // Additional sophisticated metrics for alternative investments
  calmarRatio: decimal("calmar_ratio", { precision: 8, scale: 4 }),
  omegaRatio: decimal("omega_ratio", { precision: 8, scale: 4 }),
  skewness: decimal("skewness", { precision: 8, scale: 4 }),
  kurtosis: decimal("kurtosis", { precision: 8, scale: 4 }),
  upsideCapture: decimal("upside_capture", { precision: 8, scale: 4 }),
  downsideCapture: decimal("downside_capture", { precision: 8, scale: 4 }),
  ulcerIndex: decimal("ulcer_index", { precision: 10, scale: 6 }),
  painIndex: decimal("pain_index", { precision: 10, scale: 6 }),
  gainToPainRatio: decimal("gain_to_pain_ratio", { precision: 8, scale: 4 }),
  tailRatio: decimal("tail_ratio", { precision: 8, scale: 4 }),
  commonSenseRatio: decimal("common_sense_ratio", { precision: 8, scale: 4 }),
  averageDrawdown: decimal("average_drawdown", { precision: 10, scale: 6 }),
  sterlingRatio: decimal("sterling_ratio", { precision: 8, scale: 4 }),
  burkeRatio: decimal("burke_ratio", { precision: 8, scale: 4 }),
  // Diversification and concentration metrics
  herfindahlIndex: decimal("herfindahl_index", { precision: 8, scale: 4 }),
  diversificationRatio: decimal("diversification_ratio", { precision: 8, scale: 4 }),
  // Downside risk metrics
  downsideDeviation: decimal("downside_deviation", { precision: 10, scale: 6 }),
  upsidePotentialRatio: decimal("upside_potential_ratio", { precision: 8, scale: 4 }),
  // Time-weighted metrics
  cagr: decimal("cagr", { precision: 8, scale: 4 }),
  mar: decimal("mar", { precision: 8, scale: 4 }),
});

export const stressTests = pgTable("stress_tests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  portfolioId: varchar("portfolio_id").references(() => portfolios.id).notNull(),
  scenarioName: text("scenario_name").notNull(),
  scenarioType: text("scenario_type").notNull(),
  description: text("description"),
  equityShock: decimal("equity_shock", { precision: 8, scale: 4 }),
  rateShock: decimal("rate_shock", { precision: 8, scale: 4 }),
  creditSpreadShock: decimal("credit_spread_shock", { precision: 8, scale: 4 }),
  fxShock: decimal("fx_shock", { precision: 8, scale: 4 }),
  portfolioImpact: decimal("portfolio_impact", { precision: 10, scale: 6 }),
  impactAmount: decimal("impact_amount", { precision: 20, scale: 2 }),
  runDate: timestamp("run_date").defaultNow(),
  regime: text("regime"),
  scenarioCategory: text("scenario_category"),
  commodityShock: decimal("commodity_shock", { precision: 8, scale: 4 }),
  volatilityShock: decimal("volatility_shock", { precision: 8, scale: 4 }),
  inflationShock: decimal("inflation_shock", { precision: 8, scale: 4 }),
  liquidityShock: decimal("liquidity_shock", { precision: 8, scale: 4 }),
  parametricVaR95: decimal("parametric_var_95", { precision: 10, scale: 6 }),
  parametricVaR99: decimal("parametric_var_99", { precision: 10, scale: 6 }),
  cvar95: decimal("cvar_95", { precision: 10, scale: 6 }),
  cvar99: decimal("cvar_99", { precision: 10, scale: 6 }),
  stressedValue: decimal("stressed_value", { precision: 20, scale: 2 }),
  factorDecomposition: jsonb("factor_decomposition"),
  assetImpacts: jsonb("asset_impacts"),
  componentVaR: jsonb("component_var"),
  monteCarloStats: jsonb("monte_carlo_scenario_stats"),
});

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const dataRoomDocuments = pgTable("data_room_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  portfolioId: varchar("portfolio_id").references(() => portfolios.id).notNull(),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(),
  fileSize: integer("file_size").notNull(),
  extractedContent: text("extracted_content"),
  documentType: text("document_type"),
  folderId: varchar("folder_id"),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
  lastModified: timestamp("last_modified").defaultNow(),
});

export const investmentMemos = pgTable("investment_memos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  portfolioId: varchar("portfolio_id").references(() => portfolios.id).notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull().default("draft"),
  templateType: text("template_type").notNull().default("institutional"),
  docFilePath: text("doc_file_path"),
  generatedFromDocuments: text("generated_from_documents").array(),
  folderId: varchar("folder_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  autoGenerated: boolean("auto_generated").default(false),
});

export const memoTemplateTypes = [
  "institutional",
  "everest_investment_summary",
  "verita_investment_memo",
  "investment_summary",
  "verita_investment_summary",
] as const;

export type MemoTemplateType = typeof memoTemplateTypes[number];

export const folderTypes = ["fund", "document", "memo"] as const;
export type FolderType = typeof folderTypes[number];

export const fundFolders = pgTable("fund_folders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  parentId: varchar("parent_id"),
  color: text("color"),
  icon: text("icon"),
  folderType: text("folder_type").notNull().default("fund"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const strategyLibrary = pgTable("strategy_library", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  ticker: text("ticker"),
  strategyType: text("strategy_type").notNull(),
  folderId: varchar("folder_id").references(() => fundFolders.id, { onDelete: "set null" }),
  assetClass: text("asset_class").notNull(),
  description: text("description"),
  expectedReturn: decimal("expected_return", { precision: 8, scale: 4 }),
  volatility: decimal("volatility", { precision: 8, scale: 4 }),
  sourceFile: text("source_file"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  // Hedge Fund specific fields
  managementFee: decimal("management_fee", { precision: 6, scale: 4 }),
  performanceFee: decimal("performance_fee", { precision: 6, scale: 4 }),
  hurdleRate: decimal("hurdle_rate", { precision: 6, scale: 4 }),
  highWaterMark: boolean("high_water_mark"),
  lockupPeriod: integer("lockup_period"),
  redemptionFrequency: text("redemption_frequency"),
  redemptionNotice: integer("redemption_notice"),
  gateProvision: decimal("gate_provision", { precision: 6, scale: 4 }),
  fundAum: decimal("fund_aum", { precision: 20, scale: 2 }),
  inceptionDate: timestamp("inception_date"),
  fundManager: text("fund_manager"),
  fundDomicile: text("fund_domicile"),
  // Private Credit specific fields
  targetYield: decimal("target_yield", { precision: 6, scale: 4 }),
  currentYield: decimal("current_yield", { precision: 6, scale: 4 }),
  yieldToMaturity: decimal("yield_to_maturity", { precision: 6, scale: 4 }),
  weightedAvgLife: decimal("weighted_avg_life", { precision: 6, scale: 2 }),
  loanToValue: decimal("loan_to_value", { precision: 6, scale: 4 }),
  seniorityLevel: text("seniority_level"),
  defaultRate: decimal("default_rate", { precision: 6, scale: 4 }),
  recoveryRate: decimal("recovery_rate", { precision: 6, scale: 4 }),
  spreadOverBase: decimal("spread_over_base", { precision: 6, scale: 4 }),
  floatingRatePct: decimal("floating_rate_pct", { precision: 6, scale: 4 }),
  vintageYear: integer("vintage_year"),
  fundLifeYears: integer("fund_life_years"),
  // Performance metrics
  sharpeRatio: decimal("sharpe_ratio", { precision: 8, scale: 4 }),
  sortinoRatio: decimal("sortino_ratio", { precision: 8, scale: 4 }),
  maxDrawdown: decimal("max_drawdown", { precision: 8, scale: 4 }),
  calmarRatio: decimal("calmar_ratio", { precision: 8, scale: 4 }),
  beta: decimal("beta", { precision: 8, scale: 4 }),
  alpha: decimal("alpha", { precision: 8, scale: 4 }),
  correlation: decimal("correlation", { precision: 8, scale: 4 }),
});

export const customPortfolios = pgTable("custom_portfolios", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const customPortfolioItems = pgTable("custom_portfolio_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customPortfolioId: varchar("custom_portfolio_id").references(() => customPortfolios.id, { onDelete: "cascade" }).notNull(),
  strategyId: varchar("strategy_id").references(() => strategyLibrary.id),
  ticker: text("ticker"),
  name: text("name").notNull(),
  strategyType: text("strategy_type").notNull().default("investment"),
  assetClass: text("asset_class").notNull(),
  weight: decimal("weight", { precision: 8, scale: 4 }).notNull(),
  expectedReturn: decimal("expected_return", { precision: 8, scale: 4 }),
  volatility: decimal("volatility", { precision: 8, scale: 4 }),
});

export const backtestResults = pgTable("backtest_results", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customPortfolioId: varchar("custom_portfolio_id").references(() => customPortfolios.id, { onDelete: "cascade" }).notNull(),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  initialValue: decimal("initial_value", { precision: 20, scale: 2 }).notNull(),
  finalValue: decimal("final_value", { precision: 20, scale: 2 }).notNull(),
  totalReturn: decimal("total_return", { precision: 10, scale: 6 }).notNull(),
  annualizedReturn: decimal("annualized_return", { precision: 10, scale: 6 }),
  volatility: decimal("volatility", { precision: 10, scale: 6 }),
  sharpeRatio: decimal("sharpe_ratio", { precision: 8, scale: 4 }),
  maxDrawdown: decimal("max_drawdown", { precision: 10, scale: 6 }),
  performanceData: jsonb("performance_data"),
  monteCarloStats: jsonb("monte_carlo_stats"),
  simulationFinalValues: jsonb("simulation_final_values"),
  numSimulations: integer("num_simulations").default(100),
  runDate: timestamp("run_date").defaultNow(),
});

export const strategyReturns = pgTable("strategy_returns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  strategyId: varchar("strategy_id").references(() => strategyLibrary.id, { onDelete: "cascade" }).notNull(),
  date: timestamp("date").notNull(),
  returnValue: decimal("return_value", { precision: 12, scale: 8 }).notNull(),
  source: text("source"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const benchmarks = pgTable("benchmarks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  ticker: text("ticker").notNull(),
  description: text("description"),
  category: text("category").notNull().default("Equity"),
  color: text("color"),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const benchmarkReturns = pgTable("benchmark_returns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  benchmarkId: varchar("benchmark_id").references(() => benchmarks.id, { onDelete: "cascade" }).notNull(),
  date: timestamp("date").notNull(),
  returnValue: decimal("return_value", { precision: 12, scale: 8 }).notNull(),
  cumulativeReturn: decimal("cumulative_return", { precision: 12, scale: 8 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const portfolioBenchmarks = pgTable("portfolio_benchmarks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  portfolioId: varchar("portfolio_id").references(() => portfolios.id, { onDelete: "cascade" }).notNull(),
  benchmarkId: varchar("benchmark_id").references(() => benchmarks.id, { onDelete: "cascade" }).notNull(),
  isPrimary: boolean("is_primary").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const compositeBenchmarks = pgTable("composite_benchmarks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const compositeBenchmarkComponents = pgTable("composite_benchmark_components", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  compositeBenchmarkId: varchar("composite_benchmark_id").references(() => compositeBenchmarks.id, { onDelete: "cascade" }).notNull(),
  benchmarkId: varchar("benchmark_id").references(() => benchmarks.id, { onDelete: "cascade" }).notNull(),
  weight: decimal("weight", { precision: 5, scale: 4 }).notNull(),
});

export const insertPortfolioSchema = createInsertSchema(portfolios).omit({ id: true, createdAt: true });
export const insertHoldingSchema = createInsertSchema(holdings).omit({ id: true });
export const insertPerformanceSchema = createInsertSchema(performanceHistory).omit({ id: true });
export const insertRiskMetricsSchema = createInsertSchema(riskMetrics).omit({ id: true, calculationDate: true });
export const insertStressTestSchema = createInsertSchema(stressTests).omit({ id: true, runDate: true });
export const insertUserSchema = createInsertSchema(users).pick({ username: true, password: true });
export const insertConversationSchema = createInsertSchema(conversations).omit({ id: true, createdAt: true });
export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export const insertDataRoomDocumentSchema = createInsertSchema(dataRoomDocuments).omit({ id: true, uploadedAt: true, lastModified: true });
export const insertInvestmentMemoSchema = createInsertSchema(investmentMemos).omit({ id: true, createdAt: true, updatedAt: true });
export const insertFundFolderSchema = createInsertSchema(fundFolders).omit({ id: true, createdAt: true, updatedAt: true });
export const insertStrategyLibrarySchema = createInsertSchema(strategyLibrary).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCustomPortfolioSchema = createInsertSchema(customPortfolios).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCustomPortfolioItemSchema = createInsertSchema(customPortfolioItems).omit({ id: true });
export const insertBacktestResultSchema = createInsertSchema(backtestResults).omit({ id: true, runDate: true });
export const insertStrategyReturnSchema = createInsertSchema(strategyReturns).omit({ id: true, createdAt: true });
export const insertBenchmarkSchema = createInsertSchema(benchmarks).omit({ id: true, createdAt: true });
export const insertBenchmarkReturnSchema = createInsertSchema(benchmarkReturns).omit({ id: true, createdAt: true });
export const insertPortfolioBenchmarkSchema = createInsertSchema(portfolioBenchmarks).omit({ id: true, createdAt: true });
export const insertCompositeBenchmarkSchema = createInsertSchema(compositeBenchmarks).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCompositeBenchmarkComponentSchema = createInsertSchema(compositeBenchmarkComponents).omit({ id: true });

export const intervalFunds = pgTable("interval_funds", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  ticker: text("ticker"),
  fundManager: text("fund_manager"),
  description: text("description"),
  assetClass: text("asset_class").notNull(),
  strategyType: text("strategy_type").notNull(),
  repurchaseFrequency: text("repurchase_frequency").notNull().default("Quarterly"),
  repurchaseRate: decimal("repurchase_rate", { precision: 6, scale: 4 }),
  repurchaseNotice: integer("repurchase_notice"),
  fundStructure: text("fund_structure").default("Interval Fund"),
  navPerShare: decimal("nav_per_share", { precision: 12, scale: 4 }),
  totalAum: decimal("total_aum", { precision: 20, scale: 2 }),
  minInvestment: decimal("min_investment", { precision: 20, scale: 2 }),
  managementFee: decimal("management_fee", { precision: 6, scale: 4 }),
  performanceFee: decimal("performance_fee", { precision: 6, scale: 4 }),
  expenseRatio: decimal("expense_ratio", { precision: 6, scale: 4 }),
  distributionRate: decimal("distribution_rate", { precision: 6, scale: 4 }),
  distributionFrequency: text("distribution_frequency").default("Monthly"),
  nav30dReturn: decimal("nav_30d_return", { precision: 8, scale: 4 }),
  nav90dReturn: decimal("nav_90d_return", { precision: 8, scale: 4 }),
  navYtdReturn: decimal("nav_ytd_return", { precision: 8, scale: 4 }),
  nav1yrReturn: decimal("nav_1yr_return", { precision: 8, scale: 4 }),
  nav3yrReturn: decimal("nav_3yr_return", { precision: 8, scale: 4 }),
  nav5yrReturn: decimal("nav_5yr_return", { precision: 8, scale: 4 }),
  inceptionReturn: decimal("inception_return", { precision: 8, scale: 4 }),
  volatility: decimal("volatility", { precision: 8, scale: 4 }),
  sharpeRatio: decimal("sharpe_ratio", { precision: 8, scale: 4 }),
  sortinoRatio: decimal("sortino_ratio", { precision: 8, scale: 4 }),
  maxDrawdown: decimal("max_drawdown", { precision: 8, scale: 4 }),
  beta: decimal("beta", { precision: 8, scale: 4 }),
  alpha: decimal("alpha", { precision: 8, scale: 4 }),
  correlation: decimal("correlation", { precision: 8, scale: 4 }),
  topHoldingsPct: decimal("top_holdings_pct", { precision: 6, scale: 4 }),
  numHoldings: integer("num_holdings"),
  leverageRatio: decimal("leverage_ratio", { precision: 6, scale: 4 }),
  weightedAvgCoupon: decimal("weighted_avg_coupon", { precision: 6, scale: 4 }),
  weightedAvgMaturity: decimal("weighted_avg_maturity", { precision: 6, scale: 2 }),
  defaultRate: decimal("default_rate", { precision: 6, scale: 4 }),
  inceptionDate: timestamp("inception_date"),
  fundDomicile: text("fund_domicile"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertIntervalFundSchema = createInsertSchema(intervalFunds).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertPortfolio = z.infer<typeof insertPortfolioSchema>;
export type InsertHolding = z.infer<typeof insertHoldingSchema>;
export type InsertPerformance = z.infer<typeof insertPerformanceSchema>;
export type InsertRiskMetrics = z.infer<typeof insertRiskMetricsSchema>;
export type InsertStressTest = z.infer<typeof insertStressTestSchema>;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Portfolio = typeof portfolios.$inferSelect;
export type Holding = typeof holdings.$inferSelect;
export type PerformanceHistory = typeof performanceHistory.$inferSelect;
export type RiskMetrics = typeof riskMetrics.$inferSelect;
export type StressTest = typeof stressTests.$inferSelect;
export type User = typeof users.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type DataRoomDocument = typeof dataRoomDocuments.$inferSelect;
export type InvestmentMemo = typeof investmentMemos.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type InsertDataRoomDocument = z.infer<typeof insertDataRoomDocumentSchema>;
export type InsertInvestmentMemo = z.infer<typeof insertInvestmentMemoSchema>;
export type InsertStrategyLibrary = z.infer<typeof insertStrategyLibrarySchema>;
export type InsertCustomPortfolio = z.infer<typeof insertCustomPortfolioSchema>;
export type InsertCustomPortfolioItem = z.infer<typeof insertCustomPortfolioItemSchema>;
export type InsertBacktestResult = z.infer<typeof insertBacktestResultSchema>;
export type FundFolder = typeof fundFolders.$inferSelect;
export type InsertFundFolder = z.infer<typeof insertFundFolderSchema>;
export type StrategyLibrary = typeof strategyLibrary.$inferSelect;
export type CustomPortfolio = typeof customPortfolios.$inferSelect;
export type CustomPortfolioItem = typeof customPortfolioItems.$inferSelect;
export type BacktestResult = typeof backtestResults.$inferSelect;
export type StrategyReturn = typeof strategyReturns.$inferSelect;
export type InsertStrategyReturn = z.infer<typeof insertStrategyReturnSchema>;
export type Benchmark = typeof benchmarks.$inferSelect;
export type BenchmarkReturn = typeof benchmarkReturns.$inferSelect;
export type PortfolioBenchmark = typeof portfolioBenchmarks.$inferSelect;
export type InsertBenchmark = z.infer<typeof insertBenchmarkSchema>;
export type InsertBenchmarkReturn = z.infer<typeof insertBenchmarkReturnSchema>;
export type InsertPortfolioBenchmark = z.infer<typeof insertPortfolioBenchmarkSchema>;
export type CompositeBenchmark = typeof compositeBenchmarks.$inferSelect;
export type CompositeBenchmarkComponent = typeof compositeBenchmarkComponents.$inferSelect;
export type InsertCompositeBenchmark = z.infer<typeof insertCompositeBenchmarkSchema>;
export type InsertCompositeBenchmarkComponent = z.infer<typeof insertCompositeBenchmarkComponentSchema>;
export type IntervalFund = typeof intervalFunds.$inferSelect;
export type InsertIntervalFund = z.infer<typeof insertIntervalFundSchema>;
