import { useLocation, Link } from "wouter";
import { 
  LayoutDashboard, 
  PieChart, 
  TrendingUp, 
  Shield, 
  AlertTriangle,
  Building2,
  Upload,
  FolderOpen,
  Mail,
  Briefcase,
  Library,
  BarChart3,
  BookOpen,
  Scale,
  ChevronDown,
  Wallet,
  Target,
  GitCompare
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePortfolio } from "@/hooks/use-portfolio";
import { TimePeriodSelector } from "@/components/time-period-selector";
import { Calendar } from "lucide-react";

const navigationItems = [
  {
    title: "Dashboard",
    url: "/",
    icon: LayoutDashboard,
  },
  {
    title: "Portfolio",
    url: "/portfolio",
    icon: PieChart,
  },
  {
    title: "Performance",
    url: "/performance",
    icon: TrendingUp,
  },
  {
    title: "Risk Analytics",
    url: "/risk",
    icon: Shield,
  },
  {
    title: "Stress Testing",
    url: "/stress-tests",
    icon: AlertTriangle,
  },
  {
    title: "Import Data",
    url: "/import",
    icon: Upload,
  },
  {
    title: "Data Room & Memos",
    url: "/data-room",
    icon: FolderOpen,
  },
  {
    title: "Gmail",
    url: "/gmail",
    icon: Mail,
  },
  {
    title: "Strategy Library",
    url: "/strategy-library",
    icon: Library,
  },
  {
    title: "Portfolio Builder",
    url: "/portfolio-builder",
    icon: Briefcase,
  },
  {
    title: "Portfolio Compare",
    url: "/portfolio-compare",
    icon: GitCompare,
  },
  {
    title: "Fund Analysis",
    url: "/fund-analysis",
    icon: BarChart3,
  },
  {
    title: "Analytics Glossary",
    url: "/analytics-glossary",
    icon: BookOpen,
  },
  {
    title: "Custom Benchmarks",
    url: "/benchmarks",
    icon: Scale,
  },
];

function GlobalSelectors() {
  const {
    selectedPortfolioId,
    selectedBenchmarkId,
    setSelectedPortfolioId,
    setSelectedBenchmarkId,
    selectedTimePeriod,
    setSelectedTimePeriod,
    portfolios,
    benchmarks,
    selectedPortfolio,
    selectedBenchmark,
    isLoading,
  } = usePortfolio();

  const corePortfolios = portfolios.filter(p => p.type === "core");
  const customPortfolios = portfolios.filter(p => p.type === "custom");

  const standardBenchmarks = benchmarks.filter(b => !b.isComposite);
  const compositeBenchmarks = benchmarks.filter(b => b.isComposite);

  const benchmarksByCategory = standardBenchmarks.reduce((acc, benchmark) => {
    const category = benchmark.category || "Other";
    if (!acc[category]) acc[category] = [];
    acc[category].push(benchmark);
    return acc;
  }, {} as Record<string, typeof standardBenchmarks>);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Wallet className="h-3 w-3" />
          <span>Portfolio</span>
        </div>
        <Select
          value={selectedPortfolioId || ""}
          onValueChange={setSelectedPortfolioId}
          disabled={isLoading}
        >
          <SelectTrigger 
            className="h-8 text-sm bg-sidebar-accent/50 border-sidebar-border"
            data-testid="select-global-portfolio"
          >
            <SelectValue placeholder="Select portfolio">
              {selectedPortfolio?.name || "Select portfolio"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {corePortfolios.length > 0 && (
              <SelectGroup>
                <SelectLabel>Core Portfolios</SelectLabel>
                {corePortfolios.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <div className="flex items-center gap-2">
                      <span>{p.name}</span>
                      {p.totalValue && parseFloat(p.totalValue) > 0 && (
                        <Badge variant="secondary" className="text-xs">
                          ${(parseFloat(p.totalValue) / 1000000).toFixed(1)}M
                        </Badge>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
            {customPortfolios.length > 0 && (
              <SelectGroup>
                <SelectLabel>Custom Portfolios</SelectLabel>
                {customPortfolios.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Target className="h-3 w-3" />
          <span>Benchmark</span>
        </div>
        <Select
          value={selectedBenchmarkId || ""}
          onValueChange={setSelectedBenchmarkId}
          disabled={isLoading}
        >
          <SelectTrigger 
            className="h-8 text-sm bg-sidebar-accent/50 border-sidebar-border"
            data-testid="select-global-benchmark"
          >
            <SelectValue placeholder="Select benchmark">
              {selectedBenchmark?.name || "Select benchmark"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="max-h-[300px]">
            {compositeBenchmarks.length > 0 && (
              <SelectGroup>
                <SelectLabel>Custom Benchmarks</SelectLabel>
                {compositeBenchmarks.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-2 h-2 rounded-full" 
                        style={{ backgroundColor: b.color || "#8b5cf6" }}
                      />
                      <span>{b.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
            {Object.entries(benchmarksByCategory).map(([category, categoryBenchmarks]) => (
              <SelectGroup key={category}>
                <SelectLabel>{category}</SelectLabel>
                {categoryBenchmarks.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-2 h-2 rounded-full" 
                        style={{ backgroundColor: b.color || "#6366f1" }}
                      />
                      <span>{b.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" />
          <span>Time Period</span>
        </div>
        <TimePeriodSelector
          value={selectedTimePeriod}
          onChange={setSelectedTimePeriod}
          className="flex-wrap"
        />
      </div>
    </div>
  );
}

export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
        <Link href="/" data-testid="link-logo">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-sidebar-primary">
              <Building2 className="h-4 w-4 text-sidebar-primary-foreground" />
            </div>
            <div className="flex flex-col">
              <span className="text-base font-semibold text-sidebar-foreground">InvestIQ</span>
              <span className="text-xs text-muted-foreground">Risk Dashboard</span>
            </div>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent className="px-2 py-4">
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-medium text-muted-foreground px-2 mb-2">
            Analytics
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigationItems.map((item) => {
                const isActive = location === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton 
                      asChild 
                      isActive={isActive}
                      className="h-10"
                      data-testid={`link-nav-${item.title.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      <Link href={item.url}>
                        <item.icon className="h-4 w-4" />
                        <span className="font-medium">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-3">
        <GlobalSelectors />
      </SidebarFooter>
    </Sidebar>
  );
}
