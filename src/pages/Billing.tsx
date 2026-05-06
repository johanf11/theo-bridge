import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Download } from "lucide-react";

type RangeKey = "30d" | "3m" | "6m" | "12m" | "all";

const RANGES: { value: RangeKey; label: string; days: number | null }[] = [
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "3m", label: "Last 3 months", days: 90 },
  { value: "6m", label: "Last 6 months", days: 180 },
  { value: "12m", label: "Last 12 months", days: 365 },
  { value: "all", label: "All time", days: null },
];

type BillingOrder = {
  id: string;
  reference_number: string;
  order_kind: string;
  created_at: string;
  completed_at: string | null;
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

export default function Billing() {
  const { user } = useAuth();
  const [range, setRange] = useState<RangeKey>("3m");
  const [orders, setOrders] = useState<BillingOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      const { data: c } = await supabase.from("customers").select("id").eq("user_id", user.id).maybeSingle();
      if (!c?.id) {
        if (!cancelled) { setOrders([]); setLoading(false); }
        return;
      }

      const days = RANGES.find(r => r.value === range)?.days ?? null;
      let q = supabase
        .from("orders")
        .select("id, reference_number, order_kind, created_at, completed_at, usdc_gross, fee_bps, theo_fee_bps, corridor_bps, fee_usdc, theo_fee_usdc, status")
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
        setOrders((data ?? []) as BillingOrder[]);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [user, range]);

  const totals = useMemo(() => {
    let gross = 0, fee = 0, theoFee = 0;
    for (const o of orders) {
      gross   += Number(o.usdc_gross    ?? 0);
      fee     += Number(o.fee_usdc      ?? 0);
      theoFee += Number(o.theo_fee_usdc ?? 0);
    }
    const avgRate = gross > 0 ? (fee / gross) * 100 : 0;
    const corridor = fee - theoFee;
    return { gross, fee, theoFee, corridor, avgRate };
  }, [orders]);

  const downloadCsv = () => {
    const headers = ["Date","Reference","Type","Gross USDC","Fee %","Theo Fee","Corridor Fee","Total Fee","Status"];
    const rows = orders.map(o => {
      const corridor = Number(o.fee_usdc ?? 0) - Number(o.theo_fee_usdc ?? 0);
      return [
        fmtDate(o.completed_at ?? o.created_at),
        o.reference_number,
        o.order_kind,
        Number(o.usdc_gross ?? 0).toFixed(2),
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
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `theo-statement-${range}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Style primitives — Stripe/Square dense, 1px borders
  const BORDER = "1px solid hsl(var(--theo-light))";
  const cardStyle: React.CSSProperties = {
    background: "#fff",
    border: BORDER,
    borderRadius: 6,
    padding: "16px 18px",
  };
  const btnPrimary: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "7px 12px", fontSize: 13, fontWeight: 600,
    border: "1px solid hsl(var(--theo-blue))",
    background: "hsl(var(--theo-blue))", color: "#fff",
    borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
  };
  const btnGhost: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "7px 12px", fontSize: 13, fontWeight: 600,
    border: BORDER, background: "#fff", color: "hsl(var(--theo-mid))",
    borderRadius: 6, cursor: "not-allowed", fontFamily: "inherit", opacity: 0.6,
  };
  const th: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em",
    color: "hsl(var(--theo-mid))", padding: "10px 14px", textAlign: "left",
    borderBottom: BORDER, background: "hsl(var(--theo-cream))",
    whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    fontSize: 13, color: "hsl(var(--theo-ink))", padding: "12px 14px",
    borderBottom: BORDER, whiteSpace: "nowrap",
  };

  return (
    <AppLayout>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 18 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: "hsl(var(--theo-blue))", letterSpacing: "-0.02em", margin: 0 }}>
              Billing & Statements
            </h1>
            <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))", marginTop: 4 }}>
              Fees paid to Theo and settlement partners
            </div>
            <div style={{ width: 40, height: 3, background: "hsl(var(--theo-gold))", marginTop: 10 }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={downloadCsv} style={btnPrimary}>
              <Download style={{ width: 14, height: 14 }} />
              Download CSV
            </button>
            <button id="billing-pdf-btn" disabled title="Generating…" style={btnGhost}>
              <Download style={{ width: 14, height: 14 }} />
              Download PDF
            </button>
          </div>
        </div>

        {/* Range selector */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "hsl(var(--theo-mid))" }}>
            Period
          </label>
          <select
            value={range}
            onChange={e => setRange(e.target.value as RangeKey)}
            style={{
              fontSize: 13, fontFamily: "inherit", color: "hsl(var(--theo-ink))",
              background: "#fff", border: BORDER, borderRadius: 6,
              padding: "6px 28px 6px 10px", cursor: "pointer",
              appearance: "none",
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6B8A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
              backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center",
            }}
          >
            {RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>

        {/* Summary stat cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 0 }}>
          <StatCard label="Total Volume"     value={`$${fmtUsd(totals.gross)}`}   suffix="USDC" />
          <StatCard label="Total Fees Paid"  value={`$${fmtUsd(totals.fee)}`}     suffix="USDC" />
          <StatCard label="Avg. Fee Rate"    value={`${totals.avgRate.toFixed(2)}%`} />
        </div>

        {/* Fee breakdown band */}
        <div
          style={{
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12,
            background: "hsl(var(--theo-cream))",
            border: BORDER, borderTop: "none",
            padding: "12px 14px",
            borderRadius: "0 0 6px 6px",
            marginTop: -1,
          }}
        >
          <BreakdownTile label="Theo service fee" value={`$${fmtUsd(totals.theoFee)} USDC`} />
          <BreakdownTile label="Settlement corridor" value={`$${fmtUsd(totals.corridor)} USDC`} />
        </div>

        {/* Transactions table */}
        <div style={{ marginTop: 22, background: "#fff", border: BORDER, borderRadius: 6, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Date</th>
                  <th style={th}>Reference</th>
                  <th style={th}>Type</th>
                  <th style={{ ...th, textAlign: "right" }}>Gross Volume</th>
                  <th style={{ ...th, textAlign: "right" }}>Fee Rate</th>
                  <th style={{ ...th, textAlign: "right" }}>Theo Fee</th>
                  <th style={{ ...th, textAlign: "right" }}>Corridor Fee</th>
                  <th style={{ ...th, textAlign: "right" }}>Total Fee</th>
                  <th style={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} style={{ ...td, textAlign: "center", color: "hsl(var(--theo-mid))" }}>Loading…</td></tr>
                ) : orders.length === 0 ? (
                  <tr><td colSpan={9} style={{ ...td, textAlign: "center", color: "hsl(var(--theo-mid))", padding: "32px 14px" }}>
                    No completed transactions in this period.
                  </td></tr>
                ) : (
                  orders.map(o => {
                    const corridor = Number(o.fee_usdc ?? 0) - Number(o.theo_fee_usdc ?? 0);
                    return (
                      <tr key={o.id}>
                        <td style={td}>{fmtDate(o.completed_at ?? o.created_at)}</td>
                        <td style={{ ...td, ...MONO, fontSize: 12, color: "hsl(var(--theo-blue))", fontWeight: 600 }}>
                          {o.reference_number}
                        </td>
                        <td style={{ ...td, color: "hsl(var(--theo-mid))" }}>HTG → USDC</td>
                        <td style={{ ...td, ...MONO, textAlign: "right", fontWeight: 700 }}>${fmtUsd(Number(o.usdc_gross ?? 0))}</td>
                        <td style={{ ...td, ...MONO, textAlign: "right", color: "hsl(var(--theo-mid))" }}>{fmtPct(o.fee_bps)}</td>
                        <td style={{ ...td, ...MONO, textAlign: "right" }}>${fmtUsd(Number(o.theo_fee_usdc ?? 0))}</td>
                        <td style={{ ...td, ...MONO, textAlign: "right" }}>${fmtUsd(corridor)}</td>
                        <td style={{ ...td, ...MONO, textAlign: "right", fontWeight: 700 }}>${fmtUsd(Number(o.fee_usdc ?? 0))}</td>
                        <td style={td}>
                          <span style={{
                            display: "inline-flex", alignItems: "center",
                            fontSize: 11, fontWeight: 700,
                            padding: "3px 9px", borderRadius: 999,
                            background: "rgba(34,197,94,0.10)",
                            color: "#15803d",
                            border: "1px solid rgba(34,197,94,0.25)",
                          }}>
                            Settled
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer note */}
        <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginTop: 14, lineHeight: 1.6 }}>
          Theo fee (2.00%) is all-inclusive. Corridor cost (0.70%) reflects MoneyGram FX settlement and is passed
          through at cost. Statements are generated in UTC.
        </div>
      </div>
    </AppLayout>
  );
}

function StatCard({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div style={{
      background: "#fff",
      border: "1px solid hsl(var(--theo-light))",
      borderRadius: "6px 6px 0 0",
      padding: "14px 16px",
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "hsl(var(--theo-mid))", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ ...MONO, fontSize: 22, fontWeight: 800, color: "hsl(var(--theo-blue))", letterSpacing: "-0.02em" }}>{value}</span>
        {suffix && <span style={{ fontSize: 11, fontWeight: 700, color: "hsl(var(--theo-mid))" }}>{suffix}</span>}
      </div>
    </div>
  );
}

function BreakdownTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>{label}</span>
      <span style={{ ...MONO, fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-blue))" }}>{value}</span>
    </div>
  );
}
