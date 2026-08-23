interface Asset {
  name: string;
  expectedReturn: number;
  volatility: number;
  currentWeight: number;
}

interface OptimizationResult {
  goal: string;
  weights: { name: string; weight: number }[];
  expectedReturn: number;
  volatility: number;
  sharpeRatio: number;
  convexity: number;
  description: string;
}

const RISK_FREE_RATE = 0.04;

/**
 * Deterministic PRNG (mulberry32) for the weight search.
 *
 * The search samples the weight simplex at random, and seeded from the clock
 * the same portfolio returned a different allocation on every call. An
 * allocation recommendation nobody can reproduce is not one anybody should act
 * on, and it also makes the effect of a change to the correlation inputs
 * impossible to observe. Seeding fixes both.
 */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEARCH_SEED = 0x5eed;

function calculatePortfolioReturn(assets: Asset[], weights: number[]): number {
  return assets.reduce((sum, asset, i) => sum + asset.expectedReturn * weights[i], 0);
}

function calculatePortfolioVolatility(assets: Asset[], weights: number[], correlationMatrix?: number[][]): number {
  if (!correlationMatrix) {
    correlationMatrix = assets.map((_, i) => 
      assets.map((_, j) => i === j ? 1 : 0.3)
    );
  }
  
  let variance = 0;
  for (let i = 0; i < assets.length; i++) {
    for (let j = 0; j < assets.length; j++) {
      variance += weights[i] * weights[j] * assets[i].volatility * assets[j].volatility * correlationMatrix[i][j];
    }
  }
  return Math.sqrt(variance);
}

function calculateSharpeRatio(portfolioReturn: number, portfolioVolatility: number): number {
  if (portfolioVolatility === 0) return 0;
  return (portfolioReturn - RISK_FREE_RATE) / portfolioVolatility;
}

function calculateConvexity(assets: Asset[], weights: number[]): number {
  let convexity = 0;
  for (let i = 0; i < assets.length; i++) {
    const returnToVolRatio = assets[i].volatility > 0 
      ? assets[i].expectedReturn / assets[i].volatility 
      : 0;
    const skewProxy = Math.max(0, returnToVolRatio - 0.5);
    convexity += weights[i] * skewProxy * (1 + returnToVolRatio);
  }
  return convexity;
}

function normalizeWeights(weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return weights.map(() => 1 / weights.length);
  return weights.map(w => w / sum);
}

function optimizeMaxReturn(assets: Asset[]): number[] {
  const weights = new Array(assets.length).fill(0);
  let maxReturnIdx = 0;
  let maxReturn = -Infinity;
  
  for (let i = 0; i < assets.length; i++) {
    if (assets[i].expectedReturn > maxReturn) {
      maxReturn = assets[i].expectedReturn;
      maxReturnIdx = i;
    }
  }
  
  weights[maxReturnIdx] = 1;
  return weights;
}

function optimizeMaxSharpe(assets: Asset[], correlationMatrix?: number[][]): number[] {
  const random = seededRandom(SEARCH_SEED);
  const n = assets.length;
  if (n === 1) return [1];
  
  let bestWeights = normalizeWeights(new Array(n).fill(1));
  let bestSharpe = -Infinity;
  
  const iterations = 10000;
  
  for (let iter = 0; iter < iterations; iter++) {
    const rawWeights = assets.map(() => random());
    const weights = normalizeWeights(rawWeights);
    
    const ret = calculatePortfolioReturn(assets, weights);
    const vol = calculatePortfolioVolatility(assets, weights, correlationMatrix);
    const sharpe = calculateSharpeRatio(ret, vol);
    
    if (sharpe > bestSharpe) {
      bestSharpe = sharpe;
      bestWeights = weights;
    }
  }
  
  const gradientIterations = 1000;
  let currentWeights = [...bestWeights];
  
  for (let iter = 0; iter < gradientIterations; iter++) {
    const step = 0.01 * (1 - iter / gradientIterations);
    const currentRet = calculatePortfolioReturn(assets, currentWeights);
    const currentVol = calculatePortfolioVolatility(assets, currentWeights, correlationMatrix);
    const currentSharpe = calculateSharpeRatio(currentRet, currentVol);
    
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const testWeights = [...currentWeights];
        testWeights[i] = Math.max(0, testWeights[i] + step);
        testWeights[j] = Math.max(0, testWeights[j] - step);
        const normalized = normalizeWeights(testWeights);
        
        const testRet = calculatePortfolioReturn(assets, normalized);
        const testVol = calculatePortfolioVolatility(assets, normalized, correlationMatrix);
        const testSharpe = calculateSharpeRatio(testRet, testVol);
        
        if (testSharpe > currentSharpe) {
          currentWeights = normalized;
        }
      }
    }
  }
  
  return currentWeights;
}

