import { useEffect, useState, type CSSProperties } from "react";
import { useLocation } from "react-router-dom";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { resolveEffectiveCustomerId } from "@/lib/customer";
import { StatusBadge } from "@/components/theo/StatusBadge";
import { fmtUSDC, fmtHTG, fmtHTGC } from "@/lib/format";
import { Download, FileDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useSearchHighlight } from "@/hooks/useSearchHighlight";
import { useSearch } from "@/contexts/SearchContext";
import { generateReceipt, type ReceiptData } from "@/lib/receipt";
import { useT, type TKey } from "@/lib/i18n";
import { useLocale, useFormatDate, useFormatN, capitalizeDate } from "@/lib/locale";
import { parseSearchParams, shouldExpandTransactionDateRange, INTERNAL_PAYOUT_MEMOS } from "@/lib/search";
import { usePermissions } from "@/hooks/usePermissions";
import { useRoles } from "@/lib/auth";


type TxType = "conversion" | "htgc_mint" | "swap" | "withdraw" | "payout" | "yield_payout" | "yield" | "yield_earned" | "transfer";

type TypeFilterKey = "all" | "conversion" | "mint" | "swap" | "payout" | "yieldDeposit" | "withdraw" | "transfer" | "odoo";
type StatusFilterKey = "all" | "complete" | "pending" | "failed";
type DateFilterKey = "30d" | "90d" | "ytd" | "all";

const TYPE_FILTER_OPTIONS: { value: TypeFilterKey; labelKey: TKey }[] = [
  { value: "all", labelKey: "tx.filter.types" },
  { value: "conversion", labelKey: "tx.type.conversion" },
  { value: "mint", labelKey: "tx.type.mint" },
  { value: "swap", labelKey: "tx.type.swap" },
  { value: "payout", labelKey: "tx.type.payout" },
  { value: "yieldDeposit", labelKey: "tx.type.yieldDeposit" },
  { value: "withdraw", labelKey: "tx.type.withdraw" },
  { value: "transfer", labelKey: "tx.type.transfer" },
  { value: "odoo", labelKey: "tx.type.odoo" },
];

const STATUS_FILTER_OPTIONS: { value: StatusFilterKey; labelKey: TKey }[] = [
  { value: "all", labelKey: "tx.filter.statuses" },
  { value: "complete", labelKey: "common.status.complete" },
  { value: "pending", labelKey: "common.status.pending" },
  { value: "failed", labelKey: "common.status.failed" },
];

const DATE_FILTER_OPTIONS: { value: DateFilterKey; labelKey: TKey }[] = [
  { value: "30d", labelKey: "tx.filter.last30" },
  { value: "90d", labelKey: "tx.filter.last90" },
  { value: "ytd", labelKey: "tx.filter.thisYear" },
  { value: "all", labelKey: "tx.filter.allTime" },
];

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
  // htgc_mint
  destination_stellar_address?: string | null;
  destination_wallet_address?: string | null;
  destination_wallet_label?: string | null;
  // source wallet (for receipt Settlement section)
  source_wallet_address?: string | null;
};

