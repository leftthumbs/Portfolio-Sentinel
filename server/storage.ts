import { eq, desc, ilike, or, asc, inArray, and } from "drizzle-orm";
import { db, pool } from "./db";
import session from "express-session";
import connectPg from "connect-pg-simple";
import {
  portfolios,
  holdings,
  performanceHistory,
  riskMetrics,
  stressTests,
  users,
  dataRoomDocuments,
  investmentMemos,
  conversations,
  messages,
  strategyLibrary,
  customPortfolios,
  customPortfolioItems,
  backtestResults,
  strategyReturns,
  benchmarks,
  benchmarkReturns,
  portfolioBenchmarks,
  compositeBenchmarks,
  compositeBenchmarkComponents,
  fundFolders,
  intervalFunds,
  type Portfolio,
  type Holding,
  type PerformanceHistory,
  type RiskMetrics,
  type StressTest,
  type User,
  type DataRoomDocument,
  type InvestmentMemo,
  type Conversation,
  type Message,
  type StrategyLibrary,
  type CustomPortfolio,
  type CustomPortfolioItem,
  type BacktestResult,
  type StrategyReturn,
  type Benchmark,
  type BenchmarkReturn,
  type PortfolioBenchmark,
  type FundFolder,
  type InsertPortfolio,
  type InsertHolding,
  type InsertPerformance,
  type InsertRiskMetrics,
  type InsertStressTest,
  type InsertUser,
  type InsertDataRoomDocument,
  type InsertInvestmentMemo,
  type InsertConversation,
  type InsertMessage,
  type InsertStrategyLibrary,
  type InsertCustomPortfolio,
  type InsertCustomPortfolioItem,
  type InsertBacktestResult,
  type InsertStrategyReturn,
  type InsertBenchmark,
  type InsertBenchmarkReturn,
  type InsertPortfolioBenchmark,
  type InsertFundFolder,
  type CompositeBenchmark,
  type CompositeBenchmarkComponent,
  type InsertCompositeBenchmark,
  type InsertCompositeBenchmarkComponent,
  type IntervalFund,
  type InsertIntervalFund,
} from "@shared/schema";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserPassword(id: string, hashedPassword: string): Promise<void>;
  
  getPortfolios(): Promise<Portfolio[]>;
  getPortfolio(id: string): Promise<Portfolio | undefined>;
  createPortfolio(portfolio: InsertPortfolio): Promise<Portfolio>;
  updatePortfolioValue(id: string, totalValue: string): Promise<void>;
  
  getHoldings(portfolioId: string): Promise<Holding[]>;
  getHolding(id: string): Promise<Holding | undefined>;
  createHolding(holding: InsertHolding): Promise<Holding>;
  createHoldings(holdingsData: InsertHolding[]): Promise<Holding[]>;
  updateHoldingAllocation(id: string, allocation: string): Promise<void>;
  deleteHolding(id: string): Promise<void>;
  
  getPerformanceHistory(portfolioId: string): Promise<PerformanceHistory[]>;
  createPerformanceHistory(performance: InsertPerformance): Promise<PerformanceHistory>;
  
  getRiskMetrics(portfolioId: string): Promise<RiskMetrics | undefined>;
  createRiskMetrics(metrics: InsertRiskMetrics): Promise<RiskMetrics>;
  
  getStressTests(portfolioId: string): Promise<StressTest[]>;
  createStressTest(test: InsertStressTest): Promise<StressTest>;
  
  getDataRoomDocuments(portfolioId: string): Promise<DataRoomDocument[]>;
  getDataRoomDocument(id: string): Promise<DataRoomDocument | undefined>;
  createDataRoomDocument(doc: InsertDataRoomDocument): Promise<DataRoomDocument>;
  updateDataRoomDocument(id: string, updates: Partial<InsertDataRoomDocument>): Promise<DataRoomDocument | undefined>;
  deleteDataRoomDocument(id: string): Promise<void>;
  
  getInvestmentMemos(portfolioId: string): Promise<InvestmentMemo[]>;
  getInvestmentMemo(id: string): Promise<InvestmentMemo | undefined>;
  createInvestmentMemo(memo: InsertInvestmentMemo): Promise<InvestmentMemo>;
  updateInvestmentMemo(id: string, updates: Partial<InsertInvestmentMemo>): Promise<InvestmentMemo | undefined>;
  deleteInvestmentMemo(id: string): Promise<void>;
  
  getConversation(id: number): Promise<Conversation | undefined>;
  getAllConversations(): Promise<Conversation[]>;
  createConversation(title: string): Promise<Conversation>;
  deleteConversation(id: number): Promise<void>;
  getMessagesByConversation(conversationId: number): Promise<Message[]>;
  createMessage(conversationId: number, role: string, content: string): Promise<Message>;
  
  getStrategies(): Promise<StrategyLibrary[]>;
  getStrategy(id: string): Promise<StrategyLibrary | undefined>;
  searchStrategies(query: string): Promise<StrategyLibrary[]>;
  createStrategy(strategy: InsertStrategyLibrary): Promise<StrategyLibrary>;
  createStrategies(strategies: InsertStrategyLibrary[]): Promise<StrategyLibrary[]>;
  updateStrategy(id: string, updates: Partial<InsertStrategyLibrary>): Promise<StrategyLibrary | undefined>;
  deleteStrategy(id: string): Promise<void>;
  
  getCustomPortfolios(): Promise<CustomPortfolio[]>;
  getCustomPortfolio(id: string): Promise<CustomPortfolio | undefined>;
  createCustomPortfolio(portfolio: InsertCustomPortfolio): Promise<CustomPortfolio>;
  updateCustomPortfolio(id: string, updates: Partial<InsertCustomPortfolio>): Promise<CustomPortfolio | undefined>;
  deleteCustomPortfolio(id: string): Promise<void>;
  
  getCustomPortfolioItems(customPortfolioId: string): Promise<CustomPortfolioItem[]>;
  createCustomPortfolioItem(item: InsertCustomPortfolioItem): Promise<CustomPortfolioItem>;
  updateCustomPortfolioItem(id: string, updates: Partial<InsertCustomPortfolioItem>): Promise<CustomPortfolioItem | undefined>;
  deleteCustomPortfolioItem(id: string): Promise<void>;
  deleteCustomPortfolioItems(customPortfolioId: string): Promise<void>;
  
  getBacktestResults(customPortfolioId: string): Promise<BacktestResult[]>;
  getBacktestResult(id: string): Promise<BacktestResult | undefined>;
  createBacktestResult(result: InsertBacktestResult): Promise<BacktestResult>;
  deleteBacktestResult(id: string): Promise<void>;
  
  getStrategyReturns(strategyId: string): Promise<StrategyReturn[]>;
  getReturnsForStrategies(strategyIds: string[]): Promise<StrategyReturn[]>;
  createStrategyReturns(returns: InsertStrategyReturn[]): Promise<StrategyReturn[]>;
  deleteStrategyReturns(strategyId: string): Promise<void>;
  getStrategyReturnCount(strategyId: string): Promise<number>;
  
  getBenchmarks(): Promise<Benchmark[]>;
  getBenchmark(id: string): Promise<Benchmark | undefined>;
  createBenchmark(benchmark: InsertBenchmark): Promise<Benchmark>;
  updateBenchmark(id: string, updates: Partial<InsertBenchmark>): Promise<Benchmark | undefined>;
  deleteBenchmark(id: string): Promise<void>;
  
  getBenchmarkReturns(benchmarkId: string): Promise<BenchmarkReturn[]>;
  createBenchmarkReturns(returns: InsertBenchmarkReturn[]): Promise<BenchmarkReturn[]>;
  deleteBenchmarkReturns(benchmarkId: string): Promise<void>;
  
  getPortfolioBenchmarks(portfolioId: string): Promise<PortfolioBenchmark[]>;
  addPortfolioBenchmark(data: InsertPortfolioBenchmark): Promise<PortfolioBenchmark>;
  removePortfolioBenchmark(portfolioId: string, benchmarkId: string): Promise<void>;
  setPrimaryBenchmark(portfolioId: string, benchmarkId: string): Promise<void>;
  
  getCompositeBenchmarks(): Promise<CompositeBenchmark[]>;
  getCompositeBenchmark(id: string): Promise<CompositeBenchmark | undefined>;
  createCompositeBenchmark(benchmark: InsertCompositeBenchmark, components: { benchmarkId: string; weight: string }[]): Promise<CompositeBenchmark>;
  updateCompositeBenchmark(id: string, updates: Partial<InsertCompositeBenchmark>, components?: { benchmarkId: string; weight: string }[]): Promise<CompositeBenchmark | undefined>;
  deleteCompositeBenchmark(id: string): Promise<void>;
  getCompositeBenchmarkComponents(compositeBenchmarkId: string): Promise<CompositeBenchmarkComponent[]>;
  
  getFundFolders(folderType?: string): Promise<FundFolder[]>;
  getFundFolder(id: string): Promise<FundFolder | undefined>;
  createFundFolder(folder: InsertFundFolder): Promise<FundFolder>;
  updateFundFolder(id: string, updates: Partial<InsertFundFolder>): Promise<FundFolder | undefined>;
  deleteFundFolder(id: string): Promise<void>;
  getStrategiesByFolder(folderId: string | null): Promise<StrategyLibrary[]>;
  moveStrategyToFolder(strategyId: string, folderId: string | null): Promise<StrategyLibrary | undefined>;
  moveDocumentToFolder(documentId: string, folderId: string | null): Promise<DataRoomDocument | undefined>;
  moveMemoToFolder(memoId: string, folderId: string | null): Promise<InvestmentMemo | undefined>;
  
  getIntervalFunds(): Promise<IntervalFund[]>;
  getIntervalFund(id: string): Promise<IntervalFund | undefined>;
  createIntervalFund(fund: InsertIntervalFund): Promise<IntervalFund>;
  updateIntervalFund(id: string, updates: Partial<InsertIntervalFund>): Promise<IntervalFund | undefined>;
  deleteIntervalFund(id: string): Promise<void>;
  
  sessionStore: session.Store;
}

