import { Link, NavLink, useNavigate } from "react-router-dom";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/button";
import { useAuth, useRoles } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { LogOut, LayoutDashboard, ArrowLeftRight, Shield, Users, Wallet, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { isAdmin } = useRoles();
  const navigate = useNavigate();

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const navItem =
    "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
  const navActive = "bg-sidebar-accent text-sidebar-accent-foreground";

  return (
    <div className="min-h-screen flex bg-muted/40">
      <aside className="hidden md:flex w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground p-4 gap-1">
        <div className="px-2 pb-4 pt-2">
          <Logo variant="light" />
        </div>
        <NavLink to="/dashboard" className={({ isActive }) => cn(navItem, isActive && navActive)}>
          <LayoutDashboard className="h-4 w-4" /> Dashboard
        </NavLink>
        <NavLink to="/convert" className={({ isActive }) => cn(navItem, isActive && navActive)}>
          <ArrowLeftRight className="h-4 w-4" /> Convert
        </NavLink>
        <NavLink to="/kyb" className={({ isActive }) => cn(navItem, isActive && navActive)}>
          <ShieldCheck className="h-4 w-4" /> Verification
        </NavLink>
        {isAdmin && (
          <>
            <div className="mt-4 px-3 text-xs uppercase tracking-wider text-sidebar-foreground/60">Admin</div>
            <NavLink to="/admin/orders" className={({ isActive }) => cn(navItem, isActive && navActive)}>
              <Shield className="h-4 w-4" /> All Orders
            </NavLink>
            <NavLink to="/admin/kyb" className={({ isActive }) => cn(navItem, isActive && navActive)}>
              <ShieldCheck className="h-4 w-4" /> KYB Review
            </NavLink>
            <NavLink to="/admin/pool" className={({ isActive }) => cn(navItem, isActive && navActive)}>
              <Wallet className="h-4 w-4" /> Pool
            </NavLink>
            <NavLink to="/admin/customers" className={({ isActive }) => cn(navItem, isActive && navActive)}>
              <Users className="h-4 w-4" /> Customers
            </NavLink>
          </>
        )}
        <div className="mt-auto pt-4 border-t border-sidebar-border space-y-2">
          <div className="px-3 text-xs text-sidebar-foreground/70 truncate">{user?.email}</div>
          <Button variant="ghost" size="sm" className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent" onClick={signOut}>
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </Button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden flex items-center justify-between bg-sidebar text-sidebar-foreground px-4 py-3">
          <Link to="/dashboard"><Logo variant="light" /></Link>
          <Button variant="ghost" size="sm" className="text-sidebar-foreground" onClick={signOut}>
            <LogOut className="h-4 w-4" />
          </Button>
        </header>
        <main className="flex-1 p-4 md:p-8 max-w-6xl w-full mx-auto animate-fade-in">{children}</main>
      </div>
    </div>
  );
}
