import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Upload, FileSpreadsheet, FileText, AlertTriangle, Check, X, Loader2, Plus, FolderPlus, Settings, Building2 } from "lucide-react";
import type { Portfolio } from "@shared/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

interface ParsedInvestment {
  fundName: string;
  ticker?: string;
  assetClass: string;
  marketValue: number;
  costBasis?: number;
  allocation?: number;
}

interface ParseResponse {
  investments: ParsedInvestment[];
  summary: {
    totalItems: number;
    totalValue: number;
    assetClasses: string[];
  };
}

const ASSET_CLASSES = ["Equity", "Fixed Income", "Real Estate", "Alternatives", "Cash"];

function formatCurrency(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export default function ImportPage() {
  const { toast } = useToast();
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedInvestment[] | null>(null);
  const [editableData, setEditableData] = useState<ParsedInvestment[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newPortfolioName, setNewPortfolioName] = useState("");
  const [newPortfolioDescription, setNewPortfolioDescription] = useState("");
  const [newPortfolioCurrency, setNewPortfolioCurrency] = useState("USD");

  const { data: portfolios } = useQuery<Portfolio[]>({
    queryKey: ["/api/portfolios"],
  });

  const createPortfolioMutation = useMutation({
    mutationFn: async (data: { name: string; description: string; currency: string }) => {
      return apiRequest("POST", "/api/portfolios", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolios"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({
        title: "Portfolio created",
        description: `"${newPortfolioName}" has been created successfully`,
      });
      setCreateDialogOpen(false);
      setNewPortfolioName("");
      setNewPortfolioDescription("");
      setNewPortfolioCurrency("USD");
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Failed to create portfolio",
        description: error.message,
      });
    },
  });

  const handleCreatePortfolio = () => {
    if (!newPortfolioName.trim()) {
      toast({
        variant: "destructive",
        title: "Name required",
        description: "Please enter a portfolio name",
      });
      return;
    }
    createPortfolioMutation.mutate({
      name: newPortfolioName,
      description: newPortfolioDescription,
      currency: newPortfolioCurrency,
    });
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
      return response.json() as Promise<ParseResponse>;
    },
    onSuccess: (data) => {
      setParsedData(data.investments);
      setEditableData(data.investments);
      toast({
        title: "File parsed successfully",
        description: `Found ${data.summary.totalItems} investments worth ${formatCurrency(data.summary.totalValue)}`,
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Parse failed",
        description: error.message,
      });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async (investments: ParsedInvestment[]) => {
      return apiRequest("POST", "/api/import/confirm", { investments });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({
        title: "Import successful",
        description: `${editableData.length} investments have been added to your portfolio`,
      });
      setFile(null);
      setParsedData(null);
      setEditableData([]);
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Import failed",
        description: error.message,
      });
    },
  });

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      setFile(droppedFile);
      parseMutation.mutate(droppedFile);
    }
  }, [parseMutation]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      parseMutation.mutate(selectedFile);
    }
  }, [parseMutation]);

  const updateInvestment = (index: number, field: keyof ParsedInvestment, value: string | number) => {
    setEditableData(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const removeInvestment = (index: number) => {
    setEditableData(prev => prev.filter((_, i) => i !== index));
  };

  const resetImport = () => {
    setFile(null);
    setParsedData(null);
    setEditableData([]);
  };

  const totalValue = editableData.reduce((sum, inv) => sum + inv.marketValue, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Import Investments</h1>
          <p className="text-muted-foreground mt-1">
            Upload PDF or Excel files containing investment line items
          </p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-portfolio">
              <FolderPlus className="h-4 w-4 mr-2" />
              Create Portfolio
            </Button>
          </DialogTrigger>
          <DialogContent data-testid="dialog-create-portfolio">
            <DialogHeader>
              <DialogTitle>Create New Portfolio</DialogTitle>
              <DialogDescription>
                Create an empty portfolio that you can add investments to later
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="portfolio-name">Portfolio Name</Label>
                <Input
                  id="portfolio-name"
                  placeholder="e.g., Retirement Fund"
                  value={newPortfolioName}
                  onChange={(e) => setNewPortfolioName(e.target.value)}
                  data-testid="input-portfolio-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="portfolio-description">Description (optional)</Label>
                <Textarea
                  id="portfolio-description"
                  placeholder="Brief description of the portfolio"
                  value={newPortfolioDescription}
                  onChange={(e) => setNewPortfolioDescription(e.target.value)}
                  data-testid="input-portfolio-description"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="portfolio-currency">Currency</Label>
                <Select value={newPortfolioCurrency} onValueChange={setNewPortfolioCurrency}>
                  <SelectTrigger id="portfolio-currency" data-testid="select-portfolio-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD - US Dollar</SelectItem>
                    <SelectItem value="EUR">EUR - Euro</SelectItem>
                    <SelectItem value="GBP">GBP - British Pound</SelectItem>
                    <SelectItem value="CHF">CHF - Swiss Franc</SelectItem>
                    <SelectItem value="JPY">JPY - Japanese Yen</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
                data-testid="button-cancel-create"
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreatePortfolio}
                disabled={createPortfolioMutation.isPending}
                data-testid="button-confirm-create"
              >
                {createPortfolioMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Portfolio"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card data-testid="card-portfolios">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Your Portfolios
          </CardTitle>
          <CardDescription>
            Select a portfolio to manage its investments
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!portfolios || portfolios.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              No portfolios yet. Create one using the button above.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {portfolios.map((portfolio) => (
                <div
                  key={portfolio.id}
                  className="flex items-center justify-between p-4 rounded-lg border hover-elevate"
                  data-testid={`portfolio-card-${portfolio.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{portfolio.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatCurrency(parseFloat(portfolio.totalValue))} · {portfolio.currency}
                    </p>
                  </div>
                  <Link href={`/portfolio/${portfolio.id}/manage`}>
                    <Button variant="outline" size="sm" data-testid={`button-manage-${portfolio.id}`}>
                      <Settings className="h-4 w-4 mr-1" />
                      Manage
                    </Button>
                  </Link>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {!parsedData ? (
        <Card data-testid="card-upload-zone">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Upload File
            </CardTitle>
            <CardDescription>
              Supported formats: PDF statements, Excel spreadsheets (.xlsx, .xls), CSV files
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary/50"
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              data-testid="dropzone"
            >
              {parseMutation.isPending ? (
                <div className="flex flex-col items-center gap-4">
                  <Loader2 className="h-12 w-12 text-primary animate-spin" />
                  <p className="text-lg font-medium">Parsing file...</p>
                  <p className="text-sm text-muted-foreground">
                    Extracting investment data from your file
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex justify-center gap-4 mb-4">
                    <FileSpreadsheet className="h-12 w-12 text-muted-foreground" />
                    <FileText className="h-12 w-12 text-muted-foreground" />
                  </div>
                  <p className="text-lg font-medium mb-2">
                    Drag and drop your file here
                  </p>
                  <p className="text-sm text-muted-foreground mb-4">
                    or click to browse
                  </p>
                  <Input
                    type="file"
                    accept=".pdf,.xlsx,.xls,.csv"
                    className="hidden"
                    id="file-upload"
                    onChange={handleFileSelect}
                    data-testid="input-file-upload"
                  />
                  <label htmlFor="file-upload">
                    <Button variant="outline" asChild>
                      <span data-testid="button-browse-files">Browse Files</span>
                    </Button>
                  </label>
                </>
              )}
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50">
                <FileSpreadsheet className="h-8 w-8 text-green-500 flex-shrink-0" />
                <div>
                  <p className="font-medium text-sm">Excel Files</p>
                  <p className="text-xs text-muted-foreground">
                    .xlsx, .xls with columns for fund name, value, asset class
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50">
                <FileText className="h-8 w-8 text-red-500 flex-shrink-0" />
                <div>
                  <p className="font-medium text-sm">PDF Statements</p>
                  <p className="text-xs text-muted-foreground">
                    Brokerage statements, fund reports with holdings
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50">
                <FileSpreadsheet className="h-8 w-8 text-blue-500 flex-shrink-0" />
                <div>
                  <p className="font-medium text-sm">CSV Files</p>
                  <p className="text-xs text-muted-foreground">
                    Comma-separated values exported from other systems
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card data-testid="card-file-info">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Check className="h-5 w-5 text-green-500" />
                  File Parsed Successfully
                </CardTitle>
                <CardDescription>{file?.name}</CardDescription>
              </div>
              <Button variant="outline" onClick={resetImport} data-testid="button-reset">
                Upload Different File
              </Button>
            </CardHeader>
          </Card>

          <Card data-testid="card-import-summary">
            <CardHeader>
              <CardTitle>Import Summary</CardTitle>
              <CardDescription>
                Review and edit the extracted investments before importing
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 mb-6">
                <div className="flex-1 p-4 rounded-lg bg-muted/50 text-center">
                  <p className="text-2xl font-bold" data-testid="text-total-items">
                    {editableData.length}
                  </p>
                  <p className="text-sm text-muted-foreground">Investments</p>
                </div>
                <div className="flex-1 p-4 rounded-lg bg-muted/50 text-center">
                  <p className="text-2xl font-bold text-green-500" data-testid="text-total-value">
                    {formatCurrency(totalValue)}
                  </p>
                  <p className="text-sm text-muted-foreground">Total Value</p>
                </div>
                <div className="flex-1 p-4 rounded-lg bg-muted/50 text-center">
                  <p className="text-2xl font-bold" data-testid="text-asset-classes">
                    {new Set(editableData.map(d => d.assetClass)).size}
                  </p>
                  <p className="text-sm text-muted-foreground">Asset Classes</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-investments-preview">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle>Investment Line Items</CardTitle>
                <CardDescription>
                  Edit fund names, asset classes, or remove items before importing
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={resetImport}
                  data-testid="button-cancel-import"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => confirmMutation.mutate(editableData)}
                  disabled={editableData.length === 0 || confirmMutation.isPending}
                  data-testid="button-confirm-import"
                >
                  {confirmMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>Import {editableData.length} Investments</>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {editableData.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-4">
                  <AlertTriangle className="h-12 w-12 text-muted-foreground" />
                  <p className="text-muted-foreground">
                    All investments have been removed
                  </p>
                  <Button variant="outline" onClick={resetImport}>
                    Start Over
                  </Button>
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
                        <TableHead className="text-right">Cost Basis</TableHead>
                        <TableHead className="w-[50px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {editableData.map((inv, index) => (
                        <TableRow key={index} data-testid={`row-investment-${index}`}>
                          <TableCell>
                            <Input
                              value={inv.fundName}
                              onChange={(e) =>
                                updateInvestment(index, "fundName", e.target.value)
                              }
                              className="h-8"
                              data-testid={`input-fund-name-${index}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={inv.ticker || ""}
                              onChange={(e) =>
                                updateInvestment(index, "ticker", e.target.value)
                              }
                              className="h-8 w-24"
                              placeholder="—"
                              data-testid={`input-ticker-${index}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              value={inv.assetClass}
                              onValueChange={(value) =>
                                updateInvestment(index, "assetClass", value)
                              }
                            >
                              <SelectTrigger
                                className="h-8 w-[140px]"
                                data-testid={`select-asset-class-${index}`}
                              >
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
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              value={inv.marketValue}
                              onChange={(e) =>
                                updateInvestment(
                                  index,
                                  "marketValue",
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              className="h-8 w-32 text-right"
                              data-testid={`input-market-value-${index}`}
                            />
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {inv.costBasis ? formatCurrency(inv.costBasis) : "—"}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeInvestment(index)}
                              className="h-8 w-8"
                              data-testid={`button-remove-${index}`}
                            >
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
        </>
      )}
    </div>
  );
}
