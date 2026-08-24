import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { usePortfolio } from "@/hooks/use-portfolio";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Briefcase, Plus, Trash2, Play, TrendingUp, BarChart3, Target, ArrowRight, AlertTriangle, Download, Calendar, DollarSign, Library, Search, Check, Sparkles, Zap, Shield, ClipboardCheck, FileText, Loader2, RefreshCw, Upload, FileSpreadsheet, X } from "lucide-react";
import { Tooltip as UITooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart, BarChart, Bar, Cell, ReferenceLine } from "recharts";
import { cn } from "@/lib/utils";

interface Strategy {
  id: string;
  name: string;
  ticker: string | null;
  strategyType: string;
  assetClass: string;
  description: string | null;
  expectedReturn: string | null;
  volatility: string | null;
  sourceFile: string | null;
  createdAt: string;
}

interface PortfolioItem {
  id?: string;
  strategyId?: string;
  ticker?: string;
  name: string;
  strategyType: string;
  assetClass: string;
  weight: string;
  expectedReturn?: string;
  volatility?: string;
}

interface CustomPortfolio {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MonteCarloStats {
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

interface BacktestResult {
  id: string;
  startDate: string;
  endDate: string;
  initialValue: string;
  finalValue: string;
  totalReturn: string;
  annualizedReturn: string;
  volatility: string;
  sharpeRatio: string;
  maxDrawdown: string;
  performanceData: Array<{ date: string; value: number; dailyReturn: number; cumulativeReturn: number }>;
  monteCarloStats?: MonteCarloStats;
  simulationFinalValues?: number[];
  numSimulations?: number;
  runDate: string;
}

interface StrategyReturn {
  id: string;
  strategyId: string;
  date: string;
  returnValue: string;
  source: string | null;
  createdAt: string;
}

interface AuditItem {
  item: PortfolioItem & { id: string; strategyId?: string };
  returns: StrategyReturn[];
  loading: boolean;
  error: string | null;
}

const strategyTypes = [
  "Investment",
  "ETF",
  "Mutual Fund",
  "Hedge Fund",
  "Private Equity",
  "Venture Capital",
  "Real Assets Fund",
  "Credit Strategy",
  "Macro Strategy",
  "Long/Short Equity",
  "Event Driven",
  "Distressed",
  "Multi-Strategy",
  "Managed Account",
  "Co-Investment",
  "Direct Investment",
  "Custom Strategy",
  "Other",
];

const assetClasses = [
  "US Equity",
  "International Equity",
  "Emerging Markets",
  "Fixed Income",
  "High Yield",
  "Real Estate",
  "Commodities",
  "Alternatives",
  "Private Equity",
  "Hedge Funds",
  "Cash",
  "Other",
];

const defaultAssetParams: Record<string, { expectedReturn: string; volatility: string }> = {
  "US Equity": { expectedReturn: "0.10", volatility: "0.16" },
  "International Equity": { expectedReturn: "0.08", volatility: "0.18" },
  "Emerging Markets": { expectedReturn: "0.09", volatility: "0.22" },
  "Fixed Income": { expectedReturn: "0.04", volatility: "0.05" },
  "High Yield": { expectedReturn: "0.06", volatility: "0.10" },
  "Real Estate": { expectedReturn: "0.07", volatility: "0.14" },
  "Commodities": { expectedReturn: "0.05", volatility: "0.20" },
  "Alternatives": { expectedReturn: "0.06", volatility: "0.12" },
  "Private Equity": { expectedReturn: "0.12", volatility: "0.25" },
  "Hedge Funds": { expectedReturn: "0.07", volatility: "0.10" },
  "Cash": { expectedReturn: "0.02", volatility: "0.01" },
  "Other": { expectedReturn: "0.05", volatility: "0.15" },
};

export default function PortfolioBuilderPage() {
  const { toast } = useToast();
  const { selectedPortfolioId: globalPortfolioId, selectedPortfolioType, setPortfolioSelection } = usePortfolio();
  const [selectedPortfolioId, setSelectedPortfolioIdLocal] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isBacktestDialogOpen, setIsBacktestDialogOpen] = useState(false);
  const [isLibraryDialogOpen, setIsLibraryDialogOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const setSelectedPortfolioId = useCallback((id: string | null) => {
    setSelectedPortfolioIdLocal(id);
    if (id) {
      setPortfolioSelection({ id, type: "custom" });
    }
  }, [setPortfolioSelection]);
  const [newPortfolioName, setNewPortfolioName] = useState("");
  const [newPortfolioDescription, setNewPortfolioDescription] = useState("");
  const [strategySearchOpen, setStrategySearchOpen] = useState<number | null>(null);
  const [items, setItems] = useState<PortfolioItem[]>([
    { ticker: "", name: "", strategyType: "Investment", assetClass: "US Equity", weight: "100", expectedReturn: "0.10", volatility: "0.16" },
  ]);
  const [backtestConfig, setBacktestConfig] = useState({
    startDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    endDate: new Date().toISOString().split("T")[0],
    initialValue: 1000000,
    riskFreeRate: 0.04, // Default 4%, will be updated with T-bill rate
  });
  const [tickerLookupLoading, setTickerLookupLoading] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("build");
  const [isDragging, setIsDragging] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [parsedImportData, setParsedImportData] = useState<Array<{fundName: string; ticker?: string; assetClass: string; marketValue: number; costBasis?: number; allocation?: number;}> | null>(null);
  const [editableImportData, setEditableImportData] = useState<Array<{fundName: string; ticker?: string; assetClass: string; marketValue: number; costBasis?: number; allocation?: number;}>>([]);
  const [importPortfolioName, setImportPortfolioName] = useState("");

  const { data: strategiesData, isLoading: strategiesLoading } = useQuery<{ strategies: Strategy[] }>({
    queryKey: ["/api/strategies"],
  });

  const { data: portfoliosData, isLoading: portfoliosLoading } = useQuery<{ portfolios: CustomPortfolio[] }>({
    queryKey: ["/api/custom-portfolios"],
  });

  const { data: portfolioDetail, isLoading: detailLoading } = useQuery<{
    portfolio: CustomPortfolio;
    items: Array<PortfolioItem & { id: string; customPortfolioId: string }>;
    backtests: BacktestResult[];
  }>({
    queryKey: ["/api/custom-portfolios", selectedPortfolioId],
    enabled: !!selectedPortfolioId,
  });

  const { data: liquidityLadder } = useQuery<{
    totalValue: number;
    buckets: { label: string; minDays: number; maxDays: number; value: number; weight: number }[];
    cumulative: { days: number; label: string; fraction: number; value: number }[];
    weightedAverageDaysToLiquidity: number;
    daysToFullPortfolioLiquidation: number;
    illiquidFraction: number;
    assumedHoldings: string[];
    warnings: string[];
  }>({
    queryKey: ["/api/custom-portfolios", selectedPortfolioId, "liquidity"],
    queryFn: async () => {
      const res = await fetch(`/api/custom-portfolios/${selectedPortfolioId}/liquidity`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load liquidity ladder");
      return res.json();
    },
    enabled: !!selectedPortfolioId,
  });

  const { data: treasuryRate } = useQuery<{ rate: number; date: string; source: string }>({
    queryKey: ["/api/treasury-rates/3month"],
    staleTime: 24 * 60 * 60 * 1000, // Cache for 24 hours
  });

  useEffect(() => {
    if (treasuryRate?.rate) {
      setBacktestConfig(prev => ({ ...prev, riskFreeRate: treasuryRate.rate }));
    }
  }, [treasuryRate?.rate]);

  useEffect(() => {
    if (globalPortfolioId && selectedPortfolioType === "custom" && globalPortfolioId !== selectedPortfolioId) {
      const customPortfolios = portfoliosData?.portfolios || [];
      const isCustomPortfolio = customPortfolios.some(p => p.id === globalPortfolioId);
      if (isCustomPortfolio) {
        setSelectedPortfolioIdLocal(globalPortfolioId);
      }
    }
  }, [globalPortfolioId, selectedPortfolioType, portfoliosData]);

  const createPortfolioMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string; items: PortfolioItem[] }) => {
      return apiRequest("POST", "/api/custom-portfolios", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-portfolios"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio-options"] });
      toast({ title: "Portfolio created", description: "Your custom portfolio has been created successfully." });
      setIsCreateDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create portfolio", variant: "destructive" });
    },
  });

  const deletePortfolioMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/custom-portfolios/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-portfolios"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio-options"] });
      setSelectedPortfolioId(null);
      setDeleteConfirmId(null);
      toast({ title: "Portfolio deleted", description: "The portfolio has been deleted." });
    },
    onError: (error: any) => {
      setDeleteConfirmId(null);
      toast({ title: "Error", description: error.message || "Failed to delete portfolio", variant: "destructive" });
    },
  });

  const runBacktestMutation = useMutation({
    mutationFn: async (data: { portfolioId: string; startDate: string; endDate: string; initialValue: number; riskFreeRate?: number }) => {
      return apiRequest("POST", `/api/custom-portfolios/${data.portfolioId}/backtest`, {
        startDate: data.startDate,
        endDate: data.endDate,
        initialValue: data.initialValue,
        riskFreeRate: data.riskFreeRate,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-portfolios", selectedPortfolioId] });
      toast({ title: "Backtest complete", description: "Your backtest simulation has completed successfully." });
      setIsBacktestDialogOpen(false);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to run backtest", variant: "destructive" });
    },
  });

  const [isOptimizerDialogOpen, setIsOptimizerDialogOpen] = useState(false);
  const [optimizationGoal, setOptimizationGoal] = useState<"max_return" | "max_sharpe" | "max_convexity">("max_sharpe");
  const [isAuditDialogOpen, setIsAuditDialogOpen] = useState(false);
  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);
  const [optimizationResult, setOptimizationResult] = useState<{
    goal: string;
    weights: { name: string; weight: number }[];
    expectedReturn: number;
    volatility: number;
    sharpeRatio: number;
    convexity: number;
    description: string;
    correlation?: {
      method: "sample" | "shrunk" | "assumed";
      observations: number;
      shrinkageIntensity: number;
      averageCorrelation: number;
      repaired: boolean;
      warnings: string[];
      names: string[];
      matrix: number[][];
    };
  } | null>(null);

  const optimizeMutation = useMutation({
    mutationFn: async (data: { goal: string; items: Array<{ name: string; expectedReturn: number; volatility: number; weight: number; strategyId?: string }> }) => {
      const response = await apiRequest("POST", "/api/optimize-portfolio", data);
      return response.json();
    },
    onSuccess: (data) => {
      setOptimizationResult(data);
      toast({ title: "Optimization complete", description: "Optimal weights have been calculated." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to optimize portfolio", variant: "destructive" });
    },
  });

  const handleOptimize = () => {
    const validItems = items.filter(item => item.name.trim());
    if (validItems.length === 0) {
      toast({ title: "Error", description: "Please add at least one item before optimizing", variant: "destructive" });
      return;
    }
    optimizeMutation.mutate({
      goal: optimizationGoal,
      items: validItems.map(item => ({
        name: item.name,
        expectedReturn: parseFloat(item.expectedReturn || "0.05"),
        volatility: parseFloat(item.volatility || "0.15"),
        weight: parseFloat(item.weight) || 0,
        // Lets the server estimate correlations from this holding's actual
        // return history instead of assuming a flat 0.3.
        strategyId: item.strategyId,
      })),
    });
  };

  const applyOptimizedWeights = () => {
    if (!optimizationResult) return;
    const newItems = items.map(item => {
      const optimizedWeight = optimizationResult.weights.find(w => w.name === item.name);
      if (optimizedWeight) {
        return { ...item, weight: optimizedWeight.weight.toFixed(2) };
      }
      return item;
    });
    setItems(newItems);
    setIsOptimizerDialogOpen(false);
    setOptimizationResult(null);
    toast({ title: "Weights applied", description: "Optimized weights have been applied to your portfolio." });
  };

  const handleAuditReturns = async () => {
    if (!portfolioDetail?.items) return;
    
    setIsAuditDialogOpen(true);
    
    const allItems = portfolioDetail.items;
    if (allItems.length === 0) {
      setAuditItems([]);
      return;
    }

    setAuditItems(allItems.map(item => ({
      item,
      returns: [],
      loading: true,
      error: null,
    })));

    // For items without strategyId, try to resolve by matching name/ticker to strategy library
    let resolvedStrategies: Record<string, string> = {};
    const itemsNeedingLookup = allItems.filter(item => !item.strategyId);
    if (itemsNeedingLookup.length > 0) {
      try {
        const strategiesRes = await fetch("/api/strategies", { credentials: "include" });
        if (strategiesRes.ok) {
          const strategiesList = await strategiesRes.json();
          for (const item of itemsNeedingLookup) {
            const match = strategiesList.find((s: any) => 
              s.name.toLowerCase() === item.name.toLowerCase() ||
              (item.ticker && s.ticker && s.ticker.toLowerCase() === item.ticker.toLowerCase())
            );
            if (match) {
              resolvedStrategies[item.id] = match.id;
            }
          }
        }
      } catch {}
    }

    for (const item of allItems) {
      const strategyId = item.strategyId || resolvedStrategies[item.id];
      if (!strategyId) {
        setAuditItems(prev => prev.map(a => 
          a.item.id === item.id 
            ? { ...a, loading: false, error: "No matching strategy found in library" }
            : a
        ));
        continue;
      }
      try {
        const response = await fetch(`/api/strategies/${strategyId}/returns`, { credentials: "include" });
        const data = await response.json();
        
        setAuditItems(prev => prev.map(a => 
          a.item.id === item.id 
            ? { ...a, returns: data.returns || [], loading: false }
            : a
        ));
      } catch (error: any) {
        setAuditItems(prev => prev.map(a => 
          a.item.id === item.id 
            ? { ...a, loading: false, error: error.message || "Failed to load returns" }
            : a
        ));
      }
    }
  };

  const resetForm = () => {
    setNewPortfolioName("");
    setNewPortfolioDescription("");
    setItems([{ ticker: "", name: "", strategyType: "Investment", assetClass: "US Equity", weight: "100", expectedReturn: "0.10", volatility: "0.16" }]);
  };

  const addItem = () => {
    setItems([...items, { ticker: "", name: "", strategyType: "Investment", assetClass: "US Equity", weight: "0", expectedReturn: "0.10", volatility: "0.16" }]);
  };

  const selectStrategyFromLibrary = (index: number, strategy: Strategy) => {
    const newItems = [...items];
    newItems[index] = {
      ...newItems[index],
      strategyId: strategy.id,
      ticker: strategy.ticker || "",
      name: strategy.name,
      strategyType: strategy.strategyType,
      assetClass: strategy.assetClass,
      expectedReturn: strategy.expectedReturn || defaultAssetParams[strategy.assetClass]?.expectedReturn || "0.05",
      volatility: strategy.volatility || defaultAssetParams[strategy.assetClass]?.volatility || "0.15",
    };
    setItems(newItems);
    setStrategySearchOpen(null);
  };

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    }
  };

  const updateItem = (index: number, field: keyof PortfolioItem, value: string) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    
    if (field === "assetClass" && defaultAssetParams[value]) {
      newItems[index].expectedReturn = defaultAssetParams[value].expectedReturn;
      newItems[index].volatility = defaultAssetParams[value].volatility;
    }
    
    setItems(newItems);
  };

  const lookupTicker = async (index: number) => {
    const ticker = items[index].ticker?.trim().toUpperCase();
    if (!ticker) {
      toast({ 
        title: "No ticker", 
        description: "Please enter a ticker symbol first.",
        variant: "destructive" 
      });
      return;
    }

    setTickerLookupLoading(index);
    try {
      const response = await fetch(`/api/ticker/${ticker}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to fetch ticker data");
      }

      const tickerData = data.ticker;
      const newItems = [...items];
      
      if (tickerData.name) {
        newItems[index].name = tickerData.name;
      }
      if (tickerData.annualizedReturn !== undefined && tickerData.annualizedReturn !== null && typeof tickerData.annualizedReturn === 'number') {
        newItems[index].expectedReturn = tickerData.annualizedReturn.toFixed(4);
      }
      if (tickerData.annualizedVolatility !== undefined && tickerData.annualizedVolatility !== null && typeof tickerData.annualizedVolatility === 'number') {
        newItems[index].volatility = tickerData.annualizedVolatility.toFixed(4);
      }
      
      newItems[index].strategyType = "ETF";
      
      setItems(newItems);
      
      const hasMetrics = tickerData.annualizedReturn !== null && tickerData.annualizedVolatility !== null;
      toast({ 
        title: "Ticker data loaded", 
        description: hasMetrics 
          ? `Loaded data for ${ticker}: ${tickerData.name}` 
          : `Loaded name for ${ticker}. Historical returns not available - using default metrics.`
      });
    } catch (error: any) {
      console.error("Ticker lookup error:", error);
      toast({ 
        title: "Lookup failed", 
        description: error.message || "Failed to fetch ticker data. Make sure ALPHA_VANTAGE_API_KEY is configured.",
        variant: "destructive" 
      });
    } finally {
      setTickerLookupLoading(null);
    }
  };

  const getTotalWeight = () => {
    return items.reduce((sum, item) => sum + (parseFloat(item.weight) || 0), 0);
  };

  const normalizeWeights = () => {
    const total = getTotalWeight();
    if (total > 0) {
      setItems(items.map(item => ({
        ...item,
        weight: ((parseFloat(item.weight) || 0) / total * 100).toFixed(2),
      })));
    }
  };

  const handleCreatePortfolio = () => {
    const validItems = items.filter(item => item.name.trim());
    if (!newPortfolioName.trim()) {
      toast({ title: "Error", description: "Please enter a portfolio name", variant: "destructive" });
      return;
    }
    if (validItems.length === 0) {
      toast({ title: "Error", description: "Please add at least one item with a name", variant: "destructive" });
      return;
    }
    createPortfolioMutation.mutate({
      name: newPortfolioName,
      description: newPortfolioDescription,
      items: validItems.map(item => ({
        ...item,
        strategyType: item.strategyType || "Investment",
      })),
    });
  };

  const handleRunBacktest = () => {
    if (!selectedPortfolioId) return;
    runBacktestMutation.mutate({
      portfolioId: selectedPortfolioId,
      ...backtestConfig,
    });
  };

  const mapImportAssetClass = (importClass: string): string => {
    const mapping: Record<string, string> = {
      "equity": "US Equity", "equities": "US Equity",
      "fixed income": "Fixed Income", "bonds": "Fixed Income", "bond": "Fixed Income",
      "real estate": "Real Estate", "reit": "Real Estate",
      "alternatives": "Alternatives", "alternative": "Alternatives",
      "cash": "Cash", "money market": "Cash",
      "commodities": "Commodities", "commodity": "Commodities",
      "private equity": "Private Equity",
      "hedge fund": "Hedge Funds", "hedge funds": "Hedge Funds",
    };
    return mapping[importClass.toLowerCase()] || "Other";
  };

  const formatPercent = (value: string | number) => {
    const num = typeof value === "string" ? parseFloat(value) : value;
    return `${(num * 100).toFixed(2)}%`;
  };

  const formatCurrency = (value: string | number) => {
    const num = typeof value === "string" ? parseFloat(value) : value;
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(num);
  };

  const parseMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/import/parse", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to parse file");
      }
      return response.json();
    },
    onSuccess: (data: any) => {
      setParsedImportData(data.investments);
      setEditableImportData(data.investments);
      toast({
        title: "File parsed successfully",
        description: `Found ${data.summary.totalItems} investments worth ${formatCurrency(data.summary.totalValue)}`,
      });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "Parse failed", description: error.message });
    },
  });

  const handleImportDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleImportDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); }, []);
  const handleImportDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) { setImportFile(droppedFile); parseMutation.mutate(droppedFile); }
  }, [parseMutation]);
  const handleImportFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) { setImportFile(selectedFile); parseMutation.mutate(selectedFile); }
  }, [parseMutation]);
  const updateImportInvestment = (index: number, field: string, value: string | number) => {
    setEditableImportData(prev => { const updated = [...prev]; updated[index] = { ...updated[index], [field]: value }; return updated; });
  };
  const removeImportInvestment = (index: number) => { setEditableImportData(prev => prev.filter((_, i) => i !== index)); };
  const resetImport = () => { setImportFile(null); setParsedImportData(null); setEditableImportData([]); setImportPortfolioName(""); };

  const importTotalValue = editableImportData.reduce((sum, inv) => sum + inv.marketValue, 0);

  const resolveAssetClass = (importClass: string): string => {
    const lower = importClass.toLowerCase().trim();
    const exact = assetClasses.find(ac => ac.toLowerCase() === lower);
    if (exact) return exact;
    const mapped = mapImportAssetClass(importClass);
    if (mapped !== "Other") return mapped;
    const partial = assetClasses.find(ac => lower.includes(ac.toLowerCase()) || ac.toLowerCase().includes(lower));
    if (partial) return partial;
    return "Other";
  };

  const handleCreateFromImport = () => {
    if (!importPortfolioName.trim()) {
      toast({ title: "Name required", description: "Please enter a portfolio name", variant: "destructive" });
      return;
    }
    if (editableImportData.length === 0) {
      toast({ title: "No investments", description: "Please upload a file with investment data", variant: "destructive" });
      return;
    }
    const totalValue = editableImportData.reduce((sum, inv) => sum + inv.marketValue, 0);
    const portfolioItems = editableImportData.map(inv => {
      const weight = totalValue > 0 ? ((inv.marketValue / totalValue) * 100).toFixed(2) : "0";
      const mappedAssetClass = resolveAssetClass(inv.assetClass);
      const params = defaultAssetParams[mappedAssetClass] || defaultAssetParams["Other"];
      return {
        name: inv.fundName,
        ticker: inv.ticker || "",
        strategyType: "Investment" as string,
        assetClass: mappedAssetClass,
        weight,
        expectedReturn: params.expectedReturn,
        volatility: params.volatility,
      };
    });
    const fileName = importFile?.name || "file";
    createPortfolioMutation.mutate({
      name: importPortfolioName,
      description: `Imported from ${fileName}`,
      items: portfolioItems,
    }, {
      onSuccess: () => {
        resetImport();
        setActiveTab("build");
      },
    });
  };

  if (portfoliosLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[400px]" />
      </div>
    );
  }

  const portfolios = portfoliosData?.portfolios || [];
  const latestBacktest = portfolioDetail?.backtests?.[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Briefcase className="h-6 w-6 text-primary" />
            Portfolio Builder
          </h1>
          <p className="text-muted-foreground">Build, import, and backtest custom portfolios</p>
        </div>
        {activeTab === "build" && (
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-portfolio">
              <Plus className="h-4 w-4 mr-2" />
              New Portfolio
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Custom Portfolio</DialogTitle>
              <DialogDescription>
                Define your portfolio allocation with custom weights and expected returns
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="portfolio-name">Portfolio Name</Label>
                  <Input
                    id="portfolio-name"
                    placeholder="My Custom Portfolio"
                    value={newPortfolioName}
                    onChange={(e) => setNewPortfolioName(e.target.value)}
                    data-testid="input-portfolio-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="portfolio-description">Description (optional)</Label>
                  <Input
                    id="portfolio-description"
                    placeholder="Description of your portfolio strategy"
                    value={newPortfolioDescription}
                    onChange={(e) => setNewPortfolioDescription(e.target.value)}
                    data-testid="input-portfolio-description"
                  />
                </div>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">Portfolio Items</h3>
                  <p className="text-sm text-muted-foreground">Add investments with their target weights</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={getTotalWeight() === 100 ? "default" : "secondary"}>
                    Total: {getTotalWeight().toFixed(1)}%
                  </Badge>
                  <Dialog open={isOptimizerDialogOpen} onOpenChange={(open) => { setIsOptimizerDialogOpen(open); if (!open) setOptimizationResult(null); }}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" data-testid="button-optimize-portfolio">
                        <Sparkles className="h-4 w-4 mr-1" />
                        Optimize
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                          <Sparkles className="h-5 w-5 text-primary" />
                          Portfolio Optimizer
                        </DialogTitle>
                        <DialogDescription>
                          Generate optimal asset allocation based on your selected goal
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4 overflow-y-auto flex-1">
                        <div className="space-y-2">
                          <Label>Optimization Goal</Label>
                          <div className="grid grid-cols-3 gap-3">
                            <div
                              className={cn(
                                "p-4 border rounded-md cursor-pointer transition-colors",
                                optimizationGoal === "max_return" ? "border-primary bg-primary/5" : "hover-elevate"
                              )}
                              onClick={() => setOptimizationGoal("max_return")}
                              data-testid="goal-max-return"
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <TrendingUp className="h-4 w-4 text-green-500" />
                                <span className="font-medium">Maximum Return</span>
                              </div>
                              <p className="text-xs text-muted-foreground">Allocate 100% to highest return asset</p>
                            </div>
                            <div
                              className={cn(
                                "p-4 border rounded-md cursor-pointer transition-colors",
                                optimizationGoal === "max_sharpe" ? "border-primary bg-primary/5" : "hover-elevate"
                              )}
                              onClick={() => setOptimizationGoal("max_sharpe")}
                              data-testid="goal-max-sharpe"
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <Shield className="h-4 w-4 text-blue-500" />
                                <span className="font-medium">Maximum Sharpe</span>
                              </div>
                              <p className="text-xs text-muted-foreground">Best risk-adjusted returns</p>
                            </div>
                            <div
                              className={cn(
                                "p-4 border rounded-md cursor-pointer transition-colors",
                                optimizationGoal === "max_convexity" ? "border-primary bg-primary/5" : "hover-elevate"
                              )}
                              onClick={() => setOptimizationGoal("max_convexity")}
                              data-testid="goal-max-convexity"
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <Zap className="h-4 w-4 text-amber-500" />
                                <span className="font-medium">Maximum Convexity</span>
                              </div>
                              <p className="text-xs text-muted-foreground">Favor asymmetric upside potential</p>
                            </div>
                          </div>
                        </div>

                        {!optimizationResult && (
                          <Button onClick={handleOptimize} disabled={optimizeMutation.isPending} className="w-full" data-testid="button-run-optimization">
                            {optimizeMutation.isPending ? "Optimizing..." : "Calculate Optimal Weights"}
                          </Button>
                        )}

                        {optimizationResult && (
                          <div className="space-y-4">
                            <Separator />
                            <div>
                              <h4 className="font-semibold mb-2">Optimization Results</h4>
                              <p className="text-sm text-muted-foreground mb-4">{optimizationResult.description}</p>
                            </div>
                            
                            <div className="grid grid-cols-4 gap-4">
                              <div className="p-3 bg-muted/50 rounded-md">
                                <p className="text-xs text-muted-foreground">Expected Return</p>
                                <p className="text-lg font-semibold text-green-500">{(optimizationResult.expectedReturn * 100).toFixed(2)}%</p>
                              </div>
                              <div className="p-3 bg-muted/50 rounded-md">
                                <p className="text-xs text-muted-foreground">Volatility</p>
                                <p className="text-lg font-semibold">{(optimizationResult.volatility * 100).toFixed(2)}%</p>
                              </div>
                              <div className="p-3 bg-muted/50 rounded-md">
                                <p className="text-xs text-muted-foreground">Sharpe Ratio</p>
                                <p className="text-lg font-semibold text-blue-500">{optimizationResult.sharpeRatio.toFixed(2)}</p>
                              </div>
                              <div className="p-3 bg-muted/50 rounded-md">
                                <p className="text-xs text-muted-foreground">Convexity Score</p>
                                <p className="text-lg font-semibold text-amber-500">{optimizationResult.convexity.toFixed(2)}</p>
                              </div>
                            </div>

                            {optimizationResult.correlation && (
                              <div className="rounded-lg border p-3 text-sm" data-testid="optimizer-correlation-provenance">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-medium">Correlations</span>
                                  <span className="text-muted-foreground">
                                    {optimizationResult.correlation.method === "assumed"
                                      ? "Assumed 0.30 \u2014 no usable return history"
                                      : `From ${optimizationResult.correlation.observations} overlapping periods of actual returns`}
                                  </span>
                                </div>
                                {optimizationResult.correlation.method !== "assumed" && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Average pairwise correlation {optimizationResult.correlation.averageCorrelation.toFixed(2)};
                                    shrunk {(optimizationResult.correlation.shrinkageIntensity * 100).toFixed(0)}% toward that
                                    average to temper small-sample noise.
                                  </p>
                                )}
                                {optimizationResult.correlation.warnings.map((w, i) => (
                                  <p key={i} className="mt-1 text-xs text-amber-500">{w}</p>
                                ))}
                              </div>
                            )}

                            <div>
                              <h5 className="font-medium mb-2">Optimized Weights</h5>
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Asset</TableHead>
                                    <TableHead className="text-right">Weight</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {optimizationResult.weights.map((w, i) => (
                                    <TableRow key={i}>
                                      <TableCell>{w.name}</TableCell>
                                      <TableCell className="text-right font-medium">{w.weight.toFixed(2)}%</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </div>
                        )}
                      </div>
                      {optimizationResult && (
                        <DialogFooter>
                          <Button variant="outline" onClick={() => { setOptimizationResult(null); }}>
                            Recalculate
                          </Button>
                          <Button onClick={applyOptimizedWeights} data-testid="button-apply-weights">
                            Apply Weights
                          </Button>
                        </DialogFooter>
                      )}
                    </DialogContent>
                  </Dialog>
                  <Button variant="outline" size="sm" onClick={normalizeWeights} data-testid="button-normalize-weights">
                    Normalize to 100%
                  </Button>
                  <Button variant="outline" size="sm" onClick={addItem} data-testid="button-add-item">
                    <Plus className="h-4 w-4 mr-1" />
                    Add Item
                  </Button>
                </div>
              </div>

              {strategiesData?.strategies && strategiesData.strategies.length > 0 && (
                <div className="mb-4 p-3 bg-muted/50 rounded-md">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Library className="h-4 w-4" />
                    <span>{strategiesData.strategies.length} strategies available in your library. Select from library or enter manually.</span>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {items.map((item, index) => (
                  <div key={index} className="space-y-2 p-3 border rounded-md">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Item {index + 1}</span>
                      <div className="flex items-center gap-2">
                        {strategiesData?.strategies && strategiesData.strategies.length > 0 && (
                          <Popover open={strategySearchOpen === index} onOpenChange={(open) => setStrategySearchOpen(open ? index : null)}>
                            <PopoverTrigger asChild>
                              <Button variant="outline" size="sm" data-testid={`button-select-from-library-${index}`}>
                                <Library className="h-4 w-4 mr-1" />
                                From Library
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-80 p-0" align="end">
                              <Command>
                                <CommandInput placeholder="Search strategies..." />
                                <CommandList>
                                  <CommandEmpty>No strategies found.</CommandEmpty>
                                  <CommandGroup>
                                    {strategiesData.strategies.map((strategy) => (
                                      <CommandItem
                                        key={strategy.id}
                                        value={strategy.name}
                                        onSelect={() => selectStrategyFromLibrary(index, strategy)}
                                        className="cursor-pointer"
                                      >
                                        <div className="flex flex-col">
                                          <span className="font-medium">{strategy.name}</span>
                                          <span className="text-xs text-muted-foreground">
                                            {strategy.ticker && `${strategy.ticker} • `}{strategy.strategyType} • {strategy.assetClass}
                                          </span>
                                        </div>
                                        {item.strategyId === strategy.id && (
                                          <Check className="ml-auto h-4 w-4" />
                                        )}
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeItem(index)}
                          disabled={items.length === 1}
                          data-testid={`button-remove-item-${index}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-8 gap-2">
                      <div className="space-y-1 col-span-2">
                        <Label className="text-xs">Name *</Label>
                        <Input
                          placeholder="Strategy or fund name"
                          value={item.name}
                          onChange={(e) => updateItem(index, "name", e.target.value)}
                          data-testid={`input-name-${index}`}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Ticker</Label>
                        <div className="flex gap-1">
                          <Input
                            placeholder="e.g. AAPL"
                            value={item.ticker || ""}
                            onChange={(e) => updateItem(index, "ticker", e.target.value.toUpperCase())}
                            data-testid={`input-ticker-${index}`}
                            className="flex-1"
                          />
                          <UITooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="default"
                                size="icon"
                                onClick={() => lookupTicker(index)}
                                disabled={tickerLookupLoading === index || !item.ticker}
                                data-testid={`button-lookup-ticker-${index}`}
                                className="shrink-0"
                              >
                                {tickerLookupLoading === index ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Search className="h-4 w-4" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Look up ticker data</p>
                            </TooltipContent>
                          </UITooltip>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Type</Label>
                        <Select
                          value={item.strategyType || "Investment"}
                          onValueChange={(v) => updateItem(index, "strategyType", v)}
                        >
                          <SelectTrigger data-testid={`select-strategy-type-${index}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {strategyTypes.map((st) => (
                              <SelectItem key={st} value={st}>{st}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Asset Class</Label>
                        <Select
                          value={item.assetClass}
                          onValueChange={(v) => updateItem(index, "assetClass", v)}
                        >
                          <SelectTrigger data-testid={`select-asset-class-${index}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {assetClasses.map((ac) => (
                              <SelectItem key={ac} value={ac}>{ac}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Weight (%)</Label>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={item.weight}
                          onChange={(e) => updateItem(index, "weight", e.target.value)}
                          data-testid={`input-weight-${index}`}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Exp. Return</Label>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="0.10"
                          value={item.expectedReturn || ""}
                          onChange={(e) => updateItem(index, "expectedReturn", e.target.value)}
                          data-testid={`input-return-${index}`}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Volatility</Label>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="0.16"
                          value={item.volatility || ""}
                          onChange={(e) => updateItem(index, "volatility", e.target.value)}
                          data-testid={`input-volatility-${index}`}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleCreatePortfolio} disabled={createPortfolioMutation.isPending} data-testid="button-save-portfolio">
                {createPortfolioMutation.isPending ? "Creating..." : "Create Portfolio"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="build" data-testid="tab-build">
            <Briefcase className="h-4 w-4 mr-2" />
            Build
          </TabsTrigger>
          <TabsTrigger value="import" data-testid="tab-import">
            <Upload className="h-4 w-4 mr-2" />
            Import from File
          </TabsTrigger>
        </TabsList>

        <TabsContent value="build" className="mt-6">
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Your Portfolios</CardTitle>
              <CardDescription>Select a portfolio to view details and run backtests</CardDescription>
            </CardHeader>
            <CardContent>
              {portfolios.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Briefcase className="h-10 w-10 mx-auto mb-3 opacity-50" />
                  <p>No custom portfolios yet</p>
                  <p className="text-sm">Create your first portfolio to get started</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {portfolios.map((portfolio) => (
                    <div
                      key={portfolio.id}
                      className={`p-3 rounded-md border cursor-pointer transition-colors ${
                        selectedPortfolioId === portfolio.id
                          ? "border-primary bg-primary/5"
                          : "hover-elevate"
                      }`}
                      onClick={() => setSelectedPortfolioId(portfolio.id)}
                      data-testid={`portfolio-card-${portfolio.id}`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <div className="min-w-0 flex-1">
                          <h4 className="font-medium truncate">{portfolio.name}</h4>
                          {portfolio.description && (
                            <p className="text-sm text-muted-foreground truncate max-w-[200px]">
                              {portfolio.description}
                            </p>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="shrink-0"
                          onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(portfolio.id); }}
                          data-testid={`button-delete-portfolio-${portfolio.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="col-span-8">
          {!selectedPortfolioId ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16">
                <Target className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">Select a Portfolio</h3>
                <p className="text-muted-foreground text-center max-w-md">
                  Choose a portfolio from the list to view its composition and run backtest simulations
                </p>
              </CardContent>
            </Card>
          ) : detailLoading ? (
            <Skeleton className="h-[500px]" />
          ) : portfolioDetail ? (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>{portfolioDetail.portfolio.name}</CardTitle>
                      <CardDescription>{portfolioDetail.portfolio.description || "No description"}</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() => window.open(`/api/custom-portfolios/${selectedPortfolioId}/export-audit`, "_blank")}
                        data-testid="button-export-audit"
                      >
                        <FileText className="h-4 w-4 mr-2" />
                        Export Audit
                      </Button>
                      <Dialog open={isBacktestDialogOpen} onOpenChange={setIsBacktestDialogOpen}>
                        <DialogTrigger asChild>
                          <Button data-testid="button-run-backtest">
                            <Play className="h-4 w-4 mr-2" />
                            Run Backtest
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Configure Backtest</DialogTitle>
                            <DialogDescription>
                              Set parameters for your historical simulation
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4 py-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label htmlFor="start-date">Start Date</Label>
                                <Input
                                  id="start-date"
                                  type="date"
                                  value={backtestConfig.startDate}
                                  onChange={(e) => setBacktestConfig({ ...backtestConfig, startDate: e.target.value })}
                                  data-testid="input-backtest-start-date"
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="end-date">End Date</Label>
                                <Input
                                  id="end-date"
                                  type="date"
                                  value={backtestConfig.endDate}
                                  onChange={(e) => setBacktestConfig({ ...backtestConfig, endDate: e.target.value })}
                                  data-testid="input-backtest-end-date"
                                />
                              </div>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="initial-value">Initial Investment ($)</Label>
                              <Input
                                id="initial-value"
                                type="number"
                                min="1000"
                                step="1000"
                                value={backtestConfig.initialValue}
                                onChange={(e) => setBacktestConfig({ ...backtestConfig, initialValue: parseInt(e.target.value) || 1000000 })}
                                data-testid="input-backtest-initial-value"
                              />
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <Label htmlFor="risk-free-rate">Risk-Free Rate (%)</Label>
                                {treasuryRate && (
                                  <span className="text-xs text-muted-foreground">
                                    3M T-Bill: {(treasuryRate.rate * 100).toFixed(2)}% ({treasuryRate.source})
                                  </span>
                                )}
                              </div>
                              <Input
                                id="risk-free-rate"
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                value={(backtestConfig.riskFreeRate * 100).toFixed(2)}
                                onChange={(e) => setBacktestConfig({ ...backtestConfig, riskFreeRate: parseFloat(e.target.value) / 100 || 0 })}
                                data-testid="input-risk-free-rate"
                              />
                              <p className="text-xs text-muted-foreground">Used for Sharpe ratio calculation. Default is the 3-month T-bill rate.</p>
                            </div>
                          </div>
                          <DialogFooter>
                            <Button variant="outline" onClick={() => setIsBacktestDialogOpen(false)}>Cancel</Button>
                            <Button onClick={handleRunBacktest} disabled={runBacktestMutation.isPending} data-testid="button-submit-backtest">
                              {runBacktestMutation.isPending ? "Running..." : "Run Simulation"}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                      <Button
                        variant="outline"
                        onClick={handleAuditReturns}
                        data-testid="button-audit-returns"
                      >
                        <ClipboardCheck className="h-4 w-4 mr-2" />
                        Audit Returns
                      </Button>
                      <Button
                        variant="destructive"
                        size="icon"
                        onClick={() => setDeleteConfirmId(selectedPortfolioId)}
                        data-testid="button-delete-portfolio"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <h4 className="font-semibold mb-3">Composition</h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ticker</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Asset Class</TableHead>
                        <TableHead className="text-right">Weight</TableHead>
                        <TableHead className="text-right">Exp. Return</TableHead>
                        <TableHead className="text-right">Volatility</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {portfolioDetail.items.map((item) => (
                        <TableRow key={item.id} data-testid={`row-item-${item.id}`}>
                          <TableCell className="font-mono">{item.ticker}</TableCell>
                          <TableCell>{item.name}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{item.assetClass}</Badge>
                          </TableCell>
                          <TableCell className="text-right">{parseFloat(item.weight).toFixed(2)}%</TableCell>
                          <TableCell className="text-right">
                            {item.expectedReturn ? formatPercent(item.expectedReturn) : "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            {item.volatility ? formatPercent(item.volatility) : "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {liquidityLadder && liquidityLadder.totalValue > 0 && (
                <Card data-testid="card-liquidity-ladder">
                  <CardHeader>
                    <CardTitle>Liquidity Ladder</CardTitle>
                    <CardDescription>
                      When this book turns into cash, from each holding&apos;s stated redemption
                      terms. Notice periods and gates are applied; manager behaviour under stress
                      is not modelled.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="p-4 border rounded-lg">
                        <span className="text-sm font-medium text-muted-foreground">Realizable in 90 days</span>
                        <p className="text-2xl font-semibold">
                          {((liquidityLadder.cumulative.find((c) => c.days === 90)?.fraction ?? 0) * 100).toFixed(0)}%
                        </p>
                      </div>
                      <div className="p-4 border rounded-lg">
                        <span className="text-sm font-medium text-muted-foreground">Beyond one year</span>
                        <p className="text-2xl font-semibold">
                          {(liquidityLadder.illiquidFraction * 100).toFixed(0)}%
                        </p>
                      </div>
                      <div className="p-4 border rounded-lg">
                        <span className="text-sm font-medium text-muted-foreground">Full exit</span>
                        <p className="text-2xl font-semibold">
                          {(liquidityLadder.daysToFullPortfolioLiquidation / 365).toFixed(1)}
                          <span className="text-sm font-normal text-muted-foreground"> years</span>
                        </p>
                      </div>
                    </div>

                    <div>
                      <h5 className="font-medium mb-3">Weight by time to first redemption</h5>
                      <div className="space-y-2">
                        {liquidityLadder.buckets.map((b) => (
                          <div
                            key={b.label}
                            className="flex items-center gap-3"
                            title={`${b.label}: ${(b.weight * 100).toFixed(1)}% of the portfolio`}
                          >
                            <span className="w-28 shrink-0 text-sm text-muted-foreground">{b.label}</span>
                            <div className="h-5 flex-1 rounded bg-muted overflow-hidden">
                              <div
                                className="h-full rounded bg-primary"
                                style={{ width: `${Math.max(b.weight * 100, b.weight > 0 ? 1 : 0)}%` }}
                              />
                            </div>
                            <span className="w-14 shrink-0 text-right text-sm tabular-nums">
                              {(b.weight * 100).toFixed(1)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h5 className="font-medium mb-3">Cumulative realizable</h5>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Horizon</TableHead>
                            <TableHead className="text-right">Share of portfolio</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {liquidityLadder.cumulative.map((c) => (
                            <TableRow key={c.days}>
                              <TableCell>{c.label}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {(c.fraction * 100).toFixed(1)}%
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {liquidityLadder.warnings.length > 0 && (
                      <div className="space-y-1 border-t pt-4">
                        {liquidityLadder.warnings.map((w, i) => (
                          <p key={i} className="text-sm text-amber-500">{w}</p>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {latestBacktest && (
                <>
                  <div className="grid grid-cols-4 gap-4">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                          <TrendingUp className="h-4 w-4" />
                          Total Return
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className={`text-2xl font-bold ${parseFloat(latestBacktest.totalReturn) >= 0 ? "text-green-500" : "text-red-500"}`}>
                          {formatPercent(latestBacktest.totalReturn)}
                        </div>
                        <p className="text-xs text-muted-foreground">Annualized: {formatPercent(latestBacktest.annualizedReturn)}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                          <BarChart3 className="h-4 w-4" />
                          Sharpe Ratio
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">
                          {parseFloat(latestBacktest.sharpeRatio).toFixed(2)}
                        </div>
                        <p className="text-xs text-muted-foreground">Risk-adjusted return</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                          <AlertTriangle className="h-4 w-4" />
                          Max Drawdown
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold text-red-500">
                          {formatPercent(latestBacktest.maxDrawdown)}
                        </div>
                        <p className="text-xs text-muted-foreground">Peak to trough</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                          <DollarSign className="h-4 w-4" />
                          Final Value
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">
                          {formatCurrency(latestBacktest.finalValue)}
                        </div>
                        <p className="text-xs text-muted-foreground">From {formatCurrency(latestBacktest.initialValue)}</p>
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Performance Chart</CardTitle>
                      <CardDescription>
                        Simulated portfolio value from {new Date(latestBacktest.startDate).toLocaleDateString()} to {new Date(latestBacktest.endDate).toLocaleDateString()}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={latestBacktest.performanceData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                            <defs>
                              <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                            <XAxis
                              dataKey="date"
                              tickFormatter={(value) => new Date(value).toLocaleDateString("en-US", { month: "short", year: "2-digit" })}
                              tick={{ fontSize: 12 }}
                              className="fill-muted-foreground"
                            />
                            <YAxis
                              tickFormatter={(value) => formatCurrency(value)}
                              tick={{ fontSize: 12 }}
                              className="fill-muted-foreground"
                              width={80}
                            />
                            <Tooltip
                              contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                              labelFormatter={(value) => new Date(value).toLocaleDateString()}
                              formatter={(value: number) => [formatCurrency(value), "Value"]}
                            />
                            <Area
                              type="monotone"
                              dataKey="value"
                              stroke="hsl(var(--primary))"
                              fillOpacity={1}
                              fill="url(#colorValue)"
                              strokeWidth={2}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  {latestBacktest.monteCarloStats && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <BarChart3 className="h-5 w-5 text-primary" />
                          Monte Carlo Distribution
                        </CardTitle>
                        <CardDescription>
                          Results from 100 simulated scenarios showing outcome distribution
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                          <div className="p-3 rounded-md bg-muted/50">
                            <p className="text-xs text-muted-foreground mb-1">5th Percentile (Worst)</p>
                            <p className="text-lg font-semibold text-red-500">
                              {formatCurrency(latestBacktest.monteCarloStats.percentile5)}
                            </p>
                          </div>
                          <div className="p-3 rounded-md bg-muted/50">
                            <p className="text-xs text-muted-foreground mb-1">25th Percentile</p>
                            <p className="text-lg font-semibold">
                              {formatCurrency(latestBacktest.monteCarloStats.percentile25)}
                            </p>
                          </div>
                          <div className="p-3 rounded-md bg-muted/50">
                            <p className="text-xs text-muted-foreground mb-1">Median (50th)</p>
                            <p className="text-lg font-semibold">
                              {formatCurrency(latestBacktest.monteCarloStats.medianFinalValue)}
                            </p>
                          </div>
                          <div className="p-3 rounded-md bg-muted/50">
                            <p className="text-xs text-muted-foreground mb-1">95th Percentile (Best)</p>
                            <p className="text-lg font-semibold text-green-500">
                              {formatCurrency(latestBacktest.monteCarloStats.percentile95)}
                            </p>
                          </div>
                        </div>

                        {latestBacktest.simulationFinalValues && latestBacktest.simulationFinalValues.length > 0 && (() => {
                          const values = latestBacktest.simulationFinalValues!;
                          const initialValue = parseFloat(latestBacktest.initialValue);
                          const minVal = Math.min(...values);
                          const maxVal = Math.max(...values);
                          const range = maxVal - minVal;
                          const numBins = range > 0 ? 12 : 1;
                          const binWidth = range > 0 ? range / numBins : 1;
                          
                          const bins: { range: string; count: number; minValue: number; maxValue: number }[] = [];
                          for (let i = 0; i < numBins; i++) {
                            const binMin = minVal + i * binWidth;
                            const binMax = range > 0 ? minVal + (i + 1) * binWidth : maxVal + 1;
                            const count = values.filter(v => v >= binMin && (i === numBins - 1 ? v <= binMax : v < binMax)).length;
                            bins.push({
                              range: range > 0 ? `$${(binMin / 1000).toFixed(0)}k` : formatCurrency(minVal),
                              count,
                              minValue: binMin,
                              maxValue: binMax,
                            });
                          }

                          return (
                            <>
                              <Separator className="my-4" />
                              <div className="h-[200px]" data-testid="monte-carlo-histogram">
                                <ResponsiveContainer width="100%" height="100%">
                                  <BarChart data={bins} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                                    <XAxis 
                                      dataKey="range" 
                                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                      tickLine={false}
                                      interval="preserveStartEnd"
                                    />
                                    <YAxis 
                                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                      tickLine={false}
                                      allowDecimals={false}
                                    />
                                    <Tooltip 
                                      contentStyle={{
                                        backgroundColor: "hsl(var(--card))",
                                        border: "1px solid hsl(var(--border))",
                                        borderRadius: "var(--radius)",
                                      }}
                                      formatter={(value: number) => [`${value} simulations`, "Count"]}
                                      labelFormatter={(label) => `Final Value: ${label}`}
                                    />
                                    <ReferenceLine 
                                      x={bins.findIndex(b => b.minValue <= initialValue && b.maxValue >= initialValue) >= 0 
                                        ? bins[bins.findIndex(b => b.minValue <= initialValue && b.maxValue >= initialValue)].range 
                                        : undefined} 
                                      stroke="hsl(var(--muted-foreground))" 
                                      strokeDasharray="5 5"
                                      label={{ value: "Initial", position: "top", fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                    />
                                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                                      {bins.map((entry, index) => {
                                        const midValue = (entry.minValue + entry.maxValue) / 2;
                                        let color = "hsl(var(--primary))";
                                        if (midValue < initialValue * 0.95) {
                                          color = "hsl(0, 84%, 60%)";
                                        } else if (midValue > initialValue * 1.1) {
                                          color = "hsl(142, 76%, 36%)";
                                        }
                                        return <Cell key={`cell-${index}`} fill={color} />;
                                      })}
                                    </Bar>
                                  </BarChart>
                                </ResponsiveContainer>
                              </div>
                              <p className="text-xs text-muted-foreground text-center mt-2">
                                Distribution of final portfolio values across 100 simulations
                              </p>
                            </>
                          );
                        })()}

                        <Separator className="my-4" />

                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                          <div className="p-3 rounded-md border">
                            <p className="text-xs text-muted-foreground mb-1">Value at Risk (95%)</p>
                            <p className="text-lg font-semibold text-red-500">
                              {formatCurrency(latestBacktest.monteCarloStats.valueAtRisk95)}
                            </p>
                            <p className="text-xs text-muted-foreground">5% chance of losing more</p>
                          </div>
                          <div className="p-3 rounded-md border">
                            <p className="text-xs text-muted-foreground mb-1">Expected Shortfall</p>
                            <p className="text-lg font-semibold text-red-500">
                              {formatCurrency(latestBacktest.monteCarloStats.expectedShortfall)}
                            </p>
                            <p className="text-xs text-muted-foreground">Avg loss in worst 5%</p>
                          </div>
                          <div className="p-3 rounded-md border">
                            <p className="text-xs text-muted-foreground mb-1">Mean Final Value</p>
                            <p className="text-lg font-semibold">
                              {formatCurrency(latestBacktest.monteCarloStats.meanFinalValue)}
                            </p>
                            <p className="text-xs text-muted-foreground">Expected outcome</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              )}

              {portfolioDetail.backtests.length === 0 && (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Play className="h-10 w-10 text-muted-foreground mb-3" />
                    <h3 className="font-medium">No Backtest Results</h3>
                    <p className="text-muted-foreground text-sm text-center">
                      Run a backtest to simulate historical performance
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : null}
        </div>
      </div>
        </TabsContent>

        <TabsContent value="import" className="mt-6">
          <div className="space-y-6">
            {!parsedImportData ? (
              <Card data-testid="card-import-upload">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Upload className="h-5 w-5" />
                    Upload File
                  </CardTitle>
                  <CardDescription>
                    Upload a PDF, Excel, or CSV file to automatically extract investments and create a custom portfolio
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div
                    className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                      isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
                    }`}
                    onDragOver={handleImportDragOver}
                    onDragLeave={handleImportDragLeave}
                    onDrop={handleImportDrop}
                    data-testid="dropzone-import"
                  >
                    {parseMutation.isPending ? (
                      <div className="flex flex-col items-center gap-4">
                        <Loader2 className="h-12 w-12 text-primary animate-spin" />
                        <p className="text-lg font-medium">Parsing file...</p>
                        <p className="text-sm text-muted-foreground">Extracting investment data from your file</p>
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-center gap-4 mb-4">
                          <FileSpreadsheet className="h-12 w-12 text-muted-foreground" />
                          <FileText className="h-12 w-12 text-muted-foreground" />
                        </div>
                        <p className="text-lg font-medium mb-2">Drag and drop your file here</p>
                        <p className="text-sm text-muted-foreground mb-4">or click to browse</p>
                        <Input type="file" accept=".pdf,.xlsx,.xls,.csv" className="hidden" id="import-file-upload" onChange={handleImportFileSelect} data-testid="input-import-file" />
                        <label htmlFor="import-file-upload">
                          <Button variant="outline" asChild><span data-testid="button-browse-import">Browse Files</span></Button>
                        </label>
                      </>
                    )}
                  </div>
                  <div className="mt-6 grid gap-4 md:grid-cols-3">
                    <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50">
                      <FileSpreadsheet className="h-8 w-8 text-green-500 flex-shrink-0" />
                      <div>
                        <p className="font-medium text-sm">Excel Files</p>
                        <p className="text-xs text-muted-foreground">.xlsx, .xls with columns for fund name, value, asset class</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50">
                      <FileText className="h-8 w-8 text-red-500 flex-shrink-0" />
                      <div>
                        <p className="font-medium text-sm">PDF Statements</p>
                        <p className="text-xs text-muted-foreground">Brokerage statements, fund reports with holdings</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50">
                      <FileSpreadsheet className="h-8 w-8 text-blue-500 flex-shrink-0" />
                      <div>
                        <p className="font-medium text-sm">CSV Files</p>
                        <p className="text-xs text-muted-foreground">Comma-separated values exported from other systems</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-4">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Check className="h-5 w-5 text-green-500" />
                        File Parsed Successfully
                      </CardTitle>
                      <CardDescription>{importFile?.name}</CardDescription>
                    </div>
                    <Button variant="outline" onClick={resetImport} data-testid="button-reset-import">Upload Different File</Button>
                  </CardHeader>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Import Summary</CardTitle>
                    <CardDescription>Review extracted investments, then create a custom portfolio</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-4 mb-6">
                      <div className="flex-1 p-4 rounded-lg bg-muted/50 text-center">
                        <p className="text-2xl font-bold" data-testid="text-import-count">{editableImportData.length}</p>
                        <p className="text-sm text-muted-foreground">Investments</p>
                      </div>
                      <div className="flex-1 p-4 rounded-lg bg-muted/50 text-center">
                        <p className="text-2xl font-bold text-green-500" data-testid="text-import-value">{formatCurrency(importTotalValue)}</p>
                        <p className="text-sm text-muted-foreground">Total Value</p>
                      </div>
                      <div className="flex-1 p-4 rounded-lg bg-muted/50 text-center">
                        <p className="text-2xl font-bold" data-testid="text-import-classes">{new Set(editableImportData.map(d => d.assetClass)).size}</p>
                        <p className="text-sm text-muted-foreground">Asset Classes</p>
                      </div>
                    </div>
                    <div className="space-y-2 mb-6">
                      <Label htmlFor="import-portfolio-name">Portfolio Name</Label>
                      <Input id="import-portfolio-name" placeholder="e.g., Imported Q4 Portfolio" value={importPortfolioName} onChange={(e) => setImportPortfolioName(e.target.value)} data-testid="input-import-portfolio-name" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-4">
                    <div>
                      <CardTitle>Investment Line Items</CardTitle>
                      <CardDescription>Edit fund names, asset classes, or remove items before creating portfolio</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={resetImport} data-testid="button-cancel-import">Cancel</Button>
                      <Button onClick={handleCreateFromImport} disabled={editableImportData.length === 0 || createPortfolioMutation.isPending} data-testid="button-create-from-import">
                        {createPortfolioMutation.isPending ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating...</>) : (<><Plus className="mr-2 h-4 w-4" />Create Portfolio ({editableImportData.length} items)</>)}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {editableImportData.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 gap-4">
                        <AlertTriangle className="h-12 w-12 text-muted-foreground" />
                        <p className="text-muted-foreground">All investments have been removed</p>
                        <Button variant="outline" onClick={resetImport}>Start Over</Button>
                      </div>
                    ) : (
                      <div className="rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-[300px]">Fund Name</TableHead>
                              <TableHead>Ticker</TableHead>
                              <TableHead>Asset Class</TableHead>
                              <TableHead className="text-right">Market Value</TableHead>
                              <TableHead className="text-right">Weight</TableHead>
                              <TableHead className="w-[50px]"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {editableImportData.map((inv, index) => (
                              <TableRow key={index} data-testid={`row-import-${index}`}>
                                <TableCell>
                                  <Input value={inv.fundName} onChange={(e) => updateImportInvestment(index, "fundName", e.target.value)} data-testid={`input-import-name-${index}`} />
                                </TableCell>
                                <TableCell>
                                  <Input value={inv.ticker || ""} onChange={(e) => updateImportInvestment(index, "ticker", e.target.value)} className="w-24" placeholder="-" data-testid={`input-import-ticker-${index}`} />
                                </TableCell>
                                <TableCell>
                                  <Select value={inv.assetClass} onValueChange={(value) => updateImportInvestment(index, "assetClass", value)}>
                                    <SelectTrigger className="w-[160px]" data-testid={`select-import-class-${index}`}><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      {["Equity", "Fixed Income", "Real Estate", "Alternatives", "Cash", "US Equity", "International Equity", "Emerging Markets", "High Yield", "Commodities", "Private Equity", "Hedge Funds", "Other"].map(ac => (
                                        <SelectItem key={ac} value={ac}>{ac}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                                <TableCell className="text-right">
                                  <Input type="number" value={inv.marketValue} onChange={(e) => updateImportInvestment(index, "marketValue", parseFloat(e.target.value) || 0)} className="w-32 text-right" data-testid={`input-import-value-${index}`} />
                                </TableCell>
                                <TableCell className="text-right text-muted-foreground">
                                  {importTotalValue > 0 ? `${((inv.marketValue / importTotalValue) * 100).toFixed(1)}%` : "-"}
                                </TableCell>
                                <TableCell>
                                  <Button variant="ghost" size="icon" onClick={() => removeImportInvestment(index)} data-testid={`button-remove-import-${index}`}>
                                    <X className="h-4 w-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={isAuditDialogOpen} onOpenChange={setIsAuditDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5" />
              Audit Historical Returns
            </DialogTitle>
            <DialogDescription>
              Review uploaded historical returns for each linked strategy to verify data conversion was correct.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {auditItems.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-8">
                  <FileText className="h-10 w-10 text-muted-foreground mb-3" />
                  <h3 className="font-medium">No Portfolio Items</h3>
                  <p className="text-muted-foreground text-sm text-center max-w-md mt-2">
                    This portfolio has no items to audit. Add items to your portfolio to view their historical returns.
                  </p>
                </CardContent>
              </Card>
            ) : (
              auditItems.map((auditItem) => (
                <Card key={auditItem.item.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base">{auditItem.item.name}</CardTitle>
                        <CardDescription className="flex items-center gap-2 mt-1">
                          {auditItem.item.ticker && (
                            <Badge variant="outline" className="font-mono">{auditItem.item.ticker}</Badge>
                          )}
                          <Badge variant="secondary">{auditItem.item.assetClass}</Badge>
                          <span className="text-xs">Weight: {parseFloat(auditItem.item.weight).toFixed(2)}%</span>
                        </CardDescription>
                      </div>
                      {auditItem.loading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : auditItem.error ? (
                        <Badge variant="destructive">Error</Badge>
                      ) : (
                        <Badge variant="default">{auditItem.returns.length} returns</Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {auditItem.loading ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="h-6 w-6 animate-spin mr-2" />
                        <span>Loading returns data...</span>
                      </div>
                    ) : auditItem.error ? (
                      <div className="text-red-500 text-sm">{auditItem.error}</div>
                    ) : auditItem.returns.length === 0 ? (
                      <div className="text-muted-foreground text-sm text-center py-4">
                        No historical returns uploaded for this strategy.
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-4 gap-4 mb-4">
                          <div className="p-3 rounded-md border">
                            <p className="text-xs text-muted-foreground">Total Records</p>
                            <p className="text-lg font-semibold">{auditItem.returns.length}</p>
                          </div>
                          <div className="p-3 rounded-md border">
                            <p className="text-xs text-muted-foreground">Date Range</p>
                            <p className="text-sm font-medium">
                              {new Date(auditItem.returns[0]?.date).toLocaleDateString()} - {new Date(auditItem.returns[auditItem.returns.length - 1]?.date).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="p-3 rounded-md border">
                            <p className="text-xs text-muted-foreground">Average Return</p>
                            <p className={`text-lg font-semibold ${
                              (auditItem.returns.reduce((sum, r) => sum + parseFloat(r.returnValue), 0) / auditItem.returns.length) >= 0 
                                ? "text-green-500" 
                                : "text-red-500"
                            }`}>
                              {((auditItem.returns.reduce((sum, r) => sum + parseFloat(r.returnValue), 0) / auditItem.returns.length) * 100).toFixed(4)}%
                            </p>
                          </div>
                          <div className="p-3 rounded-md border">
                            <p className="text-xs text-muted-foreground">Source File</p>
                            <p className="text-sm font-medium truncate flex items-center gap-1">
                              <FileText className="h-3 w-3" />
                              {auditItem.returns[0]?.source || "Manual entry"}
                            </p>
                          </div>
                        </div>

                        <div className="border rounded-md max-h-[200px] overflow-y-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead className="text-right">Return</TableHead>
                                <TableHead className="text-right">Return (%)</TableHead>
                                <TableHead>Source</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {auditItem.returns.slice(0, 50).map((ret, idx) => (
                                <TableRow key={ret.id} data-testid={`row-return-${idx}`}>
                                  <TableCell className="font-mono text-sm">
                                    {new Date(ret.date).toLocaleDateString()}
                                  </TableCell>
                                  <TableCell className={`text-right font-mono ${parseFloat(ret.returnValue) >= 0 ? "text-green-500" : "text-red-500"}`}>
                                    {parseFloat(ret.returnValue).toFixed(6)}
                                  </TableCell>
                                  <TableCell className={`text-right font-mono ${parseFloat(ret.returnValue) >= 0 ? "text-green-500" : "text-red-500"}`}>
                                    {(parseFloat(ret.returnValue) * 100).toFixed(4)}%
                                  </TableCell>
                                  <TableCell className="text-xs text-muted-foreground truncate max-w-[150px]">
                                    {ret.source || "-"}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                          {auditItem.returns.length > 50 && (
                            <div className="text-center py-2 text-sm text-muted-foreground border-t">
                              Showing first 50 of {auditItem.returns.length} records
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAuditDialogOpen(false)} data-testid="button-close-audit">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteConfirmId !== null} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Portfolio</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{portfolios.find(p => p.id === deleteConfirmId)?.name}"? This will permanently remove the portfolio, all its holdings, and any backtest results. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)} data-testid="button-cancel-delete">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => { if (deleteConfirmId) deletePortfolioMutation.mutate(deleteConfirmId); }}
              disabled={deletePortfolioMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deletePortfolioMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Deleting...</> : <><Trash2 className="h-4 w-4 mr-2" />Delete</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
