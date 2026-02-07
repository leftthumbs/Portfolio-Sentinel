import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Scale, TrendingUp, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { TableSkeleton } from "@/components/loading-skeleton";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Benchmark, CompositeBenchmark, CompositeBenchmarkComponent } from "@shared/schema";

interface BenchmarkWithComponents extends CompositeBenchmark {
  components: (CompositeBenchmarkComponent & { benchmark?: Benchmark })[];
}

interface BenchmarksData {
  benchmarks: Benchmark[];
}

interface CompositeBenchmarksData {
  compositeBenchmarks: BenchmarkWithComponents[];
}

interface BenchmarkComponent {
  benchmarkId: string;
  name: string;
  weight: number;
}

const BENCHMARK_CATEGORIES: Record<string, string[]> = {
  "Equity - US": ["S&P 500", "Nasdaq 100", "Russell 2000", "Russell 1000", "Dow Jones Industrial"],
  "Equity - International": ["MSCI EAFE", "MSCI Emerging Markets", "MSCI ACWI", "FTSE 100", "DAX", "Nikkei 225", "Hang Seng"],
  "Fixed Income": ["Bloomberg US Aggregate", "Bloomberg Global Aggregate", "US Treasury 10Y", "ICE BofA High Yield", "TIPS"],
  "Alternative": ["HFRI Fund Weighted", "Cambridge Associates PE", "NCREIF Property", "Bloomberg Commodity", "S&P GSCI"],
  "Multi-Asset": ["60/40 Portfolio", "MSCI World", "Morningstar Moderate Target Risk"],
};

