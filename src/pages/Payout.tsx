import { useEffect, useRef, useState } from "react";
import { AppLayout } from "@/components/theo/Layout";
import { Upload, Loader2, Star, X, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { useSearch } from "@/contexts/SearchContext";
import { usePermissions } from "@/hooks/usePermissions";

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

type SavedRecipient = {
  id: string;
  name: string;
  stellar_address: string;
  label: string | null;
};

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  COMPLETED: { bg: "#EFFBF3",                    color: "#1A7F37", label: "Paid" },
  PENDING:   { bg: "hsl(var(--theo-gold-soft))", color: "#7A5F00", label: "Processing" },
  FAILED:    { bg: "#FEE2E2",                    color: "#B91C1C", label: "Failed" },
};

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

  // Recent payouts
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [payoutsLoading, setPayoutsLoading] = useState(true);

  // Derived: selected recipient matches a saved one
  const isAlreadySaved = savedRecipients.some(
    (r) => r.stellar_address === recipientAddress.trim()
  );

  // Stellar address validation
  const addrTrimmed = recipientAddress.trim();
  type AddrState = "empty" | "valid" | "incomplete" | "wrong_chain";
  const addrState: AddrState = (() => {
    if (!addrTrimmed) return "empty";
    if (addrTrimmed.startsWith("G") && addrTrimmed.length === 56) return "valid";
    if (addrTrimmed.startsWith("G") && addrTrimmed.length < 56) return "incomplete";
    return "wrong_chain";
  })();

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

  // Filter saved recipients dropdown by search
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

  // Close dropdown on outside click
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
      .select("id, recipient_name, amount_usdc, status, stellar_tx_hash, created_at, memo")
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
    if (!customerId || !recipientName.trim() || !recipientAddress.trim()) return;
    const { error } = await supabase.from("saved_recipients").upsert({
      customer_id: customerId,
      name: recipientName.trim(),
      stellar_address: recipientAddress.trim(),
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

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceWalletId) { toast.error("Select a source account"); return; }
    if (addrState === "wrong_chain") {
      toast.error("Cross-chain payouts are not yet supported. Please use a Stellar address (starts with G).");
      return;
    }
    if (addrState !== "valid") {
      toast.error("Enter a valid Stellar account ID — starts with G, 56 characters");
      return;
    }
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) { toast.error("Enter a valid amount"); return; }

    setSending(true);
    try {
      const res = await supabase.functions.invoke("send-payment", {
        body: { sourceWalletId, recipientAddress, recipientName, amount: parsedAmount, memo },
      });

      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) throw new Error(res.data.error);

      toast.success("Payment sent successfully");

      // Save recipient if checked and not already saved
      if (saveAfterSend && !isAlreadySaved && customerId) {
        await supabase.from("saved_recipients").upsert({
          customer_id: customerId,
          name: recipientName.trim(),
          stellar_address: recipientAddress.trim(),
        }, { onConflict: "customer_id,stellar_address" });
        await loadSavedRecipients(customerId);
      }

      setRecipientName("");
      setRecipientAddress("");
      setAmount("");
      setMemo("");
      setSaveAfterSend(false);
      if (customerId) loadPayouts(customerId);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSending(false);
    }
  };

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
    color: "hsl(var(--theo-mid))", marginBottom: 4,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", fontFamily: "inherit", fontSize: 14,
    padding: "8px 12px", borderRadius: 9,
    border: "1.5px solid hsl(var(--theo-light))",
    background: "#fff", color: "hsl(var(--theo-ink))",
    outline: "none", marginBottom: 10, boxSizing: "border-box",
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
        <div className="bg-card border border-border rounded-xl shadow-xs" style={{ padding: "16px 20px" }}>
          <div className="flex items-center justify-between mb-1">
            <div className="font-bold" style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>New payout</div>
            <span className="font-bold rounded-full" style={{ fontSize: 11, background: "hsl(var(--theo-blue-soft))", color: "hsl(var(--theo-blue))", padding: "3px 8px" }}>
              Mass payout enabled
            </span>
          </div>

          <div className="flex border-b border-border mb-2 mt-2">
            <button style={tabStyle("single")} onClick={() => setTab("single")}>Single recipient</button>
            <button style={tabStyle("bulk")} onClick={() => setTab("bulk")}>Mass transfer</button>
          </div>

          {tab === "single" ? (
            <form onSubmit={handleSend}>

              {/* ── Saved recipients selector ───────────────────────── */}
              <div style={{ marginBottom: 10 }}>
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
                    {/* Trigger */}
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
                          {recipientAddress && isAlreadySaved
                            ? <span style={{ color: "hsl(var(--theo-ink))", fontWeight: 600 }}>
                                {savedRecipients.find(r => r.stellar_address === recipientAddress)?.name}
                              </span>
                            : `${savedRecipients.length} saved recipient${savedRecipients.length !== 1 ? "s" : ""}`
                          }
                        </span>
                      </div>
                      <ChevronDown style={{ width: 12, height: 12, flexShrink: 0 }} />
                    </button>

                    {/* Dropdown */}
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
                                background: recipientAddress === r.stellar_address ? "hsl(var(--theo-blue-soft))" : "transparent",
                                cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                                borderBottom: "1px solid hsl(var(--theo-light))",
                                transition: "background 80ms",
                              }}
                              onMouseEnter={(e) => { if (recipientAddress !== r.stellar_address) (e.currentTarget as HTMLElement).style.background = "hsl(var(--theo-cream))"; }}
                              onMouseLeave={(e) => { if (recipientAddress !== r.stellar_address) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
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

                {/* Manage list */}
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
              <div className="grid gap-3 mb-2.5" style={{ gridTemplateColumns: "1fr 1fr" }}>
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
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
                      background: "hsl(var(--theo-gold))", color: "hsl(var(--theo-blue))",
                      borderRadius: 99, padding: "2px 7px", border: "none",
                    }}>
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="hsl(var(--theo-blue))"><circle cx="12" cy="12" r="10"/></svg>
                      Stellar only
                    </span>
                  </div>
                  <input
                    style={{
                      ...inputStyle, marginBottom: 0,
                      borderColor: addrState === "valid" ? "#22C55E"
                        : addrState === "wrong_chain" ? "#F59E0B"
                        : addrState === "incomplete" ? "#F59E0B"
                        : "hsl(var(--theo-light))",
                    }}
                    type="text"
                    placeholder="G… (56 characters)"
                    value={recipientAddress}
                    onChange={(e) => setRecipientAddress(e.target.value)}
                    required
                  />
                  {/* Inline feedback */}
                  {addrState === "valid" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5, fontSize: 11, color: "#16A34A", fontWeight: 600 }}>
                      <CheckCircle2 size={12} />
                      Valid Stellar address
                    </div>
                  )}
                  {addrState === "incomplete" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5, fontSize: 11, color: "#D97706", fontWeight: 600 }}>
                      <Info size={12} />
                      Address looks incomplete — Stellar IDs are 56 characters
                    </div>
                  )}
                  {addrState === "wrong_chain" && (
                    <div style={{ marginTop: 6, padding: "8px 10px", borderRadius: 7, background: "#FFFBEB", border: "1px solid #FDE68A", display: "flex", alignItems: "flex-start", gap: 7 }}>
                      <AlertTriangle size={13} style={{ color: "#D97706", flexShrink: 0, marginTop: 1 }} />
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#92400E" }}>
                          Non-Stellar address detected
                        </div>
                        <div style={{ fontSize: 11, color: "#92400E", marginTop: 2, lineHeight: 1.5 }}>
                          Payouts run on the Stellar network. Cross-chain payouts (Solana, Ethereum, etc.) are coming soon. Ask your recipient for their Stellar address or use a Stellar-compatible wallet.
                        </div>
                      </div>
                    </div>
                  )}
                  {addrState === "empty" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5, fontSize: 11, color: "hsl(var(--theo-mid))" }}>
                      <Info size={11} />
                      Stellar addresses start with G and are 56 characters long
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

              {/* ── Memo ────────────────────────────────────────────── */}
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

              {/* ── Footer ──────────────────────────────────────────── */}
              <div className="flex items-center justify-between mt-1">
                {/* Save recipient toggle */}
                <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", userSelect: "none" }}>
                  {isAlreadySaved ? (
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
                  {recipientAddress && !isAlreadySaved && (
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
                    style={{ background: "hsl(var(--theo-blue))", borderRadius: 8, padding: "8px 16px", fontSize: 13, border: "none", cursor: (sending || !can("payout_send")) ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: (sending || !can("payout_send")) ? 0.5 : 1 }}
                  >
                    {sending ? <><Loader2 style={{ width: 13, height: 13, animation: "spin 1s linear infinite" }} /> Sending…</> : "Send payout"}
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

        {/* Recent payouts */}
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