const PostgresSessionStore = connectPg(session);

export class DatabaseStorage implements IStorage {
  sessionStore: session.Store;
  
  constructor() {
    this.sessionStore = new PostgresSessionStore({ 
      pool, 
      createTableIfMissing: true 
    });
  }
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUserPassword(id: string, hashedPassword: string): Promise<void> {
    await db.update(users).set({ password: hashedPassword }).where(eq(users.id, id));
  }

  async getPortfolios(): Promise<Portfolio[]> {
    return db.select().from(portfolios);
  }

  async getPortfolio(id: string): Promise<Portfolio | undefined> {
    const [portfolio] = await db.select().from(portfolios).where(eq(portfolios.id, id));
    return portfolio;
  }

  async createPortfolio(portfolio: InsertPortfolio): Promise<Portfolio> {
    const [created] = await db.insert(portfolios).values(portfolio).returning();
    return created;
  }

  async updatePortfolioValue(id: string, totalValue: string): Promise<void> {
    await db.update(portfolios).set({ totalValue }).where(eq(portfolios.id, id));
  }

  async getHoldings(portfolioId: string): Promise<Holding[]> {
    return db.select().from(holdings).where(eq(holdings.portfolioId, portfolioId));
  }

  async getHolding(id: string): Promise<Holding | undefined> {
    const [holding] = await db.select().from(holdings).where(eq(holdings.id, id));
    return holding;
  }

