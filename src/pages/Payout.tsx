import { useEffect, useState } from "react";
import { AppLayout } from "@/components/theo/Layout";
import { Upload, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

type Tab = "single" | "bulk";

type Wallet = { id: string; label: string; stellar_address: string };

type Payout = {
  id: string;
  recipient_name: string;
  amount_usdc: number;
  status: "PENDING" | "COMPLETED" | "FAILED";
  stellar_tx_hash: string | null;
  created_at: string;
  memo: string | null;
};

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  COMPLETED: { bg: "#EFFBF3", color: "#1A7F37", label: "Paid" },
  PENDING:   { bg: "hsl(var(--theo-gold-soft))", color: "#7A5F00", label: "Processing" },
  FAILED:    { bg: "#FEE2E2", color: "#B91C1C", label: "Failed" },
};

export default function Payout() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("single");

  // Wallets
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [walletsLoading, setWalletsLoading] = useState(true);

  // Form state
  const [recipientName, setRecipientName] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [sourceWalletId, setSourceWalletId] = useState("");
  const [memo, setMemo] = useState("");
  const [sending, setSending] = useState(false);

  // Recent payouts
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [payoutsLoading, setPayoutsLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    loadWallets();
    loadPayouts();
  }, [user]);

  const loadWallets = async () => {
    setWalletsLoading(true);
    const { data: customer } = await supabase
      .from("customers")
      .select("id")
      .maybeSingle();
    if (!customer) { setWalletsLoading(false); return; }

    const { data } = await supabase
      .from("wallets")
      .select("id, label, stellar_address")
      .eq("customer_id", customer.id)
      .order("created_at", { ascending: true });

    const list = data ?? [];
    setWallets(list);
    if (list.length > 0) setSourceWalletId(list[0].id);
    setWalletsLoading(false);
  };

  const loadPayouts = async () => {
    setPayoutsLoading(true);
    const { data: customer } = await supabase
      .from("customers")
      .select("id")
      .maybeSingle();
    if (!customer) { setPayoutsLoading(false); return; }

    const { data } = await supabase
      .from("payouts")
      .select("id, recipient_name, amount_usdc, status, stellar_tx_hash, created_at, memo")
      .eq("customer_id", customer.id)
      .order("created_at", { ascending: false })
      .limit(10);

    setPayouts((data ?? []) as Payout[]);
    setPayoutsLoading(false);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceWalletId) { toast.error("Select a source account"); return; }
    if (!recipientAddress.startsWith("G") || recipientAddress.length < 50) {
      toast.error("Enter a valid Stellar account ID (G…)");
      return;
    }
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) { toast.error("Enter a valid amount"); return; }

    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("send-payment", {
        body: { sourceWalletId, recipientAddress, recipientName, amount: parsedAmount, memo },
      });

      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) throw new Error(res.data.error);

      toast.success("Payment sent successfully");
      setRecipientName("");
      setRecipientAddress("");
      setAmount("");
      setMemo("");
      loadPayouts();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSending(false);
    }
  };

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

          <div className="flex border-b border-border mb-4 mt-3">
            <button style={tabStyle("single")} onClick={() => setTab("single")}>Single recipient</button>
            <button style={tabStyle("bulk")} onClick={() => setTab("bulk")}>Mass transfer</button>
          </div>

          {tab === "single" ? (
            <form onSubmit={handleSend}>
              <div className="grid gap-3 mb-3.5" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label style={labelStyle}>Recipient name</label>
                  <input
                    style={{ ...inputStyle, marginBottom: 0 }}
                    type="text"
                    placeholder="Marie Claire Dupont"
                    value={recipientName}
                    onChange={e => setRecipientName(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label style={labelStyle}>Recipient account ID</label>
                  <input
                    style={{ ...inputStyle, marginBottom: 0 }}
                    type="text"
                    placeholder="G…"
                    value={recipientAddress}
                    onChange={e => setRecipientAddress(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Amount (USDC)</label>
                <div style={{ position: "relative" }}>
                  <input
                    style={{ ...inputStyle, marginBottom: 0, paddingRight: 56 }}
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="0.00"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    required
                  />
                  <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 12, fontWeight: 700, color: "hsl(var(--theo-mid))" }}>
                    USDC
                  </span>
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Source account</label>
                {walletsLoading ? (
                  <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>Loading accounts…</div>
                ) : wallets.length === 0 ? (
                  <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>
                    No accounts found. Add one on the Balance page.
                  </div>
                ) : (
                  <select
                    style={{ ...inputStyle, marginBottom: 0, appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6B8A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center", paddingRight: 28, cursor: "pointer" }}
                    value={sourceWalletId}
                    onChange={e => setSourceWalletId(e.target.value)}
                    required
                  >
                    {wallets.map(w => (
                      <option key={w.id} value={w.id}>{w.label}</option>
                    ))}
                  </select>
                )}
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Payment note (optional)</label>
                <input
                  style={{ ...inputStyle, marginBottom: 0 }}
                  type="text"
                  placeholder="e.g. April salary — supplier payment"
                  value={memo}
                  onChange={e => setMemo(e.target.value)}
                  maxLength={28}
                />
              </div>

              <div className="flex gap-2 mt-1">
                <button
                  type="submit"
                  disabled={sending || wallets.length === 0}
                  className="flex items-center gap-1.5 font-bold text-white"
                  style={{ background: "hsl(var(--theo-blue))", borderRadius: 8, padding: "8px 16px", fontSize: 13, border: "none", cursor: sending ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: sending ? 0.7 : 1 }}
                >
                  {sending ? <><Loader2 style={{ width: 13, height: 13, animation: "spin 1s linear infinite" }} /> Sending…</> : "Send payout"}
                </button>
              </div>
            </form>
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
                  Columns: name, account_id, amount_usdc, note
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
          {payoutsLoading ? (
            <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>Loading…</div>
          ) : payouts.length === 0 ? (
            <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>No payouts yet.</div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {payouts.map((p, i) => {
                const s = STATUS_STYLE[p.status] ?? STATUS_STYLE.PENDING;
                const date = new Date(p.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                return (
                  <div
                    key={p.id}
                    className="flex justify-between items-center py-2.5"
                    style={{ borderBottom: i < payouts.length - 1 ? "1px solid hsl(var(--theo-light))" : "none" }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--theo-blue))" }}>
                        {p.recipient_name}
                      </div>
                      <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>
                        {date}{p.memo ? ` · ${p.memo}` : ""}
                      </div>
                      {p.stellar_tx_hash && (
                        <a
                          href={`https://stellar.expert/explorer/testnet/tx/${p.stellar_tx_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: 10, color: "hsl(var(--theo-cyan))", fontWeight: 600 }}
                        >
                          Verify payment ↗
                        </a>
                      )}
                    </div>
                    <div className="text-right">
                      <div style={{ fontWeight: 700, fontSize: 14, color: "hsl(var(--theo-blue))" }}>
                        ${Number(p.amount_usdc).toLocaleString()} USDC
                      </div>
                      <span className="rounded-full font-bold" style={{ fontSize: 11, background: s.bg, color: s.color, padding: "2px 8px" }}>
                        {s.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
