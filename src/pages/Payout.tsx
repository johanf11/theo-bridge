import { useEffect, useRef, useState } from "react";
import { AppLayout } from "@/components/theo/Layout";
import { Upload, Loader2, Star, X, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, Info, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { useSearch } from "@/contexts/SearchContext";
import { usePermissions } from "@/hooks/usePermissions";
import { fmtUSDC } from "@/lib/format";

type Tab = "single" | "bulk";
type DestinationChain = "stellar" | "solana" | "base";

type Wallet = { id: string; label: string; stellar_address: string };

type Payout = {
  id: string;
  recipient_name: string;
  amount_usdc: number;
  status: "PENDING" | "COMPLETED" | "FAILED" | "BRIDGING";
  stellar_tx_hash: string | null;
  created_at: string;
  memo: string | null;
  destination_chain: string | null;
};

type SavedRecipient = {
  id: string;
  name: string;
  stellar_address: string;
  label: string | null;
};

type BridgeQuote = {
  platformFee: number;
  bridgeFee: number;
  deliveredAmount: number;
};

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  COMPLETED: { bg: "#EFFBF3",                    color: "#1A7F37", label: "Paid" },
  PENDING:   { bg: "hsl(var(--theo-gold-soft))", color: "#7A5F00", label: "Processing" },
  FAILED:    { bg: "#FEE2E2",                    color: "#B91C1C", label: "Failed" },
  BRIDGING:  { bg: "hsl(var(--theo-blue-soft))", color: "hsl(var(--theo-blue))", label: "Bridging" },
};

const CHAIN_BADGE: Record<DestinationChain, { label: string; bg: string; color: string; dot: string }> = {
  stellar: { label: "Stellar",  bg: "hsl(var(--theo-gold))",    color: "hsl(var(--theo-blue))", dot: "hsl(var(--theo-gold))" },
  solana:  { label: "Solana",   bg: "hsl(280 80% 92%)",         color: "hsl(280 80% 35%)",      dot: "#9945FF" },
  base:    { label: "Base",     bg: "hsl(220 80% 92%)",         color: "hsl(220 80% 35%)",      dot: "#0052FF" },
};

// Detect which chain an address belongs to.
// Stellar: starts with G, exactly 56 chars (base32 encoded ed25519 key)
// Solana:  base58 encoded, 32–44 chars, no 0/O/I/l characters
// Base:    EVM 0x-prefixed, 42 chars total (20 bytes hex)
function detectChain(addr: string): DestinationChain | "unknown" | "stellar_incomplete" {
  if (!addr) return "unknown";
  if (addr.startsWith("G")) {
    return addr.length === 56 ? "stellar" : "stellar_incomplete";
  }
  if (/^0x[a-fA-F0-9]{40}$/.test(addr)) return "base";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) return "solana";
  return "unknown";
}

