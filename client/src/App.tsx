import { useState } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { PortfolioProvider } from "@/hooks/use-portfolio";
import { ProtectedRoute } from "@/lib/protected-route";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/auth-page";
import Dashboard from "@/pages/dashboard";
import PortfolioPage from "@/pages/portfolio";
import PerformancePage from "@/pages/performance";
import RiskPage from "@/pages/risk";
import StressTestsPage from "@/pages/stress-tests";
import PortfolioManagePage from "@/pages/portfolio-manage";
import DataRoomPage from "@/pages/data-room";
import GmailPage from "@/pages/gmail";
import PortfolioBuilderPage from "@/pages/portfolio-builder";
import StrategyLibraryPage from "@/pages/strategy-library";
import FundAnalysisPage from "@/pages/fund-analysis";
import AnalyticsGlossaryPage from "@/pages/analytics-glossary";
import BenchmarksPage from "@/pages/benchmarks";
import PortfolioComparePage from "@/pages/portfolio-compare";
import IntervalFundsPage from "@/pages/interval-funds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LogOut, Settings, Key, User } from "lucide-react";

function Router() {
  return (
    <Switch>
      <Route path="/auth" component={AuthPage} />
      <ProtectedRoute path="/" component={Dashboard} />
      <ProtectedRoute path="/portfolio" component={PortfolioPage} />
      <ProtectedRoute path="/performance" component={PerformancePage} />
      <ProtectedRoute path="/risk" component={RiskPage} />
      <ProtectedRoute path="/stress-tests" component={StressTestsPage} />
      <ProtectedRoute path="/portfolio/:id/manage" component={PortfolioManagePage} />
      <ProtectedRoute path="/data-room" component={DataRoomPage} />
      <ProtectedRoute path="/gmail" component={GmailPage} />
      <ProtectedRoute path="/strategy-library" component={StrategyLibraryPage} />
      <ProtectedRoute path="/portfolio-builder" component={PortfolioBuilderPage} />
      <ProtectedRoute path="/fund-analysis" component={FundAnalysisPage} />
      <ProtectedRoute path="/analytics-glossary" component={AnalyticsGlossaryPage} />
      <ProtectedRoute path="/benchmarks" component={BenchmarksPage} />
      <ProtectedRoute path="/portfolio-compare" component={PortfolioComparePage} />
      <ProtectedRoute path="/interval-funds" component={IntervalFundsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function UserMenu() {
  const { user, logoutMutation, changePasswordMutation } = useAuth();
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  
  if (!user) return null;

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      return;
    }
    changePasswordMutation.mutate(
      {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      },
      {
        onSuccess: () => {
          setIsPasswordDialogOpen(false);
          setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
        },
      }
    );
  };
  
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" data-testid="button-user-menu">
            <User className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <div className="px-2 py-1.5 text-sm font-medium">{user.username}</div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setIsPasswordDialogOpen(true)} data-testid="menu-change-password">
            <Key className="h-4 w-4 mr-2" />
            Change Password
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            data-testid="menu-logout"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={isPasswordDialogOpen} onOpenChange={setIsPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              Change Password
            </DialogTitle>
            <DialogDescription>
              Enter your current password and choose a new password.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-password">Current Password</Label>
              <Input
                id="current-password"
                type="password"
                value={passwordForm.currentPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                required
                data-testid="input-current-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                required
                minLength={6}
                data-testid="input-new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-new-password">Confirm New Password</Label>
              <Input
                id="confirm-new-password"
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                required
                data-testid="input-confirm-new-password"
              />
              {passwordForm.newPassword !== passwordForm.confirmPassword && passwordForm.confirmPassword && (
                <p className="text-sm text-destructive">Passwords do not match</p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsPasswordDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={changePasswordMutation.isPending || passwordForm.newPassword !== passwordForm.confirmPassword}
                data-testid="button-save-password"
              >
                {changePasswordMutation.isPending ? "Saving..." : "Save Password"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AppLayout() {
  const { user } = useAuth();
  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  if (!user) {
    return <Router />;
  }

  return (
    <SidebarProvider style={sidebarStyle as React.CSSProperties}>
      <div className="flex h-screen w-full overflow-hidden">
        <AppSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4 bg-card">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex items-center gap-2">
              <UserMenu />
              <ThemeToggle />
            </div>
          </header>
          <main className="flex-1 overflow-auto p-6">
            <Router />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark" storageKey="investiq-theme">
        <TooltipProvider>
          <AuthProvider>
            <PortfolioProvider>
              <AppLayout />
            </PortfolioProvider>
          </AuthProvider>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
