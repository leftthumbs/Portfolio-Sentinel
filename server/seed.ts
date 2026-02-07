import { db } from "./db";
import { portfolios, holdings, performanceHistory, riskMetrics, stressTests, users, benchmarks, benchmarkReturns, strategyLibrary } from "@shared/schema";
import { eq } from "drizzle-orm";
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

export async function ensureDefaultUser() {
  const existingUser = await db.select().from(users).where(eq(users.username, "leftthumbs"));
  
  if (existingUser.length === 0) {
    console.log("Creating default user...");
    const hashedPassword = await hashPassword("admin123");
    await db.insert(users).values({
      username: "leftthumbs",
      password: hashedPassword,
    });
    console.log("Default user created: leftthumbs");
  } else {
    console.log("Default user already exists");
  }
}

export async function seedDatabase() {
  const existingPortfolios = await db.select().from(portfolios);
  
  if (existingPortfolios.length > 0) {
    console.log("Database already seeded");
    return existingPortfolios[0];
  }

  console.log("Seeding database...");

  const [portfolio] = await db.insert(portfolios).values({
    name: "Global Wealth Portfolio",
    description: "Diversified fund of funds portfolio for wealth management",
    totalValue: "125000000.00",
    currency: "USD",
  }).returning();

  const holdingsData = [
    { fundName: "Vanguard Total Stock Market", ticker: "VTI", assetClass: "US Equity", allocation: "22.50", marketValue: "28125000.00", costBasis: "24500000.00", unrealizedGain: "3625000.00", returnYtd: "0.0845", return1yr: "0.1232", return3yr: "0.0892" },
    { fundName: "iShares Core S&P 500 ETF", ticker: "IVV", assetClass: "US Equity", allocation: "18.00", marketValue: "22500000.00", costBasis: "19800000.00", unrealizedGain: "2700000.00", returnYtd: "0.0912", return1yr: "0.1345", return3yr: "0.0978" },
    { fundName: "Vanguard Total International Stock", ticker: "VXUS", assetClass: "International Equity", allocation: "15.50", marketValue: "19375000.00", costBasis: "18200000.00", unrealizedGain: "1175000.00", returnYtd: "0.0523", return1yr: "0.0845", return3yr: "0.0456" },
    { fundName: "PIMCO Total Return Fund", ticker: "PTTRX", assetClass: "Fixed Income", allocation: "12.00", marketValue: "15000000.00", costBasis: "15500000.00", unrealizedGain: "-500000.00", returnYtd: "-0.0234", return1yr: "-0.0156", return3yr: "0.0123" },
    { fundName: "BlackRock Global Allocation", ticker: "MDLOX", assetClass: "Multi-Asset", allocation: "10.00", marketValue: "12500000.00", costBasis: "11200000.00", unrealizedGain: "1300000.00", returnYtd: "0.0678", return1yr: "0.0934", return3yr: "0.0645" },
    { fundName: "Bridgewater Pure Alpha", ticker: "BPAFX", assetClass: "Alternative", allocation: "8.00", marketValue: "10000000.00", costBasis: "9500000.00", unrealizedGain: "500000.00", returnYtd: "0.0445", return1yr: "0.0623", return3yr: "0.0512" },
    { fundName: "Real Estate Select SPDR", ticker: "XLRE", assetClass: "Real Estate", allocation: "7.00", marketValue: "8750000.00", costBasis: "8900000.00", unrealizedGain: "-150000.00", returnYtd: "-0.0123", return1yr: "0.0234", return3yr: "0.0345" },
    { fundName: "SPDR Gold Shares", ticker: "GLD", assetClass: "Commodities", allocation: "7.00", marketValue: "8750000.00", costBasis: "7800000.00", unrealizedGain: "950000.00", returnYtd: "0.1234", return1yr: "0.1567", return3yr: "0.0845" },
  ];

  for (const h of holdingsData) {
    await db.insert(holdings).values({
      portfolioId: portfolio.id,
      ...h,
    });
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 365);
  
  let portfolioValue = 100000000;
  let benchmarkValue = 100000000;
  let cumulativeReturn = 0;
  let benchmarkReturn = 0;

  const performanceData = [];
  for (let i = 0; i < 365; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    
    const dailyReturn = (Math.random() - 0.48) * 0.025;
    const benchDailyReturn = (Math.random() - 0.48) * 0.022;
    
    portfolioValue *= (1 + dailyReturn);
    benchmarkValue *= (1 + benchDailyReturn);
    cumulativeReturn = (portfolioValue / 100000000) - 1;
    benchmarkReturn = (benchmarkValue / 100000000) - 1;

    performanceData.push({
      portfolioId: portfolio.id,
      date,
      portfolioValue: portfolioValue.toFixed(2),
      dailyReturn: dailyReturn.toFixed(6),
      cumulativeReturn: cumulativeReturn.toFixed(6),
      benchmarkValue: benchmarkValue.toFixed(2),
      benchmarkReturn: benchmarkReturn.toFixed(6),
    });
  }

  for (const p of performanceData) {
    await db.insert(performanceHistory).values(p);
  }

  await db.insert(riskMetrics).values({
    portfolioId: portfolio.id,
    volatility: "0.1245",
    sharpeRatio: "1.42",
    sortinoRatio: "1.85",
    maxDrawdown: "-0.0823",
    var95: "-0.0189",
    var99: "-0.0267",
    cvar95: "-0.0234",
    beta: "0.92",
    alpha: "0.0234",
    treynorRatio: "0.0876",
    informationRatio: "0.67",
    trackingError: "0.0345",
    correlation: "0.87",
    downsideCorrelation: "0.92",
    jensensAlpha: "0.0312",
    calmarRatio: "1.73",
    omegaRatio: "1.68",
    skewness: "-0.34",
    kurtosis: "4.21",
    upsideCapture: "1.12",
    downsideCapture: "0.78",
    ulcerIndex: "0.0345",
    painIndex: "0.0289",
    gainToPainRatio: "2.45",
    tailRatio: "1.28",
    commonSenseRatio: "3.14",
    averageDrawdown: "-0.0412",
    sterlingRatio: "2.89",
    burkeRatio: "1.56",
    herfindahlIndex: "0.1234",
    diversificationRatio: "1.42",
    downsideDeviation: "0.0789",
    upsidePotentialRatio: "1.89",
    cagr: "0.1245",
    mar: "1.51",
  });

  const stressTestData = [
    { scenarioName: "2008 Financial Crisis", scenarioType: "Historical", equityShock: "-0.55", rateShock: "-0.02", creditSpreadShock: "0.04", fxShock: "-0.15", portfolioImpact: "-0.3245", impactAmount: "-40562500.00" },
    { scenarioName: "2020 COVID Crash", scenarioType: "Historical", equityShock: "-0.35", rateShock: "-0.015", creditSpreadShock: "0.025", fxShock: "-0.08", portfolioImpact: "-0.2134", impactAmount: "-26675000.00" },
    { scenarioName: "2022 Rate Shock", scenarioType: "Historical", equityShock: "-0.25", rateShock: "0.03", creditSpreadShock: "0.02", fxShock: "0.05", portfolioImpact: "-0.1567", impactAmount: "-19587500.00" },
    { scenarioName: "Mild Recession", scenarioType: "Hypothetical", equityShock: "-0.20", rateShock: "-0.01", creditSpreadShock: "0.015", fxShock: "-0.05", portfolioImpact: "-0.1234", impactAmount: "-15425000.00" },
  ];

  for (const test of stressTestData) {
    await db.insert(stressTests).values({
      portfolioId: portfolio.id,
      ...test,
    });
  }

  console.log("Database seeded successfully");
  return portfolio;
}