const isBridgeChain = (c: ReturnType<typeof detectChain>): c is "solana" | "base" =>
  c === "solana" || c === "base";

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function Payout() {
  const { user } = useAuth();
  const { query } = useSearch();
  const { can } = usePermissions();
  const [tab, setTab] = useState<Tab>("single");
  const [customerId, setCustomerId] = useState<string | null>(null);

  // Wallets
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [walletsLoading, setWalletsLoading] = useState(true);

  // Saved recipients
  const [savedRecipients, setSavedRecipients] = useState<SavedRecipient[]>([]);
  const [showManage, setShowManage] = useState(false);
  const [saveAfterSend, setSaveAfterSend] = useState(false);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Form state
  const [recipientName, setRecipientName] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [sourceWalletId, setSourceWalletId] = useState("");
  const [memo, setMemo] = useState("");
  const [sending, setSending] = useState(false);

  // Bridge fee modal
  const [showBridgeModal, setShowBridgeModal] = useState(false);
  const [bridgeQuote, setBridgeQuote] = useState<BridgeQuote | null>(null);
  const [bridgeQuoteLoading, setBridgeQuoteLoading] = useState(false);

  // Recent payouts
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [payoutsLoading, setPayoutsLoading] = useState(true);

  // Derived: detected chain and address validation state
  const addrTrimmed = recipientAddress.trim();
  const detectedChain = detectChain(addrTrimmed);
  const isValidStellar = detectedChain === "stellar";
  const isBridgeable = isBridgeChain(detectedChain);

  const isAlreadySaved = savedRecipients.some((r) => r.stellar_address === addrTrimmed);

  // Filter recent payouts by search query
  const filteredPayouts = query.trim()
    ? payouts.filter((p) => {
        const q = query.toLowerCase();
        return (
          p.recipient_name.toLowerCase().includes(q) ||
          String(p.amount_usdc).includes(q) ||
          (p.memo ?? "").toLowerCase().includes(q)
        );
      })
    : payouts;

  const filteredSaved = recipientSearch.trim()
    ? savedRecipients.filter(
        (r) =>
          r.name.toLowerCase().includes(recipientSearch.toLowerCase()) ||
          (r.label ?? "").toLowerCase().includes(recipientSearch.toLowerCase()) ||
          r.stellar_address.toLowerCase().includes(recipientSearch.toLowerCase())
      )
    : savedRecipients;

  useEffect(() => {
    if (!user) return;
    loadAll();
  }, [user]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setRecipientSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const loadAll = async () => {
    const { data: customer } = await supabase.from("customers").select("id").maybeSingle();
    if (!customer) return;
    setCustomerId(customer.id);
    await Promise.all([
      loadWallets(customer.id),
      loadPayouts(customer.id),
      loadSavedRecipients(customer.id),
    ]);
  };

  const loadWallets = async (cid: string) => {
    setWalletsLoading(true);
    const { data } = await supabase
      .from("wallets")
      .select("id, label, stellar_address")
      .eq("customer_id", cid)
      .order("created_at", { ascending: true });
    const list = (data ?? []) as Wallet[];
    setWallets(list);
    if (list.length > 0) setSourceWalletId(list[0].id);
    setWalletsLoading(false);
  };

  const loadPayouts = async (cid: string) => {
    setPayoutsLoading(true);
    const { data } = await supabase
      .from("payouts")
      .select("id, recipient_name, amount_usdc, status, stellar_tx_hash, created_at, memo, destination_chain")
      .eq("customer_id", cid)
      .order("created_at", { ascending: false })
      .limit(10);
    setPayouts((data ?? []) as Payout[]);
    setPayoutsLoading(false);
  };

  const loadSavedRecipients = async (cid: string) => {
    const { data } = await supabase
      .from("saved_recipients")
      .select("id, name, stellar_address, label")
      .eq("customer_id", cid)
      .order("name", { ascending: true });
    setSavedRecipients((data ?? []) as SavedRecipient[]);
  };

  const selectSavedRecipient = (r: SavedRecipient) => {
    setRecipientName(r.name);
    setRecipientAddress(r.stellar_address);
    setDropdownOpen(false);
    setRecipientSearch("");
  };

  const saveRecipient = async () => {
    if (!customerId || !recipientName.trim() || !addrTrimmed) return;
    const { error } = await supabase.from("saved_recipients").upsert({
      customer_id: customerId,
      name: recipientName.trim(),
      stellar_address: addrTrimmed,
    }, { onConflict: "customer_id,stellar_address" });
    if (!error) {
      await loadSavedRecipients(customerId);
      toast.success(`${recipientName} saved to recipients`);
    }
  };

  const deleteRecipient = async (id: string) => {
    await supabase.from("saved_recipients").delete().eq("id", id);
    setSavedRecipients((prev) => prev.filter((r) => r.id !== id));
  };

  // Fetch a bridge fee quote from the edge function, then open the confirmation modal.
  const openBridgeModal = async () => {
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      toast.error("Enter a valid amount first");
      return;
    }
    setBridgeQuoteLoading(true);
    setShowBridgeModal(true);
    setBridgeQuote(null);
    try {
      const res = await supabase.functions.invoke("bridge-payout", {
        body: { mode: "quote", amount: parsedAmount, destinationChain: detectedChain },
      });
      if (res.error || res.data?.error) throw new Error(res.error?.message ?? res.data?.error);
      setBridgeQuote(res.data as BridgeQuote);
    } catch (err) {
      toast.error((err as Error).message);
      setShowBridgeModal(false);
    } finally {
      setBridgeQuoteLoading(false);
    }
  };

  const executeStellarSend = async () => {
    const parsedAmount = parseFloat(amount);
    setSending(true);
    try {
      const res = await supabase.functions.invoke("send-payment", {
        body: { sourceWalletId, recipientAddress: addrTrimmed, recipientName, amount: parsedAmount, memo },
      });
      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) throw new Error(res.data.error);
      toast.success("Payment sent");
      if (saveAfterSend && !isAlreadySaved && customerId) {
        await supabase.from("saved_recipients").upsert({
          customer_id: customerId,
          name: recipientName.trim(),
          stellar_address: addrTrimmed,
        }, { onConflict: "customer_id,stellar_address" });
        await loadSavedRecipients(customerId);
      }
      resetForm();
      if (customerId) loadPayouts(customerId);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const executeBridgeSend = async () => {
    if (!isBridgeable) return;
    const parsedAmount = parseFloat(amount);
    setSending(true);
    setShowBridgeModal(false);
    try {
      const res = await supabase.functions.invoke("bridge-payout", {
        body: {
          mode: "execute",
          sourceWalletId,
          recipientAddress: addrTrimmed,
          destinationChain: detectedChain,
          amount: parsedAmount,
          recipientName,
        },
      });
      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) throw new Error(res.data.error);
      toast.success(`Bridge payment submitted — USDC on its way to ${CHAIN_BADGE[detectedChain as DestinationChain]?.label ?? detectedChain}`);
      resetForm();
      if (customerId) loadPayouts(customerId);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const resetForm = () => {
    setRecipientName("");
    setRecipientAddress("");
    setAmount("");
    setMemo("");
    setSaveAfterSend(false);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceWalletId) { toast.error("Select a source account"); return; }

    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) { toast.error("Enter a valid amount"); return; }
    if (!recipientName.trim()) { toast.error("Enter a recipient name"); return; }

    if (isBridgeable) {
      await openBridgeModal();
      return;
    }

    if (detectedChain === "stellar_incomplete") {
      toast.error("Stellar address looks incomplete — should be 56 characters");
      return;
    }
    if (!isValidStellar) {
      toast.error("Enter a valid Stellar, Solana, or Base (0x…) address");
      return;
    }

    await executeStellarSend();
  };

  // ── Styles ──────────────────────────────────────────────────────────────
  const tabStyle = (t: Tab): React.CSSProperties => ({
    padding: "9px 16px", fontSize: 13, fontWeight: 600,
    color: tab === t ? "hsl(var(--theo-blue))" : "hsl(var(--theo-mid))",
    border: "none", background: "none", cursor: "pointer", fontFamily: "inherit",
    borderBottom: tab === t ? "2px solid hsl(var(--theo-blue))" : "2px solid transparent",
    marginBottom: -1, transition: "all 130ms",
  });

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

  // ── Address field border color by detection state ───────────────────────
  const addrBorderColor = (() => {
    if (detectedChain === "stellar") return "#22C55E";
    if (detectedChain === "stellar_incomplete") return "#F59E0B";
    if (detectedChain === "solana") return "#9945FF";
    if (detectedChain === "base") return "#0052FF";
    if (addrTrimmed) return "#F59E0B";
    return "hsl(var(--theo-light))";
  })();

  const chainBadge = isBridgeable ? CHAIN_BADGE[detectedChain as DestinationChain] : CHAIN_BADGE.stellar;

  return (
    <AppLayout>
      {/* ── Bridge fee confirmation modal ──────────────────────────────── */}
      {showBridgeModal && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "rgba(15,15,40,0.55)", display: "flex",
            alignItems: "center", justifyContent: "center", padding: 24,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowBridgeModal(false); }}
        >
          <div style={{
            background: "#fff", borderRadius: 16, padding: "28px 28px 24px",
            width: "100%", maxWidth: 400, boxShadow: "0 20px 60px rgba(51,53,154,0.18)",
          }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "hsl(var(--theo-blue))", letterSpacing: "-0.02em" }}>
                  Sending to {CHAIN_BADGE[detectedChain as DestinationChain]?.label}
                </div>
                <div style={{ fontSize: 12, color: "hsl(var(--theo-mid))", marginTop: 2 }}>
                  Bridged via Allbridge Core · est. 1–3 min
                </div>
              </div>
              <button
                onClick={() => setShowBridgeModal(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(var(--theo-mid))", padding: 4 }}
              >
                <X style={{ width: 16, height: 16 }} />
              </button>
            </div>

            {bridgeQuoteLoading ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 0", gap: 10, color: "hsl(var(--theo-mid))", fontSize: 13 }}>
                <Loader2 style={{ width: 16, height: 16, animation: "spin 1s linear infinite" }} />
                Fetching live fees…
              </div>
            ) : bridgeQuote ? (
              <>
                {/* Fee breakdown */}
                <div style={{ borderRadius: 10, border: "1px solid hsl(var(--theo-light))", overflow: "hidden", marginBottom: 20 }}>
                  {[
                    { label: "Amount you send",       value: fmtUSDC(parseFloat(amount)), color: "hsl(var(--theo-ink))", bold: true },
                    { label: "Theo bridge fee (0.25%)", value: `−${fmtUSDC(bridgeQuote.platformFee)}`, color: "#D97706" },
                    { label: "Allbridge network fee",  value: `−${fmtUSDC(bridgeQuote.bridgeFee)}`,   color: "#D97706" },
                  ].map((row, i) => (
                    <div key={i} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "10px 14px",
                      borderBottom: i < 2 ? "1px solid hsl(var(--theo-light))" : "none",
                      background: i === 0 ? "hsl(var(--theo-cream))" : "#fff",
                    }}>
                      <span style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>{row.label}</span>
                      <span style={{ fontSize: 13, fontWeight: row.bold ? 700 : 600, color: row.color, fontFamily: "monospace" }}>
                        {row.value}
                      </span>
                    </div>
                  ))}
                  {/* Delivered */}
                  <div style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "12px 14px", background: "hsl(var(--theo-blue-soft))",
                    borderTop: "1.5px solid hsl(var(--theo-light))",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <ArrowRight style={{ width: 12, height: 12, color: "hsl(var(--theo-blue))" }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-blue))" }}>
                        Amount delivered on {CHAIN_BADGE[detectedChain as DestinationChain]?.label}
                      </span>
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 800, color: "#16A34A", fontFamily: "monospace" }}>
                      {fmtUSDC(bridgeQuote.deliveredAmount)}
                    </span>
                  </div>
                </div>

                {/* Destination */}
                <div style={{ marginBottom: 20, padding: "8px 12px", borderRadius: 8, background: "hsl(var(--theo-cream))", fontSize: 12 }}>
                  <span style={{ color: "hsl(var(--theo-mid))", fontWeight: 600 }}>Recipient: </span>
                  <span style={{ fontFamily: "monospace", color: "hsl(var(--theo-ink))" }}>{shortAddr(addrTrimmed)}</span>
                  <span style={{ color: "hsl(var(--theo-mid))" }}> on </span>
                  <span style={{ fontWeight: 700, color: "hsl(var(--theo-blue))" }}>{CHAIN_BADGE[detectedChain as DestinationChain]?.label}</span>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    onClick={() => setShowBridgeModal(false)}
                    style={{
                      flex: 1, padding: "9px 0", borderRadius: 8, border: "1.5px solid hsl(var(--theo-light))",
                      background: "#fff", fontSize: 13, fontWeight: 600, color: "hsl(var(--theo-mid))",
                      cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={executeBridgeSend}
                    disabled={sending}
                    style={{
                      flex: 2, padding: "9px 0", borderRadius: 8, border: "none",
                      background: "hsl(var(--theo-blue))", fontSize: 13, fontWeight: 700,
                      color: "#fff", cursor: sending ? "not-allowed" : "pointer",
                      fontFamily: "inherit", opacity: sending ? 0.6 : 1,
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    }}
                  >
                    {sending
                      ? <><Loader2 style={{ width: 13, height: 13, animation: "spin 1s linear infinite" }} /> Sending…</>
                      : `Confirm & bridge to ${CHAIN_BADGE[detectedChain as DestinationChain]?.label}`
                    }
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* ── Page header ────────────────────────────────────────────────── */}
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
        {/* ── Payout form ──────────────────────────────────────────────── */}
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

              {/* ── Saved recipients selector ───────────────────────── */}
              <div style={{ marginBottom: 16 }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                  <label style={labelStyle}>Saved recipients</label>
                  {savedRecipients.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowManage((v) => !v)}
                      style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--theo-mid))", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 3 }}
                    >
                      Manage {showManage ? <ChevronUp style={{ width: 11, height: 11 }} /> : <ChevronDown style={{ width: 11, height: 11 }} />}
                    </button>
                  )}
                </div>

                {savedRecipients.length === 0 ? (
                  <div style={{ fontSize: 12, color: "hsl(var(--theo-mid))", padding: "8px 0" }}>
                    No saved recipients yet — check "Save recipient" when sending to add one.
                  </div>
                ) : (
                  <div style={{ position: "relative" }} ref={dropdownRef}>
                    <button
                      type="button"
                      onClick={() => setDropdownOpen((v) => !v)}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "10px 12px", borderRadius: 9, border: "1.5px solid hsl(var(--theo-light))",
                        background: "#fff", fontFamily: "inherit", fontSize: 13, color: "hsl(var(--theo-mid))",
                        cursor: "pointer", gap: 8,
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <Star style={{ width: 13, height: 13, stroke: "hsl(var(--theo-gold))", fill: "hsl(var(--theo-gold))", flexShrink: 0 }} />
                        <span>
                          {addrTrimmed && isAlreadySaved
                            ? <span style={{ color: "hsl(var(--theo-ink))", fontWeight: 600 }}>
                                {savedRecipients.find(r => r.stellar_address === addrTrimmed)?.name}
                              </span>
                            : `${savedRecipients.length} saved recipient${savedRecipients.length !== 1 ? "s" : ""}`
                          }
                        </span>
                      </div>
                      <ChevronDown style={{ width: 12, height: 12, flexShrink: 0 }} />
                    </button>

                    {dropdownOpen && (
                      <div style={{
                        position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 100,
                        background: "#fff", borderRadius: 10, border: "1px solid hsl(var(--theo-light))",
                        boxShadow: "0 8px 24px rgba(51,53,154,0.12)", overflow: "hidden",
                      }}>
                        {savedRecipients.length > 4 && (
                          <div style={{ padding: "8px 10px", borderBottom: "1px solid hsl(var(--theo-light))" }}>
                            <input
                              autoFocus
                              placeholder="Search recipients…"
                              value={recipientSearch}
                              onChange={(e) => setRecipientSearch(e.target.value)}
                              style={{ width: "100%", border: "none", outline: "none", fontFamily: "inherit", fontSize: 13, color: "hsl(var(--theo-ink))", background: "transparent" }}
                            />
                          </div>
                        )}
                        {filteredSaved.length === 0 ? (
                          <div style={{ padding: "10px 12px", fontSize: 13, color: "hsl(var(--theo-mid))" }}>No matches</div>
                        ) : (
                          filteredSaved.map((r) => (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => selectSavedRecipient(r)}
                              style={{
                                display: "flex", alignItems: "center", justifyContent: "space-between",
                                width: "100%", padding: "10px 12px", border: "none",
                                background: addrTrimmed === r.stellar_address ? "hsl(var(--theo-blue-soft))" : "transparent",
                                cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                                borderBottom: "1px solid hsl(var(--theo-light))", transition: "background 80ms",
                              }}
                              onMouseEnter={(e) => { if (addrTrimmed !== r.stellar_address) (e.currentTarget as HTMLElement).style.background = "hsl(var(--theo-cream))"; }}
                              onMouseLeave={(e) => { if (addrTrimmed !== r.stellar_address) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                            >
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--theo-blue))" }}>{r.name}</div>
                                {r.label && <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>{r.label}</div>}
                              </div>
                              <span style={{ fontSize: 11, fontFamily: "monospace", color: "hsl(var(--theo-mid))" }}>
                                {shortAddr(r.stellar_address)}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}

                {showManage && savedRecipients.length > 0 && (
                  <div style={{ marginTop: 8, borderRadius: 9, border: "1px solid hsl(var(--theo-light))", overflow: "hidden" }}>
                    {savedRecipients.map((r, i) => (
                      <div
                        key={r.id}
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: i < savedRecipients.length - 1 ? "1px solid hsl(var(--theo-light))" : "none", background: "#fafafa" }}
                      >
                        <div>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--theo-ink))" }}>{r.name}</span>
                          <span style={{ fontSize: 11, fontFamily: "monospace", color: "hsl(var(--theo-mid))", marginLeft: 8 }}>{shortAddr(r.stellar_address)}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => deleteRecipient(r.id)}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "#B91C1C", display: "flex", alignItems: "center" }}
                          title="Remove"
                        >
                          <X style={{ width: 13, height: 13 }} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Recipient fields ────────────────────────────────── */}
              <div className="grid gap-3 mb-3.5" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label style={labelStyle}>Recipient name</label>
                  <input
                    style={{ ...inputStyle, marginBottom: 0 }}
                    type="text"
                    placeholder="Marie Claire Dupont"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>Recipient account ID</label>
                    {/* Dynamic network badge */}
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10,
                      fontWeight: 700, letterSpacing: "0.06em",
                      background: chainBadge.bg, color: chainBadge.color,
                      borderRadius: 99, padding: "2px 7px", border: "none",
                      transition: "all 150ms",
                    }}>
                      <svg width="7" height="7" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill={chainBadge.dot} /></svg>
                      {isBridgeable ? CHAIN_BADGE[detectedChain as DestinationChain].label : "Stellar"}
                    </span>
                  </div>
                  <input
                    style={{ ...inputStyle, marginBottom: 0, borderColor: addrBorderColor }}
                    type="text"
                    placeholder="G… · Solana · 0x… (Base)"
                    value={recipientAddress}
                    onChange={(e) => setRecipientAddress(e.target.value)}
                    required
                  />

                  {/* Address feedback */}
                  {detectedChain === "stellar" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5, fontSize: 11, color: "#16A34A", fontWeight: 600 }}>
                      <CheckCircle2 size={12} /> Valid Stellar address
                    </div>
                  )}
                  {detectedChain === "stellar_incomplete" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5, fontSize: 11, color: "#D97706", fontWeight: 600 }}>
                      <Info size={12} /> Stellar address looks incomplete — 56 characters required
                    </div>
                  )}
                  {detectedChain === "solana" && (
                    <div style={{ marginTop: 6, padding: "8px 10px", borderRadius: 7, background: "hsl(280 80% 97%)", border: "1px solid hsl(280 80% 85%)", display: "flex", alignItems: "flex-start", gap: 7 }}>
                      <CheckCircle2 size={12} style={{ color: "#9945FF", flexShrink: 0, marginTop: 1 }} />
                      <div style={{ fontSize: 11, color: "hsl(280 80% 30%)" }}>
                        <span style={{ fontWeight: 700 }}>Solana address detected.</span> We'll bridge USDC via Allbridge Core. A small fee applies — you'll see the exact breakdown before confirming.
                      </div>
                    </div>
                  )}
                  {detectedChain === "base" && (
                    <div style={{ marginTop: 6, padding: "8px 10px", borderRadius: 7, background: "hsl(220 80% 97%)", border: "1px solid hsl(220 80% 85%)", display: "flex", alignItems: "flex-start", gap: 7 }}>
                      <CheckCircle2 size={12} style={{ color: "#0052FF", flexShrink: 0, marginTop: 1 }} />
                      <div style={{ fontSize: 11, color: "hsl(220 80% 30%)" }}>
                        <span style={{ fontWeight: 700 }}>Base address detected.</span> We'll bridge USDC via Allbridge Core. A small fee applies — you'll see the exact breakdown before confirming.
                      </div>
                    </div>
                  )}
                  {detectedChain === "unknown" && addrTrimmed && (
                    <div style={{ marginTop: 6, padding: "8px 10px", borderRadius: 7, background: "#FFFBEB", border: "1px solid #FDE68A", display: "flex", alignItems: "flex-start", gap: 7 }}>
                      <AlertTriangle size={13} style={{ color: "#D97706", flexShrink: 0, marginTop: 1 }} />
                      <div style={{ fontSize: 11, color: "#92400E" }}>
                        <span style={{ fontWeight: 700 }}>Unrecognised address format.</span> Supported: Stellar (G…, 56 chars), Solana (base58), Base (0x…, 42 chars).
                      </div>
                    </div>
                  )}
                  {!addrTrimmed && (
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5, fontSize: 11, color: "hsl(var(--theo-mid))" }}>
                      <Info size={11} /> Stellar, Solana, or Base (0x…) addresses accepted
                    </div>
                  )}
                </div>
              </div>

              {/* ── Amount ──────────────────────────────────────────── */}
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
                    onChange={(e) => setAmount(e.target.value)}
                    required
                  />
                  <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 12, fontWeight: 700, color: "hsl(var(--theo-mid))" }}>
                    USDC
                  </span>
                </div>
              </div>

              {/* ── Source account ───────────────────────────────────── */}
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Source account</label>
                {walletsLoading ? (
                  <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>Loading accounts…</div>
                ) : wallets.length === 0 ? (
                  <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>No accounts found. Add one on the Balance page.</div>
                ) : (
                  <select
                    style={{ ...inputStyle, marginBottom: 0, appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6B8A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center", paddingRight: 28, cursor: "pointer" }}
                    value={sourceWalletId}
                    onChange={(e) => setSourceWalletId(e.target.value)}
                    required
                  >
                    {wallets.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
                  </select>
                )}
              </div>

              {/* ── Memo (hidden for bridge — Stellar memo is reserved for Allbridge routing) */}
              {!isBridgeable && (
                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>Payment note (optional)</label>
                  <input
                    style={{ ...inputStyle, marginBottom: 0 }}
                    type="text"
                    placeholder="e.g. April salary — supplier payment"
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    maxLength={28}
                  />
                </div>
              )}

              {/* ── Footer ──────────────────────────────────────────── */}
              <div className="flex items-center justify-between mt-1">
                <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", userSelect: "none" }}>
                  {/* Save recipient not supported for bridge addresses (column is named stellar_address) */}
                  {isBridgeable ? (
                    <span style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }} />
                  ) : isAlreadySaved ? (
                    <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#1A7F37", fontWeight: 600 }}>
                      <Star style={{ width: 13, height: 13, stroke: "#1A7F37", fill: "#1A7F37" }} />
                      Saved
                    </span>
                  ) : (
                    <>
                      <input
                        type="checkbox"
                        checked={saveAfterSend}
                        onChange={(e) => setSaveAfterSend(e.target.checked)}
                        style={{ accentColor: "hsl(var(--theo-blue))", width: 14, height: 14 }}
                      />
                      <span style={{ fontSize: 12, color: "hsl(var(--theo-mid))", fontWeight: 500 }}>Save recipient</span>
                    </>
                  )}
                </label>

                <div className="flex items-center gap-2">
                  {!isBridgeable && addrTrimmed && !isAlreadySaved && isValidStellar && (
                    <button
                      type="button"
                      onClick={saveRecipient}
                      style={{ fontSize: 12, fontWeight: 600, color: "hsl(var(--theo-blue))", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4 }}
                    >
                      <Star style={{ width: 12, height: 12, stroke: "hsl(var(--theo-gold))", fill: "hsl(var(--theo-gold))" }} />
                      Save now
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={sending || wallets.length === 0 || !can("payout_send")}
                    className="flex items-center gap-1.5 font-bold text-white"
                    style={{
                      background: isBridgeable ? (detectedChain === "solana" ? "#9945FF" : "#0052FF") : "hsl(var(--theo-blue))",
                      borderRadius: 8, padding: "8px 16px", fontSize: 13, border: "none",
                      cursor: (sending || !can("payout_send")) ? "not-allowed" : "pointer",
                      fontFamily: "inherit", opacity: (sending || !can("payout_send")) ? 0.5 : 1,
                      transition: "background 150ms",
                    }}
                  >
                    {sending
                      ? <><Loader2 style={{ width: 13, height: 13, animation: "spin 1s linear infinite" }} /> Sending…</>
                      : isBridgeable
                      ? `Bridge to ${CHAIN_BADGE[detectedChain as DestinationChain].label}`
                      : "Send payout"
                    }
                  </button>
                </div>
              </div>
              {!can("payout_send") && (
                <div style={{ fontSize: 12, color: "hsl(var(--theo-mid))", marginTop: 6, textAlign: "right" }}>
                  Your role doesn't have send permission
                </div>
              )}
            </form>
          ) : (
            <>
              <div
                className="text-center cursor-pointer transition-colors"
                style={{ border: "1.5px dashed hsl(var(--theo-light))", borderRadius: 10, padding: "28px 20px" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "hsl(var(--theo-blue))"; (e.currentTarget as HTMLElement).style.background = "hsl(var(--theo-blue-soft))"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "hsl(var(--theo-light))"; (e.currentTarget as HTMLElement).style.background = ""; }}
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

        {/* ── Recent payouts ───────────────────────────────────────────── */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div className="font-bold" style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>Recent payouts</div>
            {query.trim() && !payoutsLoading && (
              <span style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>
                {filteredPayouts.length} of {payouts.length}
              </span>
            )}
          </div>
          {payoutsLoading ? (
            <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>Loading…</div>
          ) : payouts.length === 0 ? (
            <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>No payouts yet.</div>
          ) : filteredPayouts.length === 0 ? (
            <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>No results for "{query}"</div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {filteredPayouts.map((p, i) => {
                const s = STATUS_STYLE[p.status] ?? STATUS_STYLE.PENDING;
                const date = new Date(p.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                const isSaved = savedRecipients.some((r) => r.name === p.recipient_name);
                const isBridge = !!p.destination_chain;
                return (
                  <div
                    key={p.id}
                    className="flex justify-between items-start py-2.5"
                    style={{ borderBottom: i < filteredPayouts.length - 1 ? "1px solid hsl(var(--theo-light))" : "none" }}
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--theo-blue))" }}>
                          {p.recipient_name}
                        </span>
                        {isSaved && (
                          <Star style={{ width: 11, height: 11, stroke: "hsl(var(--theo-gold))", fill: "hsl(var(--theo-gold))", flexShrink: 0 }} />
                        )}
                        {isBridge && (
                          <span style={{
                            fontSize: 10, fontWeight: 700, borderRadius: 99, padding: "1px 6px",
                            background: p.destination_chain === "solana" ? "hsl(280 80% 92%)" : "hsl(220 80% 92%)",
                            color: p.destination_chain === "solana" ? "hsl(280 80% 35%)" : "hsl(220 80% 35%)",
                          }}>
                            {p.destination_chain === "solana" ? "Solana" : "Base"}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>
                        {date}{!isBridge && p.memo ? ` · ${p.memo}` : ""}
                      </div>
                      {p.stellar_tx_hash && (
                        <a
                          href={`https://stellar.expert/explorer/testnet/tx/${p.stellar_tx_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: 10, color: "hsl(var(--theo-cyan))", fontWeight: 600 }}
                        >
                          Verify on Stellar ↗
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
