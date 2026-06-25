import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth, useRoles } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowLeftRight,
  Settings, LogOut, ShieldCheck, Wrench, Receipt, BookOpen, Activity, Building2,
} from "lucide-react";
import { GlobalSearchBar } from "@/components/theo/GlobalSearchBar";
import { LanguageToggle } from "@/components/theo/LanguageToggle";
import { useT } from "@/lib/i18n";
import { buildSearchNavItems } from "@/lib/search";
import { usePermissions } from "@/hooks/usePermissions";

const SIDEBAR_BG = "#33359A";
const ACTIVE_BG = "rgba(255,255,255,0.14)";
const HOVER_BG = "rgba(255,255,255,0.07)";
const ACTIVE_TEXT = "#ffffff";
const INACTIVE_TEXT = "rgba(255,255,255,0.65)";
const GOLD = "#FDCF00";

function NavItem({
  to, label, icon: Icon,
}: {
  to: string; label: string; icon: React.ComponentType<{ style?: React.CSSProperties }>;
}) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 10px", borderRadius: 7,
        fontSize: 13,
        fontWeight: isActive ? 700 : 500,
        color: isActive ? ACTIVE_TEXT : INACTIVE_TEXT,
        background: isActive ? ACTIVE_BG : "transparent",
        textDecoration: "none",
        transition: "all 130ms",
        cursor: "pointer",
      })}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        if (!el.getAttribute("aria-current")) {
          el.style.background = HOVER_BG;
          el.style.color = "rgba(255,255,255,0.90)";
        }
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        if (!el.getAttribute("aria-current")) {
          el.style.background = "transparent";
          el.style.color = INACTIVE_TEXT;
        }
      }}
    >
      {({ isActive }) => (
        <>
          <Icon
            style={{
              width: 14, height: 14, flexShrink: 0,
              stroke: isActive ? GOLD : "currentColor",
              fill: "none", strokeWidth: 1.8,
              strokeLinecap: "round", strokeLinejoin: "round",
              opacity: isActive ? 1 : 0.72,
            }}
          />
          {label}
        </>
      )}
    </NavLink>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { isAdmin, loading: rolesLoading } = useRoles();
  const { can, isOwner, loading: permsLoading } = usePermissions();
  const navAuthLoading = rolesLoading || permsLoading;
  const navigate = useNavigate();
  const t = useT();

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  // Build search nav from central registry
  const searchNav = buildSearchNavItems(t, isAdmin);

  const displayName =
    user?.user_metadata?.display_name ||
    user?.email?.split("@")[0] ||
    "User";
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "hsl(var(--theo-cream))" }}>
      {/* ── Sidebar ───────────────────────────────── */}
      <aside
        style={{
          width: 196, minWidth: 196, display: "flex", flexDirection: "column",
          height: "100vh", flexShrink: 0, background: SIDEBAR_BG,
        }}
      >
        {/* Logo */}
        <div
          style={{
            display: "flex", alignItems: "center", gap: 9,
            padding: "18px 16px 16px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div
            style={{
              width: 28, height: 28, borderRadius: 7,
              background: GOLD,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 800, fontSize: 16, color: SIDEBAR_BG,
              flexShrink: 0,
            }}
          >
            T
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: "#fff", letterSpacing: "-0.4px", lineHeight: 1 }}>
              Theo
            </div>
            <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.40)", textTransform: "uppercase", letterSpacing: "0.12em", marginTop: 2 }}>
              {t("nav.logo.tagline")}
            </div>
          </div>
        </div>

        {/* Main nav */}
        <div style={{ padding: "10px 10px 4px", display: "flex", flexDirection: "column", gap: 2 }}>
          {searchNav
            .filter(n => n.to !== "/settings" && n.to !== "/billing" && n.to !== "/kyb" && !n.adminOnly)
            .filter(n => n.to !== "/convert" || navAuthLoading || isOwner || isAdmin || can("convert"))
            .filter(n => n.to !== "/payout"  || navAuthLoading || isOwner || isAdmin || can("payout_send"))
            .filter(n => n.to !== "/pay-bill" || navAuthLoading || isOwner || isAdmin || can("payout_send"))
            .map((item) => (
              <NavItem key={item.to} to={item.to} label={item.label} icon={item.icon} />
            ))}
        </div>

        {/* Account section */}
        <div style={{ padding: "6px 10px 4px", display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "rgba(255,255,255,0.35)", padding: "10px 6px 4px" }}>
            {t("nav.account")}
          </div>
          <NavItem to="/billing" label={t("nav.billing")} icon={Receipt} />
          <NavItem to="/settings" label={t("nav.settings")} icon={Settings} />
          {isAdmin && (
            <>
              <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "rgba(255,255,255,0.35)", padding: "10px 6px 4px" }}>
                {t("nav.admin")}
              </div>
              <NavItem to="/admin/kyb" label={t("nav.admin.kyb")} icon={ShieldCheck} />
              <NavItem to="/admin/conversions" label={t("nav.admin.conversions")} icon={ArrowLeftRight} />
              <NavItem to="/admin/transactions" label={t("nav.admin.transactions")} icon={Activity} />
              <NavItem to="/admin/owlting" label={t("nav.admin.owlting")} icon={Building2} />
              <NavItem to="/admin/tools" label={t("nav.admin.tools")} icon={Wrench} />
              <NavItem to="/admin/ledger" label={t("nav.admin.ledger")} icon={BookOpen} />
            </>
          )}
        </div>

        {/* Bottom: user */}
        <div
          style={{
            marginTop: "auto",
            padding: "14px 16px",
            borderTop: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div
              style={{
                width: 28, height: 28, borderRadius: "50%",
                background: GOLD,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 800, fontSize: 12, color: SIDEBAR_BG,
                flexShrink: 0,
              }}
            >
              {initials}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.85)", lineHeight: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {displayName}
              </div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.40)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 110 }}>
                {user?.email ?? ""}
              </div>
            </div>
          </div>
          <button
            onClick={signOut}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              fontSize: 11, color: "rgba(255,255,255,0.45)",
              border: "none", background: "none", cursor: "pointer",
              fontFamily: "inherit", marginTop: 10, padding: 0,
              transition: "color 130ms",
            }}
            onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.75)")}
            onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.45)")}
          >
            <LogOut style={{ width: 12, height: 12, stroke: "currentColor", fill: "none", strokeWidth: 1.8 }} />
            {t("nav.signout")}
          </button>
        </div>
      </aside>

      {/* ── Main ──────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        {/* Topbar */}
        <div
          style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "10px 28px",
            background: "#ffffff",
            borderBottom: "1px solid hsl(var(--theo-light))",
            flexShrink: 0, height: 52,
          }}
        >
          <GlobalSearchBar nav={searchNav} />
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginLeft: "auto" }}>
            <LanguageToggle />
            <div
              style={{
                width: 30, height: 30, borderRadius: "50%",
                background: GOLD,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 800, fontSize: 12, color: SIDEBAR_BG, cursor: "pointer",
              }}
            >
              {initials}
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: SIDEBAR_BG }}>{displayName}</span>
          </div>
        </div>

        {/* Mobile header */}
        <header
          className="md:hidden flex items-center justify-between px-4 py-3 border-b"
          style={{ background: SIDEBAR_BG }}
        >
          <Link to="/dashboard" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
            <div style={{ width: 24, height: 24, borderRadius: 6, background: GOLD, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 14, color: SIDEBAR_BG }}>T</div>
            <span style={{ fontWeight: 800, fontSize: 16, color: "#fff" }}>Theo</span>
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <LanguageToggle />
            <button onClick={signOut} style={{ color: "rgba(255,255,255,0.70)", background: "none", border: "none", cursor: "pointer" }}>
              <LogOut style={{ width: 16, height: 16 }} />
            </button>
          </div>
        </header>

        {/* Content */}
        <main style={{ flex: 1, overflowY: "auto", padding: 28 }}>
          {children}
        </main>
      </div>
    </div>
  );
}