export async function seedBenchmarks() {
  const existingBenchmarks = await db.select().from(benchmarks);
  
  if (existingBenchmarks.length > 0) {
    console.log("Benchmarks already seeded");
    return;
  }

  console.log("Seeding benchmarks...");

  const defaultBenchmarks = [
    // Equity Benchmarks
    { name: "S&P 500", ticker: "SPY", description: "U.S. large cap equity index", category: "Equity", color: "#3b82f6", isDefault: true },
    { name: "MSCI World", ticker: "URTH", description: "Global developed markets equity", category: "Equity", color: "#10b981" },
    { name: "MSCI Emerging Markets", ticker: "EEM", description: "Emerging markets equity index", category: "Equity", color: "#f59e0b" },
    { name: "NASDAQ 100", ticker: "QQQ", description: "U.S. large cap technology index", category: "Equity", color: "#ec4899" },
    { name: "Russell 2000", ticker: "IWM", description: "U.S. small cap equity index", category: "Equity", color: "#14b8a6" },
    { name: "FTSE 100", ticker: "EWU", description: "UK large cap equity index", category: "Equity", color: "#0ea5e9" },
    { name: "Nikkei 225", ticker: "EWJ", description: "Japanese large cap equity index", category: "Equity", color: "#dc2626" },
    { name: "Euro Stoxx 50", ticker: "FEZ", description: "European blue chip equity index", category: "Equity", color: "#2563eb" },
    
    // Fixed Income Benchmarks
    { name: "Bloomberg US Aggregate Bond", ticker: "AGG", description: "U.S. investment grade bond index", category: "Fixed Income", color: "#6366f1" },
    { name: "US Treasury 10-Year", ticker: "IEF", description: "U.S. 7-10 year Treasury bonds", category: "Fixed Income", color: "#818cf8" },
    { name: "US Treasury 20+ Year", ticker: "TLT", description: "U.S. long-term Treasury bonds", category: "Fixed Income", color: "#a78bfa" },
    { name: "US High Yield Corporate", ticker: "HYG", description: "U.S. high yield corporate bond index", category: "Fixed Income", color: "#c084fc" },
    { name: "Investment Grade Corporate", ticker: "LQD", description: "U.S. investment grade corporate bonds", category: "Fixed Income", color: "#e879f9" },
    { name: "TIPS (Inflation Protected)", ticker: "TIP", description: "U.S. Treasury inflation-protected securities", category: "Fixed Income", color: "#f472b6" },
    { name: "Municipal Bonds", ticker: "MUB", description: "U.S. municipal bonds index", category: "Fixed Income", color: "#fb7185" },
    { name: "Global Aggregate Bond", ticker: "BNDX", description: "International ex-US aggregate bonds", category: "Fixed Income", color: "#94a3b8" },
    
    // Real Estate Benchmarks
    { name: "US REIT Index", ticker: "VNQ", description: "U.S. real estate investment trusts", category: "Real Estate", color: "#84cc16" },
    { name: "Global REIT Index", ticker: "VNQI", description: "Global ex-US real estate investment trusts", category: "Real Estate", color: "#22c55e" },
    { name: "Residential REIT", ticker: "REZ", description: "U.S. residential real estate index", category: "Real Estate", color: "#10b981" },
    { name: "Commercial REIT", ticker: "ICF", description: "U.S. commercial real estate index", category: "Real Estate", color: "#059669" },
    
    // Commodities Benchmarks  
    { name: "Gold", ticker: "GLD", description: "Gold bullion price index", category: "Commodities", color: "#fbbf24" },
    { name: "Silver", ticker: "SLV", description: "Silver bullion price index", category: "Commodities", color: "#9ca3af" },
    { name: "Broad Commodities", ticker: "DJP", description: "Bloomberg Commodity Index", category: "Commodities", color: "#a16207" },
    { name: "Crude Oil", ticker: "USO", description: "West Texas Intermediate crude oil", category: "Commodities", color: "#1c1917" },
    { name: "Agriculture", ticker: "DBA", description: "Agricultural commodities basket", category: "Commodities", color: "#65a30d" },
    
    // Alternative Benchmarks
    { name: "HFRI Fund Weighted Composite", ticker: "HFRI", description: "Hedge fund performance index", category: "Alternative", color: "#8b5cf6" },
    { name: "Private Equity Index", ticker: "PE-IDX", description: "Cambridge Associates Private Equity", category: "Alternative", color: "#7c3aed" },
    { name: "Venture Capital Index", ticker: "VC-IDX", description: "Cambridge Associates Venture Capital", category: "Alternative", color: "#6d28d9" },
    { name: "Infrastructure", ticker: "IGF", description: "Global infrastructure index", category: "Alternative", color: "#5b21b6" },
    { name: "Managed Futures", ticker: "DBMF", description: "Managed futures/CTA index", category: "Alternative", color: "#4c1d95" },
    
    // Multi-Asset Benchmarks
    { name: "60/40 Portfolio", ticker: "60/40", description: "Classic balanced portfolio benchmark", category: "Multi-Asset", color: "#64748b" },
    { name: "Risk Parity", ticker: "RPAR", description: "Risk parity balanced allocation", category: "Multi-Asset", color: "#475569" },
    { name: "All Weather Portfolio", ticker: "AWP", description: "Ray Dalio all-weather allocation", category: "Multi-Asset", color: "#334155" },
    { name: "Global Multi-Asset", ticker: "GAA", description: "Global asset allocation benchmark", category: "Multi-Asset", color: "#1e293b" },
  ];

  const insertedBenchmarks = [];
  for (const benchmark of defaultBenchmarks) {
    const [inserted] = await db.insert(benchmarks).values(benchmark).returning();
    insertedBenchmarks.push(inserted);
  }

  // Seed benchmark return data for each benchmark
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 365);
  
  // Different base returns for variety by asset class
  const baseReturns: Record<string, number> = {
    // Equity (~8-15% annualized)
    "SPY": 0.0003, "URTH": 0.00025, "EEM": 0.0002, "QQQ": 0.0004, "IWM": 0.00022,
    "EWU": 0.00018, "EWJ": 0.00015, "FEZ": 0.0002,
    // Fixed Income (~2-6% annualized)
    "AGG": 0.0001, "IEF": 0.00008, "TLT": 0.00006, "HYG": 0.00015, "LQD": 0.00012,
    "TIP": 0.00007, "MUB": 0.00009, "BNDX": 0.00008,
    // Real Estate (~6-10% annualized)
    "VNQ": 0.00022, "VNQI": 0.00018, "REZ": 0.0002, "ICF": 0.00019,
    // Commodities (~0-8% annualized, higher volatility)
    "GLD": 0.00015, "SLV": 0.00012, "DJP": 0.00008, "USO": 0.0001, "DBA": 0.00006,
    // Alternative (~5-12% annualized)
    "HFRI": 0.00018, "PE-IDX": 0.00035, "VC-IDX": 0.0004, "IGF": 0.00016, "DBMF": 0.00014,
    // Multi-Asset (~4-8% annualized)
    "60/40": 0.00015, "RPAR": 0.00014, "AWP": 0.00013, "GAA": 0.00016,
  };

  // Volatility by asset class
  const volatilityByCategory: Record<string, number> = {
    "Equity": 0.012,
    "Fixed Income": 0.003,
    "Real Estate": 0.01,
    "Commodities": 0.018,
    "Alternative": 0.008,
    "Multi-Asset": 0.006,
  };

  for (const benchmark of insertedBenchmarks) {
    const returnsData = [];
    let cumulativeReturn = 0;
    const baseReturn = baseReturns[benchmark.ticker] || 0.0002;
    const volatility = volatilityByCategory[benchmark.category] || 0.01;
    
    for (let i = 0; i < 365; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      
      // Generate realistic daily returns with category-appropriate volatility
      const dailyReturn = baseReturn + (Math.random() - 0.5) * volatility;
      cumulativeReturn = (1 + cumulativeReturn) * (1 + dailyReturn) - 1;
      
      returnsData.push({
        benchmarkId: benchmark.id,
        date,
        returnValue: String(dailyReturn),
        cumulativeReturn: String(cumulativeReturn),
      });
    }
    
    await db.insert(benchmarkReturns).values(returnsData);
  }

  console.log("Benchmarks seeded successfully with return data");
}

