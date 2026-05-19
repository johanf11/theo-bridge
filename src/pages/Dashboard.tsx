import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { useCustomerBalance } from "@/hooks/useCustomerBalance";
import { useBlendPositions } from "@/hooks/useBlendPositions";
import { useAuth } from "@/lib/auth";
import { fmtHTGC } from "@/lib/format";
import { Plus, FileText, AlertTriangle } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

type Customer = {
  id: string; company_name: string; contact_name: string | null;
  kyb_status: "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";
  fee_bps: number | null; corridor_bps: number | null;
};

type UnifiedTx = {
  id: string;
  type: "conversion" | "swap" | "payout";
  status: string;
  usdc_amount: number;
  htg_amount: number | null;
  rate: number | null;
  reference: string;
  description: string;
  created_at: string;
  order_kind?: string | null;
  swap_direction?: string | null;
};

type Period = "7D" | "30D" | "60D" | "YTD" | "1Y";
type BarRow = { label: string; conversions: number; payouts: number };
type SplitSlice = { name: string; value: number };
type RawOrder  = { usdc_amount: number; created_at: string; status: string };
type RawPayout = { amount_usdc: number; created_at: string; status: string; memo?: string | null };

// ── Chart bucketing ───────────────────────────────────────────────────────────

function buildBuckets(
  orders: RawOrder[], payouts: RawPayout[], period: Period
): BarRow[] {
  const now = new Date();
  const buckets: { label: string; start: Date; end: Date }[] = [];

  if (period === "7D") {
    // 7 daily buckets
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const end = new Date(d); end.setDate(end.getDate() + 1);
      buckets.push({ label: d.toLocaleDateString("en-US", { weekday: "short" }), start: d, end });
    }
  } else if (period === "30D" || period === "60D") {
    // Weekly buckets
    const weeks = period === "30D" ? 4 : 9;
    for (let i = weeks - 1; i >= 0; i--) {
      const end = new Date(now);
      end.setDate(end.getDate() - i * 7);
      end.setHours(23, 59, 59, 999);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      buckets.push({
        label: start.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        start, end,
      });
    }
  } else if (period === "YTD") {
    // Monthly from Jan to current month
    const yr = now.getFullYear();
    for (let m = 0; m <= now.getMonth(); m++) {
      const start = new Date(yr, m, 1);
      const end   = new Date(yr, m + 1, 1);
      buckets.push({ label: start.toLocaleString("en-US", { month: "short" }), start, end });
    }
  } else {
    // 1Y — last 12 months
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      buckets.push({ label: d.toLocaleString("en-US", { month: "short" }), start: d, end });
    }
  }

  return buckets.map(({ label, start, end }) => ({
    label,
    conversions: Math.round(
      orders
        .filter(o => o.status === "COMPLETED" && new Date(o.created_at) >= start && new Date(o.created_at) < end)
        .reduce((s, o) => s + Number(o.usdc_amount), 0)
    ),
    payouts: Math.round(
      payouts
        .filter(p => p.status === "COMPLETED" && p.memo !== "internal-transfer" && new Date(p.created_at) >= start && new Date(p.created_at) < end)
        .reduce((s, p) => s + Number(p.amount_usdc), 0)
    ),
  }));
}

function periodStart(period: Period): Date {
  const now = new Date();
  if (period === "7D")  { const d = new Date(now); d.setDate(d.getDate() - 7);   return d; }
  if (period === "30D") { const d = new Date(now); d.setDate(d.getDate() - 30);  return d; }
  if (period === "60D") { const d = new Date(now); d.setDate(d.getDate() - 60);  return d; }
  if (period === "YTD") return new Date(now.getFullYear(), 0, 1);
  // 1Y
  const d = new Date(now); d.setFullYear(d.getFullYear() - 1); return d;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const GREETING = (() => {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
})();

const STATUS_PILL: Record<string, { bg: string; color: string; label: string }> = {
  COMPLETED: { bg: "#EFFBF3", color: "#1A7F37", label: "Settled" },
  QUOTED:    { bg: "#FFF8E0", color: "#7A5F00", label: "Awaiting" },
  FUNDED:    { bg: "#E0F5FF", color: "#0A5A8A", label: "Processing" },
  RELEASING: { bg: "#E0F5FF", color: "#0A5A8A", label: "Releasing" },
  FAILED:    { bg: "#FEE2E2", color: "#B91C1C", label: "Failed" },
  EXPIRED:   { bg: "#F3F4F6", color: "#6B7280", label: "Expired" },
  PENDING:   { bg: "#FFF8E0", color: "#7A5F00", label: "Processing" },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS_PILL[status] ?? STATUS_PILL.PENDING;
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 700, borderRadius: 99, padding: "3px 8px" }}>
      {s.label}
    </span>
  );
}