  async createHolding(holding: InsertHolding): Promise<Holding> {
    const [created] = await db.insert(holdings).values(holding).returning();
    return created;
  }

  async createHoldings(holdingsData: InsertHolding[]): Promise<Holding[]> {
    if (holdingsData.length === 0) return [];
    const created = await db.insert(holdings).values(holdingsData).returning();
    return created;
  }

  async updateHoldingAllocation(id: string, allocation: string): Promise<void> {
    await db.update(holdings).set({ allocation }).where(eq(holdings.id, id));
  }

  async deleteHolding(id: string): Promise<void> {
    await db.delete(holdings).where(eq(holdings.id, id));
  }

  async getPerformanceHistory(portfolioId: string): Promise<PerformanceHistory[]> {
    return db.select().from(performanceHistory).where(eq(performanceHistory.portfolioId, portfolioId));
  }

  async createPerformanceHistory(performance: InsertPerformance): Promise<PerformanceHistory> {
    const [created] = await db.insert(performanceHistory).values(performance).returning();
    return created;
  }

  async getRiskMetrics(portfolioId: string): Promise<RiskMetrics | undefined> {
    const [metrics] = await db.select().from(riskMetrics).where(eq(riskMetrics.portfolioId, portfolioId));
    return metrics;
  }

  async createRiskMetrics(metrics: InsertRiskMetrics): Promise<RiskMetrics> {
    const [created] = await db.insert(riskMetrics).values(metrics).returning();
    return created;
  }

