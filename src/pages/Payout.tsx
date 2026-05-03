import { useState } from "react";
import { AppLayout } from "@/components/theo/Layout";
import { Upload } from "lucide-react";

type Tab = "single" | "bulk";

export default function Payout() {
  const [tab, setTab] = useState<Tab>("single");

  const tabStyle = (t: Tab) => ({
    padding: "9px 16px", fontSize: 13, fontWeight: 600,
    color: tab === t ? "hsl(var(--theo-blue))" : "hsl(var(--theo-mid))",
    border: "none", background: "none", cursor: "pointer", fontFamily: "inherit",
    borderBottom: tab === t ? "2px solid hsl(var(--theo-blue))" : "2px solid transparent",
    marginBottom: -1, transition: "all 130ms",
  } as React.CSSProperties);

  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: 10, fontWeight: 700,
    textTransform: "uppercase", letterSpacing: "0.10em",
    color: "hsl(var(--theo-mid))", marginBottom: 6,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", fontFamily: "inherit", fontSize: 14,
    padding: "10px 12px", borderRadius: 9,
    border: "1.5px solid hsl(var(--theo-light))",
    background: "#fff", color: "hsl(var(--theo-ink))",
    outline: "none", marginBottom: 14, boxSizing: "border-box",
  };

  const recentPayouts = [
    { recipients: 3, date: "Apr 22, 2026", ref: "PO-00041", amount: "$1,500", status: "Paid", statusColor: "#EFFBF3", statusText: "#1A7F37" },
    { recipients: 5, date: "Apr 5, 2026", ref: "PO-00040", amount: "$2,800", status: "Processing", statusColor: "hsl(var(--theo-gold-soft))", statusText: "#7A5F00" },
    { recipients: 2, date: "Mar 15, 2026", ref: "PO-00039", amount: "$900", status: "Paid", statusColor: "#EFFBF3", statusText: "#1A7F37" },
  ];

  return (
    <AppLayout>
      <div className="mb-1">
        <div className="font-extrabold" style={{ fontSize: 22, color: "hsl(var(--theo-blue))", letterSpacing: "-0.02em" }}>
          Payout
        </div>
        <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))", marginTop: 2 }}>
          Send USDC to one or many recipients at once.
        </div>
      </div>
      <div className="mb-5" style={{ width: 28, height: 3, background: "hsl(var(--theo-gold))", borderRadius: 2, marginTop: 8 }} />

      <div className="grid gap-4" style={{ gridTemplateColumns: "3fr 2fr" }}>
        {/* Payout form */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-1">
            <div className="font-bold" style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>New payout</div>
            <span className="font-bold rounded-full" style={{ fontSize: 11, background: "hsl(var(--theo-blue-soft))", color: "hsl(var(--theo-blue))", padding: "3px 8px" }}>
              Mass payout enabled
            </span>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-border mb-4 mt-3">
            <button style={tabStyle("single")} onClick={() => setTab("single")}>Single recipient</button>
            <button style={tabStyle("bulk")} onClick={() => setTab("bulk")}>Bulk / CSV upload</button>
          </div>

          {tab === "single" ? (
            <>
              <div className="grid gap-3 mb-3.5" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label style={labelStyle}>Recipient name</label>
                  <input style={{ ...inputStyle, marginBottom: 0 }} type="text" placeholder="Marie Claire Dupont" />
                </div>
                <div>
                  <label style={labelStyle}>Stellar wallet address</label>
                  <input style={{ ...inputStyle, marginBottom: 0 }} type="text" placeholder="G..." />
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Amount (USDC)</label>
                <div style={{ position: "relative" }}>
                  <input style={{ ...inputStyle, marginBottom: 0, paddingRight: 56 }} type="text" placeholder="0.00" />
                  <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 12, fontWeight: 700, color: "hsl(var(--theo-mid))" }}>
                    USDC
                  </span>
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Source wallet</label>
                <select style={{ ...inputStyle, marginBottom: 0, appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6B8A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center", paddingRight: 28, cursor: "pointer" }}>
                  <option>Primary — Operations</option>
                  <option>Secondary — Payroll</option>
                </select>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Memo / reference (optional)</label>
                <input style={{ ...inputStyle, marginBottom: 0 }} type="text" placeholder="e.g. April salary — supplier payment" />
              </div>
              <div className="flex gap-2 mt-1">
                <button
                  className="flex items-center gap-1.5 font-bold text-white"
                  style={{ background: "hsl(var(--theo-blue))", borderRadius: 8, padding: "8px 16px", fontSize: 13, border: "none", cursor: "pointer", fontFamily: "inherit" }}
                >
                  Send payout
                </button>
                <button
                  className="font-bold"
                  style={{ background: "transparent", border: "1.5px solid hsl(var(--theo-blue))", color: "hsl(var(--theo-blue))", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}
                >
                  Save draft
                </button>
              </div>
            </>
          ) : (
            <>
              <div
                className="text-center cursor-pointer transition-colors"
                style={{ border: "1.5px dashed hsl(var(--theo-light))", borderRadius: 10, padding: "28px 20px" }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = "hsl(var(--theo-blue))";
                  (e.currentTarget as HTMLElement).style.background = "hsl(var(--theo-blue-soft))";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = "hsl(var(--theo-light))";
                  (e.currentTarget as HTMLElement).style.background = "";
                }}
              >
                <Upload className="mx-auto mb-2.5 opacity-60" style={{ width: 28, height: 28, stroke: "hsl(var(--theo-blue))", strokeWidth: 1.8 }} />
                <div style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--theo-blue))" }}>Upload CSV file</div>
                <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginTop: 4 }}>
                  Columns: name, stellar_address, amount_usdc, memo
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <a href="#" style={{ fontSize: 12, color: "hsl(var(--theo-cyan))", fontWeight: 600, textDecoration: "none" }}>
                  Download template CSV
                </a>
              </div>
            </>
          )}
        </div>

        {/* Recent payouts */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-xs">
          <div className="font-bold mb-4" style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>Recent payouts</div>
          <div className="flex flex-col gap-2.5">
            {recentPayouts.map((p, i) => (
              <div
                key={i}
                className="flex justify-between items-center py-2.5"
                style={{ borderBottom: i < recentPayouts.length - 1 ? "1px solid hsl(var(--theo-light))" : "none" }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--theo-blue))" }}>
                    {p.recipients} recipients
                  </div>
                  <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>{p.date} · {p.ref}</div>
                </div>
                <div className="text-right">
                  <div style={{ fontWeight: 700, fontSize: 14, color: "hsl(var(--theo-blue))" }}>{p.amount}</div>
                  <span className="rounded-full font-bold" style={{ fontSize: 11, background: p.statusColor, color: p.statusText, padding: "2px 8px" }}>
                    {p.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
