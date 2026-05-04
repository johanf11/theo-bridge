import { useEffect, useRef, useState } from "react";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/theo/StatusBadge";
import { fmtUSDC, fmtHTG } from "@/lib/format";
import { Download } from "lucide-react";
import { useSearch } from "@/contexts/SearchContext";

type TxType = "conversion" | "payout" | "yield" | "transfer";

type UnifiedTx = {
  id: string;
  type: TxType;
  created_at: string;
  usdc_amount: number;
  status: string;
  stellar_tx_hash: string | null;
  // conversion-only
  htg_amount?: number;
  reference_number?: string;
  // payout / transfer
  recipient_name?: string;
  memo?: string | null;
  // yield / transfer
  wallet_label?: string;
};

// Map payout statuses → the same style system StatusBadge uses
const PAYOUT_STATUS_MAP: Record<string, string> = {
  COMPLETED: "COMPLETED",
  PENDING: "PENDING",
  FAILED: "FAILED",
};

export default function Transactions() {
  const [all, setAll] = useState<UnifiedTx[]>([]);
  const [loading, setLoading] = useState(true);
  const { query } = useSearch();
  const highlightRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  // Dropdown filter state
  const [typeFilter, setTypeFilter] = useState("All types");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [dateFilter, setDateFilter] = useState("Last 30 days");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: c } = await supabase.from("customers").select("id").maybeSingle();
      if (!c) { setLoading(false); return; }

      const cutoff = dateCutoff(dateFilter);

      const [{ data: orders }, { data: payouts }, { data: yields }] = await Promise.all([
        supabase
          .from("orders")
          .select("id, status, usdc_amount, htg_amount, reference_number, created_at, stellar_tx_hash")
          .eq("customer_id", c.id)
          .gte("created_at", cutoff)
          .order("created_at", { ascending: false }),
        supabase
          .from("payouts")
          .select("id, recipient_name, amount_usdc, status, memo, stellar_tx_hash, created_at, source_wallet_id")
          .eq("customer_id", c.id)
          .gte("created_at", cutoff)
          .order("created_at", { ascending: false }),
        supabase
          .from("blend_positions")
          .select("id, deposited_usdc, deposited_at, last_tx_hash, wallet_id")
          .eq("customer_id", c.id)
          .gte("deposited_at", cutoff)
          .order("deposited_at", { ascending: false }),
      ]);

      // Look up wallet labels for yield + transfer rows (no FK so embed isn't reliable).
      const allWalletIds = Array.from(new Set([
        ...(yields ?? []).map((y) => y.wallet_id),
        ...(payouts ?? []).map((p) => p.source_wallet_id),
      ].filter(Boolean) as string[]));
      const { data: wRows } = allWalletIds.length
        ? await supabase.from("wallets").select("id, label").in("id", allWalletIds)
        : { data: [] as { id: string; label: string | null }[] };
      const walletLabel = new Map((wRows ?? []).map((w) => [w.id, w.label ?? "Wallet"]));

      const merged: UnifiedTx[] = [
        ...(orders ?? []).map((o) => ({
          id: o.id,
          type: "conversion" as TxType,
          created_at: o.created_at,
          usdc_amount: Number(o.usdc_amount),
          status: o.status,
          stellar_tx_hash: o.stellar_tx_hash,
          htg_amount: Number(o.htg_amount),
          reference_number: o.reference_number,
        })),
        ...(payouts ?? []).map((p) => {
          const isTransfer = p.memo === "internal-transfer";
          return {
            id: p.id,
            type: (isTransfer ? "transfer" : "payout") as TxType,
            created_at: p.created_at,
            usdc_amount: Number(p.amount_usdc),
            status: PAYOUT_STATUS_MAP[p.status] ?? p.status,
            stellar_tx_hash: p.stellar_tx_hash ?? null,
            recipient_name: p.recipient_name,
            memo: isTransfer ? null : p.memo,
            wallet_label: isTransfer ? (walletLabel.get(p.source_wallet_id ?? "") ?? "Wallet") : undefined,
          };
        }),
        ...(yields ?? []).map((y) => ({
          id: y.id,
          type: "yield" as TxType,
          created_at: y.deposited_at,
          usdc_amount: Number(y.deposited_usdc),
          status: "EARNING",
          stellar_tx_hash: y.last_tx_hash ?? null,
          wallet_label: walletLabel.get(y.wallet_id) ?? "Wallet",
        })),
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      setAll(merged);
      setLoading(false);
    })();
  }, [dateFilter]);

  // Client-side filters
  const filtered = all.filter((tx) => {
    const q = query.trim().toLowerCase();

    if (typeFilter === "Conversion" && tx.type !== "conversion") return false;
    if (typeFilter === "Payout" && tx.type !== "payout") return false;
    if (typeFilter === "Yield" && tx.type !== "yield") return false;
    if (typeFilter === "Transfer" && tx.type !== "transfer") return false;

    const statusLabel = tx.status.toLowerCase();
    if (statusFilter === "Settled" && !statusLabel.includes("complet")) return false;
    if (statusFilter === "Pending" && !statusLabel.includes("pending")) return false;
    if (statusFilter === "Failed" && !statusLabel.includes("failed")) return false;

    if (!q) return true;
    return (
      (tx.reference_number ?? "").toLowerCase().includes(q) ||
      (tx.recipient_name ?? "").toLowerCase().includes(q) ||
      (tx.memo ?? "").toLowerCase().includes(q) ||
      String(tx.usdc_amount).includes(q) ||
      String(tx.htg_amount ?? "").includes(q) ||
      new Date(tx.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toLowerCase().includes(q) ||
      tx.type.includes(q)
    );
  });

  const exportCsv = () => {
    const rows = [
      ["Date", "Type", "USDC Amount", "HTG Sent", "Recipient", "Status", "Reference / Note", "Receipt ID"],
      ...all.map((tx) => [
        new Date(tx.created_at).toLocaleDateString(),
        tx.type === "conversion" ? "Conversion" : tx.type === "payout" ? "Payout" : tx.type === "yield" ? "Yield" : "Transfer",
        tx.usdc_amount,
        tx.htg_amount ?? "",
        tx.recipient_name ?? "",
        tx.status,
        tx.reference_number ?? tx.memo ?? "",
        tx.stellar_tx_hash ?? "",
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

  const selectStyle: React.CSSProperties = {
    padding: "7px 28px 7px 10px", fontFamily: "inherit",
    color: "hsl(var(--theo-ink))", background: "white",
    fontSize: 13, borderRadius: 8, border: "1px solid hsl(var(--theo-light))",
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6B8A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center",
    appearance: "none", outline: "none", cursor: "pointer",
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
      <div className="mb-5" style={{ width: 28, height: 3, background: "hsl(var(--theo-gold))", borderRadius: 2, marginTop: 8 }} />

      {/* Filters */}
      <div className="flex gap-2 mb-4 items-center">
        <select style={selectStyle} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          {["All types", "Conversion", "Payout", "Yield", "Transfer"].map(o => <option key={o}>{o}</option>)}
        </select>
        <select style={selectStyle} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          {["All statuses", "Settled", "Pending", "Failed"].map(o => <option key={o}>{o}</option>)}
        </select>
        <select style={selectStyle} value={dateFilter} onChange={e => setDateFilter(e.target.value)}>
          {["Last 30 days", "Last 90 days", "This year", "All time"].map(o => <option key={o}>{o}</option>)}
        </select>

        {(query.trim() || typeFilter !== "All types" || statusFilter !== "All statuses") && (
          <span style={{ fontSize: 12, color: "hsl(var(--theo-mid))", marginLeft: 4 }}>
            {filtered.length} result{filtered.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-14 text-center text-sm text-muted-foreground">Loading…</div>
        ) : all.length === 0 ? (
          <div className="py-14 text-center text-sm text-muted-foreground">No transactions yet.</div>
        ) : filtered.length === 0 ? (
          <div className="py-14 text-center text-sm text-muted-foreground">No matching transactions.</div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ background: "hsl(var(--theo-cream))" }}>
                {["Date", "Type", "Amount (USDC)", "Details", "Network", "Status", "Reference / Recipient", "Receipt ID"].map((h) => (
                  <th key={h} className="text-left px-5 py-2.5 border-b border-border" style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.10em", color: "hsl(var(--theo-mid))" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((tx) => {
                const q = query.trim().toLowerCase();
                const isHighlighted = q && (
                  (tx.reference_number ?? "").toLowerCase().includes(q) ||
                  (tx.recipient_name ?? "").toLowerCase().includes(q)
                );
                return (
                  <tr
                    key={tx.id}
                    ref={(el) => { highlightRefs.current[tx.id] = el; }}
                    className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors"
                    style={isHighlighted ? { background: "hsl(var(--theo-blue-soft))" } : undefined}
                  >
                    {/* Date */}
                    <td className="px-5 py-3" style={{ fontSize: 13 }}>
                      {new Date(tx.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </td>

                    {/* Type badge */}
                    <td className="px-5 py-3">
                      {(() => {
                        const palette: Record<TxType, { bg: string; fg: string; label: string }> = {
                          conversion: { bg: "hsl(var(--theo-gold-soft))", fg: "#7A5F00", label: "Conversion" },
                          payout: { bg: "hsl(var(--theo-blue-soft))", fg: "hsl(var(--theo-blue))", label: "Payout" },
                          yield: { bg: "hsl(140 60% 92%)", fg: "hsl(150 70% 25%)", label: "Yield Sweep" },
                          transfer: { bg: "hsl(195 85% 92%)", fg: "hsl(200 80% 25%)", label: "Transfer" },
                        };
                        const p = palette[tx.type];
                        return (
                          <span className="rounded-full font-bold" style={{ fontSize: 11, padding: "3px 8px", background: p.bg, color: p.fg }}>
                            {p.label}
                          </span>
                        );
                      })()}
                    </td>

                    {/* Amount */}
                    <td className="px-5 py-3" style={{ fontSize: 13, fontWeight: 700 }}>
                      {fmtUSDC(tx.usdc_amount)}
                    </td>

                    {/* Details: HTG for conversions, recipient for payouts, wallet for yield, source→dest for transfer */}
                    <td className="px-5 py-3" style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>
                      {tx.type === "conversion" ? (
                        fmtHTG(tx.htg_amount ?? 0)
                      ) : tx.type === "yield" ? (
                        <span style={{ color: "hsl(var(--theo-ink))" }}>From {tx.wallet_label} → Yield treasury</span>
                      ) : tx.type === "transfer" ? (
                        <span style={{ color: "hsl(var(--theo-ink))" }}>From {tx.wallet_label} → {tx.recipient_name}</span>
                      ) : (
                        <span style={{ color: "hsl(var(--theo-ink))" }}>{tx.recipient_name}{tx.memo ? <span style={{ color: "hsl(var(--theo-mid))" }}> · {tx.memo}</span> : ""}</span>
                      )}
                    </td>

                    {/* Network */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        <div className="rounded-full" style={{ width: 8, height: 8, background: "hsl(var(--theo-cyan))", flexShrink: 0 }} />
                        <span style={{ fontSize: 13 }}>Theo</span>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-5 py-3">
                      <StatusBadge status={tx.status} />
                    </td>

                    {/* Reference / Recipient */}
                    <td className="px-5 py-3" style={{ fontFamily: "monospace", fontSize: 12, color: "hsl(var(--theo-mid))" }}>
                      {tx.type === "conversion"
                        ? tx.reference_number
                        : <span style={{ fontFamily: "inherit", fontWeight: 600, color: "hsl(var(--theo-ink))" }}>{tx.recipient_name}</span>
                      }
                    </td>

                    {/* Receipt / TX hash */}
                    <td className="px-5 py-3" style={{ fontFamily: "monospace", fontSize: 12 }}>
                      {tx.stellar_tx_hash ? (
                        <a
                          href={`https://stellar.expert/explorer/testnet/tx/${tx.stellar_tx_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "hsl(var(--theo-cyan))", fontWeight: 600 }}
                        >
                          {tx.stellar_tx_hash.slice(0, 8)}…{tx.stellar_tx_hash.slice(-4)}
                        </a>
                      ) : (
                        <span style={{ color: "hsl(var(--theo-mid))" }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </AppLayout>
  );
}

function dateCutoff(filter: string): string {
  const now = new Date();
  if (filter === "Last 30 days") { now.setDate(now.getDate() - 30); return now.toISOString(); }
  if (filter === "Last 90 days") { now.setDate(now.getDate() - 90); return now.toISOString(); }
  if (filter === "This year") { now.setMonth(0, 1); now.setHours(0, 0, 0, 0); return now.toISOString(); }
  return "2000-01-01T00:00:00Z"; // All time
}