  async getStressTests(portfolioId: string): Promise<StressTest[]> {
    return db.select().from(stressTests).where(eq(stressTests.portfolioId, portfolioId));
  }

  async createStressTest(test: InsertStressTest): Promise<StressTest> {
    const [created] = await db.insert(stressTests).values(test).returning();
    return created;
  }

  async getDataRoomDocuments(portfolioId: string): Promise<DataRoomDocument[]> {
    return db.select().from(dataRoomDocuments).where(eq(dataRoomDocuments.portfolioId, portfolioId)).orderBy(desc(dataRoomDocuments.uploadedAt));
  }

  async getDataRoomDocument(id: string): Promise<DataRoomDocument | undefined> {
    const [doc] = await db.select().from(dataRoomDocuments).where(eq(dataRoomDocuments.id, id));
    return doc;
  }

  async createDataRoomDocument(doc: InsertDataRoomDocument): Promise<DataRoomDocument> {
    const [created] = await db.insert(dataRoomDocuments).values(doc).returning();
    return created;
  }

  async updateDataRoomDocument(id: string, updates: Partial<InsertDataRoomDocument>): Promise<DataRoomDocument | undefined> {
    const [updated] = await db.update(dataRoomDocuments).set({ ...updates, lastModified: new Date() }).where(eq(dataRoomDocuments.id, id)).returning();
    return updated;
  }

  async deleteDataRoomDocument(id: string): Promise<void> {
    await db.delete(dataRoomDocuments).where(eq(dataRoomDocuments.id, id));
  }

  async getInvestmentMemos(portfolioId: string): Promise<InvestmentMemo[]> {
    return db.select().from(investmentMemos).where(eq(investmentMemos.portfolioId, portfolioId)).orderBy(desc(investmentMemos.createdAt));
  }

  async getInvestmentMemo(id: string): Promise<InvestmentMemo | undefined> {
    const [memo] = await db.select().from(investmentMemos).where(eq(investmentMemos.id, id));
    return memo;
  }

  async createInvestmentMemo(memo: InsertInvestmentMemo): Promise<InvestmentMemo> {
    const [created] = await db.insert(investmentMemos).values(memo).returning();
    return created;
  }

  async updateInvestmentMemo(id: string, updates: Partial<InsertInvestmentMemo>): Promise<InvestmentMemo | undefined> {
    const [updated] = await db.update(investmentMemos).set({ ...updates, updatedAt: new Date() }).where(eq(investmentMemos.id, id)).returning();
    return updated;
  }

  async deleteInvestmentMemo(id: string): Promise<void> {
    await db.delete(investmentMemos).where(eq(investmentMemos.id, id));
  }