export async function seedAlternativeFunds() {
  const existingStrategies = await db.select().from(strategyLibrary);
  
  // Skip seeding if ANY strategies exist - user may have deleted sample funds intentionally
  if (existingStrategies.length > 0) {
    console.log("Strategy library has data - skipping seed");
    return;
  }

  console.log("Seeding hedge funds and private credit funds...");

  const hedgeFunds = [
    {
      name: "Citadel Wellington Fund",
      strategyType: "Multi-Strategy",
      assetClass: "Alternatives",
      description: "Diversified multi-strategy hedge fund with global macro, equity, and fixed income strategies",
      expectedReturn: "0.12",
      volatility: "0.08",
      managementFee: "0.02",
      performanceFee: "0.20",
      hurdleRate: "0.05",
      highWaterMark: true,
      lockupPeriod: 12,
      redemptionFrequency: "Quarterly",
      redemptionNotice: 90,
      gateProvision: "0.25",
      fundAum: "35000000000",
      fundManager: "Ken Griffin",
      fundDomicile: "Cayman Islands",
      sharpeRatio: "1.85",
      sortinoRatio: "2.45",
      maxDrawdown: "-0.08",
      calmarRatio: "1.50",
      beta: "0.25",
      alpha: "0.08",
      correlation: "0.35",
    },
    {
      name: "Millennium Partners",
      strategyType: "Multi-Strategy",
      assetClass: "Alternatives",
      description: "Multi-manager platform with quantitative and fundamental strategies",
      expectedReturn: "0.10",
      volatility: "0.06",
      managementFee: "0.02",
      performanceFee: "0.20",
      hurdleRate: "0.00",
      highWaterMark: true,
      lockupPeriod: 24,
      redemptionFrequency: "Quarterly",
      redemptionNotice: 60,
      gateProvision: "0.20",
      fundAum: "58000000000",
      fundManager: "Israel Englander",
      fundDomicile: "Cayman Islands",
      sharpeRatio: "2.10",
      sortinoRatio: "2.85",
      maxDrawdown: "-0.05",
      calmarRatio: "2.00",
      beta: "0.15",
      alpha: "0.09",
      correlation: "0.20",
    },
    {
      name: "Two Sigma Absolute Return",
      strategyType: "Hedge Fund",
      assetClass: "Alternatives",
      description: "Systematic quantitative hedge fund using machine learning and data science",
      expectedReturn: "0.14",
      volatility: "0.10",
      managementFee: "0.025",
      performanceFee: "0.25",
      hurdleRate: "0.04",
      highWaterMark: true,
      lockupPeriod: 12,
      redemptionFrequency: "Monthly",
      redemptionNotice: 45,
      gateProvision: "0.15",
      fundAum: "42000000000",
      fundManager: "John Overdeck",
      fundDomicile: "Delaware",
      sharpeRatio: "1.65",
      sortinoRatio: "2.20",
      maxDrawdown: "-0.12",
      calmarRatio: "1.17",
      beta: "0.30",
      alpha: "0.10",
      correlation: "0.40",
    },
    {
      name: "Viking Global Investors",
      strategyType: "Long/Short Equity",
      assetClass: "Hedge Funds",
      description: "Fundamental long/short equity focused on technology and healthcare",
      expectedReturn: "0.15",
      volatility: "0.14",
      managementFee: "0.015",
      performanceFee: "0.20",
      hurdleRate: "0.00",
      highWaterMark: true,
      lockupPeriod: 6,
      redemptionFrequency: "Monthly",
      redemptionNotice: 30,
      gateProvision: "0.10",
      fundAum: "28000000000",
      fundManager: "Ole Andreas Halvorsen",
      fundDomicile: "Cayman Islands",
      sharpeRatio: "1.25",
      sortinoRatio: "1.65",
      maxDrawdown: "-0.18",
      calmarRatio: "0.83",
      beta: "0.55",
      alpha: "0.07",
      correlation: "0.65",
    },
    {
      name: "Bridgewater Pure Alpha",
      strategyType: "Macro Strategy",
      assetClass: "Alternatives",
      description: "Global macro strategy with systematic risk parity approach",
      expectedReturn: "0.08",
      volatility: "0.12",
      managementFee: "0.02",
      performanceFee: "0.20",
      hurdleRate: "0.03",
      highWaterMark: true,
      lockupPeriod: 24,
      redemptionFrequency: "Quarterly",
      redemptionNotice: 90,
      gateProvision: "0.25",
      fundAum: "125000000000",
      fundManager: "Ray Dalio",
      fundDomicile: "Connecticut",
      sharpeRatio: "0.85",
      sortinoRatio: "1.10",
      maxDrawdown: "-0.20",
      calmarRatio: "0.40",
      beta: "0.10",
      alpha: "0.05",
      correlation: "0.15",
    },
  ];

  const privateCreditFunds = [
    {
      name: "Ares Senior Secured Fund",
      strategyType: "Credit Strategy",
      assetClass: "High Yield",
      description: "Senior secured direct lending to middle market companies",
      expectedReturn: "0.095",
      volatility: "0.04",
      managementFee: "0.015",
      performanceFee: "0.15",
      hurdleRate: "0.07",
      highWaterMark: true,
      lockupPeriod: 36,
      redemptionFrequency: "Quarterly",
      redemptionNotice: 90,
      fundAum: "45000000000",
      fundManager: "Ares Management",
      fundDomicile: "Delaware",
      targetYield: "0.10",
      currentYield: "0.095",
      yieldToMaturity: "0.102",
      weightedAvgLife: "3.5",
      loanToValue: "0.45",
      seniorityLevel: "First Lien Senior Secured",
      defaultRate: "0.015",
      recoveryRate: "0.75",
      spreadOverBase: "0.055",
      floatingRatePct: "0.95",
      vintageYear: 2021,
      fundLifeYears: 7,
      sharpeRatio: "2.00",
      maxDrawdown: "-0.04",
      correlation: "0.20",
    },
    {
      name: "Blackstone Credit BDC",
      strategyType: "Credit Strategy",
      assetClass: "High Yield",
      description: "Business development company focused on sponsored middle market loans",
      expectedReturn: "0.11",
      volatility: "0.05",
      managementFee: "0.0175",
      performanceFee: "0.175",
      hurdleRate: "0.08",
      highWaterMark: true,
      lockupPeriod: 24,
      redemptionFrequency: "Quarterly",
      redemptionNotice: 65,
      fundAum: "75000000000",
      fundManager: "Blackstone Credit",
      fundDomicile: "Maryland",
      targetYield: "0.115",
      currentYield: "0.108",
      yieldToMaturity: "0.118",
      weightedAvgLife: "4.2",
      loanToValue: "0.50",
      seniorityLevel: "First Lien",
      defaultRate: "0.02",
      recoveryRate: "0.70",
      spreadOverBase: "0.065",
      floatingRatePct: "0.98",
      vintageYear: 2020,
      fundLifeYears: 10,
      sharpeRatio: "1.80",
      maxDrawdown: "-0.06",
      correlation: "0.25",
    },
    {
      name: "Apollo European Credit",
      strategyType: "Credit Strategy",
      assetClass: "Fixed Income",
      description: "European private credit focused on asset-backed lending",
      expectedReturn: "0.085",
      volatility: "0.035",
      managementFee: "0.0125",
      performanceFee: "0.125",
      hurdleRate: "0.06",
      highWaterMark: true,
      lockupPeriod: 48,
      redemptionFrequency: "Semi-Annual",
      redemptionNotice: 120,
      fundAum: "32000000000",
      fundManager: "Apollo Global",
      fundDomicile: "Luxembourg",
      targetYield: "0.09",
      currentYield: "0.082",
      yieldToMaturity: "0.088",
      weightedAvgLife: "5.0",
      loanToValue: "0.55",
      seniorityLevel: "Unitranche",
      defaultRate: "0.018",
      recoveryRate: "0.65",
      spreadOverBase: "0.045",
      floatingRatePct: "0.85",
      vintageYear: 2022,
      fundLifeYears: 8,
      sharpeRatio: "1.95",
      maxDrawdown: "-0.03",
      correlation: "0.15",
    },
    {
      name: "HPS Mezzanine Partners",
      strategyType: "Credit Strategy",
      assetClass: "High Yield",
      description: "Subordinated debt and mezzanine financing for leveraged buyouts",
      expectedReturn: "0.13",
      volatility: "0.07",
      managementFee: "0.02",
      performanceFee: "0.20",
      hurdleRate: "0.08",
      highWaterMark: true,
      lockupPeriod: 60,
      redemptionFrequency: "Annual",
      redemptionNotice: 180,
      fundAum: "18000000000",
      fundManager: "HPS Investment Partners",
      fundDomicile: "Cayman Islands",
      targetYield: "0.14",
      currentYield: "0.125",
      yieldToMaturity: "0.145",
      weightedAvgLife: "6.0",
      loanToValue: "0.65",
      seniorityLevel: "Second Lien/Mezzanine",
      defaultRate: "0.03",
      recoveryRate: "0.45",
      spreadOverBase: "0.085",
      floatingRatePct: "0.60",
      vintageYear: 2023,
      fundLifeYears: 10,
      sharpeRatio: "1.50",
      maxDrawdown: "-0.10",
      correlation: "0.35",
    },
  ];

  for (const fund of [...hedgeFunds, ...privateCreditFunds]) {
    await db.insert(strategyLibrary).values(fund);
  }

  console.log("Alternative funds seeded successfully");
}
