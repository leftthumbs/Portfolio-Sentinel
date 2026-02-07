import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { TrendingUp, DollarSign, Clock, Shield, Percent, AlertTriangle, BarChart3, Target, Upload, FileText, ArrowUpDown, Search, Folder, Loader2, CheckCircle, X, Plus, FolderOpen, MoreHorizontal, Edit, Trash2, FolderInput, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

interface FundFolder {
  id: string;
  name: string;
  description: string | null;
  parentId: string | null;
  color: string | null;
  icon: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface Strategy {
  id: string;
  name: string;
  ticker: string | null;
  strategyType: string;
  assetClass: string;
  folderId: string | null;
  description: string | null;
  expectedReturn: string | null;
  volatility: string | null;
  managementFee: string | null;
  performanceFee: string | null;
  hurdleRate: string | null;
  highWaterMark: boolean | null;
  lockupPeriod: number | null;
  redemptionFrequency: string | null;
  redemptionNotice: number | null;
  gateProvision: string | null;
  fundAum: string | null;
  inceptionDate: string | null;
  fundManager: string | null;
  fundDomicile: string | null;
  targetYield: string | null;
  currentYield: string | null;
  yieldToMaturity: string | null;
  weightedAvgLife: string | null;
  loanToValue: string | null;
  seniorityLevel: string | null;
  defaultRate: string | null;
  recoveryRate: string | null;
  spreadOverBase: string | null;
  floatingRatePct: string | null;
  vintageYear: number | null;
  fundLifeYears: number | null;
  sharpeRatio: string | null;
  sortinoRatio: string | null;
  maxDrawdown: string | null;
  calmarRatio: string | null;
  beta: string | null;
  alpha: string | null;
  correlation: string | null;
  sourceFile: string | null;
  metadata: any;
}

const CHART_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];

type SortField = "name" | "strategyType" | "assetClass" | "expectedReturn" | "fundAum" | "inceptionDate";
type SortDirection = "asc" | "desc";

function FundUploadCard({ onUploadSuccess }: { onUploadSuccess: () => void }) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/funds/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to upload document");
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Fund Extracted Successfully",
        description: `${data.strategy.name} has been added to your fund inventory.`,
      });
      setUploadedFile(null);
      queryClient.invalidateQueries({ queryKey: ["/api/strategies"] });
      onUploadSuccess();
    },
    onError: (error: Error) => {
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
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
    const file = e.dataTransfer.files[0];
    if (file) {
      setUploadedFile(file);
      uploadMutation.mutate(file);
    }
  }, [uploadMutation]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedFile(file);
      uploadMutation.mutate(file);
    }
  };

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Upload className="h-4 w-4" />
          Upload Fund Documents
        </CardTitle>
        <CardDescription>
          Upload LPAs, marketing decks, or factsheets to automatically extract fund details
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25"
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          data-testid="fund-upload-dropzone"
        >
          {uploadMutation.isPending ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-10 w-10 text-primary animate-spin" />
              <div>
                <p className="font-medium">Analyzing Document...</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Extracting fund information using AI
                </p>
              </div>
            </div>
          ) : uploadMutation.isSuccess ? (
            <div className="flex flex-col items-center gap-3">
              <CheckCircle className="h-10 w-10 text-emerald-500" />
              <div>
                <p className="font-medium text-emerald-600">Fund Added Successfully</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {uploadMutation.data?.strategy?.name}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  uploadMutation.reset();
                  setUploadedFile(null);
                }}
                data-testid="button-upload-another"
              >
                Upload Another
              </Button>
            </div>
          ) : (
            <>
              <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium">Drop fund documents here</p>
              <p className="text-sm text-muted-foreground mt-1 mb-4">
                Supports PDF, Word, Excel, and CSV files
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.xls,.xlsx,.csv"
                className="hidden"
                onChange={handleFileSelect}
                data-testid="input-fund-file"
              />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                data-testid="button-select-fund-file"
              >
                <Upload className="h-4 w-4 mr-2" />
                Select File
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function FundInventoryTable({ 
  funds, 
  searchQuery, 
  sortField, 
  sortDirection,
  onSortChange,
  folders = [],
  onMoveFund
}: { 
  funds: Strategy[];
  searchQuery: string;
  sortField: SortField;
  sortDirection: SortDirection;
  onSortChange: (field: SortField) => void;
  folders?: FundFolder[];
  onMoveFund?: (fundId: string, folderId: string | null) => void;
}) {
  const filteredFunds = funds.filter(fund => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      fund.name.toLowerCase().includes(query) ||
      fund.strategyType.toLowerCase().includes(query) ||
      fund.assetClass.toLowerCase().includes(query) ||
      (fund.fundManager && fund.fundManager.toLowerCase().includes(query))
    );
  });

  const sortedFunds = [...filteredFunds].sort((a, b) => {
    let aVal: any, bVal: any;
    switch (sortField) {
      case "name":
        aVal = a.name.toLowerCase();
        bVal = b.name.toLowerCase();
        break;
      case "strategyType":
        aVal = a.strategyType.toLowerCase();
        bVal = b.strategyType.toLowerCase();
        break;
      case "assetClass":
        aVal = a.assetClass.toLowerCase();
        bVal = b.assetClass.toLowerCase();
        break;
      case "expectedReturn":
        aVal = parseFloat(a.expectedReturn || "0");
        bVal = parseFloat(b.expectedReturn || "0");
        break;
      case "fundAum":
        aVal = parseFloat(a.fundAum || "0");
        bVal = parseFloat(b.fundAum || "0");
        break;
      case "inceptionDate":
        aVal = a.inceptionDate ? new Date(a.inceptionDate).getTime() : 0;
        bVal = b.inceptionDate ? new Date(b.inceptionDate).getTime() : 0;
        break;
      default:
        aVal = a.name;
        bVal = b.name;
    }
    if (sortDirection === "asc") {
      return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    } else {
      return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
    }
  });

  const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
    <TableHead 
      className="cursor-pointer"
      onClick={() => onSortChange(field)}
      data-testid={`sort-header-${field}`}
    >
      <div className="flex items-center gap-1">
        {label}
        <ArrowUpDown className={`h-3 w-3 ${sortField === field ? "text-primary" : "text-muted-foreground"}`} />
      </div>
    </TableHead>
  );

  if (sortedFunds.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Folder className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium">No Funds Found</h3>
        <p className="text-sm text-muted-foreground mt-1">
          {searchQuery ? "No funds match your search criteria" : "Upload fund documents to start building your inventory"}
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortHeader field="name" label="Fund Name" />
          <SortHeader field="strategyType" label="Strategy" />
          <SortHeader field="assetClass" label="Asset Class" />
          <SortHeader field="expectedReturn" label="Expected Return" />
          <SortHeader field="fundAum" label="AUM" />
          <TableHead>Fees</TableHead>
          <SortHeader field="inceptionDate" label="Inception" />
          <TableHead>Source</TableHead>
          {onMoveFund && <TableHead className="w-[50px]">Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedFunds.map((fund) => (
          <TableRow key={fund.id} data-testid={`fund-row-${fund.id}`}>
            <TableCell className="font-medium">
              <div>
                {fund.name}
                {fund.ticker && (
                  <Badge variant="outline" className="ml-2 text-xs">{fund.ticker}</Badge>
                )}
              </div>
              {fund.fundManager && (
                <span className="text-xs text-muted-foreground">{fund.fundManager}</span>
              )}
            </TableCell>
            <TableCell>
              <Badge variant="secondary">{fund.strategyType}</Badge>
            </TableCell>
            <TableCell>{fund.assetClass}</TableCell>
            <TableCell className="text-emerald-600 font-medium">
              {formatPercent(fund.expectedReturn)}
            </TableCell>
            <TableCell>{formatCurrency(fund.fundAum)}</TableCell>
            <TableCell>
              {fund.managementFee || fund.performanceFee ? (
                <span className="text-sm">
                  {fund.managementFee ? `${(parseFloat(fund.managementFee) * 100).toFixed(1)}%` : "—"}
                  {" / "}
                  {fund.performanceFee ? `${(parseFloat(fund.performanceFee) * 100).toFixed(0)}%` : "—"}
                </span>
              ) : "—"}
            </TableCell>
            <TableCell>
              {fund.inceptionDate 
                ? new Date(fund.inceptionDate).getFullYear() 
                : fund.vintageYear || "—"}
            </TableCell>
            <TableCell>
              {fund.sourceFile ? (
                <Badge variant="outline" className="text-xs">
                  <FileText className="h-3 w-3 mr-1" />
                  Uploaded
                </Badge>
              ) : (
                <span className="text-xs text-muted-foreground">Manual</span>
              )}
            </TableCell>
            {onMoveFund && (
              <TableCell>
                <MoveToFolderMenu fund={fund} folders={folders} onMove={onMoveFund} />
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function FolderPanel({ 
  folders, 
  selectedFolderId, 
  onSelectFolder, 
  onCreateFolder,
  onEditFolder,
  onDeleteFolder,
  fundCounts
}: { 
  folders: FundFolder[];
  selectedFolderId: string | null;
  onSelectFolder: (id: string | null) => void;
  onCreateFolder: () => void;
  onEditFolder: (folder: FundFolder) => void;
  onDeleteFolder: (folder: FundFolder) => void;
  fundCounts: Record<string, number>;
}) {
  const unfiledCount = fundCounts["unfiled"] || 0;
  const allCount = Object.values(fundCounts).reduce((sum, c) => sum + c, 0);

  return (
    <Card className="h-fit">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">Folders</CardTitle>
          <Button 
            size="icon" 
            variant="ghost" 
            className="h-7 w-7"
            onClick={onCreateFolder}
            data-testid="button-create-folder"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="space-y-1">
          <button
            onClick={() => onSelectFolder(null)}
            className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
              selectedFolderId === null 
                ? "bg-primary text-primary-foreground" 
                : "hover-elevate"
            }`}
            data-testid="folder-all"
          >
            <div className="flex items-center gap-2">
              <Folder className="h-4 w-4" />
              <span>All Funds</span>
            </div>
            <Badge variant="secondary" className="text-xs">{allCount}</Badge>
          </button>

          <button
            onClick={() => onSelectFolder("unfiled")}
            className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
              selectedFolderId === "unfiled" 
                ? "bg-primary text-primary-foreground" 
                : "hover-elevate"
            }`}
            data-testid="folder-unfiled"
          >
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4" />
              <span>Unfiled</span>
            </div>
            <Badge variant="secondary" className="text-xs">{unfiledCount}</Badge>
          </button>

          {folders.length > 0 && (
            <div className="my-2 border-t" />
          )}

          {folders.map((folder) => (
            <div 
              key={folder.id} 
              className={`group flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                selectedFolderId === folder.id 
                  ? "bg-primary text-primary-foreground" 
                  : "hover-elevate"
              }`}
            >
              <button
                onClick={() => onSelectFolder(folder.id)}
                className="flex-1 flex items-center gap-2 text-left"
                data-testid={`folder-${folder.id}`}
              >
                <Folder className="h-4 w-4" style={{ color: folder.color || undefined }} />
                <span className="truncate">{folder.name}</span>
              </button>
              <div className="flex items-center gap-1">
                <Badge variant="secondary" className="text-xs">
                  {fundCounts[folder.id] || 0}
                </Badge>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button 
                      size="icon" 
                      variant="ghost" 
                      className="h-6 w-6 opacity-0 group-hover:opacity-100"
                      data-testid={`folder-menu-${folder.id}`}
                    >
                      <MoreHorizontal className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onEditFolder(folder)} data-testid={`edit-folder-${folder.id}`}>
                      <Edit className="h-4 w-4 mr-2" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem 
                      onClick={() => onDeleteFolder(folder)} 
                      className="text-destructive"
                      data-testid={`delete-folder-${folder.id}`}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function FolderDialog({
  open,
  onOpenChange,
  folder,
  onSave
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folder: FundFolder | null;
  onSave: (name: string, color: string | null) => void;
}) {
  const [name, setName] = useState(folder?.name || "");
  const [color, setColor] = useState(folder?.color || "");

  const handleSave = () => {
    if (name.trim()) {
      onSave(name.trim(), color || null);
      setName("");
      setColor("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{folder ? "Rename Folder" : "Create Folder"}</DialogTitle>
          <DialogDescription>
            {folder ? "Update the folder name" : "Create a new folder to organize your fund documents"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="folder-name">Folder Name</Label>
            <Input
              id="folder-name"
              placeholder="e.g., Q1 2026 Due Diligence"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-folder-name"
            />
          </div>
          <div className="space-y-2">
            <Label>Color (optional)</Label>
            <div className="flex gap-2">
              {["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"].map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full border-2 ${color === c ? "border-foreground" : "border-transparent"}`}
                  style={{ backgroundColor: c }}
                  data-testid={`color-${c}`}
                />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-folder">Cancel</Button>
          <Button onClick={handleSave} disabled={!name.trim()} data-testid="button-save-folder">
            {folder ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MoveToFolderMenu({ 
  fund, 
  folders, 
  onMove 
}: { 
  fund: Strategy; 
  folders: FundFolder[];
  onMove: (fundId: string, folderId: string | null) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="h-7 w-7" data-testid={`move-fund-${fund.id}`}>
          <FolderInput className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem 
          onClick={() => onMove(fund.id, null)}
          disabled={fund.folderId === null}
          data-testid={`move-fund-${fund.id}-unfiled`}
        >
          <FolderOpen className="h-4 w-4 mr-2" />
          Unfiled
        </DropdownMenuItem>
        {folders.length > 0 && <DropdownMenuSeparator />}
        {folders.map((folder) => (
          <DropdownMenuItem 
            key={folder.id}
            onClick={() => onMove(fund.id, folder.id)}
            disabled={fund.folderId === folder.id}
            data-testid={`move-fund-${fund.id}-folder-${folder.id}`}
          >
            <Folder className="h-4 w-4 mr-2" style={{ color: folder.color || undefined }} />
            {folder.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function formatPercent(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "—";
  return `${(num * 100).toFixed(2)}%`;
}

function formatCurrency(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "—";
  if (num >= 1e9) return `$${(num / 1e9).toFixed(1)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(1)}M`;
  return `$${num.toLocaleString()}`;
}

function formatNumber(value: string | number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "—";
  return num.toFixed(decimals);
}

function HedgeFundCard({ fund }: { fund: Strategy }) {
  const radarData = [
    { metric: "Sharpe", value: Math.min(3, Math.max(0, parseFloat(fund.sharpeRatio || "0"))), fullMark: 3 },
    { metric: "Sortino", value: Math.min(3, Math.max(0, parseFloat(fund.sortinoRatio || "0"))), fullMark: 3 },
    { metric: "Calmar", value: Math.min(3, Math.max(0, parseFloat(fund.calmarRatio || "0"))), fullMark: 3 },
    { metric: "Alpha", value: Math.min(0.2, Math.max(0, parseFloat(fund.alpha || "0") + 0.1)), fullMark: 0.2 },
    { metric: "Low Vol", value: Math.min(1, Math.max(0, 1 - parseFloat(fund.volatility || "0.15"))), fullMark: 1 },
  ];

  return (
    <Card data-testid={`card-hedge-fund-${fund.id}`}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-base font-medium">{fund.name}</CardTitle>
            <CardDescription>{fund.strategyType} • {fund.assetClass}</CardDescription>
          </div>
          <Badge variant="outline">{fund.fundDomicile || "N/A"}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="p-3 border rounded-lg">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <DollarSign className="h-3 w-3" />
              Fund AUM
            </div>
            <div className="text-lg font-semibold">{formatCurrency(fund.fundAum)}</div>
          </div>
          <div className="p-3 border rounded-lg">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <TrendingUp className="h-3 w-3" />
              Expected Return
            </div>
            <div className="text-lg font-semibold text-emerald-500">{formatPercent(fund.expectedReturn)}</div>
          </div>
          <div className="p-3 border rounded-lg">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <BarChart3 className="h-3 w-3" />
              Volatility
            </div>
            <div className="text-lg font-semibold">{formatPercent(fund.volatility)}</div>
          </div>
          <div className="p-3 border rounded-lg">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <AlertTriangle className="h-3 w-3" />
              Max Drawdown
            </div>
            <div className="text-lg font-semibold text-red-500">{formatPercent(fund.maxDrawdown)}</div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h4 className="text-sm font-medium mb-3">Fee Structure</h4>
            <div className="space-y-2">
              <div className="flex justify-between py-1 border-b">
                <span className="text-sm text-muted-foreground">Management Fee</span>
                <span className="text-sm font-medium">{formatPercent(fund.managementFee)}</span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-sm text-muted-foreground">Performance Fee</span>
                <span className="text-sm font-medium">{formatPercent(fund.performanceFee)}</span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-sm text-muted-foreground">Hurdle Rate</span>
                <span className="text-sm font-medium">{formatPercent(fund.hurdleRate)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-sm text-muted-foreground">High Water Mark</span>
                <span className="text-sm font-medium">{fund.highWaterMark ? "Yes" : "No"}</span>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-medium mb-3">Liquidity Terms</h4>
            <div className="space-y-2">
              <div className="flex justify-between py-1 border-b">
                <span className="text-sm text-muted-foreground">Lock-up Period</span>
                <span className="text-sm font-medium">{fund.lockupPeriod ? `${fund.lockupPeriod} months` : "—"}</span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-sm text-muted-foreground">Redemption Frequency</span>
                <span className="text-sm font-medium">{fund.redemptionFrequency || "—"}</span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-sm text-muted-foreground">Notice Period</span>
                <span className="text-sm font-medium">{fund.redemptionNotice ? `${fund.redemptionNotice} days` : "—"}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-sm text-muted-foreground">Gate Provision</span>
                <span className="text-sm font-medium">{formatPercent(fund.gateProvision)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h4 className="text-sm font-medium mb-3">Risk-Adjusted Performance</h4>
            <ResponsiveContainer width="100%" height={200}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="hsl(var(--border))" />
                <PolarAngleAxis dataKey="metric" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                <PolarRadiusAxis tick={false} axisLine={false} />
                <Radar
                  dataKey="value"
                  stroke="hsl(var(--chart-1))"
                  fill="hsl(var(--chart-1))"
                  fillOpacity={0.3}
                  strokeWidth={2}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          <div>
            <h4 className="text-sm font-medium mb-3">Performance Metrics</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-2 border rounded text-center">
                <div className="text-xs text-muted-foreground">Sharpe</div>
                <div className="text-lg font-semibold">{formatNumber(fund.sharpeRatio)}</div>
              </div>
              <div className="p-2 border rounded text-center">
                <div className="text-xs text-muted-foreground">Sortino</div>
                <div className="text-lg font-semibold">{formatNumber(fund.sortinoRatio)}</div>
              </div>
              <div className="p-2 border rounded text-center">
                <div className="text-xs text-muted-foreground">Beta</div>
                <div className="text-lg font-semibold">{formatNumber(fund.beta)}</div>
              </div>
              <div className="p-2 border rounded text-center">
                <div className="text-xs text-muted-foreground">Alpha</div>
                <div className="text-lg font-semibold">{formatPercent(fund.alpha)}</div>
              </div>
            </div>
          </div>
        </div>

        {fund.fundManager && (
          <div className="text-sm text-muted-foreground">
            <span className="font-medium">Manager:</span> {fund.fundManager}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PrivateCreditCard({ fund }: { fund: Strategy }) {
  const yieldBreakdown = [
    { name: "Base Rate", value: 0.05 },
    { name: "Credit Spread", value: parseFloat(fund.spreadOverBase || "0") },
  ];

  return (
    <Card data-testid={`card-private-credit-${fund.id}`}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-base font-medium">{fund.name}</CardTitle>
            <CardDescription>{fund.strategyType} • {fund.seniorityLevel || fund.assetClass}</CardDescription>
          </div>
          <div className="flex gap-2">
            {fund.vintageYear && <Badge variant="outline">Vintage {fund.vintageYear}</Badge>}
            <Badge variant="secondary">{fund.floatingRatePct ? `${(parseFloat(fund.floatingRatePct) * 100).toFixed(0)}% Floating` : "Fixed"}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="p-3 border rounded-lg">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Target className="h-3 w-3" />
              Target Yield
            </div>
            <div className="text-lg font-semibold text-emerald-500">{formatPercent(fund.targetYield)}</div>
          </div>
          <div className="p-3 border rounded-lg">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Percent className="h-3 w-3" />
              Current Yield
            </div>
            <div className="text-lg font-semibold">{formatPercent(fund.currentYield)}</div>
          </div>
          <div className="p-3 border rounded-lg">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Clock className="h-3 w-3" />
              WAL (Years)
            </div>
            <div className="text-lg font-semibold">{formatNumber(fund.weightedAvgLife, 1)}</div>
          </div>
          <div className="p-3 border rounded-lg">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Shield className="h-3 w-3" />
              LTV
            </div>
            <div className="text-lg font-semibold">{formatPercent(fund.loanToValue)}</div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h4 className="text-sm font-medium mb-3">Yield Components</h4>
            <div className="space-y-2">
              <div className="flex justify-between py-1 border-b">
                <span className="text-sm text-muted-foreground">Yield to Maturity</span>
                <span className="text-sm font-medium">{formatPercent(fund.yieldToMaturity)}</span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-sm text-muted-foreground">Spread Over Base</span>
                <span className="text-sm font-medium">+{formatPercent(fund.spreadOverBase)}</span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-sm text-muted-foreground">Floating Rate %</span>
                <span className="text-sm font-medium">{formatPercent(fund.floatingRatePct)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-sm text-muted-foreground">Expected Return</span>
                <span className="text-sm font-medium text-emerald-500">{formatPercent(fund.expectedReturn)}</span>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-medium mb-3">Credit Risk Metrics</h4>
            <div className="space-y-2">
              <div className="flex justify-between py-1 border-b">
                <span className="text-sm text-muted-foreground">Default Rate</span>
                <span className="text-sm font-medium text-red-500">{formatPercent(fund.defaultRate)}</span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-sm text-muted-foreground">Recovery Rate</span>
                <span className="text-sm font-medium text-emerald-500">{formatPercent(fund.recoveryRate)}</span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-sm text-muted-foreground">Expected Loss</span>
                <span className="text-sm font-medium">
                  {fund.defaultRate && fund.recoveryRate 
                    ? formatPercent(parseFloat(fund.defaultRate) * (1 - parseFloat(fund.recoveryRate)))
                    : "—"}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-sm text-muted-foreground">Seniority Level</span>
                <span className="text-sm font-medium">{fund.seniorityLevel || "—"}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h4 className="text-sm font-medium mb-3">Fund Terms</h4>
            <div className="space-y-2">
              <div className="flex justify-between py-1 border-b">
                <span className="text-sm text-muted-foreground">Fund Life</span>
                <span className="text-sm font-medium">{fund.fundLifeYears ? `${fund.fundLifeYears} years` : "—"}</span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-sm text-muted-foreground">Management Fee</span>
                <span className="text-sm font-medium">{formatPercent(fund.managementFee)}</span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-sm text-muted-foreground">Performance Fee</span>
                <span className="text-sm font-medium">{formatPercent(fund.performanceFee)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-sm text-muted-foreground">Fund AUM</span>
                <span className="text-sm font-medium">{formatCurrency(fund.fundAum)}</span>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-medium mb-3">Risk Profile</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-2 border rounded text-center">
                <div className="text-xs text-muted-foreground">Volatility</div>
                <div className="text-lg font-semibold">{formatPercent(fund.volatility)}</div>
              </div>
              <div className="p-2 border rounded text-center">
                <div className="text-xs text-muted-foreground">Max DD</div>
                <div className="text-lg font-semibold text-red-500">{formatPercent(fund.maxDrawdown)}</div>
              </div>
              <div className="p-2 border rounded text-center">
                <div className="text-xs text-muted-foreground">Sharpe</div>
                <div className="text-lg font-semibold">{formatNumber(fund.sharpeRatio)}</div>
              </div>
              <div className="p-2 border rounded text-center">
                <div className="text-xs text-muted-foreground">Correlation</div>
                <div className="text-lg font-semibold">{formatNumber(fund.correlation)}</div>
              </div>
            </div>
          </div>
        </div>

        {fund.description && (
          <div className="text-sm text-muted-foreground">
            {fund.description}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function FundAnalysisPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("inventory");
  const [selectedFundId, setSelectedFundId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<FundFolder | null>(null);

  const { data, isLoading, refetch } = useQuery<{ strategies: Strategy[] }>({
    queryKey: ["/api/strategies"],
  });

  const { data: foldersData, refetch: refetchFolders } = useQuery<{ folders: FundFolder[] }>({
    queryKey: ["/api/folders"],
  });

  const strategies = data?.strategies || [];
  const folders = foldersData?.folders || [];

  const fundCounts: Record<string, number> = {};
  fundCounts["unfiled"] = strategies.filter(s => !s.folderId).length;
  folders.forEach(folder => {
    fundCounts[folder.id] = strategies.filter(s => s.folderId === folder.id).length;
  });

  const filteredByFolder = selectedFolderId === null 
    ? strategies 
    : selectedFolderId === "unfiled"
      ? strategies.filter(s => !s.folderId)
      : strategies.filter(s => s.folderId === selectedFolderId);

  const createFolderMutation = useMutation({
    mutationFn: async (data: { name: string; color: string | null }) => {
      return apiRequest("POST", "/api/folders", data);
    },
    onSuccess: () => {
      refetchFolders();
      toast({ title: "Folder created" });
    },
    onError: () => {
      toast({ title: "Failed to create folder", variant: "destructive" });
    },
  });

  const updateFolderMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name: string; color: string | null }) => {
      return apiRequest("PATCH", `/api/folders/${id}`, data);
    },
    onSuccess: () => {
      refetchFolders();
      toast({ title: "Folder updated" });
    },
    onError: () => {
      toast({ title: "Failed to update folder", variant: "destructive" });
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/folders/${id}`);
    },
    onSuccess: () => {
      refetchFolders();
      refetch();
      if (selectedFolderId !== null && selectedFolderId !== "unfiled") {
        setSelectedFolderId(null);
      }
      toast({ title: "Folder deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete folder", variant: "destructive" });
    },
  });

  const moveFundMutation = useMutation({
    mutationFn: async ({ fundId, folderId }: { fundId: string; folderId: string | null }) => {
      return apiRequest("PATCH", `/api/strategies/${fundId}/folder`, { folderId });
    },
    onSuccess: () => {
      refetch();
      toast({ title: "Fund moved" });
    },
    onError: () => {
      toast({ title: "Failed to move fund", variant: "destructive" });
    },
  });

  const handleSortChange = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const handleCreateFolder = () => {
    setEditingFolder(null);
    setFolderDialogOpen(true);
  };

  const handleEditFolder = (folder: FundFolder) => {
    setEditingFolder(folder);
    setFolderDialogOpen(true);
  };

  const handleDeleteFolder = (folder: FundFolder) => {
    if (confirm(`Delete folder "${folder.name}"? Funds in this folder will be moved to Unfiled.`)) {
      deleteFolderMutation.mutate(folder.id);
    }
  };

  const handleSaveFolder = (name: string, color: string | null) => {
    if (editingFolder) {
      updateFolderMutation.mutate({ id: editingFolder.id, name, color });
    } else {
      createFolderMutation.mutate({ name, color });
    }
    setFolderDialogOpen(false);
  };

  const handleMoveFund = (fundId: string, folderId: string | null) => {
    moveFundMutation.mutate({ fundId, folderId });
  };

  const hedgeFunds = strategies.filter(s => 
    ["Hedge Fund", "Long/Short Equity", "Macro Strategy", "Event Driven", "Distressed", "Multi-Strategy"].includes(s.strategyType)
  );

  const privateCreditFunds = strategies.filter(s => 
    ["Credit Strategy", "Private Credit", "Direct Lending", "Mezzanine", "Distressed Debt"].includes(s.strategyType) ||
    s.assetClass === "High Yield" || s.assetClass === "Fixed Income"
  );

  const allAlternatives = [...hedgeFunds, ...privateCreditFunds];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-10 w-48" />
        </div>
        <div className="grid gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-fund-analysis-title">
            Fund Analysis
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Specialized analytics for hedge funds and private credit
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="inventory" data-testid="tab-inventory">
            <Folder className="h-4 w-4 mr-1.5" />
            Fund Inventory ({strategies.length})
          </TabsTrigger>
          <TabsTrigger value="hedge-funds" data-testid="tab-hedge-funds">
            Hedge Funds ({hedgeFunds.length})
          </TabsTrigger>
          <TabsTrigger value="private-credit" data-testid="tab-private-credit">
            Private Credit ({privateCreditFunds.length})
          </TabsTrigger>
          <TabsTrigger value="comparison" data-testid="tab-comparison">
            Comparison
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inventory" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-4">
            <div className="lg:col-span-1 space-y-4">
              <FolderPanel
                folders={folders}
                selectedFolderId={selectedFolderId}
                onSelectFolder={setSelectedFolderId}
                onCreateFolder={handleCreateFolder}
                onEditFolder={handleEditFolder}
                onDeleteFolder={handleDeleteFolder}
                fundCounts={fundCounts}
              />
              <FundUploadCard onUploadSuccess={() => refetch()} />
            </div>
            <div className="lg:col-span-3">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                      <CardTitle className="text-base font-medium">
                        {selectedFolderId === null 
                          ? "All Funds" 
                          : selectedFolderId === "unfiled" 
                            ? "Unfiled Funds" 
                            : folders.find(f => f.id === selectedFolderId)?.name || "Funds"}
                      </CardTitle>
                      <CardDescription>
                        {filteredByFolder.length} fund{filteredByFolder.length !== 1 ? "s" : ""}
                        {selectedFolderId !== null && ` • ${strategies.length} total in library`}
                      </CardDescription>
                    </div>
                    <div className="relative w-full sm:w-64">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search funds..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                        data-testid="input-search-funds"
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <FundInventoryTable
                    funds={filteredByFolder}
                    searchQuery={searchQuery}
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSortChange={handleSortChange}
                    folders={folders}
                    onMoveFund={handleMoveFund}
                  />
                </CardContent>
              </Card>
            </div>
          </div>
          <FolderDialog
            open={folderDialogOpen}
            onOpenChange={setFolderDialogOpen}
            folder={editingFolder}
            onSave={handleSaveFolder}
          />
        </TabsContent>

        <TabsContent value="hedge-funds" className="space-y-6">
          {hedgeFunds.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <BarChart3 className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">No Hedge Funds</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-md">
                  Add hedge fund strategies to your Strategy Library to see detailed analytics here.
                  Supported types: Hedge Fund, Long/Short Equity, Macro, Event Driven, Multi-Strategy.
                </p>
              </CardContent>
            </Card>
          ) : (
            hedgeFunds.map(fund => <HedgeFundCard key={fund.id} fund={fund} />)
          )}
        </TabsContent>

        <TabsContent value="private-credit" className="space-y-6">
          {privateCreditFunds.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <DollarSign className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">No Private Credit Funds</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-md">
                  Add private credit strategies to your Strategy Library to see detailed analytics here.
                  Supported types: Credit Strategy, Private Credit, Direct Lending, Mezzanine, High Yield.
                </p>
              </CardContent>
            </Card>
          ) : (
            privateCreditFunds.map(fund => <PrivateCreditCard key={fund.id} fund={fund} />)
          )}
        </TabsContent>

        <TabsContent value="comparison" className="space-y-6">
          <Card data-testid="card-fund-comparison">
            <CardHeader>
              <CardTitle className="text-base font-medium">Alternative Fund Comparison</CardTitle>
              <CardDescription>Compare hedge funds and private credit across key metrics</CardDescription>
            </CardHeader>
            <CardContent>
              {allAlternatives.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Shield className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-sm text-muted-foreground">Add alternative strategies to enable comparison</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fund Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Expected Return</TableHead>
                      <TableHead className="text-right">Volatility</TableHead>
                      <TableHead className="text-right">Sharpe</TableHead>
                      <TableHead className="text-right">Max DD</TableHead>
                      <TableHead className="text-right">Mgmt Fee</TableHead>
                      <TableHead className="text-right">Perf Fee</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allAlternatives.map(fund => (
                      <TableRow key={fund.id}>
                        <TableCell className="font-medium">{fund.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{fund.strategyType}</Badge>
                        </TableCell>
                        <TableCell className="text-right text-emerald-500">{formatPercent(fund.expectedReturn)}</TableCell>
                        <TableCell className="text-right">{formatPercent(fund.volatility)}</TableCell>
                        <TableCell className="text-right">{formatNumber(fund.sharpeRatio)}</TableCell>
                        <TableCell className="text-right text-red-500">{formatPercent(fund.maxDrawdown)}</TableCell>
                        <TableCell className="text-right">{formatPercent(fund.managementFee)}</TableCell>
                        <TableCell className="text-right">{formatPercent(fund.performanceFee)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {allAlternatives.length > 0 && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-medium">Risk/Return Profile</CardTitle>
                  <CardDescription>Expected return vs volatility scatter</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={allAlternatives.map(f => ({
                      name: f.name.substring(0, 15),
                      return: parseFloat(f.expectedReturn || "0") * 100,
                      volatility: parseFloat(f.volatility || "0") * 100,
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} />
                      <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                        formatter={(value: number, name: string) => [`${value.toFixed(2)}%`, name === "return" ? "Return" : "Volatility"]}
                      />
                      <Legend />
                      <Bar dataKey="return" name="Return" fill="hsl(var(--chart-1))" />
                      <Bar dataKey="volatility" name="Volatility" fill="hsl(var(--chart-2))" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-medium">Fee Structure Comparison</CardTitle>
                  <CardDescription>Management and performance fees</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={allAlternatives.filter(f => f.managementFee || f.performanceFee).map(f => ({
                      name: f.name.substring(0, 15),
                      mgmtFee: parseFloat(f.managementFee || "0") * 100,
                      perfFee: parseFloat(f.performanceFee || "0") * 100,
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} />
                      <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                        formatter={(value: number, name: string) => [`${value.toFixed(2)}%`, name]}
                      />
                      <Legend />
                      <Bar dataKey="mgmtFee" name="Mgmt Fee" fill="hsl(var(--chart-3))" />
                      <Bar dataKey="perfFee" name="Perf Fee" fill="hsl(var(--chart-4))" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