export default function BenchmarksPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingBenchmark, setEditingBenchmark] = useState<BenchmarkWithComponents | null>(null);
  const [deletingBenchmark, setDeletingBenchmark] = useState<BenchmarkWithComponents | null>(null);
  const [benchmarkName, setBenchmarkName] = useState("");
  const [benchmarkDescription, setBenchmarkDescription] = useState("");
  const [components, setComponents] = useState<BenchmarkComponent[]>([]);

  const { data: benchmarksData, isLoading: isLoadingBenchmarks } = useQuery<BenchmarksData>({
    queryKey: ["/api/benchmarks"],
  });

  const { data: compositeBenchmarksData, isLoading: isLoadingComposite } = useQuery<CompositeBenchmarksData>({
    queryKey: ["/api/composite-benchmarks"],
  });

  const benchmarks = benchmarksData?.benchmarks || [];
  const compositeBenchmarks = compositeBenchmarksData?.compositeBenchmarks || [];

  const benchmarksByCategory: Record<string, Benchmark[]> = {};
  benchmarks.forEach((b) => {
    for (const [category, names] of Object.entries(BENCHMARK_CATEGORIES)) {
      if (names.some((name) => b.name.includes(name) || name.includes(b.name))) {
        if (!benchmarksByCategory[category]) benchmarksByCategory[category] = [];
        benchmarksByCategory[category].push(b);
        return;
      }
    }
    if (!benchmarksByCategory["Other"]) benchmarksByCategory["Other"] = [];
    benchmarksByCategory["Other"].push(b);
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string; components: { benchmarkId: string; weight: number }[] }) => {
      return await apiRequest("POST", "/api/composite-benchmarks", {
        name: data.name,
        description: data.description,
        color: "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0"),
        components: data.components,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/composite-benchmarks"] });
      toast({ title: "Custom benchmark created", description: "Your benchmark is now available throughout the app." });
      handleCloseDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create benchmark", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; name: string; description?: string; components: { benchmarkId: string; weight: number }[] }) => {
      return await apiRequest("PATCH", `/api/composite-benchmarks/${data.id}`, {
        name: data.name,
        description: data.description,
        components: data.components,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/composite-benchmarks"] });
      toast({ title: "Benchmark updated", description: "Your changes have been saved." });
      handleCloseDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update benchmark", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/composite-benchmarks/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/composite-benchmarks"] });
      toast({ title: "Benchmark deleted", description: "The custom benchmark has been removed." });
      setDeleteDialogOpen(false);
      setDeletingBenchmark(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete benchmark", variant: "destructive" });
    },
  });

  const handleOpenCreate = () => {
    setEditingBenchmark(null);
    setBenchmarkName("");
    setBenchmarkDescription("");
    setComponents([]);
    setDialogOpen(true);
  };

  const handleOpenEdit = (benchmark: BenchmarkWithComponents) => {
    setEditingBenchmark(benchmark);
    setBenchmarkName(benchmark.name);
    setBenchmarkDescription(benchmark.description || "");
    setComponents(
      benchmark.components.map((c) => ({
        benchmarkId: c.benchmarkId,
        name: c.benchmark?.name || benchmarks.find((b) => b.id === c.benchmarkId)?.name || "Unknown",
        weight: parseFloat(c.weight),
      }))
    );
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingBenchmark(null);
    setBenchmarkName("");
    setBenchmarkDescription("");
    setComponents([]);
  };

  const handleSave = () => {
    if (!benchmarkName.trim()) {
      toast({ title: "Error", description: "Please enter a benchmark name", variant: "destructive" });
      return;
    }
    if (components.length === 0) {
      toast({ title: "Error", description: "Please add at least one component", variant: "destructive" });
      return;
    }
    const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
    if (Math.abs(totalWeight - 1) > 0.01) {
      toast({ title: "Error", description: "Weights must sum to 100%", variant: "destructive" });
      return;
    }

    const payload = {
      name: benchmarkName,
      description: benchmarkDescription || undefined,
      components: components.map((c) => ({ benchmarkId: c.benchmarkId, weight: c.weight })),
    };

    if (editingBenchmark) {
      updateMutation.mutate({ id: editingBenchmark.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleDelete = (benchmark: BenchmarkWithComponents) => {
    setDeletingBenchmark(benchmark);
    setDeleteDialogOpen(true);
  };

  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
  const isLoading = isLoadingBenchmarks || isLoadingComposite;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Custom Benchmarks</h1>
            <p className="text-sm text-muted-foreground mt-1">Create and manage composite benchmarks</p>
          </div>
        </div>
        <TableSkeleton rows={5} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-benchmarks-title">
            Custom Benchmarks
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create composite benchmarks by combining standard benchmarks with custom weights
          </p>
        </div>
        <Button onClick={handleOpenCreate} data-testid="button-create-benchmark">
          <Plus className="h-4 w-4 mr-2" />
          Create Benchmark
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Standard Benchmarks</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{benchmarks.length}</div>
            <p className="text-xs text-muted-foreground">Available for comparison</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Custom Benchmarks</CardTitle>
            <Scale className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{compositeBenchmarks.length}</div>
            <p className="text-xs text-muted-foreground">Created by you</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Available</CardTitle>
            <Scale className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{benchmarks.length + compositeBenchmarks.length}</div>
            <p className="text-xs text-muted-foreground">For portfolio comparisons</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Your Custom Benchmarks</CardTitle>
          <CardDescription>
            Composite benchmarks combine multiple standard benchmarks with custom weights
          </CardDescription>
        </CardHeader>
        <CardContent>
          {compositeBenchmarks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Scale className="h-12 w-12 mb-4" />
              <p className="font-medium">No custom benchmarks yet</p>
              <p className="text-sm">Create your first composite benchmark to compare portfolio performance</p>
              <Button onClick={handleOpenCreate} className="mt-4" variant="outline">
                <Plus className="h-4 w-4 mr-2" />
                Create Benchmark
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Components</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {compositeBenchmarks.map((benchmark) => (
                  <TableRow key={benchmark.id} data-testid={`row-benchmark-${benchmark.id}`}>
                    <TableCell className="font-medium">{benchmark.name}</TableCell>
                    <TableCell className="text-muted-foreground">{benchmark.description || "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {benchmark.components.slice(0, 3).map((c, i) => (
                          <Badge key={i} variant="secondary" className="text-xs">
                            {c.benchmark?.name?.split(" ").slice(0, 2).join(" ") || "..."} ({(parseFloat(c.weight) * 100).toFixed(0)}%)
                          </Badge>
                        ))}
                        {benchmark.components.length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{benchmark.components.length - 3} more
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenEdit(benchmark)}
                          data-testid={`button-edit-benchmark-${benchmark.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(benchmark)}
                          data-testid={`button-delete-benchmark-${benchmark.id}`}
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Standard Benchmarks</CardTitle>
          <CardDescription>Pre-defined benchmarks available for use in composite benchmarks</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Object.entries(benchmarksByCategory).map(([category, categoryBenchmarks]) => (
              <div key={category}>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">{category}</h4>
                <div className="flex flex-wrap gap-2">
                  {categoryBenchmarks.map((b) => (
                    <Badge key={b.id} variant="outline">
                      {b.name}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingBenchmark ? "Edit Custom Benchmark" : "Create Custom Benchmark"}</DialogTitle>
            <DialogDescription>
              Combine standard benchmarks with custom weights to create your own comparison benchmark.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="benchmark-name">Benchmark Name</Label>
              <Input
                id="benchmark-name"
                value={benchmarkName}
                onChange={(e) => setBenchmarkName(e.target.value)}
                placeholder="e.g., 70/30 Global Equity-Bond"
                data-testid="input-benchmark-name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="benchmark-description">Description (Optional)</Label>
              <Input
                id="benchmark-description"
                value={benchmarkDescription}
                onChange={(e) => setBenchmarkDescription(e.target.value)}
                placeholder="Describe the purpose of this benchmark"
                data-testid="input-benchmark-description"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Component Allocations</Label>
                <span
                  className={`text-sm ${
                    Math.abs(totalWeight - 1) < 0.001 ? "text-emerald-500" : "text-muted-foreground"
                  }`}
                >
                  Total: {(totalWeight * 100).toFixed(0)}%
                </span>
              </div>

              {components.map((component, index) => (
                <div key={component.benchmarkId} className="flex items-center gap-2 p-2 bg-muted rounded-md">
                  <div className="flex-1 text-sm truncate">{component.name}</div>
                  <div className="w-32 flex items-center gap-2">
                    <Slider
                      className="flex-1"
                      value={[component.weight * 100]}
                      onValueChange={([value]) => {
                        const updated = [...components];
                        updated[index] = { ...component, weight: value / 100 };
                        setComponents(updated);
                      }}
                      min={0}
                      max={100}
                      step={5}
                    />
                    <span className="w-10 text-sm text-right font-mono">{(component.weight * 100).toFixed(0)}%</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setComponents(components.filter((_, i) => i !== index));
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full" data-testid="button-add-component">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Component
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-64">
                  {Object.entries(benchmarksByCategory).map(([category, categoryBenchmarks]) => (
                    <DropdownMenuSub key={category}>
                      <DropdownMenuSubTrigger>{category}</DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="max-h-[250px] overflow-y-auto">
                        {categoryBenchmarks
                          .filter((b) => !components.some((c) => c.benchmarkId === b.id))
                          .map((benchmark) => (
                            <DropdownMenuItem
                              key={benchmark.id}
                              onClick={() => {
                                setComponents([
                                  ...components,
                                  { benchmarkId: benchmark.id, name: benchmark.name, weight: 0.2 },
                                ]);
                              }}
                            >
                              {benchmark.name}
                            </DropdownMenuItem>
                          ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <Button
              onClick={handleSave}
              className="w-full"
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-benchmark"
            >
              {createMutation.isPending || updateMutation.isPending
                ? "Saving..."
                : editingBenchmark
                ? "Update Benchmark"
                : "Create Benchmark"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Custom Benchmark</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingBenchmark?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingBenchmark && deleteMutation.mutate(deletingBenchmark.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
