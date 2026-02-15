import { useQuery } from "@tanstack/react-query";
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

export interface AllBenchmarksResult {
  standardBenchmarks: Benchmark[];
  compositeBenchmarks: BenchmarkWithComponents[];
  allBenchmarks: Array<{
    id: string;
    name: string;
    type: "standard" | "composite";
    category?: string;
    color?: string | null;
  }>;
  isLoading: boolean;
}

const BENCHMARK_CATEGORIES: Record<string, string[]> = {
  "Equity - US": ["S&P 500", "Nasdaq 100", "Russell 2000", "Russell 1000", "Dow Jones Industrial"],
  "Equity - International": ["MSCI EAFE", "MSCI Emerging Markets", "MSCI ACWI", "FTSE 100", "DAX", "Nikkei 225", "Hang Seng"],
  "Fixed Income": ["Bloomberg US Aggregate", "Bloomberg Global Aggregate", "US Treasury 10Y", "ICE BofA High Yield", "TIPS"],
  "Alternative": ["HFRI Fund Weighted", "Cambridge Associates PE", "NCREIF Property", "Bloomberg Commodity", "S&P GSCI"],
  "Multi-Asset": ["60/40 Portfolio", "MSCI World", "Morningstar Moderate Target Risk"],
};

function getBenchmarkCategory(name: string): string {
  for (const [category, names] of Object.entries(BENCHMARK_CATEGORIES)) {
    if (names.some((n) => name.includes(n) || n.includes(name))) {
      return category;
    }
  }
  return "Other";
}

export function useAllBenchmarks(): AllBenchmarksResult {
  const { data: benchmarksData, isLoading: isLoadingBenchmarks } = useQuery<BenchmarksData>({
    queryKey: ["/api/benchmarks"],
  });

  const { data: compositeBenchmarksData, isLoading: isLoadingComposite } = useQuery<CompositeBenchmarksData>({
    queryKey: ["/api/composite-benchmarks"],
  });

  const standardBenchmarks = benchmarksData?.benchmarks || [];
  const compositeBenchmarks = compositeBenchmarksData?.compositeBenchmarks || [];

  const allBenchmarks = [
    ...standardBenchmarks.map((b) => ({
      id: b.id,
      name: b.name,
      type: "standard" as const,
      category: getBenchmarkCategory(b.name),
      color: null,
    })),
    ...compositeBenchmarks.map((b) => ({
      id: b.id,
      name: b.name,
      type: "composite" as const,
      category: "Custom",
      color: b.color,
    })),
  ];

  return {
    standardBenchmarks,
    compositeBenchmarks,
    allBenchmarks,
    isLoading: isLoadingBenchmarks || isLoadingComposite,
  };
}

export type TimePeriod = "YTD" | "LTM" | "1Y" | "3Y" | "5Y" | "10Y" | "SI";
export type Cadence = "daily" | "monthly" | "quarterly";

export function useBenchmarkReturns(
  benchmarkId: string | null,
  benchmarkType: "standard" | "composite",
  timePeriod?: TimePeriod,
  cadence?: Cadence
) {
  // Build query string with optional timePeriod and cadence params
  const buildUrl = (base: string) => {
    const params = new URLSearchParams();
    if (timePeriod) params.set("timePeriod", timePeriod);
    if (cadence) params.set("cadence", cadence);
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  };

  const standardQuery = useQuery<{ returns: any[]; cadence?: string; timePeriod?: string; metrics?: any }>({
    queryKey: ["/api/benchmarks", benchmarkId, "returns", timePeriod, cadence],
    queryFn: async () => {
      if (!benchmarkId) return { returns: [] };
      const url = buildUrl(`/api/benchmarks/${benchmarkId}/returns`);
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return { returns: [] };
      return res.json();
    },
    enabled: !!benchmarkId && benchmarkType === "standard",
  });

  const compositeQuery = useQuery<{ returns: any[]; cadence?: string; timePeriod?: string; metrics?: any }>({
    queryKey: ["/api/composite-benchmarks", benchmarkId, "returns", timePeriod, cadence],
    queryFn: async () => {
      if (!benchmarkId) return { returns: [] };
      const url = buildUrl(`/api/composite-benchmarks/${benchmarkId}/returns`);
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return { returns: [] };
      return res.json();
    },
    enabled: !!benchmarkId && benchmarkType === "composite",
  });

  return benchmarkType === "standard" ? standardQuery : compositeQuery;
}
