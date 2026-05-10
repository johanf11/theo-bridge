import { useEffect, useRef, useState } from "react";
import { AppLayout } from "@/components/theo/Layout";
import { Upload, Loader2, Star, X, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, Info, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { useSearch } from "@/contexts/SearchContext";
import { usePermissions } from "@/hooks/usePermissions";
import { fetchHorizonBalances } from "@/lib/balance";
import { fmtUSDC } from "@/lib/format";

type Tab = "single" | "bulk" | "global";
type Chain = "stellar" | "solana" | "ethereum" | "base" | "bsc";

const CHAINS: {
  id: Chain; name: string; ticker: string; color: string;
  placeholder: string; hint: string;
  status: "live" | "soon";
  validate: (addr: string) => "empty" | "valid" | "incomplete" | "invalid";
}[] = [
  {
    id: "stellar", name: "Stellar", ticker: "XLM", color: "#33359A",
    placeholder: "G… (56 characters)", hint: "Stellar addresses start with G and are 56 characters long",
    status: "live",
    validate: (a) => !a ? "empty" : (a.startsWith("G") && a.length === 56) ? "valid" : (a.startsWith("G") && a.length < 56) ? "incomplete" : "invalid",
  },
  {
    id: "solana", name: "Solana", ticker: "SOL", color: "#9945FF",
    placeholder: "Base58 address (32–44 characters)", hint: "Solana addresses are base58 encoded, 32–44 characters",
    status: "soon",
    validate: (a) => !a ? "empty" : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) ? "valid" : a.length < 32 ? "incomplete" : "invalid",
  },
  {
    id: "ethereum", name: "Ethereum", ticker: "ETH", color: "#627EEA",
    placeholder: "0x… (42 characters)", hint: "Ethereum addresses start with 0x and are 42 characters long",
    status: "soon",
    validate: (a) => !a ? "empty" : /^0x[0-9a-fA-F]{40}$/.test(a) ? "valid" : a.startsWith("0x") && a.length < 42 ? "incomplete" : "invalid",
  },
  {
    id: "base", name: "Base", ticker: "BASE", color: "#0052FF",
    placeholder: "0x… (42 characters)", hint: "Base addresses start with 0x and are 42 characters long",
    status: "soon",
    validate: (a) => !a ? "empty" : /^0x[0-9a-fA-F]{40}$/.test(a) ? "valid" : a.startsWith("0x") && a.length < 42 ? "incomplete" : "invalid",
  },
  {
    id: "bsc", name: "BNB Chain", ticker: "BSC", color: "#F3BA2F",
    placeholder: "0x… (42 characters)", hint: "BNB Chain addresses start with 0x and are 42 characters long",
    status: "soon",
    validate: (a) => !a ? "empty" : /^0x[0-9a-fA-F]{40}$/.test(a) ? "valid" : a.startsWith("0x") && a.length < 42 ? "incomplete" : "invalid",
  },
];

