import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth, useRoles } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import {
  LayoutGrid, ArrowLeftRight, ArrowRightLeft, Wallet, SendHorizonal,
  Settings, LogOut, ShieldCheck, Search, Wrench, BookLock, DollarSign, Receipt, Menu,
} from "lucide-react";
import { useSearch } from "@/contexts/SearchContext";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

const mainNav = [
  { to: "/dashboard", label: "Home", icon: LayoutGrid, keywords: ["home", "dashboard"] },
  { to: "/transactions", label: "Transactions", icon: ArrowLeftRight, keywords: ["transactions", "history", "orders"] },
  { to: "/balance", label: "Balance", icon: Wallet, keywords: ["balance", "wallet", "account", "funds"] },
  { to: "/payout", label: "Payout", icon: SendHorizonal, keywords: ["payout", "send", "payment", "transfer"] },
  { to: "/convert", label: "On / Off Ramp", icon: ArrowRightLeft, keywords: ["convert", "on ramp", "off ramp", "buy", "exchange"] },
  { to: "/compliance", label: "Compliance", icon: BookLock, keywords: ["compliance", "audit", "flags", "htgc", "issuer", "regulatory"] },
  { to: "/settings", label: "Settings", icon: Settings, keywords: ["settings", "profile", "account"] },
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

type TxResult = { id: string; reference_number: string; usdc_amount: number; status: string; created_at: string };
type WalletResult = { id: string; label: string | null; stellar_address: string };
type PayoutResult = { id: string; recipient_name: string; amount_usdc: number; status: string; memo: string | null; created_at: string };

// Pages where search filters the visible table inline (no dropdown)
const FILTER_PAGES = ["/transactions", "/payout"];

function SectionLabel({ label }: { label: string }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "hsl(var(--theo-mid))", padding: "8px 12px 4px" }}>
      {label}
    </div>
  );
}

function ResultRow({
  active, onSelect, onHover, left, right, sub,
}: {
  active: boolean; onSelect: () => void; onHover: () => void;
  left: React.ReactNode; right?: React.ReactNode; sub?: string;
}) {
  return (
    <button
      onMouseDown={onSelect}
      onMouseEnter={onHover}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        width: "100%", padding: "8px 12px", border: "none",
        background: active ? "hsl(var(--theo-blue-soft))" : "transparent",
        cursor: "pointer", fontFamily: "inherit", textAlign: "left",
        transition: "background 80ms", gap: 8,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--theo-ink))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{left}</div>
        {sub && <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginTop: 1 }}>{sub}</div>}
      </div>
      {right && <span style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-blue))", flexShrink: 0 }}>{right}</span>}
    </button>
  );
}

