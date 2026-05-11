import { useEffect, useRef, useState } from "react";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/theo/StatusBadge";
import { fmtUSDC, fmtHTG, fmtHTGC } from "@/lib/format";
import { Download, FileDown } from "lucide-react";
import { useSearch } from "@/contexts/SearchContext";
import { generateReceipt, type ReceiptData } from "@/lib/receipt";


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
  // swap / conversion receipt fields
  rate?: number;
  usdc_gross?: number;
  fee_usdc?: number;
  fee_bps?: number;
  swap_direction?: string | null;
  order_kind?: string;
  // payout / transfer
  recipient_name?: string;
  memo?: string | null;
  // yield / transfer
  wallet_label?: string;
  // yield-only
  deposited_at?: string;
  net_apy?: number;
  accruedAmount?: number;
};

function swapDetailsLabel(swap_direction: string | null | undefined, order_kind: string | undefined): string {
  if (swap_direction === "usdc_to_htgc") return "USDC → HTG-C";
  if (swap_direction === "htgc_to_usdc") return "HTG → USDC";
  if (order_kind === "htgc_usdc_swap") return "HTG → USDC";
  if (order_kind) return order_kind.replace(/_/g, " ");
  return "HTG → USDC";
}

const usdcDigits2 = (n: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/** Table: amount cell (number / $ only) + separate currency column. */
function txAmountCurrency(tx: UnifiedTx): { amount: string; currency: string } {
  if (tx.type === "htgc_mint") {
    return { amount: fmtHTGC(tx.htg_amount ?? 0), currency: "HTG" };
  }
  if (tx.type === "yield_earned") {
    return { amount: `+${usdcDigits2(tx.usdc_amount)}`, currency: "USDC" };
  }
  if (tx.type === "swap" && tx.swap_direction === "usdc_to_htgc") {
    return { amount: fmtHTGC(tx.htg_amount ?? 0), currency: "HTG" };
  }
  if (tx.type === "swap") {
    return { amount: `$${usdcDigits2(tx.usdc_amount)}`, currency: "USDC" };
  }
  return { amount: `$${usdcDigits2(tx.usdc_amount)}`, currency: "USDC" };
}

const currencyMuted = {
  fontSize: 12,
  color: "hsl(var(--theo-mid))",
} as const;

const TABLE_HEADS: { label: string; align: "left" | "right" }[] = [
  { label: "Date", align: "left" },
  { label: "Type", align: "left" },
  { label: "Amount", align: "right" },
  { label: "Currency", align: "left" },
  { label: "Details", align: "left" },
  { label: "Status", align: "left" },
  { label: "Reference", align: "left" },
  { label: "Receipt", align: "left" },
];

/** Same strings as the Type pill labels (CSV + UI). */
const TYPE_PILL_LABEL: Record<TxType, string> = {
  conversion: "Conversion",
  htgc_mint: "HTG-C Mint",
  swap: "Swap",
  payout: "Payout",
  yield: "Yield Deposit",
  yield_earned: "Yield Earned",
  transfer: "Transfer",
  withdraw: "Withdraw",
};

/** RFC-style CSV field: always quoted; internal `"` as `""`. Excel-safe with UTF-8 BOM. */
function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

/** Direction / Details export: avoid Unicode arrows in financial CSVs for Excel across locales. */
function csvAsciiArrows(s: string): string {
  return s.replace(/\u2192/g, "->");
}

/** Plain-text Details column for CSV (mirrors on-screen Details). */
function txDetailsPlain(tx: UnifiedTx): string {
  if (tx.type === "conversion") return fmtHTG(tx.htg_amount ?? 0);
  if (tx.type === "htgc_mint") return `Minted ${fmtHTGC(tx.htg_amount ?? 0)} HTG-C`;
  if (tx.type === "swap") return swapDetailsLabel(tx.swap_direction ?? null, tx.order_kind);
  if (tx.type === "yield") {
    const principal = tx.usdc_amount;
    const apy = tx.net_apy ?? 0.07;
    const elapsedSec = (Date.now() - new Date(tx.deposited_at ?? tx.created_at).getTime()) / 1000;
    const accrued = principal * (Math.exp(apy * (elapsedSec / (365 * 24 * 3600))) - 1);
    return `Deposited ${fmtUSDC(principal)} from ${tx.wallet_label ?? ""} · Earned +${fmtUSDC(accrued)} · ${(apy * 100).toFixed(2)}% APY`;
  }
  if (tx.type === "yield_earned") {
    return `Yield accrued on ${tx.wallet_label ?? ""} · since ${new Date(tx.deposited_at ?? tx.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${((tx.net_apy ?? 0.07) * 100).toFixed(2)}% APY`;
  }
  if (tx.type === "transfer") return `From ${tx.wallet_label ?? ""} → ${tx.recipient_name ?? ""}`;
  return tx.recipient_name ?? "";
}

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

  // Tick once a minute so accrued yield numbers stay live without refetching.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: au } = await supabase.auth.getUser();
      const { data: c } = await supabase.from("customers").select("id").eq("user_id", au.user?.id ?? "").maybeSingle();
      if (!c) { setLoading(false); return; }

      const cutoff = dateCutoff(dateFilter);

      const [{ data: orders }, { data: payouts }, { data: yields }] = await Promise.all([
        supabase
          .from("orders")
          .select(
            "id, status, usdc_amount, htg_amount, reference_number, created_at, stellar_tx_hash, order_kind, rate, usdc_gross, fee_usdc, fee_bps, swap_direction",
          )
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
          // No date cutoff — yield positions are ongoing, not point-in-time
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
          const row = o as {
            rate?: number | null;
            usdc_gross?: number | null;
            fee_usdc?: number | null;
            fee_bps?: number | null;
            swap_direction?: string | null;
          };
          return {
            id: o.id,
            type,
            created_at: o.created_at,
            usdc_amount: Number(o.usdc_amount ?? 0),
            status: o.status,
            stellar_tx_hash: o.stellar_tx_hash,
            htg_amount: Number(o.htg_amount ?? 0),
            reference_number: o.reference_number,
            rate: row.rate != null ? Number(row.rate) : undefined,
            usdc_gross: row.usdc_gross != null ? Number(row.usdc_gross) : undefined,
            fee_usdc: row.fee_usdc != null ? Number(row.fee_usdc) : undefined,
            fee_bps: row.fee_bps != null ? Number(row.fee_bps) : undefined,
            swap_direction: row.swap_direction ?? undefined,
            order_kind: kind,
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
          const now = new Date();
          const label = walletLabel.get(y.wallet_id) ?? "Wallet";
          const MS_PER_DAY = 86_400_000;

          // Deposit row — no earned total here; individual day rows carry it
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

          const elapsedMs = now.getTime() - depositedAt.getTime();
          const completeDays = Math.floor(elapsedMs / MS_PER_DAY);

          // One row per complete 24h period — each day compounds on the previous
          // dayYield(d) = P*(e^(r*(d+1)/365) - e^(r*d/365)) — grows slightly each day
          for (let d = 0; d < completeDays; d++) {
            const dayYield = principal * (
              Math.exp(apy * (d + 1) / 365) - Math.exp(apy * d / 365)
            );
            const postedAt = new Date(depositedAt.getTime() + (d + 1) * MS_PER_DAY);
            rows.push({
              id: `${y.id}-d${d}`,
              type: "yield_earned" as TxType,
              created_at: postedAt.toISOString(),
              usdc_amount: dayYield,
              status: "EARNED",
              stellar_tx_hash: null,
              wallet_label: label,
              deposited_at: y.deposited_at,
              net_apy: apy,
            });
          }

          // Today's partial accrual (from the start of the current 24h window to now)
          const partialFraction = (elapsedMs % MS_PER_DAY) / MS_PER_DAY;
          if (partialFraction > 0) {
            const partialYield = principal * (
              Math.exp(apy * (completeDays + partialFraction) / 365) -
              Math.exp(apy * completeDays / 365)
            );
            if (partialYield >= 0.01) {
              rows.push({
                id: `${y.id}-today`,
                type: "yield_earned" as TxType,
                created_at: now.toISOString(),
                usdc_amount: partialYield,
                status: "ACCRUING",
                stellar_tx_hash: null,
                wallet_label: label,
                deposited_at: y.deposited_at,
                net_apy: apy,
              });
            }
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
    const header = [
      "Date",
      "Type",
      "Amount",
      "Currency",
      "Direction",
      "Details",
      "Status",
      "Reference",
      "Receipt ID",
    ];
    const rows = [
      header.map((h) => csvCell(h)),
      ...all.map((tx) => {
        const { amount, currency } = txAmountCurrency(tx);
        const direction =
          tx.type === "swap"
            ? csvAsciiArrows(swapDetailsLabel(tx.swap_direction ?? null, tx.order_kind))
            : "";
        const details = csvAsciiArrows(txDetailsPlain(tx));
        const reference = (tx.type === "conversion" || tx.type === "swap" || tx.type === "htgc_mint")
          ? (tx.reference_number ?? "")
          : (tx.memo ?? "");
        return [
          csvCell(
            new Date(tx.created_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            }),
          ),
          csvCell(TYPE_PILL_LABEL[tx.type]),
          csvCell(amount),
          csvCell(currency),
          csvCell(direction),
          csvCell(details),
          csvCell(tx.status),
          csvCell(reference),
          csvCell(tx.stellar_tx_hash ?? ""),
        ];
      }),
    ];
    const csv = "\uFEFF" + rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
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
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ background: "hsl(var(--theo-cream))" }}>
                {TABLE_HEADS.map((h) => (
                  <th
                    key={h.label}
                    className="px-5 py-2.5 border-b border-border"
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.10em",
                      color: "hsl(var(--theo-mid))",
                      textAlign: h.align,
                    }}
                  >
                    {h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((tx) => {
                const q = query.trim().toLowerCase();
                const { amount: amountCell, currency: currencyCell } = txAmountCurrency(tx);
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
                        const palette: Record<TxType, { bg: string; fg: string }> = {
                          conversion: { bg: "hsl(var(--theo-gold-soft))", fg: "#7A5F00" },
                          htgc_mint: { bg: "hsl(var(--theo-gold-soft))", fg: "#7A5F00" },
                          swap: { bg: "hsl(195 85% 92%)", fg: "hsl(200 80% 25%)" },
                          payout: { bg: "hsl(var(--theo-blue-soft))", fg: "hsl(var(--theo-blue))" },
                          yield: { bg: "hsl(140 60% 92%)", fg: "hsl(150 70% 25%)" },
                          yield_earned: { bg: "hsl(140 60% 92%)", fg: "hsl(150 70% 25%)" },
                          transfer: { bg: "hsl(195 85% 92%)", fg: "hsl(200 80% 25%)" },
                          withdraw: { bg: "hsl(var(--theo-blue-soft))", fg: "hsl(var(--theo-blue))" },
                        };
                        const p = palette[tx.type];
                        return (
                          <span className="rounded-full font-bold" style={{ fontSize: 11, padding: "3px 8px", background: p.bg, color: p.fg, whiteSpace: "nowrap" }}>
                            {TYPE_PILL_LABEL[tx.type]}
                          </span>
                        );
                      })()}
                    </td>

                    {/* Amount (number only, right-aligned) */}
                    <td
                      className="px-5 py-3"
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        textAlign: "right",
                        color: tx.type === "yield_earned" ? "hsl(150 70% 25%)" : undefined,
                      }}
                    >
                      {amountCell}
                    </td>

                    {/* Currency (short label, muted) */}
                    <td className="px-5 py-3" style={currencyMuted}>
                      {currencyCell}
                    </td>

                    {/* Details */}
                    <td className="px-5 py-3" style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>
                      {tx.type === "conversion" ? (
                        fmtHTG(tx.htg_amount ?? 0)
                      ) : tx.type === "htgc_mint" ? (
                        `Minted ${fmtHTGC(tx.htg_amount ?? 0)} HTG-C`
                      ) : tx.type === "swap" ? (
                        swapDetailsLabel(tx.swap_direction ?? null, tx.order_kind)
                      ) : tx.type === "yield" ? (
                        `Deposited ${fmtUSDC(tx.usdc_amount)} from ${tx.wallet_label} · ${((tx.net_apy ?? 0.07) * 100).toFixed(2)}% APY`
                      ) : tx.type === "yield_earned" ? (
                        `Daily yield · ${tx.wallet_label} · ${((tx.net_apy ?? 0.07) * 100).toFixed(2)}% APY`
                      ) : tx.type === "transfer" ? (
                        `From ${tx.wallet_label} → ${tx.recipient_name}`
                      ) : (
                        tx.recipient_name
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-5 py-3">
                      <StatusBadge status={tx.status} />
                    </td>

                    {/* Reference */}
                    <td className="px-5 py-3" style={{ fontFamily: "monospace", fontSize: 12, color: "hsl(var(--theo-mid))" }}>
                      {(tx.type === "conversion" || tx.type === "swap" || tx.type === "htgc_mint")
                        ? tx.reference_number
                        : tx.memo
                          ? <span style={{ fontFamily: "inherit", color: "hsl(var(--theo-mid))" }}>{tx.memo}</span>
                          : <span style={{ color: "hsl(var(--theo-mid))" }}>—</span>
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
                        {tx.status === "COMPLETED" || tx.status === "EARNED" || tx.status === "EARNING" || tx.status === "ACCRUING" ? (
                          <button
                            title="Download PDF receipt"
                            onClick={() => {
                              const rd: ReceiptData = {
                                kind: tx.type as ReceiptData["kind"],
                                referenceNumber: tx.reference_number,
                                createdAt: tx.created_at,
                                htgAmount: tx.htg_amount,
                                usdcAmount: tx.usdc_amount,
                                rate: tx.rate,
                                usdcGross: tx.usdc_gross,
                                feeUsdc: tx.fee_usdc,
                                feeBps: tx.fee_bps,
                                swapDirection:
                                  tx.type === "swap" &&
                                  (tx.swap_direction === "htgc_to_usdc" || tx.swap_direction === "usdc_to_htgc")
                                    ? tx.swap_direction
                                    : undefined,
                                htgGross:
                                  tx.type === "swap" && tx.swap_direction === "usdc_to_htgc"
                                    ? Math.round((tx.usdc_gross ?? tx.usdc_amount) * (tx.rate ?? 0))
                                    : undefined,
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