function swapDetailsLabel(t: ReturnType<typeof useT>, swap_direction: string | null | undefined, order_kind: string | undefined): string {
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
  if (tx.type === "withdraw") {
    return { amount: fmtHTGC(tx.htg_amount ?? 0), currency: "HTG" };
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

/** Same strings as the Type pill labels (CSV + UI). */
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
function txDetailsPlain(t: ReturnType<typeof useT>, locale: string, tx: UnifiedTx): string {
  if (tx.type === "conversion") return fmtHTG(tx.htg_amount ?? 0);
  if (tx.type === "htgc_mint") return `${t("tx.details.minted")} ${fmtHTGC(tx.htg_amount ?? 0)} HTG-C`;
  if (tx.type === "swap") return swapDetailsLabel(t, tx.swap_direction ?? null, tx.order_kind);
  if (tx.type === "yield") {
    const principal = tx.usdc_amount;
    const apy = tx.net_apy ?? 0.07;
    const elapsedSec = (Date.now() - new Date(tx.deposited_at ?? tx.created_at).getTime()) / 1000;
    const accrued = principal * (Math.exp(apy * (elapsedSec / (365 * 24 * 3600))) - 1);
    return `Deposited ${fmtUSDC(principal)} from ${tx.wallet_label ?? ""} · Earned +${fmtUSDC(accrued)} · ${(apy * 100).toFixed(2)}% APY`;
  }
  if (tx.type === "yield_earned") {
    const dateStr = capitalizeDate(new Date(tx.deposited_at ?? tx.created_at).toLocaleDateString(locale, { month: "short", day: "numeric" }));
    return `${t("tx.type.yieldEarned")} ${tx.wallet_label ?? ""} · ${t("tx.details.since")} ${dateStr} · ${((tx.net_apy ?? 0.07) * 100).toFixed(2)}% APY`;
  }
  if (tx.type === "transfer") return `${t("tx.details.from")} ${tx.wallet_label ?? ""} → ${tx.recipient_name ?? ""}`;
  return tx.recipient_name ?? "";
}

// Map payout statuses → the same style system StatusBadge uses
const PAYOUT_STATUS_MAP: Record<string, string> = {
  COMPLETED: "COMPLETED",
  PENDING: "PENDING",
  FAILED: "FAILED",
};

export default function Transactions() {
  const t = useT();
  const locale = useLocale();
  const fmtDate = useFormatDate();
  const fmtN = useFormatN();
  const location = useLocation();
  const urlSearch = parseSearchParams(location.search);
  const { can, isOwner } = usePermissions();
  const { isAdmin } = useRoles();
  const canViewBalances = isOwner || isAdmin || can("view_balances");
  const TABLE_HEADS: { label: string; align: "left" | "right" }[] = [
    { label: t("tx.col.date"), align: "left" },
    { label: t("tx.col.type"), align: "left" },
    { label: t("tx.col.amount"), align: "right" },
    { label: t("tx.head.currency"), align: "left" },
    { label: t("tx.head.details"), align: "left" },
    { label: t("tx.col.status"), align: "left" },
    { label: t("tx.col.ref"), align: "left" },
    { label: t("tx.receipt"), align: "left" },
  ];
  const TYPE_PILL_LABEL: Record<TxType, string> = {
    conversion: t("tx.type.conversion"),
    htgc_mint: t("tx.type.mint"),
    swap: t("tx.type.swap"),
    payout: t("tx.type.payout"),
    yield_payout: t("tx.type.yieldPayout"),
    yield: t("tx.type.yieldDeposit"),
    yield_earned: t("tx.type.yieldEarned"),
    transfer: t("tx.type.transfer"),
    withdraw: t("tx.type.withdraw"),
  };
  const [all, setAll] = useState<UnifiedTx[]>([]);
  const [loading, setLoading] = useState(true);
  const { query } = useSearch();
  const { highlightId, refs: highlightRefs } = useSearchHighlight<HTMLTableRowElement>(!loading);

  // Dropdown filter state (stable keys — labels come from t() at render)
  const [typeFilter, setTypeFilter] = useState<TypeFilterKey>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilterKey>("all");
  const [dateFilter, setDateFilter] = useState<DateFilterKey>("30d");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);

  // Reset to the first page when filters or page size change.
  useEffect(() => { setPage(1); }, [typeFilter, statusFilter, dateFilter, query, perPage]);

  // Reference / hash searches need full history — default 30d window would hide matches.
  useEffect(() => {
    if (shouldExpandTransactionDateRange(urlSearch.q, urlSearch.highlightId)) {
      setDateFilter("all");
    }
  }, [urlSearch.q, urlSearch.highlightId]);

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
      if (!au.user) { setLoading(false); return; }
      const cid = await resolveEffectiveCustomerId();
      const c = cid ? { id: cid } : null;
      if (!c) { setLoading(false); return; }

      const cutoff = dateCutoff(dateFilter);

      const [{ data: orders }, { data: payouts }, { data: yields }] = await Promise.all([
        supabase
          .from("orders")
          .select(
            "id, status, usdc_amount, htg_amount, reference_number, created_at, stellar_tx_hash, order_kind, rate, usdc_gross, fee_usdc, fee_bps, swap_direction, destination_stellar_address, destination_wallet_address, wallet_id",
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

      // Look up wallet labels + stellar addresses for all wallet IDs.
      const allWalletIds = Array.from(new Set([
        ...(orders ?? []).map((o) => (o as { wallet_id?: string | null }).wallet_id),
        ...(yields ?? []).map((y) => y.wallet_id),
        ...(payouts ?? []).map((p) => p.source_wallet_id),
      ].filter(Boolean) as string[]));
      const { data: wRows } = allWalletIds.length
        ? await supabase.from("wallets").select("id, label, stellar_address").in("id", allWalletIds)
        : { data: [] as { id: string; label: string | null; stellar_address: string | null }[] };
      const walletLabel = new Map((wRows ?? []).map((w) => [w.id, w.label ?? "Wallet"]));
      const walletStellarAddress = new Map((wRows ?? []).map((w) => [w.id, w.stellar_address ?? null]));

      // Look up wallet labels by stellar_address for all order destination addresses.
      const destAddresses = Array.from(new Set(
        (orders ?? [])
          .flatMap((o) => [
            (o as { destination_stellar_address?: string | null }).destination_stellar_address,
            (o as { destination_wallet_address?: string | null }).destination_wallet_address,
          ])
          .filter(Boolean) as string[]
      ));
      const { data: destWalletRows } = destAddresses.length
        ? await supabase.from("wallets").select("stellar_address, label").in("stellar_address", destAddresses)
        : { data: [] as { stellar_address: string; label: string | null }[] };
      const walletLabelByAddress = new Map(
        (destWalletRows ?? []).map((w) => [w.stellar_address, w.label ?? null])
      );

      const merged: UnifiedTx[] = [
        ...(orders ?? []).map((o) => {
          const kind = (o as { order_kind?: string }).order_kind;
          const ref = (o as { reference_number?: string }).reference_number ?? "";
          const type: TxType =
            kind === "htgc_mint" ? "htgc_mint" :
            kind === "htgc_usdc_swap" ? "swap" :
            kind === "htgc_withdraw" || ref.startsWith("THEO-W-") ? "withdraw" :
            "conversion";
          const row = o as {
            rate?: number | null;
            usdc_gross?: number | null;
            fee_usdc?: number | null;
            fee_bps?: number | null;
            swap_direction?: string | null;
            wallet_id?: string | null;
          };
          const srcWalletId = row.wallet_id ?? null;
          const destAddr = (o as { destination_stellar_address?: string | null }).destination_stellar_address
                        ?? (o as { destination_wallet_address?: string | null }).destination_wallet_address;
          // For orders missing wallet_id (e.g. legacy swaps), fall back to the
          // destination address as the source — swap/conversion/mint always
          // settle into the same wallet that initiated the order.
          const fallbackLabel = destAddr ? (walletLabelByAddress.get(destAddr) ?? null) : null;
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
            destination_stellar_address: destAddr ?? undefined,
            destination_wallet_address: (o as { destination_wallet_address?: string | null }).destination_wallet_address ?? undefined,
            destination_wallet_label: fallbackLabel,
            order_kind: kind,
            wallet_label: srcWalletId
              ? (walletLabel.get(srcWalletId) ?? fallbackLabel ?? undefined)
              : (fallbackLabel ?? undefined),
            source_wallet_address: srcWalletId
              ? (walletStellarAddress.get(srcWalletId) ?? destAddr ?? null)
              : (destAddr ?? null),
          };
        }),
        ...(payouts ?? []).map((p) => {
          const isTransfer = p.memo === "internal-transfer";
          const isYieldPayout = p.memo === "blend-withdraw";
          const srcWalletId = p.source_wallet_id ?? null;
          return {
            id: p.id,
            type: (isTransfer ? "transfer" : isYieldPayout ? "yield_payout" : "payout") as TxType,
            created_at: p.created_at,
            usdc_amount: Number(p.amount_usdc),
            status: PAYOUT_STATUS_MAP[p.status] ?? p.status,
            stellar_tx_hash: p.stellar_tx_hash ?? null,
            recipient_name: p.recipient_name,
            memo: isTransfer ? null : p.memo,
            wallet_label: isTransfer ? (walletLabel.get(srcWalletId ?? "") ?? "Wallet") : (srcWalletId ? (walletLabel.get(srcWalletId) ?? undefined) : undefined),
            source_wallet_address: srcWalletId ? (walletStellarAddress.get(srcWalletId) ?? null) : null,
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

    if (typeFilter === "conversion" && tx.type !== "conversion") return false;
    if (typeFilter === "mint" && tx.type !== "htgc_mint") return false;
    if (typeFilter === "swap" && tx.type !== "swap") return false;
    if (typeFilter === "payout" && tx.type !== "payout") return false;
    if (typeFilter === "yieldDeposit" && tx.type !== "yield" && tx.type !== "yield_earned" && tx.type !== "yield_payout") return false;
    if (typeFilter === "withdraw" && tx.type !== "withdraw") return false;
    if (typeFilter === "transfer" && tx.type !== "transfer") return false;
    if (typeFilter === "odoo" && !(tx.reference_number ?? "").toUpperCase().startsWith("THEO-ODO-")) return false;

    const statusUpper = tx.status.toUpperCase();
    if (statusFilter === "complete" && statusUpper !== "COMPLETED" && !statusUpper.includes("COMPLETE")) return false;
    if (statusFilter === "pending" && statusUpper !== "PENDING" && statusUpper !== "PROCESSING" && !statusUpper.includes("PENDING")) return false;
    if (statusFilter === "failed" && statusUpper !== "FAILED" && !statusUpper.includes("FAILED")) return false;

    if (!q) return true;
    const memoOk = tx.memo && !(INTERNAL_PAYOUT_MEMOS as readonly string[]).includes(tx.memo);
    return (
      (tx.reference_number ?? "").toLowerCase().includes(q) ||
      (tx.stellar_tx_hash ?? "").toLowerCase().includes(q) ||
      (tx.recipient_name ?? "").toLowerCase().includes(q) ||
      (memoOk && (tx.memo ?? "").toLowerCase().includes(q)) ||
      String(tx.usdc_amount).includes(q) ||
      String(tx.htg_amount ?? "").includes(q) ||
      new Date(tx.created_at).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" }).toLowerCase().includes(q) ||
      tx.type.includes(q)
    );
  });

  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
  const currentPage = Math.min(page, pageCount);
  const paged = filtered.slice((currentPage - 1) * perPage, currentPage * perPage);
  const pageBtn: CSSProperties = {
    padding: "6px 10px", borderRadius: 8, border: "1px solid hsl(var(--theo-light))",
    background: "#fff", color: "hsl(var(--theo-ink))", fontSize: 13, fontWeight: 600,
    fontFamily: "inherit", cursor: "pointer", lineHeight: 1,
  };

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
            ? csvAsciiArrows(swapDetailsLabel(t, tx.swap_direction ?? null, tx.order_kind))
            : "";
        const details = csvAsciiArrows(txDetailsPlain(t, locale, tx));
        const reference = (tx.type === "conversion" || tx.type === "swap" || tx.type === "htgc_mint")
          ? (tx.reference_number ?? "")
          : (tx.memo ?? "");
        return [
          csvCell(
            new Date(tx.created_at).toLocaleDateString(locale, {
              month: "short",
              day: "numeric",
              year: "numeric",
            }),
          ),
          csvCell(TYPE_PILL_LABEL[tx.type]),
          csvCell(canViewBalances ? amount : "—"),
          csvCell(currency),
          csvCell(direction),
          csvCell(canViewBalances ? details : "—"),
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
            {t("tx.title")}
          </div>
          <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))", marginTop: 2 }}>
            {t("tx.subtitle")}
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
          {t("tx.export.csv")}
        </button>
      </div>
      <div className="mb-5" style={{ width: 28, height: 3, background: "hsl(var(--theo-gold))", borderRadius: 2, marginTop: 8 }} />

      {/* Filters */}
      <div className="flex gap-2 mb-4 items-center">
        <select style={selectStyle} value={typeFilter} onChange={e => setTypeFilter(e.target.value as TypeFilterKey)}>
          {TYPE_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
        </select>
        <select style={selectStyle} value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilterKey)}>
          {STATUS_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
        </select>
        <select style={selectStyle} value={dateFilter} onChange={e => setDateFilter(e.target.value as DateFilterKey)}>
          {DATE_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
        </select>

        {(query.trim() || typeFilter !== "all" || statusFilter !== "all") && (
          <span style={{ fontSize: 12, color: "hsl(var(--theo-mid))", marginLeft: 4 }}>
            {filtered.length === 1
              ? t("tx.results.one")
              : t("tx.results.many").replace("{n}", String(filtered.length))}
          </span>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-14 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
        ) : all.length === 0 ? (
          <div className="py-14 text-center text-sm text-muted-foreground">{t("dashboard.recent.empty")}</div>
        ) : filtered.length === 0 ? (
          <div className="py-14 text-center text-sm text-muted-foreground">{t("tx.empty")}</div>
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
              {paged.map((tx) => {
                const q = query.trim().toLowerCase();
                const { amount: amountCell, currency: currencyCell } = txAmountCurrency(tx);
                const isHighlighted = (highlightId === tx.id) || (q && (
                  (tx.reference_number ?? "").toLowerCase().includes(q) ||
                  (tx.stellar_tx_hash ?? "").toLowerCase().includes(q) ||
                  (tx.recipient_name ?? "").toLowerCase().includes(q)
                ));
                return (
                  <tr
                    key={tx.id}
                    ref={(el) => { highlightRefs.current[tx.id] = el; }}
                    className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors"
                    style={isHighlighted ? { background: "hsl(var(--theo-blue-soft))" } : undefined}
                  >
                    {/* Date */}
                    <td className="px-5 py-3" style={{ fontSize: 13 }}>
                      {fmtDate(new Date(tx.created_at), { month: "short", day: "numeric", year: "numeric" })}
                    </td>

                    {/* Type badge */}
                    <td className="px-5 py-3">
                      {(() => {
                        const palette: Record<TxType, { bg: string; fg: string }> = {
                          conversion: { bg: "hsl(var(--theo-gold-soft))", fg: "#7A5F00" },
                          htgc_mint: { bg: "hsl(var(--theo-gold-soft))", fg: "#7A5F00" },
                          swap: { bg: "hsl(195 85% 92%)", fg: "hsl(200 80% 25%)" },
                          payout: { bg: "hsl(var(--theo-blue-soft))", fg: "hsl(var(--theo-blue))" },
                          yield_payout: { bg: "hsl(140 60% 92%)", fg: "hsl(150 70% 25%)" },
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
                      {canViewBalances ? amountCell : "—"}
                    </td>

                    {/* Currency (short label, muted) */}
                    <td className="px-5 py-3" style={currencyMuted}>
                      {currencyCell}
                    </td>

                    {/* Details */}
                    <td className="px-5 py-3" style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>
                      {!canViewBalances ? (
                        <span style={{ color: "hsl(var(--theo-mid))" }}>—</span>
                      ) : tx.type === "conversion" ? (
                        fmtHTG(tx.htg_amount ?? 0)
                      ) : tx.type === "htgc_mint" ? (
                        `Minted ${fmtHTGC(tx.htg_amount ?? 0)} HTG-C`
                      ) : tx.type === "swap" ? (
                        swapDetailsLabel(t, tx.swap_direction ?? null, tx.order_kind)
                      ) : tx.type === "yield" ? (
                        `Deposited ${fmtUSDC(tx.usdc_amount)} from ${tx.wallet_label} · ${((tx.net_apy ?? 0.07) * 100).toFixed(2)}% APY`
                      ) : tx.type === "yield_earned" ? (
                        `Daily yield · ${tx.wallet_label} · ${((tx.net_apy ?? 0.07) * 100).toFixed(2)}% APY`
                      ) : tx.type === "withdraw" ? (
                        `HTG withdrawal · bank account`
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
                      {(tx.type === "conversion" || tx.type === "swap" || tx.type === "htgc_mint" || tx.type === "withdraw")
                        ? (tx.reference_number ?? <span style={{ color: "hsl(var(--theo-mid))" }}>—</span>)
                        : tx.memo
                          ? <span style={{ fontFamily: "inherit", color: "hsl(var(--theo-mid))" }}>{tx.memo}</span>
                          : <span style={{ color: "hsl(var(--theo-mid))" }}>—</span>
                      }
                    </td>

                    {/* Receipt / TX hash */}
                    <td className="px-5 py-3" style={{ fontFamily: "monospace", fontSize: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {tx.stellar_tx_hash ? (
                          canViewBalances ? (
                            <a
                              href={`https://stellar.expert/explorer/testnet/tx/${tx.stellar_tx_hash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: "hsl(var(--theo-cyan))", fontWeight: 600 }}
                            >
                              {tx.stellar_tx_hash.slice(0, 8)}…{tx.stellar_tx_hash.slice(-4)}
                            </a>
                          ) : (
                            <span style={{ color: "hsl(var(--theo-mid))", fontWeight: 600 }}>
                              {tx.stellar_tx_hash.slice(0, 8)}…{tx.stellar_tx_hash.slice(-4)}
                            </span>
                          )
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
                                destinationAddress: (() => {
                                  const explicit = tx.destination_stellar_address ?? tx.destination_wallet_address;
                                  if (explicit) return explicit;
                                  if (tx.type === "swap" || tx.type === "conversion" || tx.type === "htgc_mint") return tx.source_wallet_address ?? undefined;
                                  return undefined;
                                })(),
                                destinationWalletLabel: (() => {
                                  const explicit = tx.destination_stellar_address ?? tx.destination_wallet_address;
                                  // Address-lookup label first; wallet_label as universal fallback
                                  if (explicit) return tx.destination_wallet_label ?? tx.wallet_label ?? undefined;
                                  // Source-wallet fallback path — same label
                                  if (tx.type === "swap" || tx.type === "conversion" || tx.type === "htgc_mint") return tx.wallet_label ?? undefined;
                                  return undefined;
                                })(),
                                recipientName: tx.recipient_name,
                                memo: tx.memo,
                                walletLabel: tx.wallet_label,
                                sourceWalletAddress: tx.source_wallet_address,
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

        {!loading && filtered.length > 0 && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "12px 16px", borderTop: "1px solid hsl(var(--theo-light))", gap: 12, flexWrap: "wrap",
          }}>
            <div style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>
              {t("tx.page.of").replace("{current}", String(currentPage)).replace("{total}", String(pageCount))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                style={{ ...pageBtn, display: "inline-flex", alignItems: "center", gap: 2, opacity: currentPage <= 1 ? 0.4 : 1, cursor: currentPage <= 1 ? "default" : "pointer" }}
              >
                <ChevronLeft style={{ width: 13, height: 13 }} /> {t("common.prev")}
              </button>
              {pageItems(currentPage, pageCount).map((it, i) =>
                it === "…" ? (
                  <span key={`e${i}`} style={{ padding: "0 4px", color: "hsl(var(--theo-mid))", fontSize: 13 }}>…</span>
                ) : (
                  <button
                    key={it}
                    onClick={() => setPage(it as number)}
                    style={{
                      ...pageBtn, minWidth: 34, textAlign: "center", fontWeight: 700,
                      background: it === currentPage ? "hsl(var(--theo-blue))" : "#fff",
                      color: it === currentPage ? "#fff" : "hsl(var(--theo-ink))",
                      borderColor: it === currentPage ? "hsl(var(--theo-blue))" : "hsl(var(--theo-light))",
                    }}
                  >
                    {it}
                  </button>
                ),
              )}
              <button
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={currentPage >= pageCount}
                style={{ ...pageBtn, display: "inline-flex", alignItems: "center", gap: 2, opacity: currentPage >= pageCount ? 0.4 : 1, cursor: currentPage >= pageCount ? "default" : "pointer" }}
              >
                {t("common.next")} <ChevronRight style={{ width: 13, height: 13 }} />
              </button>
              <select
                value={perPage}
                onChange={(e) => setPerPage(Number(e.target.value))}
                style={{ ...pageBtn, marginLeft: 6 }}
              >
                {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{t("tx.perPage").replace("{n}", String(n))}</option>)}
              </select>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

// Page-number items with ellipsis: 1 … (cur-1) cur (cur+1) … last
function pageItems(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  if (current > 3) out.push("…");
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) out.push(i);
  if (current < total - 2) out.push("…");
  out.push(total);
  return out;
}

function dateCutoff(key: DateFilterKey): string {
  const now = new Date();
  if (key === "30d") { now.setDate(now.getDate() - 30); return now.toISOString(); }
  if (key === "90d") { now.setDate(now.getDate() - 90); return now.toISOString(); }
  if (key === "ytd") { now.setMonth(0, 1); now.setHours(0, 0, 0, 0); return now.toISOString(); }
  return "2000-01-01T00:00:00Z";
}
