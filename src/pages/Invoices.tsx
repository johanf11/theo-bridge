import { useEffect, useRef, useState } from "react";
import { AppLayout } from "@/components/theo/Layout";
import {
  Plus, Trash2, ChevronDown, ChevronUp, Copy, Check,
  CheckCircle2, Clock, AlertTriangle, FileText, Loader2, X, Pencil,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { useT, type TKey } from "@/lib/i18n";
import { NUMBER_LOCALE } from "@/lib/locale";
import { useSearch } from "@/contexts/SearchContext";
import { useSearchHighlight } from "@/hooks/useSearchHighlight";

// ── Types ──────────────────────────────────────────────────────────────────────

type Currency = "USDC" | "HTG-C";
type DiscountType = "flat" | "percent";
type InvoiceStatus = "DRAFT" | "SENT" | "PAID" | "OVERDUE";

type LineItem = {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
};

type Wallet = { id: string; label: string; stellar_address: string };

type Invoice = {
  id: string;
  invoice_number: string;
  client_name: string;
  client_email: string | null;
  currency: Currency;
  line_items: LineItem[];
  discount_type: DiscountType | null;
  discount_value: number;
  subtotal: number;
  total: number;
  payment_wallet_id: string | null;
  due_date: string | null;
  note: string | null;
  status: InvoiceStatus;
  paid_at: string | null;
  created_at: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<InvoiceStatus, { labelKey: TKey; bg: string; color: string; icon: React.ReactNode }> = {
  DRAFT:   { labelKey: "invoices.status.draft",   bg: "hsl(var(--theo-cream))",    color: "hsl(var(--theo-mid))",  icon: <FileText size={10} /> },
  SENT:    { labelKey: "invoices.status.sent",    bg: "hsl(var(--theo-blue-soft))", color: "hsl(var(--theo-blue))", icon: <Clock size={10} /> },
  PAID:    { labelKey: "invoices.status.paid",    bg: "#EFFBF3",                    color: "#1A7F37",               icon: <CheckCircle2 size={10} /> },
  OVERDUE: { labelKey: "invoices.status.overdue", bg: "#FEE2E2",                    color: "#B91C1C",               icon: <AlertTriangle size={10} /> },
};

const CURRENCY_COLORS: Record<Currency, string> = {
  "USDC":  "#2775CA",
  "HTG-C": "#33359A",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9);


const genInvoiceNumber = () => {
  const d = new Date();
  const yyyymmdd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const rand = Math.floor(Math.random() * 900 + 100);
  return `INV-${yyyymmdd}-${rand}`;
};

const calcTotals = (
  items: LineItem[],
  discountType: DiscountType | null,
  discountValue: number,
) => {
  const subtotal = items.reduce((s, it) => s + it.quantity * it.unit_price, 0);
  let discount = 0;
  if (discountType === "flat") discount = Math.min(discountValue, subtotal);
  if (discountType === "percent") discount = subtotal * (Math.min(discountValue, 100) / 100);
  return { subtotal, discount, total: Math.max(0, subtotal - discount) };
};

// ── Shared styles ─────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 10, fontWeight: 700,
  textTransform: "uppercase", letterSpacing: "0.10em",
  color: "hsl(var(--theo-mid))", marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%", fontFamily: "inherit", fontSize: 14,
  padding: "8px 12px", borderRadius: 9,
  border: "1.5px solid hsl(var(--theo-light))",
  background: "#fff", color: "hsl(var(--theo-ink))",
  outline: "none", boxSizing: "border-box",
};

// ── Main component ────────────────────────────────────────────────────────────

export default function Invoices() {
  const t = useT();
  const fmt = (n: number) =>
    n.toLocaleString(NUMBER_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const { user } = useAuth();
  const { query } = useSearch();
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);

  // Invoice list
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [invoiceTab, setInvoiceTab] = useState<"active" | "paid" | "all">("active");
  const { highlightId, refs: invoiceHighlightRefs } = useSearchHighlight<HTMLDivElement>(!listLoading);

  useEffect(() => {
    if (highlightId) {
      setInvoiceTab("all");
      setExpandedId(highlightId);
    }
  }, [highlightId]);

  // Form state
  const [invoiceNumber, setInvoiceNumber] = useState(genInvoiceNumber());
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [currency, setCurrency] = useState<Currency>("USDC");
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { id: uid(), description: "", quantity: 1, unit_price: 0 },
  ]);
  const [discountType, setDiscountType] = useState<DiscountType | null>(null);
  const [discountValue, setDiscountValue] = useState<string>("");
  const [paymentWalletId, setPaymentWalletId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { subtotal, discount, total } = calcTotals(
    lineItems,
    discountType,
    parseFloat(discountValue) || 0,
  );

  // ── Load data ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: au } = await supabase.auth.getUser();
      if (!au.user) return;
      // Resolve effective customer — org member takes priority over own row
      let cid: string | null = null;
      const { data: mem } = await supabase.from("org_members").select("customer_id").eq("user_id", au.user.id).not("accepted_at", "is", null).maybeSingle();
      if (mem?.customer_id) { cid = mem.customer_id; }
      else {
        const { data: own } = await supabase.from("customers").select("id").eq("user_id", au.user.id).maybeSingle();
        cid = own?.id ?? null;
      }
      if (!cid) { setListLoading(false); return; }
      setCustomerId(cid);
      await Promise.all([loadInvoices(cid), loadWallets(cid)]);
    })();
  }, [user]);

  const loadInvoices = async (cid: string) => {
    setListLoading(true);
    const { data } = await supabase
      .from("invoices")
      .select("*")
      .eq("customer_id", cid)
      .order("created_at", { ascending: false });
    setInvoices((data ?? []) as unknown as Invoice[]);
    setListLoading(false);
  };

  const loadWallets = async (cid: string) => {
    const { data } = await supabase
      .from("wallets")
      .select("id, label, stellar_address")
      .eq("customer_id", cid)
      .order("created_at", { ascending: true });
    const list = (data ?? []) as Wallet[];
    setWallets(list);
    if (list.length > 0) setPaymentWalletId(list[0].id);
  };

  // ── Line item helpers ────────────────────────────────────────────────────────

  const addLine = () =>
    setLineItems((prev) => [...prev, { id: uid(), description: "", quantity: 1, unit_price: 0 }]);

  const removeLine = (id: string) =>
    setLineItems((prev) => prev.filter((it) => it.id !== id));

  const updateLine = (id: string, field: keyof Omit<LineItem, "id">, value: string | number) =>
    setLineItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, [field]: value } : it))
    );

  // ── Submit ───────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId) return;
    if (!clientName.trim()) { toast.error(t("common.error")); return; }
    if (lineItems.every((it) => !it.description.trim())) {
      toast.error(t("common.error"));
      return;
    }

    setSubmitting(true);
    try {
      if (editingId) {
        const { error } = await supabase.from("invoices").update({
          invoice_number: invoiceNumber.trim() || genInvoiceNumber(),
          client_name: clientName.trim(),
          client_email: clientEmail.trim() || null,
          currency,
          line_items: lineItems.filter((it) => it.description.trim()),
          discount_type: discountType,
          discount_value: parseFloat(discountValue) || 0,
          subtotal,
          total,
          payment_wallet_id: paymentWalletId || null,
          due_date: dueDate || null,
          note: note.trim() || null,
        }).eq("id", editingId);

        if (error) throw error;
        toast.success(t("invoices.updated"));
      } else {
        const { error } = await supabase.from("invoices").insert({
          customer_id: customerId,
          invoice_number: invoiceNumber.trim() || genInvoiceNumber(),
          client_name: clientName.trim(),
          client_email: clientEmail.trim() || null,
          currency,
          line_items: lineItems.filter((it) => it.description.trim()),
          discount_type: discountType,
          discount_value: parseFloat(discountValue) || 0,
          subtotal,
          total,
          payment_wallet_id: paymentWalletId || null,
          due_date: dueDate || null,
          note: note.trim() || null,
          status: "DRAFT",
        });

        if (error) throw error;
        toast.success(t("invoices.created"));
      }

      // Reset form
      setEditingId(null);
      setInvoiceNumber(genInvoiceNumber());
      setClientName("");
      setClientEmail("");
      setCurrency("USDC");
      setLineItems([{ id: uid(), description: "", quantity: 1, unit_price: 0 }]);
      setDiscountType(null);
      setDiscountValue("");
      setDueDate("");
      setNote("");

      await loadInvoices(customerId);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Invoice actions ──────────────────────────────────────────────────────────

  const markAs = async (id: string, status: InvoiceStatus) => {
    const update: Partial<Invoice> = { status };
    if (status === "PAID") update.paid_at = new Date().toISOString();
    const { error } = await supabase.from("invoices").update(update).eq("id", id);
    if (error) { toast.error(error.message); return; }
    setInvoices((prev) => prev.map((inv) => (inv.id === id ? { ...inv, ...update } : inv)));
    toast.success(`Invoice marked as ${status.toLowerCase()}`);
  };

  const deleteInvoice = async (id: string) => {
    const { error } = await supabase.from("invoices").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setInvoices((prev) => prev.filter((inv) => inv.id !== id));
    if (expandedId === id) setExpandedId(null);
    toast.success(t("invoices.deleted"));
  };

  const copyPaymentLink = async (id: string) => {
    const link = `${window.location.origin}/inv/${id}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // Fallback for non-secure contexts
      const el = document.createElement("textarea");
      el.value = link;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopiedId(id);
    toast.success(t("invoices.linkCopied"));
    setTimeout(() => setCopiedId(null), 2000);
  };

  const startEdit = (inv: Invoice) => {
    setEditingId(inv.id);
    setInvoiceNumber(inv.invoice_number);
    setClientName(inv.client_name);
    setClientEmail(inv.client_email ?? "");
    setCurrency(inv.currency);
    setLineItems(inv.line_items.length > 0 ? inv.line_items.map((it) => ({ ...it, id: it.id ?? uid() })) : [{ id: uid(), description: "", quantity: 1, unit_price: 0 }]);
    setDiscountType(inv.discount_type);
    setDiscountValue(inv.discount_value ? String(inv.discount_value) : "");
    setPaymentWalletId(inv.payment_wallet_id ?? "");
    setDueDate(inv.due_date ?? "");
    setNote(inv.note ?? "");
    setExpandedId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setInvoiceNumber(genInvoiceNumber());
    setClientName("");
    setClientEmail("");
    setCurrency("USDC");
    setLineItems([{ id: uid(), description: "", quantity: 1, unit_price: 0 }]);
    setDiscountType(null);
    setDiscountValue("");
    setDueDate("");
    setNote("");
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      {/* Page header */}
      <div className="mb-1">
        <div className="font-extrabold" style={{ fontSize: 22, color: "hsl(var(--theo-blue))", letterSpacing: "-0.02em" }}>
          {t("invoices.title")}
        </div>
        <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))", marginTop: 2 }}>
          {t("invoices.subtitle.full")}
        </div>
      </div>
      <div className="mb-5" style={{ width: 28, height: 3, background: "hsl(var(--theo-gold))", borderRadius: 2, marginTop: 8 }} />

      <div className="grid gap-4" style={{ gridTemplateColumns: "3fr 2fr", alignItems: "start" }}>

        {/* ── Create invoice form ───────────────────────────────────────────── */}
        <div className="bg-card border border-border rounded-xl shadow-xs" style={{ padding: "18px 20px 16px" }}>
          <div className="font-bold mb-4 flex items-center justify-between" style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>
            <span>{editingId ? t("invoices.page.edit") : t("invoices.page.new")}</span>
            {editingId && (
              <button
                type="button"
                onClick={cancelEdit}
                style={{
                  fontSize: 11, fontWeight: 600, color: "hsl(var(--theo-mid))",
                  background: "none", border: "none", cursor: "pointer", fontFamily: "inherit",
                  display: "inline-flex", alignItems: "center", gap: 4,
                }}
              >
                <X size={12} /> {t("invoices.cancelEdit")}
              </button>
            )}
          </div>

          <form onSubmit={handleSubmit}>

            {/* Invoice # + Currency toggle */}
            <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: "1fr auto" }}>
              <div>
                <label style={labelStyle}>{t("invoices.col.number")}</label>
                <input
                  style={inputStyle}
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="INV-20260510-001"
                />
              </div>
              <div>
                <label style={labelStyle}>{t("tx.head.currency")}</label>
                <div style={{ display: "flex", borderRadius: 9, border: "1.5px solid hsl(var(--theo-light))", overflow: "hidden", height: 38 }}>
                  {(["USDC", "HTG-C"] as Currency[]).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCurrency(c)}
                      style={{
                        padding: "0 14px", fontSize: 12, fontWeight: 700, border: "none",
                        cursor: "pointer", fontFamily: "inherit", transition: "all 120ms",
                        background: currency === c ? CURRENCY_COLORS[c] : "#fff",
                        color: currency === c ? "#fff" : "hsl(var(--theo-mid))",
                      }}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Client fields */}
            <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div>
                <label style={labelStyle}>{t("invoices.col.client")} <span style={{ color: "#C00" }}>*</span></label>
                <input
                  style={inputStyle}
                  placeholder={t("invoices.clientPlaceholder")}
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  required
                />
              </div>
              <div>
                <label style={labelStyle}>{t("invoices.clientEmail")} <span style={{ color: "hsl(var(--theo-mid))", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>{t("invoices.optional")}</span></label>
                <input
                  style={inputStyle}
                  type="email"
                  placeholder="client@example.com"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                />
              </div>
            </div>

            {/* Line items */}
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>{t("invoices.lineItems")}</label>

              {/* Header row */}
              <div
                className="grid"
                style={{
                  gridTemplateColumns: "1fr 72px 96px 72px 28px",
                  gap: 6, marginBottom: 5,
                  paddingBottom: 4, borderBottom: "1px solid hsl(var(--theo-light))",
                }}
              >
                {[t("invoices.col.description"), t("invoices.col.qty"), t("invoices.col.unitPrice"), t("invoices.col.total"), ""].map((h) => (
                  <span key={h || "empty"} style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "hsl(var(--theo-mid))" }}>
                    {h}
                  </span>
                ))}
              </div>

              {lineItems.map((item) => (
                <div
                  key={item.id}
                  className="grid"
                  style={{ gridTemplateColumns: "1fr 72px 96px 72px 28px", gap: 6, marginBottom: 6, alignItems: "center" }}
                >
                  <input
                    style={{ ...inputStyle, fontSize: 13, padding: "6px 10px" }}
                    placeholder={t("invoices.descPlaceholder")}
                    value={item.description}
                    onChange={(e) => updateLine(item.id, "description", e.target.value)}
                  />
                  <input
                    style={{ ...inputStyle, fontSize: 13, padding: "6px 8px", textAlign: "right" }}
                    type="number"
                    min={1}
                    step={1}
                    value={item.quantity}
                    onChange={(e) => updateLine(item.id, "quantity", Math.max(1, parseInt(e.target.value) || 1))}
                  />
                  <input
                    style={{ ...inputStyle, fontSize: 13, padding: "6px 8px", textAlign: "right" }}
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="0.00"
                    value={item.unit_price || ""}
                    onChange={(e) => updateLine(item.id, "unit_price", parseFloat(e.target.value) || 0)}
                  />
                  <div style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--theo-blue))", textAlign: "right", paddingRight: 4 }}>
                    {fmt(item.quantity * item.unit_price)}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(item.id)}
                    disabled={lineItems.length === 1}
                    style={{ background: "none", border: "none", cursor: lineItems.length === 1 ? "not-allowed" : "pointer", color: "#B91C1C", opacity: lineItems.length === 1 ? 0.25 : 1, display: "flex", alignItems: "center", justifyContent: "center" }}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={addLine}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  fontSize: 12, fontWeight: 600, color: "hsl(var(--theo-blue))",
                  background: "hsl(var(--theo-blue-soft))", border: "none",
                  borderRadius: 7, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit",
                  marginTop: 4,
                }}
              >
                <Plus size={12} /> {t("invoices.addLine")}
              </button>
            </div>

            {/* Discount */}
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>{t("invoices.discount")} <span style={{ color: "hsl(var(--theo-mid))", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>{t("invoices.optional")}</span></label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {/* Type toggle */}
                <div style={{ display: "flex", borderRadius: 8, border: "1.5px solid hsl(var(--theo-light))", overflow: "hidden", flexShrink: 0, height: 36 }}>
                  {([null, "flat", "percent"] as (DiscountType | null)[]).map((dt) => (
                    <button
                      key={String(dt)}
                      type="button"
                      onClick={() => { setDiscountType(dt); if (!dt) setDiscountValue(""); }}
                      style={{
                        padding: "0 10px", fontSize: 11, fontWeight: 700, border: "none",
                        cursor: "pointer", fontFamily: "inherit", transition: "all 120ms",
                        background: discountType === dt ? "hsl(var(--theo-blue))" : "#fff",
                        color: discountType === dt ? "#fff" : "hsl(var(--theo-mid))",
                      }}
                    >
                      {dt === null ? t("invoices.discount.none") : dt === "flat" ? t("invoices.discount.flat") : "%"}
                    </button>
                  ))}
                </div>
                {discountType && (
                  <div style={{ position: "relative", flex: 1 }}>
                    <input
                      style={{ ...inputStyle, paddingRight: discountType === "percent" ? 32 : 12 }}
                      type="number"
                      min={0}
                      step={0.01}
                      placeholder={discountType === "flat" ? "0.00" : "0"}
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.target.value)}
                    />
                    {discountType === "percent" && (
                      <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, fontWeight: 700, color: "hsl(var(--theo-mid))" }}>%</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Totals box */}
            <div style={{ borderRadius: 10, background: "hsl(var(--theo-cream))", border: "1px solid hsl(var(--theo-light))", padding: "12px 14px", marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
                <span style={{ color: "hsl(var(--theo-mid))" }}>{t("invoices.subtotal")}</span>
                <span style={{ fontWeight: 600, color: "hsl(var(--theo-blue))" }}>{fmt(subtotal)} {currency}</span>
              </div>
              {discount > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
                  <span style={{ color: "hsl(var(--theo-mid))" }}>{t("invoices.discount")}</span>
                  <span style={{ fontWeight: 600, color: "#B91C1C" }}>−{fmt(discount)} {currency}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 800, paddingTop: 8, borderTop: "1px solid hsl(var(--theo-light))" }}>
                <span style={{ color: "hsl(var(--theo-blue))" }}>{t("invoices.col.total")}</span>
                <span style={{ color: CURRENCY_COLORS[currency] }}>{fmt(total)} {currency}</span>
              </div>
            </div>

            {/* Payment wallet + due date */}
            <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div>
                <label style={labelStyle}>{t("invoices.paymentWallet")}</label>
                {wallets.length === 0 ? (
                  <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>{t("invoices.noWallets")}</div>
                ) : (
                  <select
                    style={{
                      ...inputStyle,
                      appearance: "none",
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6B8A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "right 10px center",
                      paddingRight: 28, cursor: "pointer",
                    }}
                    value={paymentWalletId}
                    onChange={(e) => setPaymentWalletId(e.target.value)}
                  >
                    {wallets.map((w) => (
                      <option key={w.id} value={w.id}>{w.label}</option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label style={labelStyle}>{t("invoices.dueDate")} <span style={{ color: "hsl(var(--theo-mid))", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>{t("invoices.optional")}</span></label>
                <input
                  style={inputStyle}
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>

            {/* Note */}
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>{t("invoices.noteToClient")} <span style={{ color: "hsl(var(--theo-mid))", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>{t("invoices.optional")}</span></label>
              <textarea
                style={{ ...inputStyle, resize: "vertical", minHeight: 64, lineHeight: 1.5 }}
                placeholder={t("invoices.notePlaceholder")}
                maxLength={200}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div style={{ fontSize: 10, color: "hsl(var(--theo-mid))", textAlign: "right", marginTop: 2 }}>{note.length}/200</div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="flex items-center justify-center gap-2 font-bold w-full"
              style={{
                background: submitting ? "hsl(var(--theo-light))" : "hsl(var(--theo-blue))",
                color: submitting ? "hsl(var(--theo-mid))" : "#fff",
                border: "none", borderRadius: 9, padding: "11px", fontSize: 14,
                cursor: submitting ? "not-allowed" : "pointer", fontFamily: "inherit",
                transition: "background 130ms",
              }}
            >
              {submitting
                ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> {editingId ? t("invoices.updating") : t("invoices.creating")}</>
                : editingId ? t("invoices.update") : t("invoices.create")}
            </button>
          </form>
        </div>

        {/* ── Invoice list ─────────────────────────────────────────────────── */}
        <div className="bg-card border border-border rounded-xl shadow-xs" style={{ padding: "18px 20px 16px" }}>
          <div className="flex items-center justify-between mb-3">
            <div className="font-bold" style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>{t("invoices.page.list")}</div>
            {!listLoading && (
              <span style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>
                {t("invoices.totalCount").replace("{n}", String(invoices.length))}
              </span>
            )}
          </div>

          {/* Filter tabs */}
          <div style={{ display: "flex", gap: 2, marginBottom: 14, borderBottom: "1px solid hsl(var(--theo-light))", paddingBottom: 0 }}>
            {(["active", "paid", "all"] as const).map((tab) => {
              const labels = { active: t("invoices.tab.active"), paid: t("invoices.tab.paid"), all: t("invoices.tab.all") };
              const counts = {
                active: invoices.filter((inv) => inv.status !== "PAID").length,
                paid: invoices.filter((inv) => inv.status === "PAID").length,
                all: invoices.length,
              };
              const isActive = invoiceTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setInvoiceTab(tab)}
                  style={{
                    fontSize: 12, fontWeight: 700, padding: "6px 12px",
                    border: "none", background: "none", cursor: "pointer",
                    fontFamily: "inherit",
                    color: isActive ? "hsl(var(--theo-blue))" : "hsl(var(--theo-mid))",
                    borderBottom: isActive ? "2px solid hsl(var(--theo-blue))" : "2px solid transparent",
                    marginBottom: -1,
                    transition: "all 120ms",
                  }}
                >
                  {labels[tab]}
                  {counts[tab] > 0 && (
                    <span style={{
                      marginLeft: 5, fontSize: 10, fontWeight: 700,
                      padding: "1px 5px", borderRadius: 999,
                      background: isActive ? "hsl(var(--theo-blue-soft))" : "hsl(var(--theo-light))",
                      color: isActive ? "hsl(var(--theo-blue))" : "hsl(var(--theo-mid))",
                    }}>
                      {counts[tab]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {(() => {
            const tabFiltered = invoices.filter((inv) =>
              invoiceTab === "active" ? inv.status !== "PAID" :
              invoiceTab === "paid"   ? inv.status === "PAID" :
              true
            );
            const q = query.trim().toLowerCase();
            const visible = q
              ? tabFiltered.filter((inv) =>
                  inv.invoice_number.toLowerCase().includes(q) ||
                  inv.client_name.toLowerCase().includes(q) ||
                  (inv.client_email ?? "").toLowerCase().includes(q) ||
                  String(inv.total).includes(q)
                )
              : tabFiltered;
            return listLoading ? (
              <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>{t("common.loading")}</div>
            ) : tabFiltered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
              <FileText size={32} style={{ stroke: "hsl(var(--theo-light))", margin: "0 auto 10px", display: "block" }} />
              <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))", fontWeight: 600 }}>
                {invoiceTab === "paid" ? t("invoices.empty.paid") : invoiceTab === "active" ? t("invoices.empty.active") : t("invoices.empty")}
              </div>
              <div style={{ fontSize: 12, color: "hsl(var(--theo-mid))", marginTop: 4 }}>
                {invoiceTab === "paid" ? t("invoices.empty.hintPaid") : t("invoices.empty.hintCreate")}
              </div>
            </div>
          ) : visible.length === 0 ? (
            <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))", padding: "16px 0" }}>
              {t("nav.search.noResults")} &ldquo;{query.trim()}&rdquo;
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {visible.map((inv, i) => {
                const s = STATUS_CONFIG[inv.status];
                const isOpen = expandedId === inv.id;
                const wallet = wallets.find((w) => w.id === inv.payment_wallet_id);
                const isHighlighted = highlightId === inv.id;
                return (
                  <div
                    key={inv.id}
                    ref={(el) => { invoiceHighlightRefs.current[inv.id] = el; }}
                    style={{
                      borderBottom: i < visible.length - 1 ? "1px solid hsl(var(--theo-light))" : "none",
                      background: isHighlighted ? "hsl(var(--theo-blue-soft))" : undefined,
                      borderRadius: isHighlighted ? 8 : undefined,
                      padding: isHighlighted ? "0 8px" : undefined,
                      margin: isHighlighted ? "0 -8px" : undefined,
                    }}
                  >
                    {/* Summary row */}
                    <button
                      type="button"
                      onClick={() => setExpandedId(isOpen ? null : inv.id)}
                      style={{
                        width: "100%", display: "flex", alignItems: "center",
                        justifyContent: "space-between", gap: 10,
                        padding: "12px 0", border: "none", background: "none",
                        cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-blue))" }}>{inv.client_name}</span>
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: 3,
                            fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999,
                            background: s.bg, color: s.color,
                          }}>
                            {s.icon}{t(s.labelKey)}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>
                          {inv.invoice_number}
                          {inv.due_date ? ` · Due ${new Date(inv.due_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 14, fontWeight: 800, color: CURRENCY_COLORS[inv.currency] }}>
                            {fmt(inv.total)}
                          </div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--theo-mid))" }}>{inv.currency}</div>
                        </div>
                        {isOpen
                          ? <ChevronUp size={13} style={{ color: "hsl(var(--theo-mid))", flexShrink: 0 }} />
                          : <ChevronDown size={13} style={{ color: "hsl(var(--theo-mid))", flexShrink: 0 }} />
                        }
                      </div>
                    </button>

                    {/* Expanded detail */}
                    {isOpen && (
                      <div style={{ paddingBottom: 14, paddingTop: 2 }}>
                        {/* Line items mini table */}
                        {inv.line_items.length > 0 && (
                          <div style={{ borderRadius: 8, border: "1px solid hsl(var(--theo-light))", overflow: "hidden", marginBottom: 10 }}>
                            {(inv.line_items as LineItem[]).map((item, li) => (
                              <div
                                key={item.id ?? li}
                                style={{
                                  display: "flex", justifyContent: "space-between", alignItems: "center",
                                  padding: "7px 10px", fontSize: 12,
                                  borderBottom: li < inv.line_items.length - 1 ? "1px solid hsl(var(--theo-light))" : "none",
                                  background: li % 2 === 0 ? "#fafafa" : "#fff",
                                }}
                              >
                                <span style={{ color: "hsl(var(--theo-ink))", flex: 1 }}>{item.description}</span>
                                <span style={{ color: "hsl(var(--theo-mid))", marginLeft: 12 }}>
                                  {item.quantity} × {fmt(item.unit_price)}
                                </span>
                                <span style={{ fontWeight: 700, color: "hsl(var(--theo-blue))", marginLeft: 12 }}>
                                  {fmt(item.quantity * item.unit_price)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Meta */}
                        <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginBottom: 8, lineHeight: 1.7 }}>
                          {wallet && <div><strong>Wallet:</strong> {wallet.label} ({wallet.stellar_address.slice(0, 6)}…{wallet.stellar_address.slice(-4)})</div>}
                          {inv.client_email && <div><strong>Email:</strong> {inv.client_email}</div>}
                          {inv.note && <div><strong>Note:</strong> {inv.note}</div>}
                        </div>

                        {/* Actions */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {/* Primary row — workflow actions */}
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              onClick={() => copyPaymentLink(inv.id)}
                              style={{
                                display: "inline-flex", alignItems: "center", gap: 5,
                                fontSize: 12, fontWeight: 600, padding: "6px 12px",
                                borderRadius: 7, border: "1.5px solid hsl(var(--theo-light))",
                                background: "#fff", color: "hsl(var(--theo-blue))",
                                cursor: "pointer", fontFamily: "inherit",
                              }}
                            >
                              {copiedId === inv.id ? <Check size={12} /> : <Copy size={12} />}
                              {copiedId === inv.id ? t("invoices.copied") : t("invoices.copyLink")}
                            </button>

                            {inv.status !== "SENT" && inv.status !== "PAID" && (
                              <button
                                type="button"
                                onClick={() => markAs(inv.id, "SENT")}
                                style={{
                                  display: "inline-flex", alignItems: "center", gap: 5,
                                  fontSize: 12, fontWeight: 600, padding: "6px 12px",
                                  borderRadius: 7, border: "none",
                                  background: "hsl(var(--theo-blue))", color: "#fff",
                                  cursor: "pointer", fontFamily: "inherit",
                                }}
                              >
                                Mark as sent
                              </button>
                            )}

                            {inv.status !== "PAID" && (
                              <button
                                type="button"
                                onClick={() => markAs(inv.id, "PAID")}
                                style={{
                                  display: "inline-flex", alignItems: "center", gap: 5,
                                  fontSize: 12, fontWeight: 600, padding: "6px 12px",
                                  borderRadius: 7, border: "none",
                                  background: "#EFFBF3", color: "#1A7F37",
                                  cursor: "pointer", fontFamily: "inherit",
                                }}
                              >
                                <CheckCircle2 size={12} /> {t("invoices.markPaid")}
                              </button>
                            )}

                            {inv.status === "PAID" && (
                              <button
                                type="button"
                                onClick={() => markAs(inv.id, "DRAFT")}
                                style={{
                                  display: "inline-flex", alignItems: "center", gap: 5,
                                  fontSize: 12, fontWeight: 600, padding: "6px 12px",
                                  borderRadius: 7, border: "1.5px solid hsl(var(--theo-light))",
                                  background: "#fff", color: "hsl(var(--theo-mid))",
                                  cursor: "pointer", fontFamily: "inherit",
                                }}
                              >
                                {t("invoices.reopen")}
                              </button>
                            )}
                          </div>

                          {/* Secondary row — management actions */}
                          <div style={{ display: "flex", gap: 6 }}>
                            {inv.status === "DRAFT" && (
                              <button
                                type="button"
                                onClick={() => startEdit(inv)}
                                style={{
                                  display: "inline-flex", alignItems: "center", gap: 5,
                                  fontSize: 12, fontWeight: 600, padding: "6px 12px",
                                  borderRadius: 7, border: "1.5px solid hsl(var(--theo-light))",
                                  background: "#fff", color: "hsl(var(--theo-blue))",
                                  cursor: "pointer", fontFamily: "inherit",
                                }}
                              >
                                <Pencil size={12} /> {t("invoices.edit")}
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => deleteInvoice(inv.id)}
                              style={{
                                display: "inline-flex", alignItems: "center", gap: 5,
                                fontSize: 12, fontWeight: 600, padding: "6px 12px",
                                borderRadius: 7, border: "1.5px solid #FECACA",
                                background: "#FEF2F2", color: "#B91C1C",
                                cursor: "pointer", fontFamily: "inherit",
                              }}
                            >
                              <Trash2 size={12} /> {t("invoices.delete")}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
          })()}
        </div>
      </div>
    </AppLayout>
  );
}
