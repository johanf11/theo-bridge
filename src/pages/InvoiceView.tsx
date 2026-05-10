import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { Copy, Check, CheckCircle2, Clock, AlertTriangle, FileText } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

type Currency = "USDC" | "HTG-C";
type InvoiceStatus = "DRAFT" | "SENT" | "PAID" | "OVERDUE";

type LineItem = {
  id?: string;
  description: string;
  quantity: number;
  unit_price: number;
};

type Invoice = {
  id: string;
  invoice_number: string;
  client_name: string;
  client_email: string | null;
  currency: Currency;
  line_items: LineItem[];
  discount_type: "flat" | "percent" | null;
  discount_value: number;
  subtotal: number;
  total: number;
  due_date: string | null;
  note: string | null;
  status: InvoiceStatus;
  paid_at: string | null;
  created_at: string;
  // joined
  wallet_label?: string | null;
  wallet_address?: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CURRENCY_COLOR: Record<Currency, string> = {
  "USDC":  "#2775CA",
  "HTG-C": "#33359A",
};

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; bg: string; color: string; icon: React.ReactNode }> = {
  DRAFT:   { label: "Draft",   bg: "#F3F4F6",  color: "#6B7280",  icon: <FileText size={11} /> },
  SENT:    { label: "Awaiting payment", bg: "#EFF6FF", color: "#1D4ED8", icon: <Clock size={11} /> },
  PAID:    { label: "Paid",    bg: "#EFFBF3",  color: "#1A7F37",  icon: <CheckCircle2 size={11} /> },
  OVERDUE: { label: "Overdue", bg: "#FEE2E2",  color: "#B91C1C",  icon: <AlertTriangle size={11} /> },
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function InvoiceView() {
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  const paymentLink = typeof window !== "undefined" ? window.location.href : `https://pay.theo.ht/inv/${id}`;

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*, wallets(label, stellar_address)")
        .eq("id", id)
        .maybeSingle();

      if (error || !data) { setNotFound(true); setLoading(false); return; }

      // Flatten joined wallet fields
      const walletData = (data as { wallets?: { label?: string; stellar_address?: string } | null }).wallets;
      setInvoice({
        ...data,
        line_items: (data.line_items ?? []) as LineItem[],
        wallet_label: walletData?.label ?? null,
        wallet_address: walletData?.stellar_address ?? null,
      } as Invoice);
      setLoading(false);
    })();
  }, [id]);

  const copyLink = async () => {
    await navigator.clipboard.writeText(paymentLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Loading / error states ────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F8F8FC" }}>
        <div style={{ fontSize: 14, color: "#6B7280" }}>Loading invoice…</div>
      </div>
    );
  }

  if (notFound || !invoice) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F8F8FC", flexDirection: "column", gap: 12 }}>
        <FileText size={40} style={{ stroke: "#D1D5DB" }} />
        <div style={{ fontSize: 18, fontWeight: 700, color: "#33359A" }}>Invoice not found</div>
        <div style={{ fontSize: 14, color: "#6B7280" }}>This link may be expired or incorrect.</div>
      </div>
    );
  }

  const s = STATUS_CONFIG[invoice.status];
  const discount =
    invoice.discount_type === "flat"
      ? invoice.discount_value
      : invoice.discount_type === "percent"
      ? invoice.subtotal * (invoice.discount_value / 100)
      : 0;

  // QR payload: stellar URI if wallet address known, else the payment link
  const qrPayload = invoice.wallet_address
    ? `web+stellar:pay?destination=${invoice.wallet_address}&amount=${invoice.total}&asset_code=${invoice.currency === "USDC" ? "USDC" : "HTGC"}&memo=${encodeURIComponent(invoice.invoice_number)}`
    : paymentLink;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: "100vh", background: "#F0F0F8", fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* Branded header */}
      <div style={{ background: "#33359A", padding: "14px 0" }}>
        <div style={{ maxWidth: 560, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: "#FDCF00", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 16, color: "#33359A", flexShrink: 0 }}>
            T
          </div>
          <span style={{ fontWeight: 800, fontSize: 16, color: "#fff", letterSpacing: "-0.3px" }}>Theo</span>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginLeft: 4 }}>Payment Request</span>
        </div>
      </div>

      {/* Card */}
      <div style={{ maxWidth: 560, margin: "32px auto 48px", padding: "0 16px" }}>
        <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 4px 24px rgba(51,53,154,0.10)", overflow: "hidden" }}>

          {/* Status banner */}
          {invoice.status === "PAID" && (
            <div style={{ background: "#EFFBF3", padding: "10px 24px", display: "flex", alignItems: "center", gap: 7, borderBottom: "1px solid #D1FAE5" }}>
              <CheckCircle2 size={14} style={{ color: "#1A7F37", flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "#1A7F37" }}>This invoice has been paid — thank you!</span>
            </div>
          )}
          {invoice.status === "OVERDUE" && (
            <div style={{ background: "#FEF2F2", padding: "10px 24px", display: "flex", alignItems: "center", gap: 7, borderBottom: "1px solid #FECACA" }}>
              <AlertTriangle size={14} style={{ color: "#B91C1C", flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "#B91C1C" }}>This invoice is overdue</span>
            </div>
          )}

          {/* Header */}
          <div style={{ padding: "28px 28px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#33359A", letterSpacing: "-0.4px" }}>
                  {invoice.client_name}
                </div>
                <div style={{ fontSize: 12, color: "#6B7280", marginTop: 3 }}>
                  {invoice.invoice_number}
                  {invoice.due_date && (
                    <> · Due <strong style={{ color: invoice.status === "OVERDUE" ? "#B91C1C" : "#374151" }}>
                      {new Date(invoice.due_date + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                    </strong></>
                  )}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 28, fontWeight: 900, color: CURRENCY_COLOR[invoice.currency], letterSpacing: "-0.5px" }}>
                  {fmt(invoice.total)}
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", textAlign: "right" }}>{invoice.currency}</div>
              </div>
            </div>

            {/* Status pill */}
            <div style={{ marginTop: 14 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: s.bg, color: s.color }}>
                {s.icon} {s.label}
              </span>
            </div>
          </div>

          <div style={{ height: 1, background: "#F3F4F6", margin: "0 28px" }} />

          {/* Line items */}
          <div style={{ padding: "20px 28px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.10em", color: "#9CA3AF", marginBottom: 10 }}>Items</div>
            <div style={{ borderRadius: 10, border: "1px solid #F3F4F6", overflow: "hidden" }}>
              {/* Column headers */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12, padding: "8px 14px", background: "#F9FAFB", borderBottom: "1px solid #F3F4F6" }}>
                {["Description", "Qty × Price", "Total"].map((h) => (
                  <span key={h} style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9CA3AF", textAlign: h === "Total" ? "right" : "left" }}>{h}</span>
                ))}
              </div>
              {(invoice.line_items as LineItem[]).map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12,
                    padding: "11px 14px", alignItems: "center",
                    borderBottom: i < invoice.line_items.length - 1 ? "1px solid #F3F4F6" : "none",
                    background: i % 2 === 0 ? "#fff" : "#FAFAFA",
                  }}
                >
                  <span style={{ fontSize: 14, color: "#111827" }}>{item.description}</span>
                  <span style={{ fontSize: 13, color: "#6B7280", whiteSpace: "nowrap" }}>
                    {item.quantity} × {fmt(item.unit_price)}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#33359A", textAlign: "right", whiteSpace: "nowrap" }}>
                    {fmt(item.quantity * item.unit_price)}
                  </span>
                </div>
              ))}
            </div>

            {/* Subtotal / discount / total */}
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
              {discount > 0 && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "#6B7280" }}>Subtotal</span>
                    <span style={{ fontWeight: 600, color: "#374151" }}>{fmt(invoice.subtotal)} {invoice.currency}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "#6B7280" }}>Discount</span>
                    <span style={{ fontWeight: 600, color: "#B91C1C" }}>−{fmt(discount)} {invoice.currency}</span>
                  </div>
                </>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 800, paddingTop: discount > 0 ? 10 : 0, borderTop: discount > 0 ? "1px solid #F3F4F6" : "none" }}>
                <span style={{ color: "#111827" }}>Total due</span>
                <span style={{ color: CURRENCY_COLOR[invoice.currency] }}>{fmt(invoice.total)} {invoice.currency}</span>
              </div>
            </div>
          </div>

          {/* Payment details */}
          {invoice.wallet_address && invoice.status !== "PAID" && (
            <>
              <div style={{ height: 1, background: "#F3F4F6", margin: "0 28px" }} />
              <div style={{ padding: "20px 28px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.10em", color: "#9CA3AF", marginBottom: 12 }}>
                  Payment details
                </div>
                <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                  {/* QR code */}
                  <div
                    style={{ cursor: "pointer" }}
                    onClick={() => setShowQr((v) => !v)}
                    title={showQr ? "Hide QR" : "Show full QR"}
                  >
                    <div style={{ padding: 8, background: "#F9FAFB", borderRadius: 10, border: "1px solid #F3F4F6", display: "inline-block" }}>
                      <QRCodeSVG
                        value={qrPayload}
                        size={showQr ? 180 : 80}
                        fgColor="#33359A"
                        bgColor="#F9FAFB"
                        level="M"
                        imageSettings={{
                          src: "",
                          width: 0,
                          height: 0,
                          excavate: false,
                        }}
                      />
                    </div>
                    <div style={{ fontSize: 10, color: "#9CA3AF", textAlign: "center", marginTop: 4 }}>
                      {showQr ? "Click to collapse" : "Click to expand"}
                    </div>
                  </div>

                  {/* Address + memo */}
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", marginBottom: 3 }}>Send to address</div>
                      <div style={{ fontFamily: "monospace", fontSize: 12, color: "#111827", wordBreak: "break-all", background: "#F9FAFB", padding: "8px 10px", borderRadius: 7, border: "1px solid #F3F4F6" }}>
                        {invoice.wallet_address}
                      </div>
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", marginBottom: 3 }}>Asset</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: CURRENCY_COLOR[invoice.currency] }}>{invoice.currency} on Stellar</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", marginBottom: 3 }}>Memo (required)</div>
                      <div style={{ fontFamily: "monospace", fontSize: 12, color: "#111827", background: "#F9FAFB", padding: "8px 10px", borderRadius: 7, border: "1px solid #F3F4F6" }}>
                        {invoice.invoice_number}
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 12, padding: "9px 12px", borderRadius: 8, background: "#FFFBEB", border: "1px solid #FDE68A", fontSize: 12, color: "#92400E", lineHeight: 1.5 }}>
                  <strong>Important:</strong> include the memo exactly as shown above so your payment is matched to this invoice.
                </div>
              </div>
            </>
          )}

          {/* Note */}
          {invoice.note && (
            <>
              <div style={{ height: 1, background: "#F3F4F6", margin: "0 28px" }} />
              <div style={{ padding: "16px 28px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.10em", color: "#9CA3AF", marginBottom: 6 }}>Note</div>
                <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.6 }}>{invoice.note}</div>
              </div>
            </>
          )}

          {/* Actions */}
          {invoice.status !== "PAID" && (
            <>
              <div style={{ height: 1, background: "#F3F4F6" }} />
              <div style={{ padding: "20px 28px", display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  onClick={copyLink}
                  style={{
                    flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
                    fontSize: 13, fontWeight: 700, padding: "11px 16px",
                    borderRadius: 9, border: "1.5px solid #E5E7EB",
                    background: "#fff", color: "#33359A",
                    cursor: "pointer", fontFamily: "inherit", minWidth: 160,
                    transition: "background 120ms",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#F5F5FF")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Link copied!" : "Copy payment link"}
                </button>
              </div>
            </>
          )}

          {/* Footer */}
          <div style={{ padding: "14px 28px", background: "#F9FAFB", borderTop: "1px solid #F3F4F6", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 11, color: "#9CA3AF" }}>
              Issued {new Date(invoice.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 16, height: 16, borderRadius: 4, background: "#FDCF00", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 10, color: "#33359A" }}>T</div>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF" }}>Powered by Theo</span>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