  async getConversation(id: number): Promise<Conversation | undefined> {
    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id));
    return conversation;
  }

  async getAllConversations(): Promise<Conversation[]> {
    return db.select().from(conversations).orderBy(desc(conversations.createdAt));
  }

  async createConversation(title: string): Promise<Conversation> {
    const [conversation] = await db.insert(conversations).values({ title }).returning();
    return conversation;
  }

  async deleteConversation(id: number): Promise<void> {
    await db.delete(messages).where(eq(messages.conversationId, id));
    await db.delete(conversations).where(eq(conversations.id, id));
  }

  async getMessagesByConversation(conversationId: number): Promise<Message[]> {
    return db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(messages.createdAt);
  }

  async createMessage(conversationId: number, role: string, content: string): Promise<Message> {
    const [message] = await db.insert(messages).values({ conversationId, role, content }).returning();
    return message;
  }

  async getStrategies(): Promise<StrategyLibrary[]> {
    return db.select().from(strategyLibrary).orderBy(desc(strategyLibrary.createdAt));
  }

  async getStrategy(id: string): Promise<StrategyLibrary | undefined> {
    const [strategy] = await db.select().from(strategyLibrary).where(eq(strategyLibrary.id, id));
    return strategy;
  }

  async searchStrategies(query: string): Promise<StrategyLibrary[]> {
    return db.select().from(strategyLibrary).where(
      or(
        ilike(strategyLibrary.name, `%${query}%`),
        ilike(strategyLibrary.ticker, `%${query}%`),
        ilike(strategyLibrary.strategyType, `%${query}%`),
        ilike(strategyLibrary.assetClass, `%${query}%`)
      )
    ).orderBy(desc(strategyLibrary.createdAt));
  }

  async createStrategy(strategy: InsertStrategyLibrary): Promise<StrategyLibrary> {
    const [created] = await db.insert(strategyLibrary).values(strategy).returning();
    return created;
  }

  async createStrategies(strategies: InsertStrategyLibrary[]): Promise<StrategyLibrary[]> {
    if (strategies.length === 0) return [];
    const created = await db.insert(strategyLibrary).values(strategies).returning();
    return created;
  }

  async updateStrategy(id: string, updates: Partial<InsertStrategyLibrary>): Promise<StrategyLibrary | undefined> {
    const [updated] = await db.update(strategyLibrary)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(strategyLibrary.id, id))
      .returning();
    return updated;
  }

  async deleteStrategy(id: string): Promise<void> {
    await db.delete(strategyLibrary).where(eq(strategyLibrary.id, id));
  }

  async getCustomPortfolios(): Promise<CustomPortfolio[]> {
    return db.select().from(customPortfolios).orderBy(desc(customPortfolios.createdAt));
  }

  async getCustomPortfolio(id: string): Promise<CustomPortfolio | undefined> {
    const [portfolio] = await db.select().from(customPortfolios).where(eq(customPortfolios.id, id));
    return portfolio;
  }

  async createCustomPortfolio(portfolio: InsertCustomPortfolio): Promise<CustomPortfolio> {
    const [created] = await db.insert(customPortfolios).values(portfolio).returning();
    return created;
  }

  async updateCustomPortfolio(id: string, updates: Partial<InsertCustomPortfolio>): Promise<CustomPortfolio | undefined> {
    const [updated] = await db.update(customPortfolios)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(customPortfolios.id, id))
      .returning();
    return updated;
  }

  async deleteCustomPortfolio(id: string): Promise<void> {
    await db.delete(customPortfolios).where(eq(customPortfolios.id, id));
  }

  async getCustomPortfolioItems(customPortfolioId: string): Promise<CustomPortfolioItem[]> {
    return db.select().from(customPortfolioItems).where(eq(customPortfolioItems.customPortfolioId, customPortfolioId));
  }

  async createCustomPortfolioItem(item: InsertCustomPortfolioItem): Promise<CustomPortfolioItem> {
    const [created] = await db.insert(customPortfolioItems).values(item).returning();
    return created;
  }

  async updateCustomPortfolioItem(id: string, updates: Partial<InsertCustomPortfolioItem>): Promise<CustomPortfolioItem | undefined> {
    const [updated] = await db.update(customPortfolioItems)
      .set(updates)
      .where(eq(customPortfolioItems.id, id))
      .returning();
    return updated;
  }

  async deleteCustomPortfolioItem(id: string): Promise<void> {
    await db.delete(customPortfolioItems).where(eq(customPortfolioItems.id, id));
  }

  async deleteCustomPortfolioItems(customPortfolioId: string): Promise<void> {
    await db.delete(customPortfolioItems).where(eq(customPortfolioItems.customPortfolioId, customPortfolioId));
  }

  async getBacktestResults(customPortfolioId: string): Promise<BacktestResult[]> {
    return db.select().from(backtestResults)
      .where(eq(backtestResults.customPortfolioId, customPortfolioId))
      .orderBy(desc(backtestResults.runDate));
  }

  async getBacktestResult(id: string): Promise<BacktestResult | undefined> {
    const [result] = await db.select().from(backtestResults).where(eq(backtestResults.id, id));
    return result;
  }

  async createBacktestResult(result: InsertBacktestResult): Promise<BacktestResult> {
    const [created] = await db.insert(backtestResults).values(result).returning();
    return created;
  }

  async deleteBacktestResult(id: string): Promise<void> {
    await db.delete(backtestResults).where(eq(backtestResults.id, id));
  }

  async getStrategyReturns(strategyId: string): Promise<StrategyReturn[]> {
    return db.select().from(strategyReturns)
      .where(eq(strategyReturns.strategyId, strategyId))
      .orderBy(asc(strategyReturns.date));
  }

  async getReturnsForStrategies(strategyIds: string[]): Promise<StrategyReturn[]> {
    if (strategyIds.length === 0) return [];
    return db.select().from(strategyReturns)
      .where(inArray(strategyReturns.strategyId, strategyIds))
      .orderBy(asc(strategyReturns.date));
  }

  async createStrategyReturns(returns: InsertStrategyReturn[]): Promise<StrategyReturn[]> {
    if (returns.length === 0) return [];
    const created = await db.insert(strategyReturns).values(returns).returning();
    return created;
  }

  async deleteStrategyReturns(strategyId: string): Promise<void> {
    await db.delete(strategyReturns).where(eq(strategyReturns.strategyId, strategyId));
  }

  async getStrategyReturnCount(strategyId: string): Promise<number> {
    const result = await db.select().from(strategyReturns).where(eq(strategyReturns.strategyId, strategyId));
    return result.length;
  }

  async getBenchmarks(): Promise<Benchmark[]> {
    return db.select().from(benchmarks).orderBy(asc(benchmarks.name));
  }

  async getBenchmark(id: string): Promise<Benchmark | undefined> {
    const [benchmark] = await db.select().from(benchmarks).where(eq(benchmarks.id, id));
    return benchmark;
  }

  async createBenchmark(benchmark: InsertBenchmark): Promise<Benchmark> {
    const [created] = await db.insert(benchmarks).values(benchmark).returning();
    return created;
  }

  async updateBenchmark(id: string, updates: Partial<InsertBenchmark>): Promise<Benchmark | undefined> {
    const [updated] = await db.update(benchmarks).set(updates).where(eq(benchmarks.id, id)).returning();
    return updated;
  }

  async deleteBenchmark(id: string): Promise<void> {
    await db.delete(benchmarks).where(eq(benchmarks.id, id));
  }

  async getBenchmarkReturns(benchmarkId: string): Promise<BenchmarkReturn[]> {
    return db.select().from(benchmarkReturns)
      .where(eq(benchmarkReturns.benchmarkId, benchmarkId))
      .orderBy(asc(benchmarkReturns.date));
  }

  async createBenchmarkReturns(returns: InsertBenchmarkReturn[]): Promise<BenchmarkReturn[]> {
    if (returns.length === 0) return [];
    const created = await db.insert(benchmarkReturns).values(returns).returning();
    return created;
  }

  async deleteBenchmarkReturns(benchmarkId: string): Promise<void> {
    await db.delete(benchmarkReturns).where(eq(benchmarkReturns.benchmarkId, benchmarkId));
  }

  async getPortfolioBenchmarks(portfolioId: string): Promise<PortfolioBenchmark[]> {
    return db.select().from(portfolioBenchmarks)
      .where(eq(portfolioBenchmarks.portfolioId, portfolioId));
  }

  async addPortfolioBenchmark(data: InsertPortfolioBenchmark): Promise<PortfolioBenchmark> {
    const [created] = await db.insert(portfolioBenchmarks).values(data).returning();
    return created;
  }

  async removePortfolioBenchmark(portfolioId: string, benchmarkId: string): Promise<void> {
    await db.delete(portfolioBenchmarks)
      .where(and(
        eq(portfolioBenchmarks.portfolioId, portfolioId),
        eq(portfolioBenchmarks.benchmarkId, benchmarkId)
      ));
  }

  async setPrimaryBenchmark(portfolioId: string, benchmarkId: string): Promise<void> {
    await db.update(portfolioBenchmarks)
      .set({ isPrimary: false })
      .where(eq(portfolioBenchmarks.portfolioId, portfolioId));
    await db.update(portfolioBenchmarks)
      .set({ isPrimary: true })
      .where(and(
        eq(portfolioBenchmarks.portfolioId, portfolioId),
        eq(portfolioBenchmarks.benchmarkId, benchmarkId)
      ));
  }

  async getCompositeBenchmarks(): Promise<CompositeBenchmark[]> {
    return db.select().from(compositeBenchmarks).orderBy(asc(compositeBenchmarks.name));
  }

  async getCompositeBenchmark(id: string): Promise<CompositeBenchmark | undefined> {
    const [composite] = await db.select().from(compositeBenchmarks).where(eq(compositeBenchmarks.id, id));
    return composite;
  }

  async createCompositeBenchmark(benchmark: InsertCompositeBenchmark, components: { benchmarkId: string; weight: string }[]): Promise<CompositeBenchmark> {
    const [created] = await db.insert(compositeBenchmarks).values(benchmark).returning();
    
    if (components.length > 0) {
      const componentInserts = components.map(c => ({
        compositeBenchmarkId: created.id,
        benchmarkId: c.benchmarkId,
        weight: c.weight,
      }));
      await db.insert(compositeBenchmarkComponents).values(componentInserts);
    }
    
    return created;
  }

  async updateCompositeBenchmark(id: string, updates: Partial<InsertCompositeBenchmark>, components?: { benchmarkId: string; weight: string }[]): Promise<CompositeBenchmark | undefined> {
    const [updated] = await db.update(compositeBenchmarks)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(compositeBenchmarks.id, id))
      .returning();
    
    if (components !== undefined) {
      await db.delete(compositeBenchmarkComponents).where(eq(compositeBenchmarkComponents.compositeBenchmarkId, id));
      
      if (components.length > 0) {
        const componentInserts = components.map(c => ({
          compositeBenchmarkId: id,
          benchmarkId: c.benchmarkId,
          weight: c.weight,
        }));
        await db.insert(compositeBenchmarkComponents).values(componentInserts);
      }
    }
    
    return updated;
  }

  async deleteCompositeBenchmark(id: string): Promise<void> {
    await db.delete(compositeBenchmarks).where(eq(compositeBenchmarks.id, id));
  }

  async getCompositeBenchmarkComponents(compositeBenchmarkId: string): Promise<CompositeBenchmarkComponent[]> {
    return db.select().from(compositeBenchmarkComponents)
      .where(eq(compositeBenchmarkComponents.compositeBenchmarkId, compositeBenchmarkId));
  }

  async getFundFolders(folderType?: string): Promise<FundFolder[]> {
    if (folderType) {
      return db.select().from(fundFolders)
        .where(eq(fundFolders.folderType, folderType))
        .orderBy(asc(fundFolders.sortOrder), asc(fundFolders.name));
    }
    return db.select().from(fundFolders).orderBy(asc(fundFolders.sortOrder), asc(fundFolders.name));
  }

  async getFundFolder(id: string): Promise<FundFolder | undefined> {
    const [folder] = await db.select().from(fundFolders).where(eq(fundFolders.id, id));
    return folder;
  }

  async createFundFolder(folder: InsertFundFolder): Promise<FundFolder> {
    const [created] = await db.insert(fundFolders).values(folder).returning();
    return created;
  }

  async updateFundFolder(id: string, updates: Partial<InsertFundFolder>): Promise<FundFolder | undefined> {
    const [updated] = await db.update(fundFolders)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(fundFolders.id, id))
      .returning();
    return updated;
  }

  async deleteFundFolder(id: string): Promise<void> {
    await db.update(strategyLibrary).set({ folderId: null }).where(eq(strategyLibrary.folderId, id));
    await db.update(dataRoomDocuments).set({ folderId: null }).where(eq(dataRoomDocuments.folderId, id));
    await db.update(investmentMemos).set({ folderId: null }).where(eq(investmentMemos.folderId, id));
    await db.delete(fundFolders).where(eq(fundFolders.id, id));
  }

  async getStrategiesByFolder(folderId: string | null): Promise<StrategyLibrary[]> {
    if (folderId === null) {
      return db.select().from(strategyLibrary)
        .where(eq(strategyLibrary.folderId, null as unknown as string))
        .orderBy(desc(strategyLibrary.createdAt));
    }
    return db.select().from(strategyLibrary)
      .where(eq(strategyLibrary.folderId, folderId))
      .orderBy(desc(strategyLibrary.createdAt));
  }

  async moveStrategyToFolder(strategyId: string, folderId: string | null): Promise<StrategyLibrary | undefined> {
    const [updated] = await db.update(strategyLibrary)
      .set({ folderId, updatedAt: new Date() })
      .where(eq(strategyLibrary.id, strategyId))
      .returning();
    return updated;
  }

  async moveDocumentToFolder(documentId: string, folderId: string | null): Promise<DataRoomDocument | undefined> {
    const [updated] = await db.update(dataRoomDocuments)
      .set({ folderId, lastModified: new Date() })
      .where(eq(dataRoomDocuments.id, documentId))
      .returning();
    return updated;
  }

  async moveMemoToFolder(memoId: string, folderId: string | null): Promise<InvestmentMemo | undefined> {
    const [updated] = await db.update(investmentMemos)
      .set({ folderId, updatedAt: new Date() })
      .where(eq(investmentMemos.id, memoId))
      .returning();
    return updated;
  }

  async getIntervalFunds(): Promise<IntervalFund[]> {
    return await db.select().from(intervalFunds);
  }

  async getIntervalFund(id: string): Promise<IntervalFund | undefined> {
    const [fund] = await db.select().from(intervalFunds).where(eq(intervalFunds.id, id));
    return fund;
  }

  async createIntervalFund(fund: InsertIntervalFund): Promise<IntervalFund> {
    const [created] = await db.insert(intervalFunds).values(fund).returning();
    return created;
  }

  async updateIntervalFund(id: string, updates: Partial<InsertIntervalFund>): Promise<IntervalFund | undefined> {
    const [updated] = await db.update(intervalFunds)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(intervalFunds.id, id))
      .returning();
    return updated;
  }

  async deleteIntervalFund(id: string): Promise<void> {
    await db.delete(intervalFunds).where(eq(intervalFunds.id, id));
  }
}

export const storage = new DatabaseStorage();
