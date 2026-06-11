import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Download, FileText } from "lucide-react";
import { generateStatement, type StatementData } from "@/lib/statement";
import { useT, type TKey } from "@/lib/i18n";
import { useLocale } from "@/lib/locale";
import { usePermissions } from "@/hooks/usePermissions";
import { useRoles } from "@/lib/auth";

type RangeKey = "30d" | "3m" | "6m" | "12m" | "all";

const RANGES: { value: RangeKey; labelKey: TKey; days: number | null }[] = [
  { value: "30d",  labelKey: "billing.range.30d",  days: 30 },
  { value: "3m",   labelKey: "billing.range.3m",   days: 90 },
  { value: "6m",   labelKey: "billing.range.6m",   days: 180 },
  { value: "12m",  labelKey: "billing.range.12m",  days: 365 },
  { value: "all",  labelKey: "billing.range.all",  days: null },
];

type BillingOrder = {
  id: string;
  reference_number: string;
  order_kind: string;
  created_at: string;
  completed_at: string | null;
  usdc_amount: number | null;
  usdc_gross: number | null;
  fee_bps: number | null;
  theo_fee_bps: number | null;
  corridor_bps: number | null;
  fee_usdc: number | null;
  theo_fee_usdc: number | null;
  status: string;
};

const MONO: React.CSSProperties = {
  fontFamily: "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontVariantNumeric: "tabular-nums",
};

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtPct = (bps: number | null | undefined) =>
  bps == null ? "—" : `${(bps / 100).toFixed(2)}%`;

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" })
    : "—";