function GlobalSearchBar() {
  const { query, setQuery } = useSearch();
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [txResults, setTxResults] = useState<TxResult[]>([]);
  const [payoutResults, setPayoutResults] = useState<PayoutResult[]>([]);
  const [walletResults, setWalletResults] = useState<WalletResult[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isFilterPage = FILTER_PAGES.includes(location.pathname);

  // Clear search when navigating
  useEffect(() => {
    setQuery("");
    setTxResults([]);
    setPayoutResults([]);
    setWalletResults([]);
  }, [location.pathname]);

  // Debounced Supabase search (dropdown mode only)
  useEffect(() => {
    if (isFilterPage || query.length < 2) {
      setTxResults([]);
      setPayoutResults([]);
      setWalletResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const { data: c } = await supabase.from("customers").select("id").maybeSingle();
      if (!c) return;

      const q = query;
      const [{ data: txs }, { data: pays }, { data: ws }] = await Promise.all([
        supabase
          .from("orders")
          .select("id, reference_number, usdc_amount, status, created_at")
          .eq("customer_id", c.id)
          .or(`reference_number.ilike.%${q}%`)
          .limit(3),
        supabase
          .from("payouts")
          .select("id, recipient_name, amount_usdc, status, memo, created_at")
          .eq("customer_id", c.id)
          .or(`recipient_name.ilike.%${q}%,memo.ilike.%${q}%,recipient_address.ilike.%${q}%`)
          .order("created_at", { ascending: false })
          .limit(4),
        supabase
          .from("wallets")
          .select("id, label, stellar_address")
          .eq("customer_id", c.id)
          .or(`label.ilike.%${q}%,stellar_address.ilike.%${q}%`)
          .limit(3),
      ]);
      setTxResults((txs ?? []) as TxResult[]);
      setPayoutResults((pays ?? []) as PayoutResult[]);
      setWalletResults((ws ?? []) as WalletResult[]);
      setActiveIdx(0);
    }, 180);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, isFilterPage]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) setFocused(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const navMatches = query.length >= 1
    ? mainNav.filter(n =>
        n.label.toLowerCase().includes(query.toLowerCase()) ||
        n.keywords.some(k => k.includes(query.toLowerCase()))
      )
    : [];

  type AnyResult =
    | { type: "nav"; item: typeof mainNav[0] }
    | { type: "tx"; item: TxResult }
    | { type: "payout"; item: PayoutResult }
    | { type: "wallet"; item: WalletResult };

  const allResults: AnyResult[] = [
    ...navMatches.map(n => ({ type: "nav" as const, item: n })),
    ...txResults.map(t => ({ type: "tx" as const, item: t })),
    ...payoutResults.map(p => ({ type: "payout" as const, item: p })),
    ...walletResults.map(w => ({ type: "wallet" as const, item: w })),
  ];

  const hasResults = allResults.length > 0;
  const showDropdown = !isFilterPage && focused && query.length >= 1;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || !hasResults) {
      if (e.key === "Escape") { setQuery(""); setFocused(false); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, allResults.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && allResults[activeIdx]) { e.preventDefault(); selectResult(allResults[activeIdx]); }
    if (e.key === "Escape") { setQuery(""); setFocused(false); }
  };

  const selectResult = (r: AnyResult) => {
    setFocused(false);
    setQuery("");
    if (r.type === "nav") navigate(r.item.to);
    else if (r.type === "tx") navigate("/transactions");
    else if (r.type === "payout") navigate("/payout");
    else if (r.type === "wallet") navigate("/balance");
  };

  const placeholder = location.pathname === "/transactions"
    ? "Filter by reference, amount, date…"
    : location.pathname === "/payout"
    ? "Filter payouts by recipient, amount…"
    : "Search payouts, transactions, accounts…";

  // Divider helper
  const divider = (show: boolean) => show ? <div style={{ height: 1, background: "hsl(var(--theo-light))" }} /> : null;

  return (
    <div style={{ position: "relative", flex: 1, maxWidth: 380 }}>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "hsl(var(--theo-cream))",
          border: `1px solid ${focused ? "hsl(var(--theo-blue))" : "hsl(var(--theo-light))"}`,
          borderRadius: 8, padding: "7px 12px",
          transition: "border-color 130ms",
        }}
      >
        <Search style={{ width: 13, height: 13, stroke: "hsl(var(--theo-mid))", fill: "none", strokeWidth: 2, flexShrink: 0 }} />
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={e => { setQuery(e.target.value); setActiveIdx(0); }}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          style={{
            border: "none", background: "transparent", outline: "none",
            fontFamily: "inherit", fontSize: 13, color: "hsl(var(--theo-ink))", width: "100%",
          }}
        />
        {query && (
          <button
            onClick={() => { setQuery(""); inputRef.current?.focus(); }}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "hsl(var(--theo-mid))", fontSize: 16, lineHeight: 1, flexShrink: 0 }}
          >
            ×
          </button>
        )}
      </div>

      {showDropdown && (
        <div
          ref={dropdownRef}
          style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
            background: "#fff", borderRadius: 10, zIndex: 200,
            boxShadow: "0 8px 32px rgba(51,53,154,0.14), 0 1px 4px rgba(0,0,0,0.08)",
            border: "1px solid hsl(var(--theo-light))",
            overflow: "hidden",
          }}
        >
          {!hasResults && query.length >= 2 && (
            <div style={{ padding: "14px 12px", fontSize: 13, color: "hsl(var(--theo-mid))" }}>
              No results for "{query}"
            </div>
          )}

          {navMatches.length > 0 && (
            <>
              <SectionLabel label="Navigate" />
              {navMatches.map((n, i) => {
                const Icon = n.icon;
                return (
                  <button
                    key={n.to}
                    onMouseDown={() => selectResult({ type: "nav", item: n })}
                    onMouseEnter={() => setActiveIdx(i)}
                    style={{
                      display: "flex", alignItems: "center", gap: 9,
                      width: "100%", padding: "8px 12px", border: "none",
                      background: activeIdx === i ? "hsl(var(--theo-blue-soft))" : "transparent",
                      cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                      transition: "background 80ms",
                    }}
                  >
                    <Icon style={{ width: 13, height: 13, stroke: "hsl(var(--theo-blue))", fill: "none", strokeWidth: 2, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--theo-blue))" }}>{n.label}</span>
                    <span style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginLeft: "auto" }}>↵</span>
                  </button>
                );
              })}
            </>
          )}

          {payoutResults.length > 0 && (
            <>
              {divider(navMatches.length > 0)}
              <SectionLabel label="Payouts" />
              {payoutResults.map((p, i) => {
                const gIdx = navMatches.length + i;
                return (
                  <ResultRow
                    key={p.id}
                    active={activeIdx === gIdx}
                    onSelect={() => selectResult({ type: "payout", item: p })}
                    onHover={() => setActiveIdx(gIdx)}
                    left={p.recipient_name}
                    sub={`${new Date(p.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}${p.memo ? ` · ${p.memo}` : ""}`}
                    right={`$${Number(p.amount_usdc).toLocaleString()} USDC`}
                  />
                );
              })}
            </>
          )}

          {txResults.length > 0 && (
            <>
              {divider(navMatches.length + payoutResults.length > 0)}
              <SectionLabel label="Conversions" />
              {txResults.map((t, i) => {
                const gIdx = navMatches.length + payoutResults.length + i;
                return (
                  <ResultRow
                    key={t.id}
                    active={activeIdx === gIdx}
                    onSelect={() => selectResult({ type: "tx", item: t })}
                    onHover={() => setActiveIdx(gIdx)}
                    left={<span style={{ fontFamily: "monospace" }}>{t.reference_number}</span>}
                    sub={new Date(t.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    right={`$${Number(t.usdc_amount).toLocaleString()} USDC`}
                  />
                );
              })}
            </>
          )}

          {walletResults.length > 0 && (
            <>
              {divider(navMatches.length + payoutResults.length + txResults.length > 0)}
              <SectionLabel label="Accounts" />
              {walletResults.map((w, i) => {
                const gIdx = navMatches.length + payoutResults.length + txResults.length + i;
                return (
                  <ResultRow
                    key={w.id}
                    active={activeIdx === gIdx}
                    onSelect={() => selectResult({ type: "wallet", item: w })}
                    onHover={() => setActiveIdx(gIdx)}
                    left={w.label ?? "Unnamed account"}
                    right={`${w.stellar_address.slice(0, 6)}…${w.stellar_address.slice(-4)}`}
                  />
                );
              })}
            </>
          )}

          {hasResults && (
            <div style={{ padding: "6px 12px 8px", borderTop: "1px solid hsl(var(--theo-light))" }}>
              <span style={{ fontSize: 10, color: "hsl(var(--theo-mid))" }}>↑↓ navigate · ↵ select · Esc clear</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SidebarBody({
  isAdmin, displayName, initials, email, onSignOut, onNavigate,
}: {
  isAdmin: boolean; displayName: string; initials: string; email: string;
  onSignOut: () => void; onNavigate?: () => void;
}) {
  return (
    <div
      style={{ display: "flex", flexDirection: "column", height: "100%", background: SIDEBAR_BG }}
      onClick={(e) => {
        // Close mobile drawer when a NavLink is clicked
        const t = e.target as HTMLElement;
        if (onNavigate && t.closest("a")) onNavigate();
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
        {mainNav.filter(n => n.to !== "/settings").map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </div>

      {/* Account section */}
      <div style={{ padding: "6px 10px 4px", display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "rgba(255,255,255,0.35)", padding: "10px 6px 4px" }}>
          Account
        </div>
        <NavItem to="/billing" label="Billing" icon={Receipt} />
        <NavItem to="/settings" label="Settings" icon={Settings} />
        {isAdmin && (
          <>
            <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "rgba(255,255,255,0.35)", padding: "10px 6px 4px" }}>
              Admin
            </div>
            <NavItem to="/admin/kyb" label="KYB Review" icon={ShieldCheck} />
            <NavItem to="/admin/conversions" label="Orders" icon={ArrowLeftRight} />
            <NavItem to="/admin/tools" label="Tools" icon={Wrench} />
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
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.40)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>
              {email}
            </div>
          </div>
        </div>
        <button
          onClick={onSignOut}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            fontSize: 11, color: "rgba(255,255,255,0.45)",
            border: "none", background: "none", cursor: "pointer",
            fontFamily: "inherit", marginTop: 10, padding: 0,
            transition: "color 130ms",
          }}
        >
          <LogOut style={{ width: 12, height: 12, stroke: "currentColor", fill: "none", strokeWidth: 1.8 }} />
          Sign out
        </button>
      </div>
    </div>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { isAdmin } = useRoles();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close mobile drawer on route change
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const displayName =
    user?.user_metadata?.display_name ||
    user?.email?.split("@")[0] ||
    "User";
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "hsl(var(--theo-cream))" }}>
      {/* ── Desktop sidebar ───────────────────────────────── */}
      <aside
        className="hidden md:flex"
        style={{
          width: 196, minWidth: 196, flexDirection: "column",
          height: "100vh", flexShrink: 0,
        }}
      >
        <SidebarBody
          isAdmin={isAdmin}
          displayName={displayName}
          initials={initials}
          email={user?.email ?? ""}
          onSignOut={signOut}
        />
      </aside>

      {/* ── Mobile drawer ─────────────────────────────────── */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" className="p-0 w-[260px] border-0" style={{ background: SIDEBAR_BG }}>
          <SidebarBody
            isAdmin={isAdmin}
            displayName={displayName}
            initials={initials}
            email={user?.email ?? ""}
            onSignOut={signOut}
            onNavigate={() => setDrawerOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* ── Main ──────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        {/* Mobile top bar */}
        <header
          className="md:hidden flex items-center justify-between px-4 py-3 flex-shrink-0"
          style={{ background: SIDEBAR_BG, borderBottom: "1px solid rgba(255,255,255,0.08)" }}
        >
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              style={{ background: "none", border: "none", color: "#fff", padding: 4, cursor: "pointer", display: "flex" }}
            >
              <Menu style={{ width: 22, height: 22 }} />
            </button>
            <Link to="/dashboard" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
              <div style={{ width: 24, height: 24, borderRadius: 6, background: GOLD, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 14, color: SIDEBAR_BG }}>T</div>
              <span style={{ fontWeight: 800, fontSize: 16, color: "#fff" }}>Theo</span>
            </Link>
          </div>
          <div
            style={{
              width: 30, height: 30, borderRadius: "50%",
              background: GOLD,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 800, fontSize: 12, color: SIDEBAR_BG,
            }}
          >
            {initials}
          </div>
        </header>

        {/* Desktop topbar */}
        <div
          className="hidden md:flex"
          style={{
            alignItems: "center", gap: 12,
            padding: "10px 28px",
            background: "#ffffff",
            borderBottom: "1px solid hsl(var(--theo-light))",
            flexShrink: 0, height: 52,
          }}
        >
          <GlobalSearchBar />
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

        {/* Mobile search bar */}
        <div className="md:hidden flex-shrink-0" style={{ padding: "8px 16px", background: "#fff", borderBottom: "1px solid hsl(var(--theo-light))" }}>
          <GlobalSearchBar />
        </div>

        {/* Content */}
        <main className="flex-1 overflow-y-auto" style={{ padding: "clamp(16px, 4vw, 28px)" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
