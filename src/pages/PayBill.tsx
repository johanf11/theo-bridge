import { useEffect, useState } from "react";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { resolveEffectiveCustomerId } from "@/lib/customer";
import { fmtUSDC } from "@/lib/format";
import { toast } from "sonner";
import { Loader2, Building2, CheckCircle2, ExternalLink } from "lucide-react";

type Wallet = { id: string; label: string; stellar_address: string; usdc_balance: number };

type SuccessInfo = { hash: string; memo: string; omnibusAddress: string; vendor: string; amount: number };

export default function PayBill() {
  const { user } = useAuth();
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [sourceWalletId, setSourceWalletId] = useState("");

  const [vendorName, setVendorName] = useState("");
  const [vendorCountry, setVendorCountry] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [swiftBic, setSwiftBic] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);

  useEffect(() => {
    (async () => {
      if (!user) return;
      const cid = await resolveEffectiveCustomerId();
      if (!cid) return;
      setCustomerId(cid);
      const { data } = await supabase.from("wallets")
        .select("id, label, stellar_address, usdc_balance")
        .eq("customer_id", cid)
        .order("display_order", { ascending: true });
      const list = (data ?? []) as Wallet[];
      setWallets(list);
      if (list[0]) setSourceWalletId(list[0].id);
    })();
  }, [user]);

  const canSubmit =
    !!sourceWalletId && !!vendorName.trim() && parseFloat(amount) > 0 && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSuccess(null);
    try {
      const { data, error } = await supabase.functions.invoke("pay-vendor-owlting", {
        body: {
          sourceWalletId,
          amount: parseFloat(amount),
          vendorName, vendorCountry, bankName, accountNumber, swiftBic, reference, note,
        },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      const d = data as { hash: string; memo: string; omnibusAddress: string };
      setSuccess({ hash: d.hash, memo: d.memo, omnibusAddress: d.omnibusAddress, vendor: vendorName, amount: parseFloat(amount) });
      toast.success("Sent to Owlting for settlement");
      // Reset form fields but keep success card.
      setVendorName(""); setVendorCountry(""); setBankName(""); setAccountNumber("");
      setSwiftBic(""); setReference(""); setNote(""); setAmount("");
    } catch (e) {
      toast.error((e as Error).message || "Payment failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppLayout>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "32px 24px" }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "hsl(var(--theo-cyan))", marginBottom: 8 }}>
            Off-ramp · Owlting
          </div>
          <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.02em", color: "hsl(var(--theo-ink))", margin: 0 }}>
            Pay a Bill
          </h1>
          <p style={{ color: "hsl(var(--theo-mid))", marginTop: 8 }}>
            Send USDC to Theo's Owlting off-ramp. We'll convert to fiat and wire your vendor.
          </p>
        </div>

        {success && (
          <div style={{ background: "white", border: "1px solid hsl(var(--theo-light))", borderRadius: 16, padding: 24, marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <CheckCircle2 size={24} style={{ color: "hsl(var(--theo-blue))" }} />
              <div style={{ fontWeight: 700, fontSize: 18, color: "hsl(var(--theo-ink))" }}>Sent to Owlting</div>
            </div>
            <div style={{ color: "hsl(var(--theo-mid))", fontSize: 14, marginBottom: 4 }}>
              {fmtUSDC(success.amount)} USDC routed for <strong style={{ color: "hsl(var(--theo-ink))" }}>{success.vendor}</strong>. Settling via Owlting.
            </div>
            <div style={{ fontSize: 12, color: "hsl(var(--theo-mid))", marginTop: 8, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <span>Routing ref: <code>{success.memo}</code></span>
              <a href={`https://stellar.expert/explorer/testnet/tx/${success.hash}`} target="_blank" rel="noreferrer"
                style={{ color: "hsl(var(--theo-cyan))", display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}>
                View on Stellar <ExternalLink size={12} />
              </a>
            </div>
          </div>
        )}

        <div style={{ background: "white", border: "1px solid hsl(var(--theo-light))", borderRadius: 16, padding: 24 }}>
          <Section title="From">
            <select value={sourceWalletId} onChange={(e) => setSourceWalletId(e.target.value)} style={inputStyle}>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label} — {fmtUSDC(w.usdc_balance)} USDC
                </option>
              ))}
            </select>
          </Section>

          <Section title="Vendor">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Vendor name *" value={vendorName} onChange={setVendorName} placeholder="Acme Imports Ltd" />
              <Field label="Country" value={vendorCountry} onChange={setVendorCountry} placeholder="USA" />
            </div>
          </Section>

          <Section title="Wire details">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Bank name" value={bankName} onChange={setBankName} placeholder="Wells Fargo" />
              <Field label="SWIFT / BIC" value={swiftBic} onChange={setSwiftBic} placeholder="WFBIUS6S" />
              <Field label="Account / IBAN" value={accountNumber} onChange={setAccountNumber} placeholder="9876543210" />
              <Field label="Reference" value={reference} onChange={setReference} placeholder="Invoice #INV-2034" />
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={labelStyle}>Note (optional)</label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
            </div>
          </Section>

          <Section title="Amount">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="number" min="1" step="0.01" value={amount}
                onChange={(e) => setAmount(e.target.value)} placeholder="0.00" style={{ ...inputStyle, fontSize: 22, fontWeight: 700 }} />
              <span style={{ fontWeight: 700, color: "hsl(var(--theo-mid))" }}>USDC</span>
            </div>
          </Section>

          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 12, background: "hsl(var(--theo-blue-soft))", borderRadius: 10, marginBottom: 16 }}>
            <Building2 size={16} style={{ color: "hsl(var(--theo-blue))" }} />
            <div style={{ fontSize: 13, color: "hsl(var(--theo-ink))" }}>
              Funds route to Theo's Owlting off-ramp collector. Owlting converts to fiat and sends the wire.
            </div>
          </div>

          <button onClick={submit} disabled={!canSubmit}
            style={{
              width: "100%", padding: "14px 20px", borderRadius: 10, border: "none", cursor: canSubmit ? "pointer" : "not-allowed",
              background: canSubmit ? "hsl(var(--theo-gold))" : "hsl(var(--theo-light))",
              color: canSubmit ? "hsl(var(--theo-blue))" : "hsl(var(--theo-mid))",
              fontWeight: 700, fontSize: 16, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}>
            {submitting ? <Loader2 size={18} className="animate-spin" /> : null}
            {submitting ? "Sending…" : "Send to Owlting"}
          </button>
        </div>
      </div>
    </AppLayout>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid hsl(var(--theo-light))",
  background: "white", color: "hsl(var(--theo-ink))", fontSize: 14, fontFamily: "inherit",
};
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 12, fontWeight: 600, color: "hsl(var(--theo-mid))", marginBottom: 6,
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "hsl(var(--theo-mid))", marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
    </div>
  );
}
