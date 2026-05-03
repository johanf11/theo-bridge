import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/theo/StatusBadge";
import { fmtUSDC, fmtHTG } from "@/lib/format";
import { fetchTotalUsdcBalance } from "@/lib/balance";
import { Plus } from "lucide-react";

type Customer = {
  id: string; company_name: string; contact_name: string | null;
  kyb_status: "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";
};
type Order = {
  id: string; status: string; usdc_amount: number; htg_amount: number;
  reference_number: string; created_at: string;
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
                background: i === d.active
                  ? "hsl(var(--theo-gold))"
                  : "hsl(var(--theo-blue-chip))",
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

export default function Dashboard() {
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [balance, setBalance] = useState(0);
  const [chartPeriod, setChartPeriod] = useState("1M");

  useEffect(() => {
    (async () => {
      const { data: c } = await supabase
        .from("customers")
        .select("id, company_name, contact_name, kyb_status")
        .maybeSingle();
      setCustomer(c as Customer | null);
      if (!c) return;
      const { data: o } = await supabase
        .from("orders")
        .select("id, status, usdc_amount, htg_amount, reference_number, created_at")
        .eq("customer_id", c.id)
        .order("created_at", { ascending: false })
        .limit(5);
      setOrders((o ?? []) as Order[]);
      const { data: w } = await supabase
        .from("wallets")
        .select("usdc_balance")
        .eq("customer_id", c.id)
        .maybeSingle();
      setBalance(Number(w?.usdc_balance ?? 0));
    })();
  }, []);

  const displayName = customer?.contact_name ?? customer?.company_name ?? "there";
  const totalConverted = orders.reduce((s, o) => s + Number(o.usdc_amount), 0);

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
          style={{
            background: "hsl(var(--theo-blue))",
            borderRadius: 8, padding: "8px 16px",
            fontSize: 13, border: "none", cursor: "pointer",
            fontFamily: "inherit",
          }}
          onMouseEnter={e => (e.currentTarget.style.background = "#3E40B0")}
          onMouseLeave={e => (e.currentTarget.style.background = "hsl(var(--theo-blue))")}
        >
          <Plus className="h-3.5 w-3.5" style={{ strokeWidth: 2 }} />
          New conversion
        </button>
      </div>
      <div className="mb-5" style={{ width: 28, height: 3, background: "hsl(var(--theo-gold))", borderRadius: 2, marginTop: 8 }} />

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-3.5 mb-4">
        {/* Gold: balance */}
        <div className="rounded-xl p-4 shadow-xs" style={{ background: "hsl(var(--theo-gold))" }}>
          <div className="font-bold uppercase mb-2" style={{ fontSize: 10, letterSpacing: "0.12em", color: "rgba(51,53,154,0.55)" }}>
            Total USDC Balance
          </div>
          <div className="font-extrabold leading-none" style={{ fontSize: 28, letterSpacing: "-1.5px", color: "hsl(var(--theo-blue))" }}>
            ${balance.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </div>
          <div className="flex items-center gap-1 mt-1.5" style={{ fontSize: 11, fontWeight: 600, color: "#1A7F37" }}>
            ↑ Stellar network
          </div>
        </div>
        {/* White: converted */}
        <div className="rounded-xl p-4 shadow-xs bg-card border border-border">
          <div className="font-bold uppercase mb-2" style={{ fontSize: 10, letterSpacing: "0.12em", color: "hsl(var(--theo-mid))" }}>
            Converted this month
          </div>
          <div className="font-extrabold leading-none" style={{ fontSize: 28, letterSpacing: "-1.5px", color: "hsl(var(--theo-blue))" }}>
            ${totalConverted.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </div>
          <div className="flex items-center gap-1 mt-1.5" style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--theo-mid))" }}>
            All time
          </div>
        </div>
        {/* White: transactions */}
        <div className="rounded-xl p-4 shadow-xs bg-card border border-border">
          <div className="font-bold uppercase mb-2" style={{ fontSize: 10, letterSpacing: "0.12em", color: "hsl(var(--theo-mid))" }}>
            Transactions
          </div>
          <div className="font-extrabold leading-none" style={{ fontSize: 28, letterSpacing: "-1.5px", color: "hsl(var(--theo-blue))" }}>
            {orders.length}
          </div>
          <div className="flex items-center gap-1 mt-1.5" style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--theo-mid))" }}>
            Orders to date
          </div>
        </div>
        {/* White: avg settlement */}
        <div className="rounded-xl p-4 shadow-xs bg-card border border-border">
          <div className="font-bold uppercase mb-2" style={{ fontSize: 10, letterSpacing: "0.12em", color: "hsl(var(--theo-mid))" }}>
            Avg. Settlement
          </div>
          <div className="font-extrabold leading-none" style={{ fontSize: 28, letterSpacing: "-1.5px", color: "hsl(var(--theo-blue))" }}>
            1.4 min
          </div>
          <div className="flex items-center gap-1 mt-1.5" style={{ fontSize: 11, fontWeight: 600, color: "#1A7F37" }}>
            Stellar network
          </div>
        </div>
      </div>

      {/* Chart + Quick Actions */}
      <div className="grid mb-4" style={{ gridTemplateColumns: "7fr 3fr", gap: 14 }}>
        {/* Volume chart */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div className="font-bold" style={{ fontSize: 14, color: "hsl(var(--theo-blue))" }}>
              Gross volume{" "}
              <span style={{ fontSize: 11, fontWeight: 400, color: "hsl(var(--theo-mid))", marginLeft: 6 }}>
                HTG → USDC
              </span>
            </div>
            <div className="flex gap-0.5">
              {["7D", "1M", "6M", "1Y"].map((p) => (
                <button
                  key={p}
                  onClick={() => setChartPeriod(p)}
                  className="font-bold transition-all"
                  style={{
                    padding: "4px 9px", borderRadius: 6, fontSize: 11,
                    border: "none", cursor: "pointer", fontFamily: "inherit",
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

        {/* Quick actions */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-xs">
          <div className="font-bold mb-3" style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>
            Quick Actions
          </div>
          <div className="flex flex-col gap-0.5">
            {[
              { label: "Start a conversion", to: "/convert" },
              { label: "Send a payout", to: "/payout" },
              { label: "View balances", to: "/balance" },
              { label: "Complete KYB", to: "/kyb" },
            ].map(({ label, to }) => (
              <Link
                key={to}
                to={to}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-colors"
                style={{ fontSize: 13, color: "hsl(var(--theo-blue))", fontWeight: 500, textDecoration: "none" }}
                onMouseEnter={e => (e.currentTarget.style.background = "hsl(var(--theo-blue-soft))")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
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
            style={{
              fontSize: 12, color: "hsl(var(--theo-blue))",
              border: "1.5px solid hsl(var(--theo-blue))",
              borderRadius: 7, padding: "5px 12px", textDecoration: "none",
            }}
          >
            View all
          </Link>
        </div>
        {orders.length === 0 ? (
          <div className="py-14 flex flex-col items-center gap-3">
            <div className="text-sm text-muted-foreground">
              No orders yet.{" "}
              <Link to="/convert" className="font-semibold" style={{ color: "hsl(var(--theo-cyan))" }}>
                Start your first conversion.
              </Link>
            </div>
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ background: "hsl(var(--theo-cream))" }}>
                {["Date", "Type", "Amount", "HTG Sent", "Status", "Ref"].map((h) => (
                  <th key={h} className="text-left px-5 py-2.5 border-b border-border" style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.10em", color: "hsl(var(--theo-mid))" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                  <td className="px-5 py-3" style={{ fontSize: 13 }}>
                    {new Date(o.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </td>
                  <td className="px-5 py-3" style={{ fontSize: 13 }}>Conversion</td>
                  <td className="px-5 py-3" style={{ fontSize: 13, fontWeight: 700 }}>{fmtUSDC(Number(o.usdc_amount))}</td>
                  <td className="px-5 py-3" style={{ fontSize: 13 }}>{fmtHTG(Number(o.htg_amount))}</td>
                  <td className="px-5 py-3"><StatusBadge status={o.status} /></td>
                  <td className="px-5 py-3" style={{ fontFamily: "monospace", fontSize: 12, color: "hsl(var(--theo-mid))" }}>
                    {o.reference_number}
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