function periodLabel(range: RangeKey, orders: BillingOrder[], translate: ReturnType<typeof useT>): string {
  const key = RANGES.find(r => r.value === range)?.labelKey;
  if (orders.length === 0) return key ? translate(key) : "";
  const dates = orders
    .map(o => o.completed_at ?? o.created_at)
    .filter(Boolean)
    .map(d => new Date(d!).getTime())
    .sort((a, b) => a - b);
  const fmt = (ts: number) =>
    new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`;
}

export default function Billing() {
  const t = useT();
  const locale = useLocale();
  const { user } = useAuth();
  const { can, isOwner } = usePermissions();
  const { isAdmin } = useRoles();
  const canViewBalances = isOwner || isAdmin || can("view_balances");
  const [range, setRange]   = useState<RangeKey>("3m");
  const [orders, setOrders] = useState<BillingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [customerName, setCustomerName] = useState<string | undefined>();

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      // Resolve effective customer — org member takes priority over own row
      let c: { id: string; company_name?: string; contact_name?: string } | null = null;
      const { data: mem } = await supabase.from("org_members").select("customer_id").eq("user_id", user.id).not("accepted_at", "is", null).maybeSingle();
      if (mem?.customer_id) {
        const { data: orgC } = await supabase.from("customers").select("id, company_name, contact_name").eq("id", mem.customer_id).maybeSingle();
        c = orgC ?? null;
      } else {
        const { data: own } = await supabase.from("customers").select("id, company_name, contact_name").eq("user_id", user.id).maybeSingle();
        c = own ?? null;
      }

      if (!c?.id) {
        if (!cancelled) { setOrders([]); setLoading(false); }
        return;
      }
      setCustomerName((c as { company_name?: string; contact_name?: string }).company_name
        ?? (c as { company_name?: string; contact_name?: string }).contact_name
        ?? undefined);

      const days = RANGES.find(r => r.value === range)?.days ?? null;
      let q = supabase
        .from("orders")
        .select(
          "id, reference_number, order_kind, created_at, completed_at, " +
          "usdc_amount, usdc_gross, fee_bps, theo_fee_bps, corridor_bps, fee_usdc, theo_fee_usdc, status"
        )
        .eq("customer_id", c.id)
        .eq("status", "COMPLETED")
        .eq("order_kind", "usdc_conversion")
        .order("completed_at", { ascending: false, nullsFirst: false });

      if (days != null) {
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        q = q.gte("completed_at", since);
      }

      const { data } = await q;
      if (!cancelled) {
        setOrders((data ?? []) as unknown as BillingOrder[]);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [user, range]);

  const totals = useMemo(() => {
    let gross = 0, net = 0, fee = 0, theoFee = 0;
    for (const o of orders) {
      gross   += Number(o.usdc_gross    ?? 0);
      net     += Number(o.usdc_amount   ?? 0);
      fee     += Number(o.fee_usdc      ?? 0);
      theoFee += Number(o.theo_fee_usdc ?? 0);
    }
    const avgRate = gross > 0 ? (fee / gross) * 100 : 0;
    const corridor = fee - theoFee;
    return { gross, net, fee, theoFee, corridor, avgRate };
  }, [orders]);

  const downloadCsv = () => {
    const headers = ["Date","Reference","Gross USDC","Net Received","Fee %","Theo Fee","Corridor Fee","Total Fee","Status"];
    const rows = orders.map(o => {
      const corridor = Number(o.fee_usdc ?? 0) - Number(o.theo_fee_usdc ?? 0);
      return [
        fmtDate(o.completed_at ?? o.created_at),
        o.reference_number,
        Number(o.usdc_gross   ?? 0).toFixed(2),
        Number(o.usdc_amount  ?? 0).toFixed(2),
        ((o.fee_bps ?? 0) / 100).toFixed(2) + "%",
        Number(o.theo_fee_usdc ?? 0).toFixed(2),
        corridor.toFixed(2),
        Number(o.fee_usdc ?? 0).toFixed(2),
        o.status,
      ];
    });
    const csv = [headers, ...rows]
      .map(r => r.map(c => {
        const s = String(c ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `theo-statement-${range}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadPdf = () => {
    const stmtData: StatementData = {
      periodLabel:  periodLabel(range, orders, t),
      generatedAt:  new Date().toISOString(),
      customerName,
      totals,
      rows: orders.map(o => ({
        completedAt:  o.completed_at ?? o.created_at,
        reference:    o.reference_number,
        usdcGross:    Number(o.usdc_gross    ?? 0),
        usdcNet:      Number(o.usdc_amount   ?? 0),
        feeUsdc:      Number(o.fee_usdc      ?? 0),
        theoFeeUsdc:  Number(o.theo_fee_usdc ?? 0),
        corridorFee:  Number(o.fee_usdc ?? 0) - Number(o.theo_fee_usdc ?? 0),
        feeBps:       Number(o.fee_bps       ?? 0),
      })),
    };
    generateStatement(stmtData);
  };

  // ── Style tokens ────────────────────────────────────────────────────────────
  const BORDER  = "1px solid hsl(var(--theo-light))";
  const N       = "hsl(var(--theo-blue))";
  const MID     = "hsl(var(--theo-mid))";
  const CREAM   = "hsl(var(--theo-cream))";
  const CYAN    = "#08B5E5";

  const btnStyle = (primary: boolean): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: 7,
    padding: "8px 14px", fontSize: 12.5, fontWeight: 700,
    border: primary ? "none" : BORDER,
    background: primary ? N : "#fff",
    color: primary ? "#fff" : N,
    borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
  });

  const TH: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.10em",
    color: MID, padding: "11px 18px", textAlign: "left",
    borderBottom: BORDER, background: CREAM, whiteSpace: "nowrap",
  };
  const THR: React.CSSProperties = { ...TH, textAlign: "right" };
  const THC: React.CSSProperties = { ...TH, textAlign: "center" };

  const TD: React.CSSProperties = {
    fontSize: 13, color: "hsl(var(--theo-ink))", padding: "12px 18px",
    borderBottom: BORDER, whiteSpace: "nowrap", verticalAlign: "middle",
  };

  const selectedRange = RANGES.find(r => r.value === range);

  const periodMeta = () => {
    if (orders.length === 0) return "";
    const dates = orders
      .map(o => o.completed_at ?? o.created_at)
      .filter(Boolean)
      .map(d => new Date(d!).getTime())
      .sort((a, b) => a - b);
    const fmt = (ts: number) =>
      new Date(ts).toLocaleDateString(locale, { month: "short", day: "2-digit", year: "numeric" });
    return `${orders.length} ${t("billing.orders")} · ${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`;
  };

  const fmtUsdLocal = (n: number) =>
    n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDateLocal = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "short", day: "2-digit" }) : "—";

  return (
    <AppLayout>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24, marginBottom: 6 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: N, letterSpacing: "-0.02em", margin: 0, lineHeight: 1.15 }}>
              {t("billing.title.full")}
            </h1>
            <div style={{ fontSize: 13, color: MID, marginTop: 6, lineHeight: 1.55 }}>
              {t("billing.subtitle.fees")}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, paddingTop: 4 }}>
            <select
              value={range}
              onChange={e => setRange(e.target.value as RangeKey)}
              style={{
                fontSize: 12.5, fontFamily: "inherit", fontWeight: 600, color: N,
                background: "#fff", border: BORDER, borderRadius: 8,
                padding: "8px 36px 8px 12px", cursor: "pointer", appearance: "none",
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2333359A' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center",
              }}
            >
              {RANGES.map(r => <option key={r.value} value={r.value}>{t(r.labelKey)}</option>)}
            </select>
            <button onClick={downloadCsv} style={btnStyle(false)} disabled={orders.length === 0 || !canViewBalances}>
              <Download style={{ width: 13, height: 13 }} />
              CSV
            </button>
            <button id="billing-pdf-btn" onClick={downloadPdf} style={btnStyle(true)} disabled={orders.length === 0 || !canViewBalances}>
              <FileText style={{ width: 13, height: 13 }} />
              {t("billing.downloadPdf")}
            </button>
          </div>
        </div>

        {/* Gold rule */}
        <div style={{ width: 28, height: 3, background: "hsl(var(--theo-gold))", borderRadius: 2, margin: "14px 0 24px" }} />

        {/* ── Stat grid ──────────────────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 18 }}>

          {/* Card 1 — Total Volume */}
          <div style={{ background: "#fff", border: BORDER, borderRadius: 14, padding: "18px 22px 16px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: MID, marginBottom: 8 }}>
              {t("billing.totalVolume")}
            </div>
            <div style={{ ...MONO, display: "flex", alignItems: "baseline", gap: 8, fontSize: 28, fontWeight: 800, color: N, letterSpacing: "-0.02em", lineHeight: 1.05, fontVariantNumeric: "tabular-nums" }}>
              {canViewBalances ? `$${fmtUsdLocal(totals.gross)}` : "—"}
              <span style={{ fontSize: 11, fontWeight: 700, color: MID, letterSpacing: "0.06em", textTransform: "uppercase" }}>{t("billing.usdcGross")}</span>
            </div>
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed hsl(var(--theo-light))", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
              <span style={{ color: MID }}>{t("billing.avgFeeRate")}</span>
              <span style={{ ...MONO, fontWeight: 700, color: "hsl(var(--theo-ink))", fontVariantNumeric: "tabular-nums" }}>{canViewBalances ? `${totals.avgRate.toFixed(2)}%` : "—"}</span>
            </div>
          </div>

          {/* Card 2 — Net Received */}
          <div style={{ background: "#fff", border: BORDER, borderRadius: 14, padding: "18px 22px 16px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: MID, marginBottom: 8 }}>
              {t("billing.netReceived")}
            </div>
            <div style={{ ...MONO, display: "flex", alignItems: "baseline", gap: 8, fontSize: 28, fontWeight: 800, color: N, letterSpacing: "-0.02em", lineHeight: 1.05, fontVariantNumeric: "tabular-nums" }}>
              {canViewBalances ? `$${fmtUsdLocal(totals.net)}` : "—"}
              <span style={{ fontSize: 11, fontWeight: 700, color: MID, letterSpacing: "0.06em", textTransform: "uppercase" }}>{t("billing.usdcNet")}</span>
            </div>
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed hsl(var(--theo-light))", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
              <span style={{ color: MID }}>{t("billing.theoServiceFee")}</span>
              <span style={{ ...MONO, fontWeight: 700, color: "hsl(var(--theo-ink))", fontVariantNumeric: "tabular-nums" }}>
                {canViewBalances ? <>${fmtUsdLocal(totals.theoFee)}<span style={{ color: MID, fontWeight: 600, fontSize: 10.5, marginLeft: 4, letterSpacing: "0.06em" }}>USDC</span></> : "—"}
              </span>
            </div>
          </div>

          {/* Card 3 — Total Fees (gold) */}
          <div style={{ background: "hsl(var(--theo-gold))", border: "1px solid hsl(var(--theo-gold))", borderRadius: 14, padding: "18px 22px 16px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "rgba(51,53,154,0.55)", marginBottom: 8 }}>
              {t("billing.fee.total")}
            </div>
            <div style={{ ...MONO, display: "flex", alignItems: "baseline", gap: 8, fontSize: 28, fontWeight: 800, color: N, letterSpacing: "-0.02em", lineHeight: 1.05, fontVariantNumeric: "tabular-nums" }}>
              {canViewBalances ? `$${fmtUsdLocal(totals.fee)}` : "—"}
              <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(51,53,154,0.55)", letterSpacing: "0.06em", textTransform: "uppercase" }}>USDC</span>
            </div>
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed rgba(51,53,154,0.18)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
              <span style={{ color: "rgba(51,53,154,0.65)" }}>{t("billing.settlementCorridor")}</span>
              <span style={{ ...MONO, fontWeight: 700, color: N, fontVariantNumeric: "tabular-nums" }}>
                {canViewBalances ? <>${fmtUsdLocal(totals.corridor)}<span style={{ color: "rgba(51,53,154,0.55)", fontWeight: 600, fontSize: 10.5, marginLeft: 4, letterSpacing: "0.06em" }}>USDC</span></> : "—"}
              </span>
            </div>
          </div>

        </div>

        {/* ── Statement panel ─────────────────────────────────────────────── */}
        <div style={{ background: "#fff", border: BORDER, borderRadius: 14, overflow: "hidden" }}>

          {/* Panel head */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px", borderBottom: BORDER, gap: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: N }}>
              {t("billing.statement")} · {selectedRange ? t(selectedRange.labelKey) : ""}
            </div>
            <div style={{ fontSize: 11.5, color: MID, fontVariantNumeric: "tabular-nums" }}>
              {periodMeta()}
            </div>
          </div>

          {/* Table */}
          <div style={{ width: "100%", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
              <thead>
                <tr>
                  <th style={TH}>{t("billing.th.date")}</th>
                  <th style={TH}>{t("billing.th.reference")}</th>
                  <th style={THR}>{t("billing.th.gross")}</th>
                  <th style={THR}>{t("billing.netReceived")}</th>
                  <th style={THR}>{t("billing.th.feeRate")}</th>
                  <th style={THR}>{t("billing.th.theoFee")}</th>
                  <th style={THR}>{t("billing.th.corridorFee")}</th>
                  <th style={THR}>{t("billing.th.totalFee")}</th>
                  <th style={THC}>{t("billing.th.status")}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} style={{ ...TD, textAlign: "center", padding: "40px 18px", color: MID }}>
                    {t("common.loading")}
                  </td></tr>
                ) : orders.length === 0 ? (
                  <tr><td colSpan={9} style={{ ...TD, textAlign: "center", padding: "48px 18px", color: MID }}>
                    {t("billing.noTransactions")}
                  </td></tr>
                ) : orders.map(o => {
                  const corridor = Number(o.fee_usdc ?? 0) - Number(o.theo_fee_usdc ?? 0);
                  return (
                    <tr key={o.id} style={{ borderBottom: BORDER }}>
                      <td style={{ ...TD, color: MID, fontVariantNumeric: "tabular-nums", fontSize: 12.5 }}>
                        {fmtDateLocal(o.completed_at ?? o.created_at)}
                      </td>
                      <td style={{ ...TD, ...MONO, fontSize: 12, color: CYAN, fontWeight: 600, letterSpacing: "0.02em" }}>
                        {o.reference_number}
                      </td>
                      <td style={{ ...TD, ...MONO, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                        {canViewBalances ? `$${fmtUsdLocal(Number(o.usdc_gross ?? 0))}` : "—"}
                      </td>
                      <td style={{ ...TD, ...MONO, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                        {canViewBalances ? `$${fmtUsdLocal(Number(o.usdc_amount ?? 0))}` : "—"}
                      </td>
                      <td style={{ ...TD, ...MONO, textAlign: "right", fontVariantNumeric: "tabular-nums", color: MID, fontWeight: 500, fontSize: 12.5 }}>
                        {canViewBalances ? fmtPct(o.fee_bps) : "—"}
                      </td>
                      <td style={{ ...TD, ...MONO, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                        {canViewBalances ? `$${fmtUsdLocal(Number(o.theo_fee_usdc ?? 0))}` : "—"}
                      </td>
                      <td style={{ ...TD, ...MONO, textAlign: "right", fontVariantNumeric: "tabular-nums", color: MID, fontWeight: 500 }}>
                        {canViewBalances ? `$${fmtUsdLocal(corridor)}` : "—"}
                      </td>
                      <td style={{ ...TD, ...MONO, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: N }}>
                        {canViewBalances ? `$${fmtUsdLocal(Number(o.fee_usdc ?? 0))}` : "—"}
                      </td>
                      <td style={{ ...TD, textAlign: "center" }}>
                        <span style={{
                          display: "inline-flex", alignItems: "center", gap: 6,
                          padding: "4px 10px", borderRadius: 999,
                          fontSize: 11, fontWeight: 700,
                          background: "#EFFBF3", color: "#1A7F37",
                        }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#1A7F37", display: "inline-block" }} />
                          {t("billing.settled")}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {orders.length > 0 && (
                <tfoot>
                  <tr>
                    <td style={{ padding: "14px 18px", background: CREAM, borderTop: "2px solid hsl(var(--theo-light))", fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: MID }}>
                      {orders.length} {t("billing.orders")}
                    </td>
                    <td style={{ padding: "14px 18px", background: CREAM, borderTop: "2px solid hsl(var(--theo-light))", fontSize: 13, fontWeight: 800, color: N }}>
                      {t("billing.total")}
                    </td>
                    <td style={{ padding: "14px 18px", background: CREAM, borderTop: "2px solid hsl(var(--theo-light))", ...MONO, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: N, fontSize: 13 }}>
                      {canViewBalances ? `$${fmtUsdLocal(totals.gross)}` : "—"}
                    </td>
                    <td style={{ padding: "14px 18px", background: CREAM, borderTop: "2px solid hsl(var(--theo-light))", ...MONO, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: N, fontSize: 13 }}>
                      {canViewBalances ? `$${fmtUsdLocal(totals.net)}` : "—"}
                    </td>
                    <td style={{ padding: "14px 18px", background: CREAM, borderTop: "2px solid hsl(var(--theo-light))", ...MONO, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: MID, fontSize: 12.5 }}>
                      {canViewBalances ? `${totals.avgRate.toFixed(2)}%` : "—"}
                    </td>
                    <td style={{ padding: "14px 18px", background: CREAM, borderTop: "2px solid hsl(var(--theo-light))", ...MONO, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: N, fontSize: 13 }}>
                      {canViewBalances ? `$${fmtUsdLocal(totals.theoFee)}` : "—"}
                    </td>
                    <td style={{ padding: "14px 18px", background: CREAM, borderTop: "2px solid hsl(var(--theo-light))", ...MONO, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: N, fontSize: 13 }}>
                      {canViewBalances ? `$${fmtUsdLocal(totals.corridor)}` : "—"}
                    </td>
                    <td style={{ padding: "14px 18px", background: CREAM, borderTop: "2px solid hsl(var(--theo-light))", ...MONO, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: N, fontSize: 13 }}>
                      {canViewBalances ? `$${fmtUsdLocal(totals.fee)}` : "—"}
                    </td>
                    <td style={{ padding: "14px 18px", background: CREAM, borderTop: "2px solid hsl(var(--theo-light))" }} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Panel footer note */}
          <div style={{ padding: "14px 22px", borderTop: BORDER, background: CREAM, fontSize: 11.5, color: MID, lineHeight: 1.55 }}>
            {t("billing.footerNote")}
          </div>
        </div>

      </div>
    </AppLayout>
  );
}