function optimizeMaxConvexity(assets: Asset[], correlationMatrix?: number[][]): number[] {
  const random = seededRandom(SEARCH_SEED);
  const n = assets.length;
  if (n === 1) return [1];
  
  let bestWeights = normalizeWeights(new Array(n).fill(1));
  let bestScore = -Infinity;
  
  const iterations = 10000;
  
  for (let iter = 0; iter < iterations; iter++) {
    const rawWeights = assets.map(() => random());
    const weights = normalizeWeights(rawWeights);
    
    const ret = calculatePortfolioReturn(assets, weights);
    const vol = calculatePortfolioVolatility(assets, weights, correlationMatrix);
    const convexity = calculateConvexity(assets, weights);
    const score = convexity * (1 + calculateSharpeRatio(ret, vol) * 0.5);
    
    if (score > bestScore) {
      bestScore = score;
      bestWeights = weights;
    }
  }
  
  return bestWeights;
}

export function optimizePortfolio(
  items: Array<{ name: string; expectedReturn: number; volatility: number; weight: number }>,
  goal: "max_return" | "max_sharpe" | "max_convexity",
  correlationMatrix?: number[][]
): OptimizationResult {
  const assets: Asset[] = items.map(item => ({
    name: item.name,
    expectedReturn: item.expectedReturn,
    volatility: item.volatility,
    currentWeight: item.weight / 100,
  }));
  
  let optimizedWeights: number[];
  let description: string;
  
  switch (goal) {
    case "max_return":
      optimizedWeights = optimizeMaxReturn(assets);
      description = "Allocates 100% to the asset with the highest expected return. This is an aggressive strategy that maximizes expected returns without regard to risk.";
      break;
    case "max_sharpe":
      optimizedWeights = optimizeMaxSharpe(assets, correlationMatrix);
      description = "Optimizes the risk-adjusted return by maximizing the Sharpe ratio. This strategy balances return potential against volatility to find the most efficient allocation.";
      break;
    case "max_convexity":
      optimizedWeights = optimizeMaxConvexity(assets, correlationMatrix);
      description = "Maximizes portfolio convexity, favoring assets with asymmetric return profiles (higher upside relative to downside). This strategy seeks exposure to assets that offer convex payoffs.";
      break;
    default:
      throw new Error(`Unknown optimization goal: ${goal}`);
  }
  
  const portfolioReturn = calculatePortfolioReturn(assets, optimizedWeights);
  const portfolioVolatility = calculatePortfolioVolatility(assets, optimizedWeights, correlationMatrix);
  const sharpeRatio = calculateSharpeRatio(portfolioReturn, portfolioVolatility);
  const convexity = calculateConvexity(assets, optimizedWeights);
  
  return {
    goal,
    weights: assets.map((asset, i) => ({
      name: asset.name,
      weight: Math.round(optimizedWeights[i] * 10000) / 100,
    })),
    expectedReturn: portfolioReturn,
    volatility: portfolioVolatility,
    sharpeRatio,
    convexity,
    description,
  };
}
