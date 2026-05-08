import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { fmtUSDC, fmtHTG } from "@/lib/format";
import { useCustomerBalance } from "@/hooks/useCustomerBalance";
import { useBlendPositions } from "@/hooks/useBlendPositions";
import { useAuth } from "@/lib/auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { Plus, ArrowRightLeft, SendHorizonal, Wallet, Users, ChevronRight } from "lucide-react";

type Customer = {
  id: string; company_name: string; contact_name: string | null;
  kyb_status: "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";
  fee_bps: number | null; corridor_bps: number | null;
};

type UnifiedTx = {
  id: string;
  type: "conversion" | "payout";
  status: string;
  usdc_amount: number;
  htg_amount: number | null;
  rate: number | null;
  reference: string;
  description: string;
  created_at: string;
};

const CHART_DATA: Record<string, { vals: number[]; labels: string[]; active: number }> = {
  "7D": { vals: [45, 60, 38, 72, 55, 80, 65], labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], active: 5 },
  "1M": {
    vals: [20,35,28,45,38,52,42,60,55,48,62,58,70,65,72,68,80,75,85,78,90,82,88,95,87,92,98,88,94,100],
    labels: Array.from({ length: 30 }, (_, i) => String(i + 1)),
    active: 25,
  },
  "6M": { vals: [40, 55, 48, 62, 70, 85], labels: ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr"], active: 5 },
  "1Y": { vals: [30,35,42,38,50,45,55,60,52,65,70,85], labels: ["M","A","M","J","J","A","S","O","N","D","J","F"], active: 11 },
};

