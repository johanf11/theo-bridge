import { useEffect, useRef, useState } from "react";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/theo/StatusBadge";
import { fmtUSDC, fmtHTG, fmtHTGC } from "@/lib/format";
import { Download, FileDown, Search, ChevronRight, ArrowRightLeft, SendHorizonal, TrendingUp } from "lucide-react";
import { useSearch } from "@/contexts/SearchContext";
import { generateReceipt, type ReceiptData } from "@/lib/receipt";
import { useIsMobile } from "@/hooks/use-mobile";


type TxType = "conversion" | "htgc_mint" | "swap" | "withdraw" | "payout" | "yield" | "yield_earned" | "transfer";

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
  // yield-only
  deposited_at?: string;
  net_apy?: number;
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
  const { query, setQuery } = useSearch();
  const highlightRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  // Dropdown filter state
  const [typeFilter, setTypeFilter] = useState("All types");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [dateFilter, setDateFilter] = useState("Last 30 days");

  // Tick once a minute so accrued yield numbers stay live without refetching.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: c } = await supabase.from("customers").select("id").maybeSingle();
      if (!c) { setLoading(false); return; }

      const cutoff = dateCutoff(dateFilter);

      const [{ data: orders }, { data: payouts }, { data: yields }] = await Promise.all([
        supabase
          .from("orders")
          .select("id, status, usdc_amount, htg_amount, reference_number, created_at, stellar_tx_hash, order_kind")
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
          .select("id, deposited_usdc, deposited_at, last_tx_hash, wallet_id, net_apy")
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
        ...(orders ?? []).map((o) => {
          const kind = (o as { order_kind?: string }).order_kind;
          const type: TxType =
            kind === "htgc_mint" ? "htgc_mint" :
            kind === "htgc_usdc_swap" ? "swap" :
            kind === "htgc_withdraw" ? "withdraw" :
            "conversion";
          return {
            id: o.id,
            type,
            created_at: o.created_at,
            usdc_amount: Number(o.usdc_amount ?? 0),
            status: o.status,
            stellar_tx_hash: o.stellar_tx_hash,
            htg_amount: Number(o.htg_amount ?? 0),
            reference_number: o.reference_number,
          };
        }),
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
        ...(yields ?? []).flatMap((y) => {
          const principal = Number(y.deposited_usdc);
          const apy = Number(y.net_apy ?? 0.07);
          const depositedAt = new Date(y.deposited_at);
          const elapsedSec = (Date.now() - depositedAt.getTime()) / 1000;
          const accruedTotal = principal * (Math.exp(apy * (elapsedSec / (365 * 24 * 3600))) - 1);
          const label = walletLabel.get(y.wallet_id) ?? "Wallet";

          const rows: UnifiedTx[] = [{
            id: y.id,
            type: "yield" as TxType,
            created_at: y.deposited_at,
            usdc_amount: principal,
            status: "EARNING",
            stellar_tx_hash: y.last_tx_hash ?? null,
            wallet_label: label,
            deposited_at: y.deposited_at,
            net_apy: apy,
          }];

          // Synthetic "Yield earned" line item — shows accrual since deposit, dated today.
          // Only meaningful once at least a few cents have accrued.
          if (accruedTotal >= 0.01) {
            rows.push({
              id: `${y.id}-earned`,
              type: "yield_earned" as TxType,
              created_at: new Date().toISOString(),
              usdc_amount: accruedTotal,
              status: "EARNED",
              stellar_tx_hash: null,
              wallet_label: label,
              deposited_at: y.deposited_at,
              net_apy: apy,
            });
          }
          return rows;
        }),
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      setAll(merged);
      setLoading(false);
    })();
  }, [dateFilter]);

  // Client-side filters
  const filtered = all.filter((tx) => {
    const q = query.trim().toLowerCase();

    if (typeFilter === "Conversion" && tx.type !== "conversion") return false;
    if (typeFilter === "HTG-C Mint" && tx.type !== "htgc_mint") return false;
    if (typeFilter === "Swap" && tx.type !== "swap") return false;
    if (typeFilter === "Payout" && tx.type !== "payout") return false;
    if (typeFilter === "Yield" && tx.type !== "yield" && tx.type !== "yield_earned") return false;
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

  const isMobile = useIsMobile();

  if (isMobile) {
    const typeIcon = (type: TxType) => {
      if (type === "conversion" || type === "swap" || type === "htgc_mint") return <ArrowRightLeft className="h-4 w-4" style={{ color: "#7A5F00" }} />;
      if (type === "yield" || type === "yield_earned") return <TrendingUp className="h-4 w-4" style={{ color: "hsl(150 70% 25%)" }} />;
      return <SendHorizonal className="h-4 w-4" style={{ color: "hsl(var(--theo-blue))" }} />;
    };
    const typeBg = (type: TxType) => {
      if (type === "conversion" || type === "swap" || type === "htgc_mint") return "hsl(var(--theo-gold-soft))";
      if (type === "yield" || type === "yield_earned") return "hsl(140 60% 92%)";
      return "hsl(var(--theo-blue-soft))";
    };
    const typeLabels: { value: string; short: string }[] = [
      { value: "All types", short: "All" },
      { value: "Conversion", short: "Convert" },
      { value: "Payout", short: "Payouts" },
      { value: "Yield", short: "Yield" },
      { value: "Transfer", short: "Transfers" },
    ];
    const datePresets = ["Last 30 days", "Last 90 days", "This year"];

    return (
      <AppLayout>
        <div className="mb-3">
          <div className="font-extrabold" style={{ fontSize: 26, color: "hsl(var(--theo-blue))", letterSpacing: "-0.02em" }}>
            Transactions
          </div>
          <div style={{ fontSize: 12, color: "hsl(var(--theo-mid))", marginTop: 2 }}>
            {filtered.length} {filtered.length === 1 ? "result" : "results"} · {dateFilter}
          </div>
        </div>

        {/* Search bar (Square style) */}
        <div
          className="flex items-center gap-2 mb-3"
          style={{
            background: "#fff", border: "1px solid hsl(var(--theo-light))",
            borderRadius: 12, padding: "10px 12px",
          }}
        >
          <Search style={{ width: 14, height: 14, color: "hsl(var(--theo-mid))" }} />
          <input
            value={query}
            onChange={(e) => useSearchSet(e.target.value)}
            placeholder="Search by reference, amount, recipient…"
            style={{ border: "none", outline: "none", background: "transparent", fontFamily: "inherit", fontSize: 14, color: "hsl(var(--theo-ink))", width: "100%" }}
          />
          {query && (
            <button onClick={() => useSearchSet("")} style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(var(--theo-mid))", fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
          )}
        </div>

        {/* Type filter chips */}
        <div className="flex gap-1.5 mb-3 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {typeLabels.map((t) => (
            <button
              key={t.value}
              onClick={() => setTypeFilter(t.value)}
              style={{
                flexShrink: 0,
                padding: "6px 12px", borderRadius: 999,
                fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
                background: typeFilter === t.value ? "hsl(var(--theo-blue))" : "#fff",
                color: typeFilter === t.value ? "#fff" : "hsl(var(--theo-blue))",
                border: typeFilter === t.value ? "none" : "1px solid hsl(var(--theo-light))",
              }}
            >
              {t.short}
            </button>
          ))}
        </div>

        {/* Date chips */}
        <div className="flex gap-1.5 mb-4">
          {datePresets.map((d) => (
            <button
              key={d}
              onClick={() => setDateFilter(d)}
              style={{
                flex: 1,
                padding: "6px 8px", borderRadius: 8,
                fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                background: dateFilter === d ? "hsl(var(--theo-blue-soft))" : "transparent",
                color: dateFilter === d ? "hsl(var(--theo-blue))" : "hsl(var(--theo-mid))",
                border: "1px solid " + (dateFilter === d ? "hsl(var(--theo-blue-soft))" : "hsl(var(--theo-light))"),
              }}
            >
              {d}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {all.length === 0 ? "No transactions yet." : "No matching transactions."}
            </div>
          ) : (
            filtered.map((tx) => {
              const title =
                tx.type === "conversion" ? "Conversion" :
                tx.type === "htgc_mint" ? "HTG-C Mint" :
                tx.type === "swap" ? "Swap" :
                tx.type === "yield" ? "Yield deposit" :
                tx.type === "yield_earned" ? "Yield earned" :
                tx.type === "transfer" ? `Transfer · ${tx.wallet_label ?? ""}` :
                tx.recipient_name ?? "Payout";
              const sub =
                tx.type === "conversion" ? fmtHTG(tx.htg_amount ?? 0) :
                tx.type === "yield" || tx.type === "yield_earned" ? (tx.wallet_label ?? "Wallet") :
                tx.memo ? tx.memo : new Date(tx.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
              const amountColor = tx.type === "yield_earned" ? "hsl(150 70% 25%)" : "hsl(var(--theo-blue))";
              const amountPrefix = tx.type === "yield_earned" ? "+" : "";
              return (
                <div
                  key={tx.id}
                  className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0"
                >
                  <div
                    className="flex items-center justify-center rounded-full flex-shrink-0"
                    style={{ width: 38, height: 38, background: typeBg(tx.type) }}
                  >
                    {typeIcon(tx.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-ink))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {title}
                    </div>
                    <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {new Date(tx.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {sub}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div style={{ fontSize: 14, fontWeight: 800, color: amountColor }}>
                      {amountPrefix}{fmtUSDC(tx.usdc_amount)}
                    </div>
                    <div style={{ marginTop: 3 }}>
                      <StatusBadge status={tx.status} />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <button
          onClick={exportCsv}
          className="flex items-center justify-center gap-1.5 font-bold mt-4 w-full"
          style={{
            background: "transparent", border: "1.5px solid hsl(var(--theo-blue))",
            color: "hsl(var(--theo-blue))", borderRadius: 10, padding: "10px",
            fontSize: 13, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </AppLayout>
    );
  }

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
          {["All types", "Conversion", "HTG-C Mint", "Swap", "Payout", "Yield", "Transfer"].map(o => <option key={o}>{o}</option>)}
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
          <div className="overflow-x-auto -mx-4 md:mx-0"><table className="w-full border-collapse min-w-[640px]">
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
                          htgc_mint: { bg: "hsl(var(--theo-gold-soft))", fg: "#7A5F00", label: "HTG-C Mint" },
                          swap: { bg: "hsl(195 85% 92%)", fg: "hsl(200 80% 25%)", label: "Swap" },
                          payout: { bg: "hsl(var(--theo-blue-soft))", fg: "hsl(var(--theo-blue))", label: "Payout" },
                          yield: { bg: "hsl(140 60% 92%)", fg: "hsl(150 70% 25%)", label: "Yield Deposit" },
                          yield_earned: { bg: "hsl(140 60% 92%)", fg: "hsl(150 70% 25%)", label: "Yield Earned" },
                          transfer: { bg: "hsl(195 85% 92%)", fg: "hsl(200 80% 25%)", label: "Transfer" },
                          withdraw: { bg: "hsl(var(--theo-blue-soft))", fg: "hsl(var(--theo-blue))", label: "Withdraw" },
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
                    <td className="px-5 py-3" style={{ fontSize: 13, fontWeight: 700, color: tx.type === "yield_earned" ? "hsl(150 70% 25%)" : undefined }}>
                      {tx.type === "htgc_mint"
                        ? `${fmtHTGC(tx.htg_amount ?? 0)} HTG`
                        : tx.type === "yield_earned"
                        ? `+${fmtUSDC(tx.usdc_amount)}`
                        : fmtUSDC(tx.usdc_amount)}
                    </td>

                    {/* Details: HTG for conversions, swap legs, recipient for payouts, wallet for yield, source→dest for transfer */}
                    <td className="px-5 py-3" style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>
                      {tx.type === "conversion" ? (
                        fmtHTG(tx.htg_amount ?? 0)
                      ) : tx.type === "htgc_mint" ? (
                        <span style={{ color: "hsl(var(--theo-ink))" }}>Minted {fmtHTGC(tx.htg_amount ?? 0)} HTG-C</span>
                      ) : tx.type === "swap" ? (
                        <span style={{ color: "hsl(var(--theo-ink))" }}>
                          {fmtHTGC(tx.htg_amount ?? 0)} HTG-C ↔ {fmtUSDC(tx.usdc_amount)}
                        </span>
                      ) : tx.type === "yield" ? (
                        (() => {
                          const principal = tx.usdc_amount;
                          const apy = tx.net_apy ?? 0.07;
                          const elapsedSec = (Date.now() - new Date(tx.deposited_at ?? tx.created_at).getTime()) / 1000;
                          const accrued = principal * (Math.exp(apy * (elapsedSec / (365 * 24 * 3600))) - 1);
                          return (
                            <span style={{ color: "hsl(var(--theo-ink))" }}>
                              Deposited {fmtUSDC(principal)} from {tx.wallet_label}
                              <span style={{ color: "hsl(150 70% 25%)", fontWeight: 700, marginLeft: 6 }}>
                                · Earned +{fmtUSDC(accrued)}
                              </span>
                              <span style={{ color: "hsl(var(--theo-mid))" }}> · {(apy * 100).toFixed(2)}% APY</span>
                            </span>
                          );
                        })()
                      ) : tx.type === "yield_earned" ? (
                        <span style={{ color: "hsl(var(--theo-ink))" }}>
                          Yield accrued on {tx.wallet_label}
                          <span style={{ color: "hsl(var(--theo-mid))" }}> · since {new Date(tx.deposited_at ?? tx.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {((tx.net_apy ?? 0.07) * 100).toFixed(2)}% APY</span>
                        </span>
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
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
                        {tx.status === "COMPLETED" || tx.status === "EARNED" || tx.status === "EARNING" ? (
                          <button
                            title="Download PDF receipt"
                            onClick={() => {
                              const rd: ReceiptData = {
                                kind: tx.type as ReceiptData["kind"],
                                referenceNumber: tx.reference_number,
                                createdAt: tx.created_at,
                                htgAmount: tx.htg_amount,
                                usdcAmount: tx.usdc_amount,
                                stellarTxHash: tx.stellar_tx_hash,
                                status: tx.status,
                                recipientName: tx.recipient_name,
                                memo: tx.memo,
                                walletLabel: tx.wallet_label,
                                netApy: tx.net_apy,
                                depositedAt: tx.deposited_at,
                                accruedAmount: tx.type === "yield_earned" ? tx.usdc_amount : undefined,
                              };
                              generateReceipt(rd);
                            }}
                            style={{
                              display: "flex", alignItems: "center", justifyContent: "center",
                              width: 26, height: 26, borderRadius: 5,
                              background: "transparent",
                              border: "1.5px solid hsl(var(--theo-light))",
                              color: "hsl(var(--theo-blue))",
                              cursor: "pointer", flexShrink: 0,
                            }}
                          >
                            <FileDown style={{ width: 12, height: 12, strokeWidth: 2 }} />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
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
