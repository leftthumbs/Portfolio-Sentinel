import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Library, Plus, Trash2, Edit2, Upload, Search, FileSpreadsheet, TrendingUp, History, FileUp, Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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

interface StrategyReturn {
  id: string;
  strategyId: string;
  date: string;
  returnValue: string;
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

interface StrategyForm {
  name: string;
  ticker: string;
  strategyType: string;
  assetClass: string;
  description: string;
  expectedReturn: string;
  volatility: string;
}

export default function StrategyLibraryPage() {
  const { toast } = useToast();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isBulkDialogOpen, setIsBulkDialogOpen] = useState(false);
  const [isReturnsDialogOpen, setIsReturnsDialogOpen] = useState(false);
  const [selectedStrategyForReturns, setSelectedStrategyForReturns] = useState<Strategy | null>(null);
  const [returnsInput, setReturnsInput] = useState("");
  const [editingStrategy, setEditingStrategy] = useState<Strategy | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [bulkInput, setBulkInput] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedReturns, setExtractedReturns] = useState<{ date: string; returnValue: string }[]>([]);
  const [form, setForm] = useState<StrategyForm>({
    name: "",
    ticker: "",
    strategyType: "Investment",
    assetClass: "US Equity",
    description: "",
    expectedReturn: "0.10",
    volatility: "0.16",
  });

  const { data: strategiesData, isLoading } = useQuery<{ strategies: Strategy[] }>({
    queryKey: ["/api/strategies"],
  });

  const { data: returnsData, refetch: refetchReturns } = useQuery<{ returns: StrategyReturn[]; count: number }>({
    queryKey: ["/api/strategies", selectedStrategyForReturns?.id, "returns"],
    enabled: !!selectedStrategyForReturns,
  });

  const importReturnsMutation = useMutation({
    mutationFn: async ({ strategyId, returns }: { strategyId: string; returns: { date: string; returnValue: string }[] }) => {
      return apiRequest("POST", `/api/strategies/${strategyId}/returns`, { returns });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategies", selectedStrategyForReturns?.id, "returns"] });
      toast({ title: "Returns imported", description: `${data.count} return records have been imported.` });
      setReturnsInput("");
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to import returns", variant: "destructive" });
    },
  });

  const deleteReturnsMutation = useMutation({
    mutationFn: async (strategyId: string) => {
      return apiRequest("DELETE", `/api/strategies/${strategyId}/returns`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategies", selectedStrategyForReturns?.id, "returns"] });
      toast({ title: "Returns deleted", description: "Historical returns have been deleted." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete returns", variant: "destructive" });
    },
  });

  const uploadReturnsMutation = useMutation({
    mutationFn: async ({ strategyId, file }: { strategyId: string; file: File }) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`/api/strategies/${strategyId}/returns/upload`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Upload failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategies", selectedStrategyForReturns?.id, "returns"] });
      toast({ title: "File imported", description: `${data.count} return records imported from ${data.fileName}` });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to upload returns file", variant: "destructive" });
    },
  });

  const createStrategyMutation = useMutation({
    mutationFn: async ({ data, file, historicalReturns }: { data: Partial<StrategyForm>; file: File | null; historicalReturns: { date: string; returnValue: string }[] }) => {
      let result;
      if (file) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("name", data.name || "");
        formData.append("ticker", data.ticker || "");
        formData.append("strategyType", data.strategyType || "Investment");
        formData.append("assetClass", data.assetClass || "US Equity");
        formData.append("description", data.description || "");
        formData.append("expectedReturn", data.expectedReturn || "");
        formData.append("volatility", data.volatility || "");
        
        const response = await fetch("/api/strategies/with-file", {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || "Failed to create strategy");
        }
        result = await response.json();
      } else {
        result = await apiRequest("POST", "/api/strategies", data);
      }
      
      // Import historical returns if we have them
      if (historicalReturns.length > 0 && result.strategy?.id) {
        try {
          await apiRequest("POST", `/api/strategies/${result.strategy.id}/returns`, { returns: historicalReturns });
        } catch (err) {
          console.error("Failed to import historical returns:", err);
          // Don't fail the whole operation if returns import fails
        }
      }
      
      return { ...result, returnsImported: historicalReturns.length };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategies"] });
      const returnsMsg = data.returnsImported > 0 ? ` ${data.returnsImported} historical returns imported.` : "";
      toast({ title: "Strategy added", description: `Strategy has been added to your library.${returnsMsg}` });
      setIsCreateDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to add strategy", variant: "destructive" });
    },
  });

  const updateStrategyMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<StrategyForm> }) => {
      return apiRequest("PATCH", `/api/strategies/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategies"] });
      toast({ title: "Strategy updated", description: "Strategy has been updated." });
      setEditingStrategy(null);
      resetForm();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update strategy", variant: "destructive" });
    },
  });

  const uploadFileMutation = useMutation({
    mutationFn: async ({ strategyId, file }: { strategyId: string; file: File }) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`/api/strategies/${strategyId}/file`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to upload file");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategies"] });
      toast({ title: "File uploaded", description: "File has been attached to the strategy." });
      setSelectedFile(null);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to upload file", variant: "destructive" });
    },
  });

  const deleteFileMutation = useMutation({
    mutationFn: async (strategyId: string) => {
      return apiRequest("DELETE", `/api/strategies/${strategyId}/file`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategies"] });
      toast({ title: "File removed", description: "File has been removed from the strategy." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to remove file", variant: "destructive" });
    },
  });

  const extractInfoFromFile = async (file: File) => {
    setIsExtracting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      
      const response = await fetch("/api/strategies/extract-info", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to extract info");
      }
      
      const data = await response.json();
      const extracted = data.extracted;
      const historicalReturns = data.historicalReturns || [];
      
      // Store extracted returns for import after strategy is created
      setExtractedReturns(historicalReturns);
      
      setForm(prev => ({
        name: extracted.name || prev.name,
        ticker: extracted.ticker || prev.ticker,
        strategyType: strategyTypes.includes(extracted.strategyType) ? extracted.strategyType : prev.strategyType,
        assetClass: assetClasses.includes(extracted.assetClass) ? extracted.assetClass : prev.assetClass,
        description: extracted.description || prev.description,
        expectedReturn: extracted.expectedReturn != null ? String(Number(extracted.expectedReturn).toFixed(4)) : prev.expectedReturn,
        volatility: extracted.volatility != null ? String(Number(extracted.volatility).toFixed(4)) : prev.volatility,
      }));
      
      const details: string[] = [];
      const returnFrequency = data.returnFrequency;
      if (historicalReturns.length > 0) {
        const freqLabel = returnFrequency ? ` (${returnFrequency})` : "";
        details.push(`${historicalReturns.length} historical return records found${freqLabel}`);
      }
      if (extracted.expectedReturnSource === "calculated") {
        details.push("Expected return calculated from historical data");
      } else if (extracted.expectedReturnSource === "document") {
        details.push("Expected return extracted from document text");
      }
      if (extracted.volatilitySource === "calculated") {
        details.push("Volatility calculated from historical data");
      } else if (extracted.volatilitySource === "document") {
        details.push("Volatility extracted from document text");
      }
      
      const detailMsg = details.length > 0 ? " " + details.join(". ") + "." : "";
      
      toast({ 
        title: "Information extracted", 
        description: `Form fields populated from the document.${detailMsg} Please review and adjust as needed.` 
      });
    } catch (error: any) {
      toast({ 
        title: "Extraction failed", 
        description: error.message || "Could not extract information. Please fill in the fields manually.",
        variant: "destructive"
      });
    } finally {
      setIsExtracting(false);
    }
  };

  const deleteStrategyMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/strategies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategies"] });
      toast({ title: "Strategy deleted", description: "Strategy has been removed from your library." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete strategy", variant: "destructive" });
    },
  });

  const importStrategiesMutation = useMutation({
    mutationFn: async (strategies: Partial<StrategyForm>[]) => {
      return apiRequest("POST", "/api/strategies/import", { strategies });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategies"] });
      toast({ title: "Strategies imported", description: `${data.count} strategies have been added to your library.` });
      setIsBulkDialogOpen(false);
      setBulkInput("");
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to import strategies", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setForm({
      name: "",
      ticker: "",
      strategyType: "Investment",
      assetClass: "US Equity",
      description: "",
      expectedReturn: "0.10",
      volatility: "0.16",
    });
    setSelectedFile(null);
    setExtractedReturns([]);
  };

  const handleSaveStrategy = () => {
    if (!form.name.trim()) {
      toast({ title: "Error", description: "Please enter a strategy name", variant: "destructive" });
      return;
    }
    if (editingStrategy) {
      updateStrategyMutation.mutate({ id: editingStrategy.id, data: form });
      // If there's a new file selected for an existing strategy, upload it separately
      if (selectedFile) {
        uploadFileMutation.mutate({ strategyId: editingStrategy.id, file: selectedFile });
      }
    } else {
      // Include extracted historical returns when creating new strategy
      createStrategyMutation.mutate({ data: form, file: selectedFile, historicalReturns: extractedReturns });
    }
  };

  const handleEditStrategy = (strategy: Strategy) => {
    setEditingStrategy(strategy);
    setForm({
      name: strategy.name,
      ticker: strategy.ticker || "",
      strategyType: strategy.strategyType,
      assetClass: strategy.assetClass,
      description: strategy.description || "",
      expectedReturn: strategy.expectedReturn || "0.05",
      volatility: strategy.volatility || "0.15",
    });
    setIsCreateDialogOpen(true);
  };

  const handleBulkImport = () => {
    const lines = bulkInput.trim().split("\n").filter(line => line.trim());
    if (lines.length === 0) {
      toast({ title: "Error", description: "Please enter at least one strategy", variant: "destructive" });
      return;
    }
    const strategies: Partial<StrategyForm>[] = lines.map(line => {
      const parts = line.split(",").map(p => p.trim());
      const assetClass = parts[2] || "Other";
      return {
        name: parts[0] || "Unnamed Strategy",
        ticker: parts[1] || undefined,
        strategyType: parts[3] || "Investment",
        assetClass,
        expectedReturn: defaultAssetParams[assetClass]?.expectedReturn || "0.05",
        volatility: defaultAssetParams[assetClass]?.volatility || "0.15",
      };
    });
    importStrategiesMutation.mutate(strategies);
  };

  const handleOpenReturnsDialog = (strategy: Strategy) => {
    setSelectedStrategyForReturns(strategy);
    setReturnsInput("");
    setIsReturnsDialogOpen(true);
  };

  const handleImportReturns = () => {
    if (!selectedStrategyForReturns) return;
    const lines = returnsInput.trim().split("\n").filter(line => line.trim());
    if (lines.length === 0) {
      toast({ title: "Error", description: "Please enter return data", variant: "destructive" });
      return;
    }
    
    const returns: { date: string; returnValue: string }[] = [];
    for (const line of lines) {
      const parts = line.split(",").map(p => p.trim());
      if (parts.length >= 2) {
        const date = parts[0];
        const returnValue = parts[1];
        if (date && returnValue && !isNaN(parseFloat(returnValue))) {
          returns.push({ date, returnValue });
        }
      }
    }
    
    if (returns.length === 0) {
      toast({ title: "Error", description: "No valid return data found", variant: "destructive" });
      return;
    }
    
    importReturnsMutation.mutate({ strategyId: selectedStrategyForReturns.id, returns });
  };

  const filteredStrategies = strategiesData?.strategies.filter(s => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (s.ticker && s.ticker.toLowerCase().includes(searchQuery.toLowerCase())) ||
    s.strategyType.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.assetClass.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  const formatPercent = (value: string | null) => {
    if (!value) return "-";
    const num = parseFloat(value);
    return `${(num * 100).toFixed(1)}%`;
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Library className="h-6 w-6" />
            Strategy Library
          </h1>
          <p className="text-muted-foreground">
            Manage your investment strategies, funds, and assets. Import data to build your library.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setIsBulkDialogOpen(true)} data-testid="button-bulk-import">
            <Upload className="h-4 w-4 mr-2" />
            Bulk Import
          </Button>
          <Button onClick={() => { resetForm(); setEditingStrategy(null); setIsCreateDialogOpen(true); }} data-testid="button-add-strategy">
            <Plus className="h-4 w-4 mr-2" />
            Add Strategy
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Strategies</CardTitle>
              <CardDescription>
                {filteredStrategies.length} strategies in your library
              </CardDescription>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search strategies..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="input-search-strategies"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredStrategies.length === 0 ? (
            <div className="text-center py-12">
              <Library className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-medium mb-2">
                {searchQuery ? "No strategies found" : "No strategies yet"}
              </h3>
              <p className="text-muted-foreground mb-4">
                {searchQuery 
                  ? "Try adjusting your search query" 
                  : "Add strategies to your library to use in portfolio construction"
                }
              </p>
              {!searchQuery && (
                <Button onClick={() => { resetForm(); setIsCreateDialogOpen(true); }}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Your First Strategy
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Ticker</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Asset Class</TableHead>
                  <TableHead className="text-right">Exp. Return</TableHead>
                  <TableHead className="text-right">Volatility</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredStrategies.map((strategy) => (
                  <TableRow key={strategy.id} data-testid={`row-strategy-${strategy.id}`}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {strategy.name}
                        {strategy.sourceFile && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  window.open(`/api/strategies/${strategy.id}/file`, "_blank");
                                }}
                                data-testid={`button-view-file-${strategy.id}`}
                              >
                                <FileUp className="h-3 w-3 text-primary" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>View attached document</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {strategy.ticker ? (
                        <Badge variant="outline">{strategy.ticker}</Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{strategy.strategyType}</Badge>
                    </TableCell>
                    <TableCell>{strategy.assetClass}</TableCell>
                    <TableCell className="text-right">{formatPercent(strategy.expectedReturn)}</TableCell>
                    <TableCell className="text-right">{formatPercent(strategy.volatility)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleOpenReturnsDialog(strategy)}
                              data-testid={`button-returns-strategy-${strategy.id}`}
                            >
                              <History className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Historical Returns</TooltipContent>
                        </Tooltip>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEditStrategy(strategy)}
                          data-testid={`button-edit-strategy-${strategy.id}`}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteStrategyMutation.mutate(strategy.id)}
                          data-testid={`button-delete-strategy-${strategy.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={isCreateDialogOpen} onOpenChange={(open) => { setIsCreateDialogOpen(open); if (!open) { setEditingStrategy(null); resetForm(); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingStrategy ? "Edit Strategy" : "Add Strategy"}</DialogTitle>
            <DialogDescription>
              {editingStrategy ? "Update strategy details" : "Add a new strategy to your library"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name *</Label>
                <Input
                  placeholder="Strategy name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  data-testid="input-strategy-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Ticker</Label>
                <Input
                  placeholder="Optional ticker"
                  value={form.ticker}
                  onChange={(e) => setForm({ ...form, ticker: e.target.value })}
                  data-testid="input-strategy-ticker"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Strategy Type</Label>
                <Select value={form.strategyType} onValueChange={(v) => setForm({ ...form, strategyType: v })}>
                  <SelectTrigger data-testid="select-strategy-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {strategyTypes.map((st) => (
                      <SelectItem key={st} value={st}>{st}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Asset Class</Label>
                <Select 
                  value={form.assetClass} 
                  onValueChange={(v) => {
                    const params = defaultAssetParams[v];
                    setForm({ 
                      ...form, 
                      assetClass: v,
                      expectedReturn: params?.expectedReturn || form.expectedReturn,
                      volatility: params?.volatility || form.volatility,
                    });
                  }}
                >
                  <SelectTrigger data-testid="select-asset-class">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {assetClasses.map((ac) => (
                      <SelectItem key={ac} value={ac}>{ac}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Expected Return</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.10"
                  value={form.expectedReturn}
                  onChange={(e) => setForm({ ...form, expectedReturn: e.target.value })}
                  data-testid="input-expected-return"
                />
              </div>
              <div className="space-y-2">
                <Label>Volatility</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.16"
                  value={form.volatility}
                  onChange={(e) => setForm({ ...form, volatility: e.target.value })}
                  data-testid="input-volatility"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                placeholder="Optional description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                data-testid="input-description"
              />
            </div>
            <div className="space-y-2">
              <Label>Attach Document (PDF, Excel, CSV, Word)</Label>
              <p className="text-xs text-muted-foreground">
                {editingStrategy ? "Upload a new document to replace the existing file." : "Upload a document to auto-populate strategy details."}
              </p>
              <div className="flex items-center gap-2">
                <Input
                  type="file"
                  accept=".pdf,.xlsx,.xls,.csv,.doc,.docx"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    setSelectedFile(file);
                    // Auto-extract info when adding new strategy (not editing)
                    if (file && !editingStrategy) {
                      extractInfoFromFile(file);
                    }
                  }}
                  className="flex-1"
                  disabled={isExtracting}
                  data-testid="input-strategy-file"
                />
                {selectedFile && !isExtracting && (
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => setSelectedFile(null)}
                    data-testid="button-clear-file"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
                {isExtracting && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
              {isExtracting && (
                <p className="text-xs text-primary flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Analyzing document and extracting strategy details...
                </p>
              )}
              {selectedFile && !isExtracting && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                  </p>
                  {extractedReturns.length > 0 && (
                    <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                      <History className="h-3 w-3" />
                      {extractedReturns.length} historical return records found (volatility calculated from data)
                    </p>
                  )}
                </div>
              )}
              {editingStrategy?.sourceFile && !selectedFile && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FileUp className="h-3 w-3" />
                  <span>Current file: {editingStrategy.sourceFile.replace(/^\d+_/, "")}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => window.open(`/api/strategies/${editingStrategy.id}/file`, "_blank")}
                    data-testid="button-download-file"
                  >
                    Download
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-destructive"
                    onClick={() => deleteFileMutation.mutate(editingStrategy.id)}
                    data-testid="button-remove-file"
                  >
                    Remove
                  </Button>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>Cancel</Button>
            <Button 
              onClick={handleSaveStrategy} 
              disabled={createStrategyMutation.isPending || updateStrategyMutation.isPending || isExtracting}
              data-testid="button-save-strategy"
            >
              {createStrategyMutation.isPending || updateStrategyMutation.isPending ? "Saving..." : editingStrategy ? "Update" : "Add Strategy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isBulkDialogOpen} onOpenChange={setIsBulkDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Bulk Import Strategies</DialogTitle>
            <DialogDescription>
              Enter strategies in CSV format: Name, Ticker, Asset Class, Strategy Type (one per line)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 bg-muted rounded-md">
              <p className="text-sm font-medium mb-2">Example format:</p>
              <code className="text-xs block">
                Vanguard Total Stock Market,VTI,US Equity,ETF<br />
                Bridgewater All Weather,,Alternatives,Hedge Fund<br />
                Private Credit Fund I,,Fixed Income,Private Equity
              </code>
            </div>
            <Textarea
              placeholder="Paste your strategies here..."
              value={bulkInput}
              onChange={(e) => setBulkInput(e.target.value)}
              className="min-h-[200px] font-mono text-sm"
              data-testid="textarea-bulk-import"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkDialogOpen(false)}>Cancel</Button>
            <Button 
              onClick={handleBulkImport} 
              disabled={importStrategiesMutation.isPending}
              data-testid="button-confirm-bulk-import"
            >
              {importStrategiesMutation.isPending ? "Importing..." : "Import Strategies"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isReturnsDialogOpen} onOpenChange={(open) => { setIsReturnsDialogOpen(open); if (!open) setSelectedStrategyForReturns(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Historical Returns - {selectedStrategyForReturns?.name}
            </DialogTitle>
            <DialogDescription>
              Import historical daily/monthly returns for more accurate backtesting. Returns will be used via bootstrap sampling in Monte Carlo simulations.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {returnsData && returnsData.count > 0 && (
              <div className="p-3 bg-muted rounded-md">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    <span className="font-medium">{returnsData.count} return records</span>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => selectedStrategyForReturns && deleteReturnsMutation.mutate(selectedStrategyForReturns.id)}
                    disabled={deleteReturnsMutation.isPending}
                    data-testid="button-delete-returns"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Clear All
                  </Button>
                </div>
                {returnsData.returns.length > 0 && (
                  <div className="mt-3 max-h-32 overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead className="text-right">Return</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {returnsData.returns.slice(0, 10).map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="text-sm">{new Date(r.date).toLocaleDateString()}</TableCell>
                            <TableCell className="text-right text-sm">
                              <span className={parseFloat(r.returnValue) >= 0 ? "text-green-500" : "text-red-500"}>
                                {(parseFloat(r.returnValue) * 100).toFixed(2)}%
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                        {returnsData.returns.length > 10 && (
                          <TableRow>
                            <TableCell colSpan={2} className="text-center text-muted-foreground text-sm">
                              ... and {returnsData.returns.length - 10} more
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}
            
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <FileUp className="h-4 w-4" />
                  Upload File (CSV, Excel, or PDF)
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="file"
                    accept=".csv,.xlsx,.xls,.pdf"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file && selectedStrategyForReturns) {
                        uploadReturnsMutation.mutate({ strategyId: selectedStrategyForReturns.id, file });
                        e.target.value = "";
                      }
                    }}
                    disabled={uploadReturnsMutation.isPending}
                    data-testid="input-upload-returns-file"
                  />
                  {uploadReturnsMutation.isPending && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  CSV/Excel: Date and Return columns. PDF: Date and return values on same line.
                </p>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">Or paste data</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Paste Returns (CSV format)</Label>
                <div className="p-3 bg-muted/50 rounded-md text-xs">
                  <p className="font-medium mb-1">Format: Date, Return (decimal)</p>
                  <code className="block text-muted-foreground">
                    2024-01-02, 0.0125<br />
                    2024-01-03, -0.0034<br />
                    2024-01-04, 0.0078
                  </code>
                </div>
                <Textarea
                  placeholder="Paste return data here (one per line: date, return)..."
                  value={returnsInput}
                  onChange={(e) => setReturnsInput(e.target.value)}
                  className="min-h-[120px] font-mono text-sm"
                  data-testid="textarea-returns-import"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsReturnsDialogOpen(false)}>Close</Button>
            <Button 
              onClick={handleImportReturns} 
              disabled={importReturnsMutation.isPending || !returnsInput.trim()}
              data-testid="button-import-returns"
            >
              {importReturnsMutation.isPending ? "Importing..." : "Import Pasted Data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