function BarChart({ period }: { period: string }) {
  const d = CHART_DATA[period];
  const max = Math.max(...d.vals);
  return (
    <div>
      <div className="flex items-end gap-1.5" style={{ height: 120 }}>
        {d.vals.map((v, i) => (
          <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
            <div
              className="w-full rounded-t-[5px] transition-all duration-200"
              style={{
                height: `${Math.round((v / max) * 100)}%`,
                minHeight: 4,
                background: i === d.active ? "hsl(var(--theo-gold))" : "hsl(var(--theo-blue-chip))",
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1.5">
        {d.labels.map((l, i) => (
          <div key={i} className="flex-1 text-center" style={{ fontSize: 9, color: "hsl(var(--theo-mid))", fontWeight: 500 }}>
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}

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
    label: "View balances", to: "/balance",
    icon: <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: "hsl(var(--theo-blue))", fill: "none", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, flexShrink: 0, opacity: 0.7 }}><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>,
  },
  {
    label: "Team & permissions", to: "/settings",
    icon: <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, stroke: "hsl(var(--theo-blue))", fill: "none", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, flexShrink: 0, opacity: 0.7 }}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  },
];

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
  const [chartPeriod, setChartPeriod] = useState("1M");

  useEffect(() => {
    (async () => {
      const { data: c } = await supabase
        .from("customers")
        .select("id, company_name, contact_name, kyb_status, fee_bps, corridor_bps")
        .maybeSingle();
      setCustomer(c as Customer | null);
      if (!c) return;

      const monthStart = new Date();
      monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const [
        { data: orders },
        { data: payouts },
        { data: monthOrders },
        { count: orderCount30d },
        { count: payoutCount30d },
      ] = await Promise.all([
        supabase
          .from("orders")
          .select("id, status, usdc_amount, htg_amount, rate, reference_number, created_at")
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
      ]);

      const orderTxs: UnifiedTx[] = (orders ?? []).map((o: any) => ({
        id: o.id, type: "conversion",
        status: o.status,
        usdc_amount: Number(o.usdc_amount),
        htg_amount: Number(o.htg_amount),
        rate: o.rate ? Number(o.rate) : null,
        reference: o.reference_number,
        description: "HTG → USDC",
        created_at: o.created_at,
      }));

      const payoutTxs: UnifiedTx[] = (payouts ?? []).map((p: any) => ({
        id: p.id, type: "payout",
        status: p.status,
        usdc_amount: Number(p.amount_usdc),
        htg_amount: null,
        rate: null,
        reference: p.id.slice(0, 8).toUpperCase(),
        description: p.recipient_name + (p.memo ? ` · ${p.memo}` : ""),
        created_at: p.created_at,
      }));

      const merged = [...orderTxs, ...payoutTxs]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 6);

      setTxs(merged);
      setConvertedThisMonth(
        (monthOrders ?? []).reduce((s, o: any) => s + Number(o.htg_amount ?? 0), 0)
      );
      setTxCount30d((orderCount30d ?? 0) + (payoutCount30d ?? 0));
    })();
  }, []);

  const displayName =
    user?.user_metadata?.display_name ||
    customer?.contact_name ||
    customer?.company_name ||
    "there";
  const txCount = txCount30d;

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

      {/* Stat cards */}
      <div className={`grid ${hasYield ? "grid-cols-5" : "grid-cols-4"} gap-3.5 mb-4`}>
        <div className="rounded-xl p-4 shadow-xs" style={{ background: "hsl(var(--theo-gold))" }}>
          <div className="font-bold uppercase mb-2" style={{ fontSize: 10, letterSpacing: "0.12em", color: "rgba(51,53,154,0.55)" }}>Total USDC Balance</div>
          <div className="font-extrabold leading-none" style={{ fontSize: 28, letterSpacing: "-1.5px", color: "hsl(var(--theo-blue))" }}>
            ${balance.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#1A7F37", marginTop: 6 }}>↑ Theo network</div>
        </div>

        <div className="rounded-xl p-4 shadow-xs" style={{ background: "hsl(var(--theo-cyan))" }}>
          <div className="font-bold uppercase mb-2" style={{ fontSize: 10, letterSpacing: "0.12em", color: "rgba(15,29,84,0.50)" }}>Total HTG-C Balance</div>
          <div className="font-extrabold leading-none" style={{ fontSize: 28, letterSpacing: "-1.5px", color: "hsl(var(--theo-blue))" }}>
            {htgcTotal.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--theo-blue))", marginTop: 6, opacity: 0.6 }}>↑ Theo network</div>
        </div>

        {hasYield && (
          <Link
            to="/balance"
            className="rounded-xl p-4 shadow-xs bg-card border border-border transition-colors hover:border-[hsl(var(--theo-cyan))]"
            style={{ textDecoration: "none" }}
          >
            <div className="font-bold uppercase mb-2" style={{ fontSize: 10, letterSpacing: "0.12em", color: "hsl(var(--theo-mid))" }}>Yield Earned</div>
            <div className="font-extrabold leading-none" style={{ fontSize: 28, letterSpacing: "-1.5px", color: "hsl(150 70% 25%)" }}>
              +${totalAccrued.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--theo-mid))", marginTop: 6 }}>
              ${totalEarning.toLocaleString("en-US", { maximumFractionDigits: 2 })} earning · {(netApy * 100).toFixed(2)}% APY
            </div>
          </Link>
        )}

        <div className="rounded-xl p-4 shadow-xs bg-card border border-border">
          <div className="font-bold uppercase mb-2" style={{ fontSize: 10, letterSpacing: "0.12em", color: "hsl(var(--theo-mid))" }}>HTG Converted This Month</div>
          <div className="font-extrabold leading-none" style={{ fontSize: 28, letterSpacing: "-1.5px", color: "hsl(var(--theo-blue))" }}>
            {convertedThisMonth.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--theo-mid))", marginTop: 6 }}>
            {new Date().toLocaleString("en-US", { month: "long" })}
          </div>
        </div>


        <div className="rounded-xl p-4 shadow-xs bg-card border border-border">
          <div className="font-bold uppercase mb-2" style={{ fontSize: 10, letterSpacing: "0.12em", color: "hsl(var(--theo-mid))" }}>Transactions</div>
          <div className="font-extrabold leading-none" style={{ fontSize: 28, letterSpacing: "-1.5px", color: "hsl(var(--theo-blue))" }}>{txCount}</div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--theo-mid))", marginTop: 6 }}>Last 30 days</div>
        </div>
      </div>

      {/* Chart + Quick Actions */}
      <div className="grid mb-4 grid-cols-1 lg:[grid-template-columns:7fr_3fr]" style={{ gap: 14 }}>
        <div className="bg-card border border-border rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div className="font-bold" style={{ fontSize: 14, color: "hsl(var(--theo-blue))" }}>
              Gross volume{" "}
              <span style={{ fontSize: 11, fontWeight: 400, color: "hsl(var(--theo-mid))", marginLeft: 6 }}>HTG → USDC</span>
            </div>
            <div className="flex gap-0.5">
              {["7D", "1M", "6M", "1Y"].map((p) => (
                <button
                  key={p}
                  onClick={() => setChartPeriod(p)}
                  className="font-bold transition-all"
                  style={{
                    padding: "4px 9px", borderRadius: 6, fontSize: 11, border: "none",
                    cursor: "pointer", fontFamily: "inherit",
                    background: chartPeriod === p ? "hsl(var(--theo-blue))" : "transparent",
                    color: chartPeriod === p ? "#fff" : "hsl(var(--theo-mid))",
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <BarChart period={chartPeriod} />
        </div>

        <div className="bg-card border border-border rounded-xl p-5 shadow-xs">
          <div className="font-bold mb-3" style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>Quick Actions</div>
          <div className="flex flex-col gap-0.5">
            {QUICK_ACTIONS.map(({ label, to, icon }) => (
              <Link
                key={to}
                to={to}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-colors"
                style={{ fontSize: 13, color: "hsl(var(--theo-blue))", fontWeight: 500, textDecoration: "none" }}
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

      {/* Recent transactions */}
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
          <div className="overflow-x-auto -mx-4 md:mx-0"><table className="w-full border-collapse min-w-[640px]">
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
                      background: t.type === "conversion" ? "hsl(var(--theo-gold-soft))" : "hsl(var(--theo-blue-soft))",
                      color: t.type === "conversion" ? "#7A5F00" : "hsl(var(--theo-blue))",
                    }}>
                      {t.type === "conversion" ? "Conversion" : "Payout"}
                    </span>
                  </td>
                  <td className="px-5 py-3" style={{ fontSize: 12, color: "hsl(var(--theo-mid))", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.description}
                  </td>
                  <td className="px-5 py-3" style={{ fontSize: 13, fontWeight: 700 }}>
                    ${Number(t.usdc_amount).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </td>
                  <td className="px-5 py-3" style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>
                    {t.htg_amount ? `G ${Number(t.htg_amount).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}
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
          </table></div>
        )}
      </div>
    </AppLayout>
  );
}
