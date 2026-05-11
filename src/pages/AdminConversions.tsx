import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CheckCircle2, Clock, Loader2, RefreshCw, ExternalLink, ArrowLeftRight } from "lucide-react";

type OrderStatus = "QUOTED" | "FUNDED" | "RELEASING" | "COMPLETED" | "FAILED" | "EXPIRED";

type Order = {
  id: string;
  reference_number: string;
  htg_amount: number;
  usdc_amount: number;
  rate: number;
  status: OrderStatus;
  quote_expires_at: string;
  stellar_tx_hash: string | null;
  failure_reason: string | null;
  created_at: string;
  funded_at: string | null;
  completed_at: string | null;
  customer_id: string;
  company_name?: string;
  contact_name?: string;
  email?: string;
};

type Tab = "pending" | "processing" | "completed" | "all";

const STATUS_COLORS: Record<OrderStatus, { bg: string; text: string; label: string }> = {
  QUOTED:    { bg: "#FFF8E0", text: "#7A5F00", label: "Awaiting payment" },
  FUNDED:    { bg: "#E0F5FF", text: "#0A5A8A", label: "Payment received" },
  RELEASING: { bg: "#E0F5FF", text: "#0A5A8A", label: "Releasing USDC" },
  COMPLETED: { bg: "#EFFBF3", text: "#1A7F37", label: "Complete" },
  FAILED:    { bg: "#FDE8E8", text: "#B91C1C", label: "Failed" },
  EXPIRED:   { bg: "#F3F4F6", text: "#6B7280", label: "Expired" },
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtHTG(n: number | null | undefined) {
  const v = Number(n ?? 0);
  return `${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} HTG`;
}
function fmtUSDC(n: number | null | undefined) {
  const v = Number(n ?? 0);
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function AdminConversions() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("pending");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("orders")
      .select(`
        id, reference_number, htg_amount, usdc_amount, rate, status,
        quote_expires_at, stellar_tx_hash, failure_reason,
        created_at, funded_at, completed_at, customer_id,
        customers!inner(company_name, contact_name, email)
      `)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    const rows = (data ?? []).map((r: any) => ({
      ...r,
      company_name: r.customers?.company_name,
      contact_name: r.customers?.contact_name,
      email: r.customers?.email,
    }));
    setOrders(rows as Order[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, []);

  const confirmReceipt = async (order: Order) => {
    setBusyId(order.id);
    const { data, error } = await supabase.functions.invoke("simulate-spih-payment", {
      body: { orderId: order.id },
    });
    setBusyId(null);
    const apiErr = (data as { error?: string } | null)?.error;
    if (error || apiErr) {
      const msg = apiErr ?? error?.message ?? "Failed to confirm receipt";
      if (msg.includes("not in QUOTED")) {
        toast.info("Order already moved past QUOTED — refreshing.");
        load();
      } else {
        toast.error(msg);
      }
    } else {
      toast.success(`Payment confirmed — releasing ${fmtUSDC(order.usdc_amount)} USDC`);
      setOrders((prev) =>
        prev.map((o) => o.id === order.id ? { ...o, status: "RELEASING" as OrderStatus } : o)
      );
      setTimeout(load, 2000);
    }
  };

  // Stats
  const pendingCount = orders.filter((o) => o.status === "QUOTED").length;
  const processingCount = orders.filter((o) => o.status === "FUNDED" || o.status === "RELEASING").length;
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const completedToday = orders.filter((o) => o.status === "COMPLETED" && new Date(o.completed_at ?? o.created_at) >= todayStart).length;
  const completedTodayUsdc = orders
    .filter((o) => o.status === "COMPLETED" && new Date(o.completed_at ?? o.created_at) >= todayStart)
    .reduce((s, o) => s + Number(o.usdc_amount), 0);

  const filtered = orders.filter((o) => {
    if (tab === "pending") return o.status === "QUOTED";
    if (tab === "processing") return o.status === "FUNDED" || o.status === "RELEASING";
    if (tab === "completed") return o.status === "COMPLETED" || o.status === "FAILED" || o.status === "EXPIRED";
    return true;
  });

  const tabStyle = (t: Tab): React.CSSProperties => ({
    padding: "8px 16px", fontSize: 12, fontWeight: 700,
    border: "none", background: "none", cursor: "pointer", fontFamily: "inherit",
    color: tab === t ? "hsl(var(--theo-blue))" : "hsl(var(--theo-mid))",
    borderBottom: tab === t ? "2px solid hsl(var(--theo-blue))" : "2px solid transparent",
    marginBottom: -1, transition: "all 120ms",
  });

  return (
    <AppLayout>
      {/* Header */}
      <div className="flex items-start justify-between mb-1">
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "hsl(var(--theo-cyan))" }}>
            Admin
          </div>
          <div className="font-extrabold" style={{ fontSize: 22, color: "hsl(var(--theo-blue))", letterSpacing: "-0.02em" }}>
            Orders
          </div>
          <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))", marginTop: 2 }}>
            Confirm HTG receipt to move orders through the pipeline and release USDC or mint HTG-C.
          </div>
        </div>
        <button
          onClick={load}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "transparent", border: "1.5px solid hsl(var(--border))",
            color: "hsl(var(--theo-mid))", borderRadius: 7, padding: "6px 12px",
            fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          <RefreshCw size={13} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
          Refresh
        </button>
      </div>
      <div className="mb-5" style={{ width: 28, height: 3, background: "hsl(var(--theo-gold))", borderRadius: 2, marginTop: 8 }} />

      {/* Stats */}
      <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        {[
          { label: "Awaiting payment", value: pendingCount, sub: "QUOTED orders", color: "#7A5F00", bg: "#FFF8E0", dot: "#F59E0B" },
          { label: "Processing", value: processingCount, sub: "FUNDED / Releasing", color: "hsl(var(--theo-blue))", bg: "hsl(var(--theo-blue-soft))", dot: "hsl(var(--theo-cyan))" },
          { label: "Completed today", value: completedToday, sub: "orders settled", color: "#1A7F37", bg: "#EFFBF3", dot: "#22C55E" },
          { label: "USDC released today", value: fmtUSDC(completedTodayUsdc), sub: "across all clients", color: "hsl(var(--theo-blue))", bg: "hsl(var(--theo-cream))", dot: "hsl(var(--theo-gold))" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl p-4" style={{ background: s.bg, border: "1px solid rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: s.color, marginBottom: 4 }}>
              {s.label}
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color, letterSpacing: "-0.03em", lineHeight: 1.1 }}>
              {s.value}
            </div>
            <div style={{ fontSize: 11, color: s.color, opacity: 0.7, marginTop: 3 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Tabs + table */}
      <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
        <div className="flex border-b border-border px-4">
          <button style={tabStyle("pending")} onClick={() => setTab("pending")}>
            Pending {pendingCount > 0 && <span style={{ marginLeft: 5, background: "#F59E0B", color: "#fff", borderRadius: 99, fontSize: 10, fontWeight: 700, padding: "1px 6px" }}>{pendingCount}</span>}
          </button>
          <button style={tabStyle("processing")} onClick={() => setTab("processing")}>
            Processing {processingCount > 0 && <span style={{ marginLeft: 5, background: "hsl(var(--theo-cyan))", color: "#fff", borderRadius: 99, fontSize: 10, fontWeight: 700, padding: "1px 6px" }}>{processingCount}</span>}
          </button>
          <button style={tabStyle("completed")} onClick={() => setTab("completed")}>Completed</button>
          <button style={tabStyle("all")} onClick={() => setTab("all")}>All orders</button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 size={16} className="animate-spin" /> Loading orders…
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center" style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>
            {tab === "pending" ? "No orders awaiting payment." : "No orders in this category."}
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ background: "hsl(var(--theo-cream))" }}>
                {["Client", "Reference", "HTG due", "USDC", "Rate", "Age", "Status", "Action"].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 border-b border-border"
                    style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.10em", color: "hsl(var(--theo-mid))" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const sc = STATUS_COLORS[o.status];
                const isQuoted = o.status === "QUOTED";
                const isProcessing = o.status === "FUNDED" || o.status === "RELEASING";
                const isCompleted = o.status === "COMPLETED";
                const isBusy = busyId === o.id;

                return (
                  <tr key={o.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    {/* Client */}
                    <td className="px-4 py-3">
                      <div style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-ink))" }}>
                        {o.company_name ?? "—"}
                      </div>
                      <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>{o.email ?? ""}</div>
                    </td>

                    {/* Reference */}
                    <td className="px-4 py-3">
                      <Link
                        to={`/orders/${o.id}`}
                        style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 600, color: "hsl(var(--theo-blue))", textDecoration: "none" }}
                      >
                        {o.reference_number}
                      </Link>
                    </td>

                    {/* HTG */}
                    <td className="px-4 py-3" style={{ fontSize: 13, fontWeight: 700 }}>
                      {fmtHTG(Number(o.htg_amount))}
                    </td>

                    {/* USDC */}
                    <td className="px-4 py-3" style={{ fontSize: 13, fontWeight: 800, color: "hsl(var(--theo-blue))" }}>
                      {fmtUSDC(Number(o.usdc_amount))}
                    </td>

                    {/* Rate */}
                    <td className="px-4 py-3" style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>
                      {Number(o.rate).toFixed(2)}
                    </td>

                    {/* Age */}
                    <td className="px-4 py-3" style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>
                      {timeAgo(o.created_at)}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <span className="rounded-full font-bold" style={{ background: sc.bg, color: sc.text, fontSize: 11, padding: "3px 8px" }}>
                        {isProcessing && <Loader2 size={10} style={{ display: "inline", marginRight: 3, animation: "spin 1s linear infinite" }} />}
                        {sc.label}
                      </span>
                    </td>

                    {/* Action */}
                    <td className="px-4 py-3">
                      {isQuoted && (
                        <button
                          onClick={() => confirmReceipt(o)}
                          disabled={isBusy}
                          style={{
                            background: isBusy ? "hsl(var(--theo-mid))" : "hsl(var(--theo-blue))",
                            color: "#fff", border: "none", borderRadius: 7, padding: "6px 12px",
                            fontSize: 11, fontWeight: 700, cursor: isBusy ? "wait" : "pointer",
                            fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {isBusy
                            ? <><Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> Confirming…</>
                            : <><CheckCircle2 size={11} /> Confirm receipt</>
                          }
                        </button>
                      )}
                      {isProcessing && (
                        <span style={{ fontSize: 11, color: "hsl(var(--theo-cyan))", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "hsl(var(--theo-cyan))", animation: "pulse 2s infinite", display: "inline-block" }} />
                          Releasing…
                        </span>
                      )}
                      {isCompleted && o.stellar_tx_hash && (
                        <a
                          href={`https://stellar.expert/explorer/testnet/tx/${o.stellar_tx_hash}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontSize: 11, color: "#1A7F37", fontWeight: 600, display: "flex", alignItems: "center", gap: 4, textDecoration: "none" }}
                        >
                          <CheckCircle2 size={11} /> Verify <ExternalLink size={9} />
                        </a>
                      )}
                      {(o.status === "FAILED" || o.status === "EXPIRED") && (
                        <span style={{ fontSize: 11, color: "#B91C1C", fontWeight: 600 }}>{o.status}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Real-time note */}
      <div className="mt-4 flex items-center gap-2" style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "hsl(var(--theo-cyan))", animation: "pulse 2s infinite" }} />
        Page auto-refreshes every 10s · Confirming receipt marks order FUNDED and triggers USDC release instantly
      </div>
    </AppLayout>
  );
}
