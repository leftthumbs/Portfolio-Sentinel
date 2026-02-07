import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { ArrowLeft, Plus, Trash2, Loader2, Building2 } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Portfolio, Holding } from "@shared/schema";

const ASSET_CLASSES = ["Equity", "Fixed Income", "Real Estate", "Alternatives", "Cash"];

function formatCurrency(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(0)}K`;
  return `$${num.toFixed(0)}`;
}

export default function PortfolioManagePage() {
  const { toast } = useToast();
  const [, params] = useRoute("/portfolio/:id/manage");
  const portfolioId = params?.id;

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [fundName, setFundName] = useState("");
  const [ticker, setTicker] = useState("");
  const [assetClass, setAssetClass] = useState("Equity");
  const [marketValue, setMarketValue] = useState("");
  const [costBasis, setCostBasis] = useState("");

  const { data: portfolio, isLoading: portfolioLoading } = useQuery<Portfolio>({
    queryKey: ["/api/portfolios", portfolioId],
    queryFn: async () => {
      const res = await fetch(`/api/portfolios`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch portfolios");
      const portfolios = await res.json();
      return portfolios.find((p: Portfolio) => p.id === portfolioId);
    },
    enabled: !!portfolioId,
  });

  const { data: holdings, isLoading: holdingsLoading } = useQuery<Holding[]>({
    queryKey: ["/api/portfolios", portfolioId, "holdings"],
    queryFn: async () => {
      const res = await fetch(`/api/portfolios/${portfolioId}/holdings`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch holdings");
      return res.json();
    },
    enabled: !!portfolioId,
  });

  const addHoldingMutation = useMutation({
    mutationFn: async (data: { fundName: string; ticker: string; assetClass: string; marketValue: string; costBasis: string }) => {
      return apiRequest("POST", `/api/portfolios/${portfolioId}/holdings`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolios", portfolioId, "holdings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolios"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({
        title: "Investment added",
        description: `"${fundName}" has been added to the portfolio`,
      });
      setAddDialogOpen(false);
      resetForm();
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Failed to add investment",
        description: error.message,
      });
    },
  });

  const deleteHoldingMutation = useMutation({
    mutationFn: async (holdingId: string) => {
      return apiRequest("DELETE", `/api/portfolios/${portfolioId}/holdings/${holdingId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolios", portfolioId, "holdings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolios"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({
        title: "Investment removed",
        description: "The investment has been removed from the portfolio",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Failed to remove investment",
        description: error.message,
      });
    },
  });

  const resetForm = () => {
    setFundName("");
    setTicker("");
    setAssetClass("Equity");
    setMarketValue("");
    setCostBasis("");
  };

  const handleAddHolding = () => {
    if (!fundName.trim()) {
      toast({
        variant: "destructive",
        title: "Name required",
        description: "Please enter a fund/investment name",
      });
      return;
    }
    if (!marketValue || parseFloat(marketValue) <= 0) {
      toast({
        variant: "destructive",
        title: "Value required",
        description: "Please enter a valid market value",
      });
      return;
    }
    addHoldingMutation.mutate({
      fundName,
      ticker,
      assetClass,
      marketValue,
      costBasis: costBasis || marketValue,
    });
  };

  const isLoading = portfolioLoading || holdingsLoading;
  const totalValue = holdings?.reduce((sum, h) => sum + parseFloat(h.marketValue), 0) || 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!portfolio) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/import">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">Portfolio Not Found</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <Link href="/import">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight" data-testid="text-portfolio-name">
              {portfolio.name}
            </h1>
            <p className="text-muted-foreground mt-1">
              {portfolio.description || "Manage investments in this portfolio"}
            </p>
          </div>
        </div>
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-investment">
              <Plus className="h-4 w-4 mr-2" />
              Add Investment
            </Button>
          </DialogTrigger>
          <DialogContent data-testid="dialog-add-investment">
            <DialogHeader>
              <DialogTitle>Add Investment</DialogTitle>
              <DialogDescription>
                Add a new investment to this portfolio
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="fund-name">Fund/Investment Name</Label>
                <Input
                  id="fund-name"
                  placeholder="e.g., Vanguard S&P 500 ETF"
                  value={fundName}
                  onChange={(e) => setFundName(e.target.value)}
                  data-testid="input-fund-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ticker">Ticker Symbol (optional)</Label>
                <Input
                  id="ticker"
                  placeholder="e.g., VOO"
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value)}
                  data-testid="input-ticker"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="asset-class">Asset Class</Label>
                <Select value={assetClass} onValueChange={setAssetClass}>
                  <SelectTrigger id="asset-class" data-testid="select-asset-class">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSET_CLASSES.map((ac) => (
                      <SelectItem key={ac} value={ac}>
                        {ac}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="market-value">Market Value ($)</Label>
                  <Input
                    id="market-value"
                    type="number"
                    placeholder="100000"
                    value={marketValue}
                    onChange={(e) => setMarketValue(e.target.value)}
                    data-testid="input-market-value"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cost-basis">Cost Basis ($)</Label>
                  <Input
                    id="cost-basis"
                    type="number"
                    placeholder="90000"
                    value={costBasis}
                    onChange={(e) => setCostBasis(e.target.value)}
                    data-testid="input-cost-basis"
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setAddDialogOpen(false)}
                data-testid="button-cancel-add"
              >
                Cancel
              </Button>
              <Button
                onClick={handleAddHolding}
                disabled={addHoldingMutation.isPending}
                data-testid="button-confirm-add"
              >
                {addHoldingMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Adding...
                  </>
                ) : (
                  "Add Investment"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Value</CardDescription>
            <CardTitle className="text-2xl text-green-500" data-testid="text-total-value">
              {formatCurrency(totalValue)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Holdings</CardDescription>
            <CardTitle className="text-2xl" data-testid="text-holdings-count">
              {holdings?.length || 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Currency</CardDescription>
            <CardTitle className="text-2xl" data-testid="text-currency">
              {portfolio.currency}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card data-testid="card-holdings">
        <CardHeader>
          <CardTitle>Portfolio Holdings</CardTitle>
          <CardDescription>
            All investments in this portfolio
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!holdings || holdings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Building2 className="h-12 w-12 text-muted-foreground" />
              <p className="text-muted-foreground">
                No investments yet. Click "Add Investment" to get started.
              </p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fund Name</TableHead>
                    <TableHead>Ticker</TableHead>
                    <TableHead>Asset Class</TableHead>
                    <TableHead className="text-right">Market Value</TableHead>
                    <TableHead className="text-right">Allocation</TableHead>
                    <TableHead className="text-right">Gain/Loss</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {holdings.map((holding) => {
                    const gain = parseFloat(holding.unrealizedGain);
                    const gainPercent = parseFloat(holding.costBasis) > 0 
                      ? (gain / parseFloat(holding.costBasis)) * 100 
                      : 0;
                    return (
                      <TableRow key={holding.id} data-testid={`row-holding-${holding.id}`}>
                        <TableCell className="font-medium">{holding.fundName}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {holding.ticker || "—"}
                        </TableCell>
                        <TableCell>{holding.assetClass}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(holding.marketValue)}
                        </TableCell>
                        <TableCell className="text-right">
                          {parseFloat(holding.allocation).toFixed(1)}%
                        </TableCell>
                        <TableCell className={`text-right ${gain >= 0 ? "text-green-500" : "text-red-500"}`}>
                          {gain >= 0 ? "+" : ""}{formatCurrency(gain)} ({gainPercent.toFixed(1)}%)
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteHoldingMutation.mutate(holding.id)}
                            disabled={deleteHoldingMutation.isPending}
                            data-testid={`button-delete-${holding.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
