import { useEffect, useState } from "react";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/theo/StatusBadge";
import { fmtUSDC, fmtHTG } from "@/lib/format";
import { Download } from "lucide-react";

type Order = {
  id: string; status: string; usdc_amount: number; htg_amount: number;
  reference_number: string; created_at: string; stellar_tx_hash: string | null;
};

export default function Transactions() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: c } = await supabase.from("customers").select("id").maybeSingle();
      if (!c) return;
      setCustomerId(c.id);
      const { data: o } = await supabase
        .from("orders")
        .select("id, status, usdc_amount, htg_amount, reference_number, created_at, stellar_tx_hash")
        .eq("customer_id", c.id)
        .order("created_at", { ascending: false });
      setOrders((o ?? []) as Order[]);
    })();
  }, []);

  const exportCsv = () => {
    const rows = [
      ["Date", "Type", "USDC Amount", "HTG Sent", "Status", "Reference"],
      ...orders.map((o) => [
        new Date(o.created_at).toLocaleDateString(),
        "Conversion",
        o.usdc_amount,
        o.htg_amount,
        o.status,
        o.reference_number,
      ]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "theo-transactions.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout>
      <div className="flex items-start justify-between mb-1">
        <div>
          <div className="font-extrabold" style={{ fontSize: 22, color: "hsl(var(--theo-blue))", letterSpacing: "-0.02em" }}>
            Transactions
          </div>
          <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))", marginTop: 2 }}>
            Full history of conversions and payouts.
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportCsv}
            className="flex items-center gap-1.5 font-bold transition-colors"
            style={{
              background: "transparent", border: "1.5px solid hsl(var(--theo-blue))",
              color: "hsl(var(--theo-blue))", borderRadius: 7, padding: "6px 12px",
              fontSize: 12, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            <Download className="h-3 w-3" style={{ strokeWidth: 2 }} />
            Export CSV
          </button>
        </div>
      </div>
      <div className="mb-5" style={{ width: 28, height: 3, background: "hsl(var(--theo-gold))", borderRadius: 2, marginTop: 8 }} />

      {/* Filters */}
      <div className="flex gap-2 mb-4 items-center">
        {[
          { opts: ["All types", "Conversion", "Payout"] },
          { opts: ["All statuses", "Settled", "Pending", "Failed"] },
          { opts: ["Last 30 days", "Last 90 days", "This year", "All time"] },
        ].map(({ opts }, i) => (
          <select
            key={i}
            className="border border-border rounded-lg outline-none text-sm font-medium cursor-pointer"
            style={{
              padding: "7px 28px 7px 10px", fontFamily: "inherit",
              color: "hsl(var(--theo-ink))", background: "white",
              fontSize: 13,
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6B8A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 10px center",
              appearance: "none",
            }}
          >
            {opts.map((o) => <option key={o}>{o}</option>)}
          </select>
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
        {orders.length === 0 ? (
          <div className="py-14 text-center text-sm text-muted-foreground">No transactions yet.</div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ background: "hsl(var(--theo-cream))" }}>
                {["Date", "Type", "Amount (USDC)", "HTG Sent", "Network", "Status", "Reference", "Receipt ID"].map((h) => (
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
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className="rounded-full" style={{ width: 8, height: 8, background: "hsl(var(--theo-cyan))", flexShrink: 0 }} />
                      <span style={{ fontSize: 13 }}>Theo</span>
                    </div>
                  </td>
                  <td className="px-5 py-3"><StatusBadge status={o.status} /></td>
                  <td className="px-5 py-3" style={{ fontFamily: "monospace", fontSize: 12, color: "hsl(var(--theo-mid))" }}>
                    {o.reference_number}
                  </td>
                  <td className="px-5 py-3" style={{ fontFamily: "monospace", fontSize: 12 }}>
                    {o.stellar_tx_hash ? (
                      <a
                        href={`https://stellar.expert/explorer/testnet/tx/${o.stellar_tx_hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "hsl(var(--theo-cyan))", fontWeight: 600 }}
                      >
                        {o.stellar_tx_hash.slice(0, 8)}...{o.stellar_tx_hash.slice(-4)}
                      </a>
                    ) : (
                      <span style={{ color: "hsl(var(--theo-mid))" }}>—</span>
                    )}
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