type Wallet = { id: string; label: string; stellar_address: string; usdc_balance: number };

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
  const [destinationChain, setDestinationChain] = useState<Chain>("stellar");
  const [chainDropdownOpen, setChainDropdownOpen] = useState(false);
  const chainDropdownRef = useRef<HTMLDivElement>(null);
  const [amount, setAmount] = useState("");
  const [sourceWalletId, setSourceWalletId] = useState("");
  const [memo, setMemo] = useState("");
  const [sending, setSending] = useState(false);
  type TrustStatus = "idle" | "checking" | "ready" | "no_trust" | "not_authorized" | "not_found";
  const [trustStatus, setTrustStatus] = useState<TrustStatus>("idle");

  // Recent payouts
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [payoutsLoading, setPayoutsLoading] = useState(true);

  // Global Bank Payout (OwlPay) state
  const [bankRecipientName, setBankRecipientName] = useState("");
  const [bankBankName, setBankBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankRoutingCode, setBankRoutingCode] = useState("");
  const [bankAmountRaw, setBankAmountRaw] = useState(0);
  const [bankAmountDisplay, setBankAmountDisplay] = useState("");
  const [bankBusy, setBankBusy] = useState(false);

  // Derived: selected recipient matches a saved one
  const isAlreadySaved = savedRecipients.some(
    (r) => r.stellar_address === recipientAddress.trim()
  );

  // Chain-aware address validation
  const addrTrimmed = recipientAddress.trim();
  const selectedChain = CHAINS.find((c) => c.id === destinationChain) ?? CHAINS[0];
  const addrState = selectedChain.validate(addrTrimmed);

  // Real-time trust line check — fires when Stellar address becomes valid
  useEffect(() => {
    if (destinationChain !== "stellar" || addrState !== "valid") {
      setTrustStatus("idle");
      return;
    }
    let cancelled = false;
    setTrustStatus("checking");
    (async () => {
      try {
        const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${addrTrimmed}`);
        if (cancelled) return;
        if (res.status === 404) { setTrustStatus("not_found"); return; }
        if (!res.ok) { setTrustStatus("idle"); return; }
        const data = await res.json();
        const usdcTrust = (data.balances ?? []).find((b: { asset_code?: string }) => b.asset_code === "USDC");
        setTrustStatus(!usdcTrust ? "no_trust" : usdcTrust.is_authorized === false ? "not_authorized" : "ready");
      } catch {
        if (!cancelled) setTrustStatus("idle");
      }
    })();
    return () => { cancelled = true; };
  }, [addrTrimmed, destinationChain, addrState]);

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

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setRecipientSearch("");
      }
      if (chainDropdownRef.current && !chainDropdownRef.current.contains(e.target as Node)) {
        setChainDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const loadAll = async () => {
    const { data: au } = await supabase.auth.getUser();
    const { data: customer } = await supabase.from("customers").select("id").eq("user_id", au.user?.id ?? "").maybeSingle();
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
      .select("id, label, stellar_address, usdc_balance")
      .eq("customer_id", cid)
      .order("created_at", { ascending: true });
    const list = (data ?? []) as Wallet[];
    // Hydrate live USDC balances from Horizon (DB column is stale/0)
    const hydrated = await Promise.all(
      list.map(async (w) => {
        try {
          const bals = await fetchHorizonBalances(w.stellar_address);
          return { ...w, usdc_balance: bals.usdc };
        } catch {
          return w;
        }
      })
    );
    setWallets(hydrated);
    if (hydrated.length > 0) setSourceWalletId(hydrated[0].id);
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
    if (selectedChain.status === "soon") {
      toast.error(`${selectedChain.name} payouts are coming soon via Allbridge. Use Stellar for now.`);
      return;
    }
    if (addrState !== "valid") {
      toast.error(`Enter a valid ${selectedChain.name} address — ${selectedChain.hint.toLowerCase()}`);
      return;
    }
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) { toast.error("Enter a valid amount"); return; }

    // Pre-send balance check — compare against live balance already loaded
    const sourceWallet = wallets.find((w) => w.id === sourceWalletId);
    const availableBalance = Number(sourceWallet?.usdc_balance ?? 0);
    if (parsedAmount > availableBalance) {
      toast.error(
        `Insufficient balance — you have ${availableBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC available`
      );
      return;
    }

    setSending(true);
    try {
      const res = await supabase.functions.invoke("send-payment", {
        body: { sourceWalletId, recipientAddress, recipientName, amount: parsedAmount, memo },
      });

      if (res.data && (res.data as { ok?: boolean }).ok === false) {
        toast.error((res.data as { error?: string }).error ?? "Payment could not be sent");
        if (customerId) loadPayouts(customerId);
        return;
      }

      // res.data still contains the JSON body even on non-2xx — prefer that message
      if (res.error) throw new Error((res.data as { error?: string } | null)?.error ?? res.error.message);
      if (res.data?.error) throw new Error(res.data.error);

      toast.success("Payment sent successfully");

      // Refresh wallet balance so the tag reflects the deducted amount immediately
      if (customerId) loadWallets(customerId);

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
        <div className="bg-card border border-border rounded-xl shadow-xs self-start" style={{ padding: "16px 20px 14px" }}>
          <div className="font-bold mb-1" style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>New payout</div>

          <div className="flex border-b border-border mb-2 mt-2" style={{ overflowX: "auto" }}>
            <button style={tabStyle("single")} onClick={() => setTab("single")}>Single recipient</button>
            <button style={tabStyle("bulk")} onClick={() => setTab("bulk")}>Mass transfer</button>
            <button style={tabStyle("global")} onClick={() => setTab("global")}>Global Bank Payout</button>
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
                  {/* Label row with chain selector */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>Recipient account ID</label>

                    {/* Chain selector pill dropdown */}
                    <div style={{ position: "relative" }} ref={chainDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setChainDropdownOpen((v) => !v)}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 5,
                          fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
                          background: selectedChain.status === "soon" ? "hsl(var(--theo-cream))" : "hsl(var(--theo-gold))",
                          color: "hsl(var(--theo-blue))",
                          borderRadius: 99, padding: "3px 9px 3px 7px",
                          border: "1.5px solid " + (selectedChain.status === "soon" ? "hsl(var(--theo-light))" : "transparent"),
                          cursor: "pointer", fontFamily: "inherit",
                        }}
                      >
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: selectedChain.color, display: "inline-block", flexShrink: 0 }} />
                        {selectedChain.name}
                        <ChevronDown style={{ width: 9, height: 9, flexShrink: 0 }} />
                      </button>

                      {chainDropdownOpen && (
                        <div style={{
                          position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 200,
                          background: "#fff", borderRadius: 10, border: "1px solid hsl(var(--theo-light))",
                          boxShadow: "0 8px 24px rgba(51,53,154,0.13)", overflow: "hidden", minWidth: 180,
                        }}>
                          {/* Header */}
                          <div style={{ padding: "8px 12px 6px", borderBottom: "1px solid hsl(var(--theo-light))" }}>
                            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase", color: "hsl(var(--theo-mid))" }}>
                              Destination chain
                            </div>
                          </div>
                          {CHAINS.map((chain) => (
                            <button
                              key={chain.id}
                              type="button"
                              onClick={() => {
                                setDestinationChain(chain.id);
                                setRecipientAddress("");
                                setTrustStatus("idle");
                                setChainDropdownOpen(false);
                              }}
                              style={{
                                display: "flex", alignItems: "center", justifyContent: "space-between",
                                width: "100%", padding: "9px 12px",
                                border: "none", borderBottom: "1px solid hsl(var(--theo-light))",
                                background: destinationChain === chain.id ? "hsl(var(--theo-blue-soft))" : "transparent",
                                cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                                transition: "background 80ms",
                              }}
                              onMouseEnter={(e) => { if (destinationChain !== chain.id) (e.currentTarget as HTMLElement).style.background = "hsl(var(--theo-cream))"; }}
                              onMouseLeave={(e) => { if (destinationChain !== chain.id) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ width: 10, height: 10, borderRadius: "50%", background: chain.color, display: "inline-block", flexShrink: 0 }} />
                                <div>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: "hsl(var(--theo-blue))" }}>{chain.name}</div>
                                  <div style={{ fontSize: 10, color: "hsl(var(--theo-mid))" }}>{chain.ticker}</div>
                                </div>
                              </div>
                              {chain.status === "soon" ? (
                                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", background: "hsl(var(--theo-cream))", color: "hsl(var(--theo-mid))", borderRadius: 99, padding: "2px 6px", border: "1px solid hsl(var(--theo-light))" }}>
                                  SOON
                                </span>
                              ) : (
                                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", background: "#EFFBF3", color: "#1A7F37", borderRadius: 99, padding: "2px 6px" }}>
                                  LIVE
                                </span>
                              )}
                            </button>
                          ))}
                          {/* Allbridge footnote */}
                          <div style={{ padding: "7px 12px", fontSize: 10, color: "hsl(var(--theo-mid))", borderTop: "1px solid hsl(var(--theo-light))", lineHeight: 1.5 }}>
                            Cross-chain via <span style={{ fontWeight: 700, color: "hsl(var(--theo-blue))" }}>Allbridge</span> — coming soon
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Address input */}
                  <input
                    style={{
                      ...inputStyle, marginBottom: 0,
                      borderColor: addrState === "valid" ? "#22C55E"
                        : addrState === "incomplete" || addrState === "invalid" ? "#F59E0B"
                        : "hsl(var(--theo-light))",
                    }}
                    type="text"
                    placeholder={selectedChain.placeholder}
                    value={recipientAddress}
                    onChange={(e) => setRecipientAddress(e.target.value)}
                    required={selectedChain.status === "live"}
                  />

                  {/* Coming soon banner for non-Stellar */}
                  {selectedChain.status === "soon" && (
                    <div style={{ marginTop: 6, padding: "8px 10px", borderRadius: 7, background: "hsl(var(--theo-blue-soft))", border: "1px solid hsl(var(--theo-light))", display: "flex", alignItems: "flex-start", gap: 7 }}>
                      <Info size={12} style={{ color: "hsl(var(--theo-blue))", flexShrink: 0, marginTop: 1 }} />
                      <div style={{ fontSize: 11, color: "hsl(var(--theo-blue))", lineHeight: 1.5 }}>
                        <span style={{ fontWeight: 700 }}>{selectedChain.name} payouts coming soon</span> via Allbridge.{" "}
                        You can enter the address now — it will be saved with the recipient.
                      </div>
                    </div>
                  )}

                  {/* Inline address feedback (live chains only) */}
                  {selectedChain.status === "live" && addrState === "valid" && (() => {
                    if (trustStatus === "checking") return (
                      <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5, fontSize: 11, color: "hsl(var(--theo-mid))", fontWeight: 600 }}>
                        <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} />
                        Verifying wallet…
                      </div>
                    );
                    if (trustStatus === "ready") return (
                      <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5, fontSize: 11, color: "#16A34A", fontWeight: 600 }}>
                        <CheckCircle2 size={12} />
                        Ready to receive USDC
                      </div>
                    );
                    if (trustStatus === "no_trust") return (
                      <div style={{ marginTop: 6, padding: "8px 10px", borderRadius: 7, background: "#FFFBEB", border: "1px solid #FDE68A", display: "flex", alignItems: "flex-start", gap: 7 }}>
                        <AlertTriangle size={13} style={{ color: "#D97706", flexShrink: 0, marginTop: 1 }} />
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#92400E" }}>USDC not enabled on this wallet</div>
                          <div style={{ fontSize: 11, color: "#92400E", marginTop: 2, lineHeight: 1.5 }}>
                            The recipient needs to add a USDC trust line before they can receive funds. If this is a Theo wallet, it will be set up automatically on send.
                          </div>
                        </div>
                      </div>
                    );
                    if (trustStatus === "not_authorized") return (
                      <div style={{ marginTop: 6, padding: "8px 10px", borderRadius: 7, background: "#EFF6FF", border: "1px solid #BFDBFE", display: "flex", alignItems: "flex-start", gap: 7 }}>
                        <Info size={13} style={{ color: "#1D4ED8", flexShrink: 0, marginTop: 1 }} />
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#1E3A8A" }}>Trust line pending authorization</div>
                          <div style={{ fontSize: 11, color: "#1E3A8A", marginTop: 2, lineHeight: 1.5 }}>
                            Wallet found — Theo will authorize the USDC trust line automatically when you send.
                          </div>
                        </div>
                      </div>
                    );
                    if (trustStatus === "not_found") return (
                      <div style={{ marginTop: 6, padding: "8px 10px", borderRadius: 7, background: "#FEE2E2", border: "1px solid #FECACA", display: "flex", alignItems: "flex-start", gap: 7 }}>
                        <AlertTriangle size={13} style={{ color: "#B91C1C", flexShrink: 0, marginTop: 1 }} />
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#7F1D1D" }}>Account not found on Stellar</div>
                          <div style={{ fontSize: 11, color: "#7F1D1D", marginTop: 2, lineHeight: 1.5 }}>
                            This address hasn't been activated yet. The recipient needs to receive at least 1 XLM to create their account.
                          </div>
                        </div>
                      </div>
                    );
                    // idle fallback
                    return (
                      <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5, fontSize: 11, color: "#16A34A", fontWeight: 600 }}>
                        <CheckCircle2 size={12} />
                        Valid Stellar address
                      </div>
                    );
                  })()}
                  {selectedChain.status === "live" && addrState === "incomplete" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5, fontSize: 11, color: "#D97706", fontWeight: 600 }}>
                      <Info size={12} />
                      Address looks incomplete — {selectedChain.hint.toLowerCase()}
                    </div>
                  )}
                  {selectedChain.status === "live" && addrState === "invalid" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5, fontSize: 11, color: "#D97706", fontWeight: 600 }}>
                      <AlertTriangle size={12} />
                      Invalid address format for {selectedChain.name}
                    </div>
                  )}
                  {addrState === "empty" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5, fontSize: 11, color: "hsl(var(--theo-mid))" }}>
                      <Info size={11} />
                      {selectedChain.hint}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Amount ──────────────────────────────────────────── */}
              <div style={{ marginBottom: 10 }}>
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
              <div style={{ marginBottom: 10 }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>Source account</label>
                  {(() => {
                    const w = wallets.find((w) => w.id === sourceWalletId);
                    const bal = Number(w?.usdc_balance ?? 0);
                    const low = bal < 100;
                    if (!w) return null;
                    return (
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 999,
                        background: low ? "#FEF3C7" : "hsl(var(--theo-blue-soft))",
                        color: low ? "#92400E" : "hsl(var(--theo-blue))",
                        border: `1px solid ${low ? "#FDE68A" : "hsl(var(--theo-light))"}`,
                      }}>
                        {low && <AlertTriangle size={10} style={{ flexShrink: 0 }} />}
                        {bal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC available
                      </span>
                    );
                  })()}
                </div>
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
              <div style={{ marginBottom: 10 }}>
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
                    disabled={sending || wallets.length === 0 || !can("payout_send") || trustStatus === "not_found" || trustStatus === "checking"}
                    className="flex items-center gap-1.5 font-bold text-white"
                    style={{ background: "hsl(var(--theo-blue))", borderRadius: 8, padding: "8px 16px", fontSize: 13, border: "none", cursor: (sending || !can("payout_send") || trustStatus === "not_found" || trustStatus === "checking") ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: (sending || !can("payout_send") || trustStatus === "not_found" || trustStatus === "checking") ? 0.5 : 1 }}
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
          ) : tab === "bulk" ? (
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
          ) : (() => {
            // Wire fee config (matches Convert.tsx Global Wire tab):
            // - WIRE_FLAT_FEE: $50 flat correspondent-bank wire fee
            // - Variable fee 100 bps (1%) split:
            //     • 50 bps → OwlTing (orchestrator)
            //     • 50 bps → Theo  (platform)
            // - Volume incentive: amounts > $50,000 reduce Theo's portion
            //   from 50 bps → 25 bps (total variable becomes 75 bps + $50 flat).
            const WIRE_FLAT_FEE = 50;
            const orchestratorBps = 50;
            const platformBps = bankAmountRaw > 50000 ? 25 : 50;
            const variableBps = orchestratorBps + platformBps;

            const orchestratorFee = bankAmountRaw * (orchestratorBps / 10000);
            const platformFee = bankAmountRaw * (platformBps / 10000);
            const variableFee = orchestratorFee + platformFee;
            const totalCost = bankAmountRaw > 0 ? variableFee + WIRE_FLAT_FEE : 0;
            const totalDebit = bankAmountRaw + totalCost;
            const netDelivered = Math.max(0, bankAmountRaw);

            const selectedBankWallet = wallets.find((w) => w.id === sourceWalletId);
            const bankWalletBalance = Number(selectedBankWallet?.usdc_balance ?? 0);
            const overBalance = totalDebit > bankWalletBalance;
            const allFilled =
              bankRecipientName.trim() &&
              bankBankName.trim() &&
              bankAccountNumber.trim() &&
              bankRoutingCode.trim() &&
              bankAmountRaw > 0 &&
              !!sourceWalletId;
            const disabled = bankBusy || !allFilled || overBalance || !can("payout_send");

            const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

            const handleBankPayoutSubmit = async () => {
              const payload = {
                recipient_name: bankRecipientName,
                bank_name: bankBankName,
                account_number: bankAccountNumber,
                routing_code: bankRoutingCode,
                amount_usdc: bankAmountRaw,
                flat_fee_usdc: WIRE_FLAT_FEE,
                orchestrator_fee_usdc: orchestratorFee,
                platform_fee_usdc: platformFee,
                total_cost_usdc: totalCost,
                total_debit_usdc: totalDebit,
                orchestrator: "owlpay",
                source_wallet: sourceWalletId,
              };
              console.log("[BankPayout] payload", payload);
              setBankBusy(true);
              toast("Initiating orchestrator bridge...");
              setTimeout(() => setBankBusy(false), 1200);
            };

            return (
              <>
                <div className="rounded-xl mb-4 flex items-start gap-2.5" style={{ background: "hsl(var(--theo-blue-soft))", border: "1px solid hsl(var(--theo-cyan))", padding: "12px 14px" }}>
                  <Building2 className="shrink-0" style={{ width: 16, height: 16, color: "hsl(var(--theo-cyan))", marginTop: 1 }} />
                  <div style={{ fontSize: 12, color: "hsl(var(--theo-blue))", lineHeight: 1.6 }}>
                    Settlements to bank accounts are processed via <strong>OwlPay</strong> regulated rails. Requires a valid business license and may take 1–3 business days.
                  </div>
                </div>

                {/* Source wallet */}
                <div style={{ marginBottom: 12 }}>
                  <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>Source account <span style={{ color: "#C00" }}>*</span></label>
                    {selectedBankWallet && (
                      <span
                        style={{
                          display: "inline-block",
                          background: "hsl(var(--theo-blue-soft))",
                          color: "hsl(var(--theo-blue))",
                          border: "1px solid hsl(var(--theo-blue-chip))",
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "3px 9px",
                          borderRadius: 999,
                        }}
                      >
                        Available: {bankWalletBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC
                      </span>
                    )}
                  </div>
                  {walletsLoading ? (
                    <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>Loading accounts…</div>
                  ) : wallets.length === 0 ? (
                    <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>No accounts found. Add one on the Balance page.</div>
                  ) : (
                    <select
                      style={{ ...inputStyle, marginBottom: 0, appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6B8A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center", paddingRight: 28, cursor: "pointer" }}
                      value={sourceWalletId}
                      onChange={(e) => setSourceWalletId(e.target.value)}
                    >
                      {wallets.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
                    </select>
                  )}
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>Recipient full name <span style={{ color: "#C00" }}>*</span></label>
                  <input style={inputStyle} value={bankRecipientName} onChange={(e) => setBankRecipientName(e.target.value)} placeholder="Jane Doe" />
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>Bank name <span style={{ color: "#C00" }}>*</span></label>
                  <input style={inputStyle} value={bankBankName} onChange={(e) => setBankBankName(e.target.value)} placeholder="HSBC, BBVA, etc." />
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>Account number / IBAN / CLABE <span style={{ color: "#C00" }}>*</span></label>
                  <input style={inputStyle} value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} placeholder="GB29 NWBK 6016 1331 9268 19" />
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>Routing / SWIFT code <span style={{ color: "#C00" }}>*</span></label>
                  <input style={inputStyle} value={bankRoutingCode} onChange={(e) => setBankRoutingCode(e.target.value)} placeholder="NWBKGB2L" />
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>Amount (USDC) <span style={{ color: "#C00" }}>*</span></label>
                  <input
                    style={inputStyle}
                    inputMode="decimal"
                    value={bankAmountDisplay}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^\d.]/g, "");
                      const num = parseFloat(raw) || 0;
                      setBankAmountRaw(num);
                      setBankAmountDisplay(raw);
                    }}
                    placeholder="0.00"
                  />
                  {overBalance && (
                    <div style={{ fontSize: 11, color: "hsl(var(--destructive))", marginTop: 6, fontWeight: 600 }}>
                      Insufficient USDC — you need {fmt(totalDebit)} USDC including fees.
                    </div>
                  )}
                  {bankAmountRaw > 50000 && (
                    <div style={{ fontSize: 11, color: "hsl(var(--theo-cyan))", marginTop: 6, fontWeight: 600 }}>
                      Volume incentive applied: Theo platform fee reduced to 0.25% (total 0.75% + $50 flat).
                    </div>
                  )}
                </div>

                {/* Transfer Summary */}
                <div className="rounded-xl mb-4 p-4" style={{ background: "hsl(var(--theo-cream))", border: "1px solid hsl(var(--theo-light))" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "hsl(var(--theo-cyan))", marginBottom: 10 }}>
                    Transfer Summary
                  </div>
                  <div className="flex justify-between" style={{ fontSize: 12, marginBottom: 6 }}>
                    <span style={{ color: "hsl(var(--theo-mid))" }}>Principal</span>
                    <span style={{ fontWeight: 700, color: "hsl(var(--theo-blue))" }}>${fmt(bankAmountRaw)} USDC</span>
                  </div>
                  <div className="flex justify-between" style={{ fontSize: 12, marginBottom: 6 }}>
                    <span style={{ color: "hsl(var(--theo-mid))" }}>Bank Wire Fee <span style={{ opacity: 0.7 }}>(Flat)</span></span>
                    <span style={{ fontWeight: 700, color: "hsl(var(--theo-blue))" }}>${fmt(WIRE_FLAT_FEE)} USDC</span>
                  </div>
                  <div className="flex justify-between" style={{ fontSize: 12, marginBottom: 6 }}>
                    <span style={{ color: "hsl(var(--theo-mid))" }}>Processing Fee <span style={{ opacity: 0.7 }}>({(variableBps / 100).toFixed(2)}%)</span></span>
                    <span style={{ fontWeight: 700, color: "hsl(var(--theo-blue))" }}>${fmt(variableFee)} USDC</span>
                  </div>
                  <div className="flex justify-between" style={{ fontSize: 13, marginTop: 8, paddingTop: 8, borderTop: "1px solid hsl(var(--theo-light))" }}>
                    <span style={{ fontWeight: 700, color: "hsl(var(--theo-blue))" }}>Total Deducted</span>
                    <span style={{ fontWeight: 800, color: "hsl(var(--theo-blue))" }}>${fmt(totalDebit)} USDC</span>
                  </div>
                  <div className="flex justify-between items-center" style={{ fontSize: 13, marginTop: 10, paddingTop: 10, borderTop: "1px dashed hsl(var(--theo-cyan))" }}>
                    <span style={{ fontWeight: 800, color: "hsl(var(--theo-blue))" }}>Net Delivery</span>
                    <span style={{ fontWeight: 800, color: "hsl(var(--theo-blue))" }}>
                      Recipient will receive <span style={{ color: "hsl(var(--theo-cyan))" }}>${fmt(netDelivered)}</span> in local currency
                    </span>
                  </div>
                </div>

                <button
                  onClick={handleBankPayoutSubmit}
                  disabled={disabled}
                  className="w-full font-bold"
                  style={{
                    background: disabled ? "hsl(var(--theo-light))" : "hsl(var(--theo-cyan))",
                    color: disabled ? "hsl(var(--theo-mid))" : "#fff",
                    borderRadius: 9, padding: "12px", fontSize: 14, border: "none",
                    cursor: disabled ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {bankBusy ? "Initiating wire…" : "Confirm Wire →"}
                </button>
              </>
            );
          })()}
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
                        ${fmtUSDC(Number(p.amount_usdc))}
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
