import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

export type PortfolioType = "core" | "custom";
export type TimePeriod = "YTD" | "LTM" | "1Y" | "3Y" | "5Y" | "10Y" | "SI";

export interface PortfolioSelection {
  id: string;
  type: PortfolioType;
}

interface PortfolioOption {
  id: string;
  name: string;
  type: PortfolioType;
  totalValue: string | null;
  description: string | null;
}

interface Benchmark {
  id: string;
  name: string;
  ticker: string;
  category: string;
  color: string | null;
  isComposite?: boolean;
}

interface PortfolioContextType {
  selectedPortfolioId: string;
  setSelectedPortfolioId: (id: string) => void;
  selectedPortfolioType: PortfolioType;
  setSelectedPortfolioType: (type: PortfolioType) => void;
  setPortfolioSelection: (selection: PortfolioSelection) => void;
  selectedBenchmarkId: string;
  setSelectedBenchmarkId: (id: string) => void;
  selectedTimePeriod: TimePeriod;
  setSelectedTimePeriod: (period: TimePeriod) => void;
  portfolios: PortfolioOption[];
  benchmarks: Benchmark[];
  selectedPortfolio: PortfolioOption | null;
  selectedBenchmark: Benchmark | null;
  isLoading: boolean;
}

const PortfolioContext = createContext<PortfolioContextType | null>(null);

const STORAGE_KEY_PORTFOLIO = "selectedPortfolioId";
const STORAGE_KEY_PORTFOLIO_TYPE = "selectedPortfolioType";
const STORAGE_KEY_BENCHMARK = "selectedBenchmarkId";
const STORAGE_KEY_TIME_PERIOD = "selectedTimePeriod";

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const [selectedPortfolioId, setSelectedPortfolioIdState] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(STORAGE_KEY_PORTFOLIO) || "";
    }
    return "";
  });

  const [selectedPortfolioType, setSelectedPortfolioTypeState] = useState<PortfolioType>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem(STORAGE_KEY_PORTFOLIO_TYPE) as PortfolioType) || "core";
    }
    return "core";
  });

  const [selectedBenchmarkId, setSelectedBenchmarkIdState] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(STORAGE_KEY_BENCHMARK) || "";
    }
    return "";
  });

  const [selectedTimePeriod, setSelectedTimePeriodState] = useState<TimePeriod>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem(STORAGE_KEY_TIME_PERIOD) as TimePeriod) || "1Y";
    }
    return "1Y";
  });

  const { data: portfoliosData, isLoading: portfoliosLoading } = useQuery<{ options: PortfolioOption[] }>({
    queryKey: ["/api/portfolio-options"],
  });

  const { data: benchmarksData, isLoading: benchmarksLoading } = useQuery<{ benchmarks: Benchmark[] }>({
    queryKey: ["/api/benchmarks"],
  });

  const { data: compositeBenchmarksData } = useQuery<any[]>({
    queryKey: ["/api/composite-benchmarks"],
  });

  const portfolios = Array.isArray(portfoliosData?.options) ? portfoliosData.options : [];
  
  const benchmarksList = Array.isArray(benchmarksData?.benchmarks) ? benchmarksData.benchmarks : [];
  const compositeBenchmarksList = Array.isArray(compositeBenchmarksData) ? compositeBenchmarksData : [];
  
  const benchmarks: Benchmark[] = [
    ...benchmarksList,
    ...compositeBenchmarksList.map((cb: any) => ({
      id: `composite-${cb.id}`,
      name: cb.name,
      ticker: "CUSTOM",
      category: "Custom",
      color: "#8b5cf6",
      isComposite: true,
    })),
  ];

  const setSelectedPortfolioId = (id: string) => {
    setSelectedPortfolioIdState(id);
    if (id) {
      localStorage.setItem(STORAGE_KEY_PORTFOLIO, id);
      const portfolio = portfolios.find(p => p.id === id);
      if (portfolio) {
        setSelectedPortfolioTypeState(portfolio.type);
        localStorage.setItem(STORAGE_KEY_PORTFOLIO_TYPE, portfolio.type);
      }
    }
  };

  const setSelectedPortfolioType = (type: PortfolioType) => {
    setSelectedPortfolioTypeState(type);
    localStorage.setItem(STORAGE_KEY_PORTFOLIO_TYPE, type);
  };

  const setSelectedBenchmarkId = (id: string) => {
    setSelectedBenchmarkIdState(id);
    if (id) {
      localStorage.setItem(STORAGE_KEY_BENCHMARK, id);
    }
  };

  const setSelectedTimePeriod = (period: TimePeriod) => {
    setSelectedTimePeriodState(period);
    localStorage.setItem(STORAGE_KEY_TIME_PERIOD, period);
  };

  const setPortfolioSelection = (selection: PortfolioSelection) => {
    setSelectedPortfolioId(selection.id);
    setSelectedPortfolioType(selection.type);
  };

  useEffect(() => {
    if (!selectedPortfolioId && portfolios.length > 0) {
      const corePortfolio = portfolios.find(p => p.type === "core" && p.totalValue && parseFloat(p.totalValue) > 0);
      if (corePortfolio) {
        setSelectedPortfolioId(corePortfolio.id);
      } else if (portfolios[0]) {
        setSelectedPortfolioId(portfolios[0].id);
      }
    }
  }, [portfolios, selectedPortfolioId]);

  useEffect(() => {
    if (!selectedBenchmarkId && benchmarks.length > 0) {
      const sp500 = benchmarks.find(b => b.ticker === "SPY" || b.name.includes("S&P 500"));
      if (sp500) {
        setSelectedBenchmarkId(sp500.id);
      } else if (benchmarks[0]) {
        setSelectedBenchmarkId(benchmarks[0].id);
      }
    }
  }, [benchmarks, selectedBenchmarkId]);

  const selectedPortfolio = portfolios.find(p => p.id === selectedPortfolioId) || null;
  const selectedBenchmark = benchmarks.find(b => b.id === selectedBenchmarkId) || null;

  return (
    <PortfolioContext.Provider value={{ 
      selectedPortfolioId, 
      setSelectedPortfolioId,
      selectedPortfolioType,
      setSelectedPortfolioType,
      setPortfolioSelection,
      selectedBenchmarkId,
      setSelectedBenchmarkId,
      selectedTimePeriod,
      setSelectedTimePeriod,
      portfolios,
      benchmarks,
      selectedPortfolio,
      selectedBenchmark,
      isLoading: portfoliosLoading || benchmarksLoading,
    }}>
      {children}
    </PortfolioContext.Provider>
  );
}

export function usePortfolio() {
  const context = useContext(PortfolioContext);
  if (!context) {
    throw new Error("usePortfolio must be used within a PortfolioProvider");
  }
  return context;
}
