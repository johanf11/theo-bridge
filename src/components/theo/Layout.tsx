import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth, useRoles } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import {
  LayoutGrid, ArrowLeftRight, ArrowRightLeft, Wallet, SendHorizonal,
  Settings, LogOut, ShieldCheck, Search,
} from "lucide-react";

const mainNav = [
  { to: "/dashboard", label: "Home", icon: LayoutGrid },
  { to: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { to: "/balance", label: "Balance", icon: Wallet },
  { to: "/payout", label: "Payout", icon: SendHorizonal },
  { to: "/convert", label: "Convert", icon: ArrowRightLeft },
];

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
  const { isAdmin } = useRoles();
  const navigate = useNavigate();

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const initials = user?.email?.slice(0, 2).toUpperCase() ?? "TB";
  const displayName = user?.email?.split("@")[0] ?? "User";

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
              For Business
            </div>
          </div>
        </div>

        {/* Main nav */}
        <div style={{ padding: "10px 10px 4px", display: "flex", flexDirection: "column", gap: 2 }}>
          {mainNav.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </div>

        {/* Account section */}
        <div style={{ padding: "6px 10px 4px", display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "rgba(255,255,255,0.35)", padding: "10px 6px 4px" }}>
            Account
          </div>
          <NavItem to="/settings" label="Settings" icon={Settings} />
          {isAdmin && (
            <>
              <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "rgba(255,255,255,0.35)", padding: "10px 6px 4px" }}>
                Admin
              </div>
              <NavItem to="/admin/kyb" label="KYB Review" icon={ShieldCheck} />
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
            Sign out
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
          <div
            style={{
              flex: 1, maxWidth: 380,
              display: "flex", alignItems: "center", gap: 8,
              background: "hsl(var(--theo-cream))",
              border: "1px solid hsl(var(--theo-light))",
              borderRadius: 8, padding: "7px 12px",
            }}
          >
            <Search style={{ width: 13, height: 13, stroke: "hsl(var(--theo-mid))", fill: "none", strokeWidth: 2, flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Search transactions, accounts..."
              style={{
                border: "none", background: "transparent", outline: "none",
                fontFamily: "inherit", fontSize: 13, color: "hsl(var(--theo-ink))", width: "100%",
              }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
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
          <button onClick={signOut} style={{ color: "rgba(255,255,255,0.70)", background: "none", border: "none", cursor: "pointer" }}>
            <LogOut style={{ width: 16, height: 16 }} />
          </button>
        </header>

        {/* Content */}
        <main style={{ flex: 1, overflowY: "auto", padding: 28 }}>
          {children}
        </main>
      </div>
    </div>
  );
}
