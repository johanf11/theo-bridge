import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Download, FileText } from "lucide-react";
import { generateStatement, type StatementData } from "@/lib/statement";

type RangeKey = "30d" | "3m" | "6m" | "12m" | "all";

const RANGES: { value: RangeKey; label: string; days: number | null }[] = [
  { value: "30d",  label: "Last 30 days",    days: 30 },
  { value: "3m",   label: "Last 3 months",   days: 90 },
  { value: "6m",   label: "Last 6 months",   days: 180 },
  { value: "12m",  label: "Last 12 months",  days: 365 },
  { value: "all",  label: "All time",        days: null },
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

function periodLabel(range: RangeKey, orders: BillingOrder[]): string {
  if (orders.length === 0) return RANGES.find(r => r.value === range)?.label ?? "";
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
  const { user } = useAuth();
  const [range, setRange]   = useState<RangeKey>("3m");
  const [orders, setOrders] = useState<BillingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [customerName, setCustomerName] = useState<string | undefined>();

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      const { data: c } = await supabase
        .from("customers")
        .select("id, company_name, contact_name")
        .eq("user_id", user.id)
        .maybeSingle();

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
      periodLabel:  periodLabel(range, orders),
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
  const BORDER = "1px solid hsl(var(--theo-light))";

  const btnStyle = (primary: boolean): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "7px 13px", fontSize: 12, fontWeight: 600,
    border: primary ? "1px solid hsl(var(--theo-blue))" : BORDER,
    background: primary ? "hsl(var(--theo-blue))" : "#fff",
    color: primary ? "#fff" : "hsl(var(--theo-ink))",
    borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
    letterSpacing: "0.01em",
  });

  const thStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em",
    color: "hsl(var(--theo-mid))", padding: "9px 12px", textAlign: "left",
    borderBottom: BORDER, background: "hsl(var(--theo-cream))", whiteSpace: "nowrap",
  };
  const tdStyle: React.CSSProperties = {
    fontSize: 12, color: "hsl(var(--theo-ink))", padding: "11px 12px",
    borderBottom: BORDER, whiteSpace: "nowrap",
  };
  const tdR: React.CSSProperties = { ...tdStyle, textAlign: "right" };
  const thR: React.CSSProperties = { ...thStyle, textAlign: "right" };

  return (
    <AppLayout>
      <div style={{ maxWidth: 1240, margin: "0 auto" }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "hsl(var(--theo-blue))", letterSpacing: "-0.02em", margin: 0 }}>
              Billing & Statements
            </h1>
            <div style={{ fontSize: 12, color: "hsl(var(--theo-mid))", marginTop: 3 }}>
              Fees paid to Theo and settlement partners
            </div>
            <div style={{ width: 36, height: 3, background: "hsl(var(--theo-gold))", marginTop: 8 }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 2 }}>
            {/* Period selector */}
            <select
              value={range}
              onChange={e => setRange(e.target.value as RangeKey)}
              style={{
                fontSize: 12, fontFamily: "inherit", color: "hsl(var(--theo-ink))",
                background: "#fff", border: BORDER, borderRadius: 6,
                padding: "7px 28px 7px 10px", cursor: "pointer", appearance: "none",
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='%236B6B8A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center",
              }}
            >
              {RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <button onClick={downloadCsv} style={btnStyle(false)} disabled={orders.length === 0}>
              <Download style={{ width: 13, height: 13 }} />
              CSV
            </button>
            <button id="billing-pdf-btn" onClick={downloadPdf} style={btnStyle(true)} disabled={orders.length === 0}>
              <FileText style={{ width: 13, height: 13 }} />
              Download PDF
            </button>
          </div>
        </div>

        {/* ── Summary strip ──────────────────────────────────────────────── */}
        <div style={{ border: BORDER, borderRadius: 6, overflow: "hidden", marginBottom: 20 }}>
          {/* Top row — 3 primary stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)" }}>
            {[
              { label: "Total Volume",    value: `$${fmtUsd(totals.gross)}`, sub: "USDC gross" },
              { label: "Net Received",    value: `$${fmtUsd(totals.net)}`,   sub: "USDC net" },
              { label: "Total Fees Paid", value: `$${fmtUsd(totals.fee)}`,   sub: "USDC" },
            ].map((s, i) => (
              <div key={i} style={{
                padding: "16px 18px",
                borderRight: i < 2 ? BORDER : "none",
                background: "#fff",
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "hsl(var(--theo-mid))", marginBottom: 6 }}>
                  {s.label}
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                  <span style={{ ...MONO, fontSize: 22, fontWeight: 800, color: "hsl(var(--theo-blue))", letterSpacing: "-0.02em" }}>{s.value}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "hsl(var(--theo-mid))" }}>{s.sub}</span>
                </div>
              </div>
            ))}
          </div>
          {/* Bottom band — fee breakdown + avg rate */}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
            background: "hsl(var(--theo-cream))",
            borderTop: BORDER,
          }}>
            {[
              { label: "Avg. fee rate",      value: `${totals.avgRate.toFixed(2)}%` },
              { label: "Theo service fee",   value: `$${fmtUsd(totals.theoFee)} USDC` },
              { label: "Settlement corridor", value: `$${fmtUsd(totals.corridor)} USDC` },
            ].map((t, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 18px",
                borderRight: i < 2 ? BORDER : "none",
              }}>
                <span style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>{t.label}</span>
                <span style={{ ...MONO, fontSize: 12, fontWeight: 700, color: "hsl(var(--theo-blue))" }}>{t.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Transactions table ─────────────────────────────────────────── */}
        <div style={{ background: "#fff", border: BORDER, borderRadius: 6, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Reference</th>
                  <th style={thR}>Gross (USDC)</th>
                  <th style={thR}>Net Received</th>
                  <th style={thR}>Fee Rate</th>
                  <th style={thR}>Theo Fee</th>
                  <th style={thR}>Corridor Fee</th>
                  <th style={thR}>Total Fee</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} style={{ ...tdStyle, textAlign: "center", padding: "32px 12px", color: "hsl(var(--theo-mid))" }}>
                    Loading…
                  </td></tr>
                ) : orders.length === 0 ? (
                  <tr><td colSpan={9} style={{ ...tdStyle, textAlign: "center", padding: "40px 12px", color: "hsl(var(--theo-mid))" }}>
                    No completed transactions in this period.
                  </td></tr>
                ) : (
                  <>
                    {orders.map((o, idx) => {
                      const corridor = Number(o.fee_usdc ?? 0) - Number(o.theo_fee_usdc ?? 0);
                      return (
                        <tr key={o.id} style={{ background: idx % 2 === 1 ? "hsl(var(--theo-cream))" : "#fff" }}>
                          <td style={tdStyle}>{fmtDate(o.completed_at ?? o.created_at)}</td>
                          <td style={{ ...tdStyle, ...MONO, fontSize: 11, color: "hsl(var(--theo-blue))", fontWeight: 700 }}>
                            {o.reference_number}
                          </td>
                          <td style={{ ...tdR, ...MONO, fontWeight: 600 }}>${fmtUsd(Number(o.usdc_gross ?? 0))}</td>
                          <td style={{ ...tdR, ...MONO }}>${fmtUsd(Number(o.usdc_amount ?? 0))}</td>
                          <td style={{ ...tdR, ...MONO, color: "hsl(var(--theo-mid))" }}>{fmtPct(o.fee_bps)}</td>
                          <td style={{ ...tdR, ...MONO }}>${fmtUsd(Number(o.theo_fee_usdc ?? 0))}</td>
                          <td style={{ ...tdR, ...MONO, color: "hsl(var(--theo-mid))" }}>${fmtUsd(corridor)}</td>
                          <td style={{ ...tdR, ...MONO, fontWeight: 700 }}>${fmtUsd(Number(o.fee_usdc ?? 0))}</td>
                          <td style={tdStyle}>
                            <span style={{
                              display: "inline-flex", alignItems: "center",
                              fontSize: 10, fontWeight: 700,
                              padding: "2px 8px", borderRadius: 999,
                              background: "rgba(34,197,94,0.10)",
                              color: "#15803d",
                              border: "1px solid rgba(34,197,94,0.25)",
                            }}>● Settled</span>
                          </td>
                        </tr>
                      );
                    })}
                    {/* Totals row */}
                    <tr style={{ background: "#eef0f8", borderTop: "2px solid hsl(var(--theo-light))" }}>
                      <td style={{ ...tdStyle, color: "hsl(var(--theo-mid))", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "none" }}>
                        {orders.length} orders
                      </td>
                      <td style={{ ...tdStyle, color: "hsl(var(--theo-blue))", fontWeight: 800, fontSize: 12, borderBottom: "none" }}>Total</td>
                      <td style={{ ...tdR, ...MONO, color: "hsl(var(--theo-ink))", fontWeight: 800, borderBottom: "none" }}>${fmtUsd(totals.gross)}</td>
                      <td style={{ ...tdR, ...MONO, color: "hsl(var(--theo-ink))", fontWeight: 800, borderBottom: "none" }}>${fmtUsd(totals.net)}</td>
                      <td style={{ ...tdR, ...MONO, color: "hsl(var(--theo-mid))", borderBottom: "none" }}>{totals.avgRate.toFixed(2)}%</td>
                      <td style={{ ...tdR, ...MONO, color: "hsl(var(--theo-ink))", fontWeight: 700, borderBottom: "none" }}>${fmtUsd(totals.theoFee)}</td>
                      <td style={{ ...tdR, ...MONO, color: "hsl(var(--theo-mid))", borderBottom: "none" }}>${fmtUsd(totals.corridor)}</td>
                      <td style={{ ...tdR, ...MONO, color: "hsl(var(--theo-blue))", fontWeight: 800, borderBottom: "none" }}>${fmtUsd(totals.fee)}</td>
                      <td style={{ ...tdStyle, borderBottom: "none" }} />
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Footer note ────────────────────────────────────────────────── */}
        <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginTop: 14, lineHeight: 1.7 }}>
          Theo fee (2.00%) is all-inclusive. Corridor cost (0.70%) reflects MoneyGram FX settlement and is
          passed through at cost. Statements are generated in UTC.
        </div>
      </div>
    </AppLayout>
  );
}
