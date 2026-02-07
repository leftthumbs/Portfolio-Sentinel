import type { CustomPortfolioItem, StrategyReturn } from "@shared/schema";

export interface BacktestConfig {
  items: CustomPortfolioItem[];
  startDate: Date;
  endDate: Date;
  initialValue: number;
  numSimulations?: number;
  rebalanceFrequency?: "daily" | "weekly" | "monthly" | "quarterly" | "none";
  historicalReturns?: Map<string, number[]>;
  riskFreeRate?: number; // Annual risk-free rate (e.g., 0.04 for 4%)
}

export interface PerformancePoint {
  date: string;
  value: number;
  dailyReturn: number;
  cumulativeReturn: number;
}

export interface MonteCarloStats {
  meanFinalValue: number;
  medianFinalValue: number;
  percentile5: number;
  percentile25: number;
  percentile75: number;
  percentile95: number;
  meanAnnualizedReturn: number;
  meanSharpeRatio: number;
  meanMaxDrawdown: number;
  valueAtRisk95: number;
  expectedShortfall: number;
}

export interface BacktestOutput {
  performanceData: PerformancePoint[];
  finalValue: number;
  totalReturn: number;
  annualizedReturn: number;
  volatility: number;
  sharpeRatio: number;
  maxDrawdown: number;
  monteCarloStats?: MonteCarloStats;
  allSimulationReturns?: number[];
  simulationFinalValues?: number[];
}

const assetClassReturns: Record<string, { annualReturn: number; volatility: number }> = {
  "US Equity": { annualReturn: 0.10, volatility: 0.16 },
  "International Equity": { annualReturn: 0.08, volatility: 0.18 },
  "Emerging Markets": { annualReturn: 0.09, volatility: 0.22 },
  "Fixed Income": { annualReturn: 0.04, volatility: 0.05 },
  "High Yield": { annualReturn: 0.06, volatility: 0.10 },
  "Real Estate": { annualReturn: 0.07, volatility: 0.14 },
  "Commodities": { annualReturn: 0.05, volatility: 0.20 },
  "Alternatives": { annualReturn: 0.06, volatility: 0.12 },
  "Private Equity": { annualReturn: 0.12, volatility: 0.25 },
  "Hedge Funds": { annualReturn: 0.07, volatility: 0.10 },
  "Cash": { annualReturn: 0.02, volatility: 0.01 },
  "Other": { annualReturn: 0.05, volatility: 0.15 },
};

function getAssetReturns(assetClass: string): { annualReturn: number; volatility: number } {
  return assetClassReturns[assetClass] || assetClassReturns["Other"];
}

function randomNormal(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function generateDailyReturn(annualReturn: number, annualVolatility: number): number {
  const dailyReturn = annualReturn / 252;
  const dailyVolatility = annualVolatility / Math.sqrt(252);
  return dailyReturn + dailyVolatility * randomNormal();
}

function sampleFromHistoricalReturns(returns: number[]): number {
  if (returns.length === 0) return 0;
  const index = Math.floor(Math.random() * returns.length);
  return returns[index];
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

interface SimulationResult {
  finalValue: number;
  totalReturn: number;
  annualizedReturn: number;
  volatility: number;
  sharpeRatio: number;
  maxDrawdown: number;
  performanceData: PerformancePoint[];
}

function runSingleSimulation(
  normalizedItems: Array<CustomPortfolioItem & { normalizedWeight: number }>,
  startDate: Date,
  endDate: Date,
  initialValue: number,
  historicalReturns?: Map<string, number[]>,
  riskFreeRate: number = 0.04
): SimulationResult {
  const performanceData: PerformancePoint[] = [];
  let currentValue = initialValue;
  let previousValue = initialValue;
  let peakValue = initialValue;
  let maxDrawdown = 0;
  const dailyReturns: number[] = [];

  const currentDate = new Date(startDate);
  const end = new Date(endDate);
  
  while (currentDate <= end) {
    if (currentDate.getDay() !== 0 && currentDate.getDay() !== 6) {
      let portfolioDailyReturn = 0;
      
      for (const item of normalizedItems) {
        let assetDailyReturn: number;
        
        const itemKey = item.strategyId || item.id;
        const itemReturns = historicalReturns?.get(itemKey);
        
        if (itemReturns && itemReturns.length > 0) {
          assetDailyReturn = sampleFromHistoricalReturns(itemReturns);
        } else {
          const assetParams = getAssetReturns(item.assetClass);
          const expectedReturn = item.expectedReturn 
            ? parseFloat(item.expectedReturn) 
            : assetParams.annualReturn;
          const volatility = item.volatility 
            ? parseFloat(item.volatility) 
            : assetParams.volatility;
          
          assetDailyReturn = generateDailyReturn(expectedReturn, volatility);
        }
        
        portfolioDailyReturn += assetDailyReturn * item.normalizedWeight;
      }
      
      previousValue = currentValue;
      currentValue = currentValue * (1 + portfolioDailyReturn);
      dailyReturns.push(portfolioDailyReturn);
      
      if (currentValue > peakValue) {
        peakValue = currentValue;
      }
      const drawdown = (peakValue - currentValue) / peakValue;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
      
      performanceData.push({
        date: currentDate.toISOString().split("T")[0],
        value: currentValue,
        dailyReturn: portfolioDailyReturn,
        cumulativeReturn: (currentValue - initialValue) / initialValue,
      });
    }
    
    currentDate.setDate(currentDate.getDate() + 1);
  }

  const totalReturn = (currentValue - initialValue) / initialValue;
  
  const tradingDays = dailyReturns.length;
  const years = tradingDays / 252;
  const annualizedReturn = years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0;
  
  const avgDailyReturn = dailyReturns.reduce((a, b) => a + b, 0) / tradingDays;
  const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgDailyReturn, 2), 0) / tradingDays;
  const dailyVolatility = Math.sqrt(variance);
  const annualVolatility = dailyVolatility * Math.sqrt(252);
  
  const excessReturn = annualizedReturn - riskFreeRate;
  const sharpeRatio = annualVolatility > 0 ? excessReturn / annualVolatility : 0;

  return {
    finalValue: currentValue,
    totalReturn,
    annualizedReturn,
    volatility: annualVolatility,
    sharpeRatio,
    maxDrawdown,
    performanceData,
  };
}