const QUICK_ACTIONS = [
  {
    label: "Start a conversion", to: "/convert",
    icon: <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: "hsl(var(--theo-blue))", fill: "none", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, flexShrink: 0, opacity: 0.7 }}><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>,
  },
  {
    label: "Send a payout", to: "/payout",
    icon: <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: "hsl(var(--theo-blue))", fill: "none", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, flexShrink: 0, opacity: 0.7 }}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  },
  {
    label: "Create invoice", to: "/invoices",
    icon: <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: "hsl(var(--theo-blue))", fill: "none", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, flexShrink: 0, opacity: 0.7 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
  },
  {
    label: "View balances", to: "/balance",
    icon: <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: "hsl(var(--theo-blue))", fill: "none", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, flexShrink: 0, opacity: 0.7 }}><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>,
  },
  {
    label: "Team & permissions", to: "/settings",
    icon: <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: "hsl(var(--theo-blue))", fill: "none", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, flexShrink: 0, opacity: 0.7 }}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  },
];

// ── Tooltip for bar chart ─────────────────────────────────────────────────────

const VolumeTooltip = ({ active, payload, label }: {
  active?: boolean; payload?: { value: number; name: string; color: string }[]; label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#fff", border: "1px solid hsl(var(--theo-light))", borderRadius: 8, padding: "8px 12px", fontSize: 12, boxShadow: "0 4px 12px rgba(51,53,154,0.10)" }}>
      <div style={{ fontWeight: 700, color: "hsl(var(--theo-blue))", marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, display: "inline-block" }} />
          <span style={{ color: "hsl(var(--theo-mid))" }}>{p.name}:</span>
          <span style={{ fontWeight: 700, color: "hsl(var(--theo-blue))" }}>
            ${p.value.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </span>
        </div>
      ))}
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [txs, setTxs] = useState<UnifiedTx[]>([]);
  const [convertedThisMonth, setConvertedThisMonth] = useState(0);
  const [txCount30d, setTxCount30d] = useState(0);
  const { total: balance, htgcTotal } = useCustomerBalance();
  const { positions: yieldPositions, netApy } = useBlendPositions();
  const totalEarning = yieldPositions.reduce((s, p) => s + p.deposited + p.accrued, 0);
  const totalAccrued = yieldPositions.reduce((s, p) => s + p.accrued, 0);
  const hasYield = yieldPositions.length > 0;

  // Chart data
  const [period, setPeriod] = useState<Period>("YTD");
  const [rawOrders, setRawOrders]   = useState<RawOrder[]>([]);
  const [rawPayouts, setRawPayouts] = useState<RawPayout[]>([]);

  // Derived chart data — recomputes when period or raw data changes
  const volumeData = useMemo(() => buildBuckets(rawOrders, rawPayouts, period), [rawOrders, rawPayouts, period]);
  const splitData: SplitSlice[] = useMemo(() => {
    const start = periodStart(period);
    const conv = rawOrders
      .filter(o => o.status === "COMPLETED" && new Date(o.created_at) >= start)
      .reduce((s, o) => s + Number(o.usdc_amount), 0);
    const pays = rawPayouts
      .filter(p => p.status === "COMPLETED" && p.memo !== "internal-transfer" && new Date(p.created_at) >= start)
      .reduce((s, p) => s + Number(p.amount_usdc), 0);
    if (conv === 0 && pays === 0) return [];
    return [
      { name: "Conversions", value: Math.round(conv) },
      { name: "Payouts",     value: Math.round(pays) },
    ];
  }, [rawOrders, rawPayouts, period]);

  // Invoice stats
  const [invoiceStats, setInvoiceStats] = useState({
    outstanding: 0,      // total USDC in SENT invoices
    overdueCount: 0,
    overdueAmount: 0,
    paidThisMonth: 0,
  });

  useEffect(() => {
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) return;
      // Resolve effective customer — org member takes priority over own row
      let c: Customer | null = null;
      const { data: mem } = await supabase.from("org_members").select("customer_id").eq("user_id", authData.user.id).not("accepted_at", "is", null).maybeSingle();
      if (mem?.customer_id) {
        const { data: orgC } = await supabase.from("customers").select("id, company_name, contact_name, kyb_status, fee_bps, corridor_bps").eq("id", mem.customer_id).maybeSingle();
        c = orgC as Customer ?? null;
      } else {
        const { data: own } = await supabase
          .from("customers")
          .select("id, company_name, contact_name, kyb_status, fee_bps, corridor_bps")
          .eq("user_id", authData.user.id)
          .maybeSingle();
        c = own as Customer ?? null;
      }
      const customers = c ? [c] : [];
      void customers; // used below via c
      setCustomer(c as Customer | null);
      if (!c) return;

      const monthStart = new Date();
      monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      // Fetch 1 full year of data so all period filters work client-side
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

      const [
        { data: orders },
        { data: payouts },
        { data: monthOrders },
        { count: orderCount30d },
        { count: payoutCount30d },
        { data: allOrders1y },
        { data: allPayouts1y },
        { data: invoices },
      ] = await Promise.all([
        supabase
          .from("orders")
          .select("id, status, usdc_amount, htg_amount, rate, reference_number, created_at, order_kind, swap_direction")
          .eq("customer_id", c.id)
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("payouts")
          .select("id, status, amount_usdc, recipient_name, memo, created_at")
          .eq("customer_id", c.id)
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("orders")
          .select("htg_amount")
          .eq("customer_id", c.id)
          .eq("status", "COMPLETED")
          .gte("created_at", monthStart.toISOString()),
        supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", c.id)
          .gte("created_at", thirtyDaysAgo.toISOString()),
        supabase
          .from("payouts")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", c.id)
          .gte("created_at", thirtyDaysAgo.toISOString()),
        // Full year of orders for chart — period filtering is client-side
        supabase
          .from("orders")
          .select("usdc_amount, created_at, status")
          .eq("customer_id", c.id)
          .gte("created_at", oneYearAgo.toISOString()),
        // Full year of payouts for chart
        supabase
          .from("payouts")
          .select("amount_usdc, created_at, status, memo")
          .eq("customer_id", c.id)
          .gte("created_at", oneYearAgo.toISOString()),
        // Invoices for stats
        supabase
          .from("invoices")
          .select("status, total, paid_at")
          .eq("customer_id", c.id),
      ]);

      // ── Merge recent transactions ──────────────────────────────────────────
      const orderTxs: UnifiedTx[] = (orders ?? []).map((o) => {
        const kind = (o as { order_kind?: string | null }).order_kind ?? null;
        const swap_direction = (o as { swap_direction?: string | null }).swap_direction ?? null;
        const isSwap = kind === "htgc_usdc_swap";
        const description = (() => {
          if (!isSwap) return "HTG → USDC";
          if (swap_direction === "usdc_to_htgc") return "USDC → HTG-C";
          if (swap_direction === "htgc_to_usdc") return "HTG → USDC";
          if (kind === "htgc_usdc_swap") return "HTG → USDC";
          return kind ? String(kind).replace(/_/g, " ") : "HTG → USDC";
        })();
        return {
          id: o.id,
          type: isSwap ? ("swap" as const) : ("conversion" as const),
          order_kind: kind,
          swap_direction,
          status: o.status,
          usdc_amount: Number(o.usdc_amount),
          htg_amount: o.htg_amount != null ? Number(o.htg_amount) : null,
          rate: o.rate ? Number(o.rate) : null,
          reference: o.reference_number,
          description,
          created_at: o.created_at,
        };
      });

      const payoutTxs: UnifiedTx[] = (payouts ?? []).map((p) => ({
        id: p.id, type: "payout" as const,
        status: p.status,
        usdc_amount: Number(p.amount_usdc),
        htg_amount: null,
        rate: null,
        reference: (p.memo && p.memo !== "internal-transfer" && p.memo !== "blend-withdraw") ? p.memo : p.id.slice(0, 8).toUpperCase(),
        description: p.recipient_name,
        created_at: p.created_at,
      }));

      const merged = [...orderTxs, ...payoutTxs]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 6);
      setTxs(merged);

      setConvertedThisMonth(
        (monthOrders ?? []).reduce((s, o) => s + Number(o.htg_amount ?? 0), 0)
      );
      setTxCount30d((orderCount30d ?? 0) + (payoutCount30d ?? 0));

      // Cache raw data — chart is computed reactively via useMemo
      setRawOrders((allOrders1y ?? []) as RawOrder[]);
      setRawPayouts((allPayouts1y ?? []) as RawPayout[]);

      // ── Invoice stats ──────────────────────────────────────────────────────
      const today = new Date();
      const invList = (invoices ?? []) as { status: string; total: number; paid_at: string | null }[];
      const outstanding = invList
        .filter((i) => i.status === "SENT")
        .reduce((s, i) => s + Number(i.total ?? 0), 0);
      const overdue = invList.filter((i) => i.status === "OVERDUE");
      const paidThisMonth = invList
        .filter((i) => i.status === "PAID" && i.paid_at && new Date(i.paid_at) >= monthStart)
        .reduce((s, i) => s + Number(i.total ?? 0), 0);

      setInvoiceStats({
        outstanding,
        overdueCount: overdue.length,
        overdueAmount: overdue.reduce((s, i) => s + Number(i.total ?? 0), 0),
        paidThisMonth,
      });
    })();
  }, []);

  const displayName =
    user?.user_metadata?.display_name ||
    customer?.contact_name ||
    customer?.company_name ||
    "there";

  return (
    <AppLayout>
      {/* Page header */}
      <div className="flex items-start justify-between mb-1">
        <div>
          <div className="font-extrabold" style={{ fontSize: 22, color: "hsl(var(--theo-blue))", letterSpacing: "-0.02em" }}>
            {GREETING}, {displayName}.
          </div>
          <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))", marginTop: 2 }}>
            {customer?.company_name ?? "—"} · Last updated just now
          </div>
        </div>
        <button
          onClick={() => navigate("/convert")}
          className="flex items-center gap-1.5 font-bold text-white transition-colors"
          style={{ background: "hsl(var(--theo-blue))", borderRadius: 8, padding: "8px 16px", fontSize: 13, border: "none", cursor: "pointer", fontFamily: "inherit" }}
          onMouseEnter={e => (e.currentTarget.style.background = "#3E40B0")}
          onMouseLeave={e => (e.currentTarget.style.background = "hsl(var(--theo-blue))")}
        >
          <Plus className="h-3.5 w-3.5" style={{ strokeWidth: 2 }} />
          New conversion
        </button>
      </div>
      <div className="mb-4" style={{ width: 28, height: 3, background: "hsl(var(--theo-gold))", borderRadius: 2, marginTop: 8 }} />

      {/* ── Stat cards ──────────────────────────────────────────────────────── */}
      <div className={`grid gap-3.5 mb-4`} style={{ gridTemplateColumns: `repeat(${hasYield ? 6 : 5}, 1fr)` }}>

        {/* USDC balance */}
        <div className="rounded-xl p-4 shadow-xs" style={{ background: "hsl(var(--theo-gold))" }}>
          <div className="font-bold uppercase mb-2" style={{ fontSize: 10, letterSpacing: "0.12em", color: "rgba(51,53,154,0.55)" }}>USDC Balance</div>
          <div className="font-extrabold leading-none" style={{ fontSize: 24, letterSpacing: "-1px", color: "hsl(var(--theo-blue))" }}>
            ${(balance + totalEarning).toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#1A7F37", marginTop: 6 }}>↑ Theo network</div>
        </div>

        {/* HTG-C balance */}
        <div className="rounded-xl p-4 shadow-xs" style={{ background: "hsl(var(--theo-cyan))" }}>
          <div className="font-bold uppercase mb-2" style={{ fontSize: 10, letterSpacing: "0.12em", color: "rgba(15,29,84,0.50)" }}>HTG-C Balance</div>
          <div className="font-extrabold leading-none" style={{ fontSize: 24, letterSpacing: "-1px", color: "hsl(var(--theo-blue))" }}>
            {htgcTotal.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--theo-blue))", marginTop: 6, opacity: 0.6 }}>Gourde</div>
        </div>

        {/* Yield */}
        {hasYield && (
          <Link
            to="/balance"
            className="rounded-xl p-4 shadow-xs bg-card border border-border transition-colors hover:border-[hsl(var(--theo-cyan))]"
            style={{ textDecoration: "none" }}
          >
            <div className="font-bold uppercase mb-2" style={{ fontSize: 10, letterSpacing: "0.12em", color: "hsl(var(--theo-mid))" }}>Yield Earned</div>
            <div className="font-extrabold leading-none" style={{ fontSize: 24, letterSpacing: "-1px", color: "hsl(150 70% 25%)" }}>
              +${totalAccrued.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--theo-mid))", marginTop: 6 }}>
              {(netApy * 100).toFixed(2)}% APY
            </div>
          </Link>
        )}

        {/* HTG converted */}
        <div className="rounded-xl p-4 shadow-xs bg-card border border-border">
          <div className="font-bold uppercase mb-2" style={{ fontSize: 10, letterSpacing: "0.12em", color: "hsl(var(--theo-mid))" }}>HTG Converted</div>
          <div className="font-extrabold leading-none" style={{ fontSize: 24, letterSpacing: "-1px", color: "hsl(var(--theo-blue))" }}>
            {convertedThisMonth.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--theo-mid))", marginTop: 6 }}>
            {new Date().toLocaleString("en-US", { month: "long" })}
          </div>
        </div>

        {/* Transactions */}
        <div className="rounded-xl p-4 shadow-xs bg-card border border-border">
          <div className="font-bold uppercase mb-2" style={{ fontSize: 10, letterSpacing: "0.12em", color: "hsl(var(--theo-mid))" }}>Transactions</div>
          <div className="font-extrabold leading-none" style={{ fontSize: 24, letterSpacing: "-1px", color: "hsl(var(--theo-blue))" }}>{txCount30d}</div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--theo-mid))", marginTop: 6 }}>Last 30 days</div>
        </div>

        {/* Invoice receivables */}
        <Link
          to="/invoices"
          className="rounded-xl p-4 shadow-xs bg-card border border-border transition-colors"
          style={{ textDecoration: "none" }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = "hsl(var(--theo-blue))")}
          onMouseLeave={e => (e.currentTarget.style.borderColor = "")}
        >
          <div className="font-bold uppercase mb-2 flex items-center gap-1.5" style={{ fontSize: 10, letterSpacing: "0.12em", color: "hsl(var(--theo-mid))" }}>
            <FileText size={10} />
            Receivables
          </div>
          <div className="font-extrabold leading-none" style={{ fontSize: 24, letterSpacing: "-1px", color: "hsl(var(--theo-blue))" }}>
            ${invoiceStats.outstanding.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
            {invoiceStats.overdueCount > 0 ? (
              <span style={{ color: "#B91C1C", display: "flex", alignItems: "center", gap: 3 }}>
                <AlertTriangle size={10} />
                {invoiceStats.overdueCount} overdue
              </span>
            ) : (
              <span style={{ color: "#1A7F37" }}>All current</span>
            )}
          </div>
        </Link>
      </div>

      {/* ── Charts row ──────────────────────────────────────────────────────── */}
      <div className="grid mb-4" style={{ gridTemplateColumns: "5fr 2fr 2fr", gap: 14 }}>

        {/* Monthly volume bar chart — REAL DATA */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-bold" style={{ fontSize: 14, color: "hsl(var(--theo-blue))" }}>Volume</div>
              <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginTop: 2 }}>USDC · conversions &amp; payouts</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {/* Legend */}
              <div style={{ display: "flex", gap: 8, fontSize: 11 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: "hsl(var(--theo-blue))", display: "inline-block" }} />
                  <span style={{ color: "hsl(var(--theo-mid))" }}>Conv</span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: "hsl(var(--theo-gold))", display: "inline-block" }} />
                  <span style={{ color: "hsl(var(--theo-mid))" }}>Payouts</span>
                </span>
              </div>
              {/* Period selector */}
              <div style={{ display: "flex", borderRadius: 7, border: "1px solid hsl(var(--theo-light))", overflow: "hidden" }}>
                {(["7D", "30D", "60D", "YTD", "1Y"] as Period[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    style={{
                      padding: "4px 9px", border: "none", fontSize: 11, fontWeight: 700,
                      cursor: "pointer", fontFamily: "inherit", transition: "all 120ms",
                      background: period === p ? "hsl(var(--theo-blue))" : "transparent",
                      color: period === p ? "#fff" : "hsl(var(--theo-mid))",
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {volumeData.some(b => b.conversions > 0 || b.payouts > 0) ? (
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={volumeData} barSize={period === "7D" ? 22 : period === "1Y" ? 14 : 16} barGap={3}>
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--theo-mid))" }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 10, fill: "hsl(var(--theo-mid))" }}
                  axisLine={false} tickLine={false}
                  tickFormatter={(v) => v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`}
                  width={42}
                />
                <Tooltip content={<VolumeTooltip />} cursor={{ fill: "hsl(var(--theo-cream))", radius: 4 }} />
                <Bar dataKey="conversions" name="Conversions" fill="hsl(var(--theo-blue))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="payouts"     name="Payouts"     fill="hsl(var(--theo-gold))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 140, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "hsl(var(--theo-mid))" }}>
              No activity in this period
            </div>
          )}
        </div>

        {/* Volume split — inline breakdown */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-xs">
          <div className="font-bold mb-1" style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>Volume split</div>
          <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginBottom: 12 }}>{period} USDC mix</div>
          {splitData.length > 0 ? (() => {
            const total = splitData.reduce((s, d) => s + d.value, 0);
            const conv = splitData.find(d => d.name === "Conversions")?.value ?? 0;
            const pays = splitData.find(d => d.name === "Payouts")?.value ?? 0;
            const convPct = total > 0 ? Math.round((conv / total) * 100) : 0;
            const paysPct = total > 0 ? Math.round((pays / total) * 100) : 0;
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {/* Stacked bar */}
                <div style={{ height: 10, borderRadius: 999, overflow: "hidden", display: "flex", gap: 2 }}>
                  <div style={{ width: `${convPct}%`, background: "hsl(var(--theo-blue))", borderRadius: "999px 0 0 999px", minWidth: convPct > 0 ? 4 : 0 }} />
                  <div style={{ width: `${paysPct}%`, background: "hsl(var(--theo-gold))", borderRadius: "0 999px 999px 0", minWidth: paysPct > 0 ? 4 : 0 }} />
                </div>
                {/* Legend rows */}
                {[
                  { label: "Conversions", value: conv, pct: convPct, color: "hsl(var(--theo-blue))" },
                  { label: "Payouts",     value: pays, pct: paysPct, color: "hsl(var(--theo-gold))" },
                ].map(row => (
                  <div key={row.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: row.color, flexShrink: 0, display: "inline-block" }} />
                      <span style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>{row.label}</span>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "hsl(var(--theo-blue))" }}>
                        ${row.value.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                      </span>
                      <span style={{ fontSize: 10, color: "hsl(var(--theo-mid))", marginLeft: 5 }}>{row.pct}%</span>
                    </div>
                  </div>
                ))}
                <div style={{ borderTop: "1px solid hsl(var(--theo-light))", paddingTop: 8, display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>Total</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "hsl(var(--theo-blue))" }}>
                    ${total.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </span>
                </div>
              </div>
            );
          })() : (
            <div style={{ height: 100, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "hsl(var(--theo-mid))" }}>
              No data yet
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-xs">
          <div className="font-bold mb-3" style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>Quick Actions</div>
          <div className="flex flex-col gap-0.5">
            {QUICK_ACTIONS.map(({ label, to, icon }) => (
              <Link
                key={to}
                to={to}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-colors"
                style={{ fontSize: 12, color: "hsl(var(--theo-blue))", fontWeight: 500, textDecoration: "none" }}
                onMouseEnter={e => (e.currentTarget.style.background = "hsl(var(--theo-blue-soft))")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                {icon}
                {label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* ── Recent transactions ──────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div className="font-bold" style={{ fontSize: 14, color: "hsl(var(--theo-blue))" }}>Recent transactions</div>
          <Link
            to="/transactions"
            className="font-bold transition-colors"
            style={{ fontSize: 12, color: "hsl(var(--theo-blue))", border: "1.5px solid hsl(var(--theo-blue))", borderRadius: 7, padding: "5px 12px", textDecoration: "none" }}
          >
            View all
          </Link>
        </div>
        {txs.length === 0 ? (
          <div className="py-14 flex flex-col items-center gap-3">
            <div className="text-sm text-muted-foreground">
              No transactions yet.{" "}
              <Link to="/convert" className="font-semibold" style={{ color: "hsl(var(--theo-cyan))" }}>
                Start your first conversion.
              </Link>
            </div>
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ background: "hsl(var(--theo-cream))" }}>
                {["Date", "Type", "Description", "Amount", "HTG Sent", "Rate", "Status", "Ref"].map((h) => (
                  <th key={h} className="text-left px-5 py-2.5 border-b border-border"
                    style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.10em", color: "hsl(var(--theo-mid))" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {txs.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                  <td className="px-5 py-3" style={{ fontSize: 13 }}>
                    {new Date(t.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </td>
                  <td className="px-5 py-3">
                    <span style={{
                      fontSize: 11, fontWeight: 700, borderRadius: 99, padding: "3px 8px",
                      background: t.type === "conversion" ? "hsl(var(--theo-gold-soft))" : t.type === "swap" ? "hsl(195 85% 92%)" : "hsl(var(--theo-blue-soft))",
                      color: t.type === "conversion" ? "#7A5F00" : t.type === "swap" ? "hsl(200 80% 25%)" : "hsl(var(--theo-blue))",
                    }}>
                      {t.type === "conversion" ? "Conversion" : t.type === "swap" ? "Swap" : "Payout"}
                    </span>
                  </td>
                  <td className="px-5 py-3" style={{ fontSize: 12, color: "hsl(var(--theo-mid))", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.description}
                  </td>
                  <td className="px-5 py-3" style={{ fontSize: 13, fontWeight: 700 }}>
                    {t.type === "swap" && t.swap_direction === "usdc_to_htgc"
                      ? `${fmtHTGC(Number(t.htg_amount ?? 0))} HTG`
                      : `$${Number(t.usdc_amount).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
                  </td>
                  <td className="px-5 py-3" style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>
                    {t.type === "payout" || (t.type === "swap" && t.swap_direction === "usdc_to_htgc")
                      ? "—"
                      : t.htg_amount != null && t.htg_amount > 0
                        ? `${fmtHTGC(t.htg_amount)} HTG`
                        : "—"}
                  </td>
                  <td className="px-5 py-3" style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>
                    {t.rate ? t.rate.toFixed(2) : "—"}
                  </td>
                  <td className="px-5 py-3"><StatusPill status={t.status} /></td>
                  <td className="px-5 py-3" style={{ fontFamily: "monospace", fontSize: 12, color: "hsl(var(--theo-mid))" }}>
                    {t.reference}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppLayout>
  );
}