export function runBacktest(config: BacktestConfig): BacktestOutput {
  const { items, startDate, endDate, initialValue, numSimulations = 100, historicalReturns, riskFreeRate = 0.04 } = config;
  
  const totalWeight = items.reduce((sum, item) => sum + parseFloat(item.weight), 0);
  const normalizedItems = items.map(item => ({
    ...item,
    normalizedWeight: parseFloat(item.weight) / totalWeight,
  }));

  const simulationResults: SimulationResult[] = [];
  
  for (let i = 0; i < numSimulations; i++) {
    const result = runSingleSimulation(normalizedItems, startDate, endDate, initialValue, historicalReturns, riskFreeRate);
    simulationResults.push(result);
  }

  const finalValues = simulationResults.map(r => r.finalValue);
  const annualizedReturns = simulationResults.map(r => r.annualizedReturn);
  const sharpeRatios = simulationResults.map(r => r.sharpeRatio);
  const maxDrawdowns = simulationResults.map(r => r.maxDrawdown);
  const totalReturns = simulationResults.map(r => r.totalReturn);

  const sortedFinalValues = [...finalValues].sort((a, b) => a - b);
  const valueAtRisk95 = initialValue - percentile(finalValues, 5);
  const shortfallValues = sortedFinalValues.filter(v => v <= percentile(finalValues, 5));
  const expectedShortfall = shortfallValues.length > 0
    ? initialValue - shortfallValues.reduce((a, b) => a + b, 0) / shortfallValues.length
    : valueAtRisk95;

  const monteCarloStats: MonteCarloStats = {
    meanFinalValue: finalValues.reduce((a, b) => a + b, 0) / numSimulations,
    medianFinalValue: percentile(finalValues, 50),
    percentile5: percentile(finalValues, 5),
    percentile25: percentile(finalValues, 25),
    percentile75: percentile(finalValues, 75),
    percentile95: percentile(finalValues, 95),
    meanAnnualizedReturn: annualizedReturns.reduce((a, b) => a + b, 0) / numSimulations,
    meanSharpeRatio: sharpeRatios.reduce((a, b) => a + b, 0) / numSimulations,
    meanMaxDrawdown: maxDrawdowns.reduce((a, b) => a + b, 0) / numSimulations,
    valueAtRisk95,
    expectedShortfall,
  };

  const medianIndex = Math.floor(numSimulations / 2);
  const sortedByReturn = [...simulationResults].sort((a, b) => a.totalReturn - b.totalReturn);
  const medianSimulation = sortedByReturn[medianIndex];

  return {
    performanceData: medianSimulation.performanceData,
    finalValue: monteCarloStats.meanFinalValue,
    totalReturn: totalReturns.reduce((a, b) => a + b, 0) / numSimulations,
    annualizedReturn: monteCarloStats.meanAnnualizedReturn,
    volatility: medianSimulation.volatility,
    sharpeRatio: monteCarloStats.meanSharpeRatio,
    maxDrawdown: monteCarloStats.meanMaxDrawdown,
    monteCarloStats,
    allSimulationReturns: totalReturns,
    simulationFinalValues: finalValues,
  };
}
