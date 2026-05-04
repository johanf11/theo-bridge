import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth, useRoles } from "@/lib/auth";
import { X, Plus, Building2, CheckCircle2 } from "lucide-react";

type Tab = "on" | "off";
type KybStatus = "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";
type Profile = { kyb_status: KybStatus; stellar_wallet_address: string | null; fee_bps: number; corridor_bps: number };
type WalletOption = { id: string; label: string; stellar_address: string };
type BankAccount = { id: string; bank_name: string; account_name: string; account_number: string; routing_code: string | null; is_default: boolean };

const HAITI_BANKS = [
  "BNC (Banque Nationale de Crédit)",
  "Sogebank",
  "Unibank",
  "BH (Banque de l'Habitat)",
  "Capital Bank",
  "Scotiabank Haïti",
  "Citibank Haïti",
  "Fonkoze",
  "Other",
];

export default function Convert() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin } = useRoles();

  const [tab, setTab] = useState<Tab>("on");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [spotRate, setSpotRate] = useState<number | null>(null);
  const [liveRate, setLiveRate] = useState<number | null>(null);
  const [rateSource, setRateSource] = useState<"brh" | "cache" | "seed">("seed");
  const [rateCapturedAt, setRateCapturedAt] = useState<string | null>(null);
  const [rateLoading, setRateLoading] = useState(true);
  const [usdcRaw, setUsdcRaw] = useState(10000);
  const [usdcDisplay, setUsdcDisplay] = useState("10,000");
  const [lockSecs, setLockSecs] = useState(15 * 60);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockedRef, setLockedRef] = useState("");
  const [walletOptions, setWalletOptions] = useState<WalletOption[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<string>("");

  // ── Off-ramp state ──────────────────────────────────────────────────────
  const [offAmount, setOffAmount] = useState("5,000");
  const [offAmountRaw, setOffAmountRaw] = useState(5000);
  const [offSourceWallet, setOffSourceWallet] = useState<string>("");
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [selectedBank, setSelectedBank] = useState<string>("");
  const [bankLoading, setBankLoading] = useState(false);
  const [showAddBank, setShowAddBank] = useState(false);
  const [offConfirm, setOffConfirm] = useState(false);
  const [offBusy, setOffBusy] = useState(false);

  // Add bank form
  const [addBankName, setAddBankName] = useState("");
  const [addAccountName, setAddAccountName] = useState("");
  const [addAccountNumber, setAddAccountNumber] = useState("");
  const [addRoutingCode, setAddRoutingCode] = useState("");
  const [addBankBusy, setAddBankBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setProfileLoading(true);
    supabase.from("customers").select("id, kyb_status, stellar_wallet_address, fee_bps, corridor_bps").eq("user_id", user.id).maybeSingle().then(async ({ data }) => {
      if (cancelled) return;
      setProfile(data as Profile | null);
      setProfileLoading(false);

      if (data?.id) {
        const { data: ws } = await supabase
          .from("wallets")
          .select("id, label, stellar_address")
          .eq("customer_id", data.id)
          .order("created_at", { ascending: true });
        if (cancelled) return;
        const opts: WalletOption[] = (ws ?? []).map((w) => ({
          id: w.id,
          label: w.label ?? "Wallet",
          stellar_address: w.stellar_address,
        }));
        setWalletOptions(opts);
        if (opts.length > 0) {
          setSelectedWallet(opts[0].stellar_address);
          setOffSourceWallet(opts[0].id);
        } else {
          setSelectedWallet("");
        }

        // Load bank accounts
        setBankLoading(true);
        const { data: banks } = await supabase
          .from("bank_accounts")
          .select("id, bank_name, account_name, account_number, routing_code, is_default")
          .eq("customer_id", data.id)
          .order("is_default", { ascending: false });
        if (!cancelled) {
          const b = (banks ?? []) as BankAccount[];
          setBankAccounts(b);
          const def = b.find((x) => x.is_default) ?? b[0];
          if (def) setSelectedBank(def.id);
          setBankLoading(false);
        }
      }
    });
    // Fetch live BRH reference rate.
    // Falls back to latest rate_snapshots row if edge function isn't deployed yet.
    const applyRate = (spot: number, source: string, capturedAt?: string) => {
      if (cancelled) return;
      setSpotRate(spot);
      setLiveRate(spot);
      setRateSource(source as "brh" | "cache" | "seed");
      setRateCapturedAt(capturedAt ?? null);
      setRateLoading(false);
    };

    supabase.functions.invoke("fetch-brh-rate")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && data?.rate) {
          applyRate(Number(data.rate), data.source ?? "brh", data.captured_at);
        } else {
          // Edge function not deployed yet — read directly from rate_snapshots
          supabase
            .from("rate_snapshots")
            .select("spot_rate, source, captured_at")
            .order("captured_at", { ascending: false })
            .limit(1)
            .maybeSingle()
            .then(({ data: snap }) => {
              applyRate(Number(snap?.spot_rate ?? 130), snap?.source ?? "cache", snap?.captured_at);
            });
        }
      })
      .catch(() => {
        if (cancelled) return;
        supabase
          .from("rate_snapshots")
          .select("spot_rate, source, captured_at")
          .order("captured_at", { ascending: false })
          .limit(1)
          .maybeSingle()
          .then(({ data: snap }) => {
            applyRate(Number(snap?.spot_rate ?? 130), snap?.source ?? "cache", snap?.captured_at);
          });
      });

    return () => { cancelled = true; };
  }, [user]);

  // No random ticker — rate is BRH official, only refreshes on page load.

  // Countdown
  useEffect(() => {
    const id = setInterval(() => setLockSecs((s) => (s <= 1 ? 15 * 60 : s - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  const handleUsdcInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^\d]/g, "");
    const num = parseInt(raw, 10) || 0;
    setUsdcRaw(num);
    setUsdcDisplay(num ? num.toLocaleString("en-US") : "");
  };

  const htg = liveRate ? Math.round(usdcRaw * liveRate) : null;
  const timerLabel = `${Math.floor(lockSecs / 60)}:${String(lockSecs % 60).padStart(2, "0")}`;
  const canQuote = profile?.kyb_status === "APPROVED" && !profileLoading && !rateLoading;

  // Fee breakdown — bps applied to USDC notional
  const feeBps      = profile?.fee_bps      ?? 150; // Theo margin
  const corridorBps = profile?.corridor_bps ?? 70;  // MoneyGram corridor
  const totalBps    = feeBps + corridorBps;
  const feeUSDC     = usdcRaw * (totalBps / 10_000);
  const fmtFee = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const [showFeeBreakdown, setShowFeeBreakdown] = useState(false);

  const submit = async () => {
    if (!canQuote) { toast.error("KYB approval required"); return; }
    if (usdcRaw < 1000 || usdcRaw > 50000) { toast.error("Enter an amount between 1,000 and 50,000 USDC"); return; }
    if (!selectedWallet) { toast.error("Please select a destination account"); return; }
    try {
      setBusy(true);
      const { data, error } = await supabase.functions.invoke("create-quote", {
        body: { usdc_amount: usdcRaw, destination_wallet_address: selectedWallet },
      });
      if (error || data?.error) { toast.error(data?.error || error?.message || "Quote failed"); return; }
      setLocked(true);
      setLockedRef(data.reference_number);
      toast.success(`Rate locked. Reference ${data.reference_number}`);
      navigate(`/orders/${data.quote_id}`);
    } finally {
      setBusy(false);
    }
  };

  const approveTestKyb = async () => {
    if (!user) return;
    const existing = profile?.stellar_wallet_address ?? "";
    const wallet = window.prompt(
      "Account ID for USDC release:",
      existing.startsWith("G") ? existing : "",
    );
    if (!wallet || !wallet.startsWith("G") || wallet.length < 50) {
      toast.error("Valid account ID required");
      return;
    }
    setBusy(true);
    const { data } = await supabase
      .from("customers")
      .update({ kyb_status: "APPROVED", stellar_wallet_address: wallet.trim() })
      .eq("user_id", user.id)
      .select("kyb_status, stellar_wallet_address")
      .maybeSingle();
    setBusy(false);
    setProfile(data as Profile | null);
    toast.success("KYB approved + wallet saved");
  };

  const handleOffAmountInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^\d]/g, "");
    const num = parseInt(raw, 10) || 0;
    setOffAmountRaw(num);
    setOffAmount(num ? num.toLocaleString("en-US") : "");
  };

  const loadBankAccounts = async () => {
    const { data: c } = await supabase.from("customers").select("id").maybeSingle();
    if (!c) return;
    const { data: banks } = await supabase
      .from("bank_accounts")
      .select("id, bank_name, account_name, account_number, routing_code, is_default")
      .eq("customer_id", c.id)
      .order("is_default", { ascending: false });
    const b = (banks ?? []) as BankAccount[];
    setBankAccounts(b);
    const def = b.find((x) => x.is_default) ?? b[0];
    if (def) setSelectedBank(def.id);
  };

  const handleAddBank = async () => {
    if (!addBankName || !addAccountName || !addAccountNumber) {
      toast.error("Please fill in all required fields");
      return;
    }
    setAddBankBusy(true);
    const { data: c } = await supabase.from("customers").select("id").maybeSingle();
    if (!c) { toast.error("Customer not found"); setAddBankBusy(false); return; }

    const isFirst = bankAccounts.length === 0;
    const { data, error } = await supabase
      .from("bank_accounts")
      .insert({
        customer_id: c.id,
        bank_name: addBankName,
        account_name: addAccountName,
        account_number: addAccountNumber,
        routing_code: addRoutingCode || null,
        is_default: isFirst,
      })
      .select()
      .single();
    setAddBankBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Bank account added");
    setShowAddBank(false);
    setAddBankName(""); setAddAccountName(""); setAddAccountNumber(""); setAddRoutingCode("");
    await loadBankAccounts();
    if (data) setSelectedBank(data.id);
  };

  const handleWithdraw = async () => {
    const bank = bankAccounts.find((b) => b.id === selectedBank);
    if (!bank) { toast.error("Please select a destination bank account"); return; }
    if (offAmountRaw < 100) { toast.error("Minimum withdrawal is $100 USDC"); return; }
    setOffBusy(true);
    // Stub — wire to withdraw edge function
    await new Promise((r) => setTimeout(r, 1500));
    setOffBusy(false);
    setOffConfirm(false);
    toast.success(`Withdrawal of $${offAmount} USDC initiated — arrives in 1–2 business days`);
  };

  const maskAccount = (num: string) =>
    num.length > 4 ? `**** ${num.slice(-4)}` : num;

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
    outline: "none", boxSizing: "border-box",
  };

  return (
    <AppLayout>
      <div className="mb-1">
        <div className="font-extrabold" style={{ fontSize: 22, color: "hsl(var(--theo-blue))", letterSpacing: "-0.02em" }}>
          Convert
        </div>
        <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))", marginTop: 2 }}>
          Fund your account or withdraw to a bank.
        </div>
      </div>
      <div className="mb-5" style={{ width: 28, height: 3, background: "hsl(var(--theo-gold))", borderRadius: 2, marginTop: 8 }} />

      <div className="grid gap-4" style={{ gridTemplateColumns: "3fr 2fr" }}>
        {/* Main form */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-xs">
          <div className="flex border-b border-border mb-4">
            <button style={tabStyle("on")} onClick={() => setTab("on")}>HTG → USDC</button>
            <button style={tabStyle("off")} onClick={() => setTab("off")}>USDC → Bank</button>
          </div>

          {tab === "on" ? (
            <>
              {/* KYB gate */}
              {!canQuote && !profileLoading && (
                <div className="mb-4 rounded-xl p-4 flex items-start gap-3" style={{ background: "hsl(var(--theo-blue-soft))", border: "1px solid hsl(var(--theo-blue-chip))" }}>
                  <div style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>
                    <strong>KYB approval required</strong> to unlock conversions.{" "}
                    {isAdmin && profile?.kyb_status !== "APPROVED" && (
                      <button onClick={approveTestKyb} disabled={busy} className="underline cursor-pointer border-none bg-transparent" style={{ fontFamily: "inherit", fontSize: 13, color: "hsl(var(--theo-cyan))" }}>
                        Approve test KYB
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>USDC you want to receive</label>
                <div style={{ position: "relative" }}>
                  <input
                    style={{ ...inputStyle, paddingRight: 56 }}
                    type="text"
                    inputMode="numeric"
                    value={usdcDisplay}
                    onChange={handleUsdcInput}
                    placeholder="0"
                  />
                  <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 12, fontWeight: 700, color: "hsl(var(--theo-mid))" }}>
                    USDC
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginTop: 4 }}>Min $1,000 · Max $50,000</div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Destination account</label>
                {walletOptions.length === 0 ? (
                  <div style={{ ...inputStyle, display: "flex", alignItems: "center", color: "hsl(var(--theo-mid))", fontSize: 13 }}>
                    No accounts yet — create one with “+ Add account” on the Balance page.
                  </div>
                ) : (
                  <select
                    value={selectedWallet}
                    onChange={(e) => setSelectedWallet(e.target.value)}
                    style={{ ...inputStyle, appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6B8A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center", paddingRight: 28, cursor: "pointer" }}
                  >
                    {walletOptions.map((w) => (
                      <option key={w.id} value={w.stellar_address}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Live quote */}
              <div className="rounded-xl mb-4" style={{ background: "hsl(var(--theo-blue-soft))", border: "1px solid hsl(var(--theo-blue-chip))", padding: "14px 16px" }}>
                <div className="flex justify-between mb-1.5">
                  <span style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>HTG to send</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: "hsl(var(--theo-blue))" }}>{htg != null ? htg.toLocaleString("en-US") : "—"}</span>
                </div>
                <div className="flex justify-between mb-1.5">
                  <span style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>Rate</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-blue))" }}>{liveRate != null ? liveRate.toFixed(2) : "—"} HTG/USDC</span>
                </div>
                <div>
                  <div className="flex justify-between items-center">
                    <button
                      onClick={() => setShowFeeBreakdown((v) => !v)}
                      style={{ fontSize: 12, color: "hsl(var(--theo-mid))", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 3 }}
                    >
                      Fee <span style={{ fontSize: 10 }}>{showFeeBreakdown ? "▲" : "▼"}</span>
                    </button>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-blue))" }}>
                      {fmtFee(feeUSDC)}
                    </span>
                  </div>
                  {showFeeBreakdown && (
                    <div className="mt-2 rounded-lg" style={{ background: "rgba(255,255,255,0.6)", border: "1px solid hsl(var(--theo-blue-chip))", padding: "8px 10px" }}>
                      <div className="flex justify-between mb-1">
                        <span style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>Corridor ({corridorBps / 100}%)</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--theo-blue))" }}>{fmtFee(usdcRaw * corridorBps / 10_000)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>Theo service ({feeBps / 100}%)</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--theo-blue))" }}>{fmtFee(usdcRaw * feeBps / 10_000)}</span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between mt-2.5 pt-2.5" style={{ borderTop: "1px solid hsl(var(--theo-blue-chip))" }}>
                  <div className="flex items-center gap-1.5">
                    <div className="rounded-full" style={{ width: 6, height: 6, background: "hsl(var(--theo-cyan))", animation: "pulse 2s infinite" }} />
                    <span style={{ fontSize: 11, color: "hsl(var(--theo-cyan))", fontWeight: 600 }}>
                      Rate locked for <strong>{timerLabel}</strong>
                    </span>
                  </div>
                  <span style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>Updates every 5s</span>
                </div>
              </div>

              <button
                onClick={submit}
                disabled={busy || !canQuote}
                className="w-full font-bold text-white transition-colors"
                style={{
                  background: busy || !canQuote ? "hsl(var(--theo-mid))" : "hsl(var(--theo-blue))",
                  borderRadius: 9, padding: "12px", fontSize: 14,
                  border: "none", cursor: busy || !canQuote ? "not-allowed" : "pointer",
                  fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                {busy ? "Generating quote…" : "Get payment reference →"}
              </button>
            </>
          ) : (
            <>
              {/* Amount */}
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>USDC to withdraw</label>
                <div style={{ position: "relative" }}>
                  <input
                    style={{ ...inputStyle, paddingRight: 56 }}
                    type="text" inputMode="numeric"
                    value={offAmount}
                    onChange={handleOffAmountInput}
                    placeholder="0"
                  />
                  <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 12, fontWeight: 700, color: "hsl(var(--theo-mid))" }}>USDC</span>
                </div>
              </div>

              {/* Source wallet */}
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Source account</label>
                <select
                  value={offSourceWallet}
                  onChange={(e) => setOffSourceWallet(e.target.value)}
                  style={{ ...inputStyle, appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6B8A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center", paddingRight: 28, cursor: "pointer" }}
                >
                  {walletOptions.length === 0
                    ? <option>No accounts yet</option>
                    : walletOptions.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
                </select>
              </div>

              {/* Destination bank account */}
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Destination bank account</label>
                {bankLoading ? (
                  <div style={{ ...inputStyle, color: "hsl(var(--theo-mid))", fontSize: 13 }}>Loading…</div>
                ) : bankAccounts.length === 0 ? (
                  <button
                    onClick={() => setShowAddBank(true)}
                    style={{ ...inputStyle, background: "hsl(var(--theo-blue-soft))", border: "1.5px dashed hsl(var(--theo-blue))", color: "hsl(var(--theo-blue))", fontWeight: 600, fontSize: 13, cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <Plus size={14} /> Add a bank account
                  </button>
                ) : (
                  <div style={{ display: "flex", gap: 8 }}>
                    <select
                      value={selectedBank}
                      onChange={(e) => setSelectedBank(e.target.value)}
                      style={{ ...inputStyle, flex: 1, appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6B8A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center", paddingRight: 28, cursor: "pointer" }}
                    >
                      {bankAccounts.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.bank_name} — {maskAccount(b.account_number)}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => setShowAddBank(true)}
                      title="Add bank account"
                      style={{ background: "hsl(var(--theo-blue-soft))", border: "1.5px solid hsl(var(--theo-blue-chip))", borderRadius: 9, padding: "0 11px", cursor: "pointer", color: "hsl(var(--theo-blue))", display: "flex", alignItems: "center" }}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                )}
              </div>

              {/* Selected bank summary */}
              {selectedBank && (() => {
                const b = bankAccounts.find((x) => x.id === selectedBank);
                if (!b) return null;
                return (
                  <div className="rounded-xl mb-3" style={{ background: "hsl(var(--theo-blue-soft))", border: "1px solid hsl(var(--theo-blue-chip))", padding: "10px 14px" }}>
                    <div className="flex items-center gap-2">
                      <Building2 size={13} color="hsl(var(--theo-blue))" />
                      <span style={{ fontSize: 12, fontWeight: 700, color: "hsl(var(--theo-blue))" }}>{b.bank_name}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginTop: 3 }}>
                      {b.account_name} · {maskAccount(b.account_number)}
                      {b.routing_code && ` · ${b.routing_code}`}
                    </div>
                  </div>
                );
              })()}

              {/* Settlement note */}
              <div className="rounded-xl mb-4" style={{ background: "hsl(var(--theo-gold-soft))", border: "1px solid #F0C000", padding: "12px 14px", fontSize: 12, color: "#7A5F00", lineHeight: 1.5 }}>
                <strong>Note:</strong> Off-ramp withdrawals are processed via SPIH and typically arrive in 1–2 business days.
              </div>

              <button
                onClick={() => setOffConfirm(true)}
                disabled={!selectedBank || offAmountRaw < 100}
                className="w-full font-bold text-white"
                style={{
                  background: !selectedBank || offAmountRaw < 100 ? "hsl(var(--theo-mid))" : "hsl(var(--theo-blue))",
                  borderRadius: 9, padding: "12px", fontSize: 14,
                  border: "none", cursor: !selectedBank || offAmountRaw < 100 ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                }}
              >
                Initiate withdrawal →
              </button>
            </>
          )}
        </div>

        {/* Info sidebar */}
        <div className="flex flex-col gap-3">
          <div className="bg-card border border-border rounded-xl p-5 shadow-xs">
            <div className="font-bold mb-3" style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>Corridor info</div>
            <p style={{ fontSize: 12, color: "hsl(var(--theo-mid))", lineHeight: 1.6, marginBottom: 12 }}>
              Theo bridges the Haiti–DR corridor. All HTG payments route through SPIH, Haiti's interbank settlement network.
            </p>
            {[
              ["Avg. settlement", "< 2 min"],
              ["Network", "Theo"],
              ["Reserve model", "1:1 · Segregated"],
              ["Max per order", "$50,000 USDC"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between" style={{ fontSize: 12, marginBottom: 8 }}>
                <span style={{ color: "hsl(var(--theo-mid))" }}>{k}</span>
                <span style={{ fontWeight: 700, color: "hsl(var(--theo-blue))" }}>{v}</span>
              </div>
            ))}
          </div>

          <div className="bg-card border border-border rounded-xl p-5 shadow-xs">
            <div className="flex items-center justify-between mb-2">
              <div className="font-bold" style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>Live rate</div>
              {rateSource === "brh" && (
                <a
                  href="https://www.brh.ht/taux-du-jour/"
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--theo-cyan))", textDecoration: "none", letterSpacing: "0.08em", textTransform: "uppercase" }}
                >
                  BRH ↗
                </a>
              )}
            </div>
            <div className="font-extrabold leading-none" style={{ fontSize: 28, letterSpacing: "-1px", color: "hsl(var(--theo-blue))" }}>
              {rateLoading ? "…" : liveRate != null ? liveRate.toFixed(2) : "—"}
            </div>
            <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginTop: 2 }}>HTG per USDC</div>
            <div className="flex items-center gap-1.5 mt-1.5">
              <div className="rounded-full" style={{ width: 6, height: 6, background: "hsl(var(--theo-cyan))", animation: "pulse 2s infinite" }} />
              <span style={{ fontSize: 11, color: "hsl(var(--theo-cyan))", fontWeight: 600 }}>
                {rateSource === "brh" ? "BRH · updates daily" : "Live · updates every 5s"}
              </span>
            </div>
            {rateCapturedAt && rateSource === "brh" && (
              <div style={{ fontSize: 10, color: "hsl(var(--theo-mid))", marginTop: 4, opacity: 0.7 }}>
                As of {new Date(rateCapturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Add Bank Account Modal ─────────────────────────────────────── */}
      {showAddBank && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 460, boxShadow: "0 20px 60px rgba(0,0,0,0.2)", overflow: "hidden" }}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid hsl(var(--theo-light))" }}>
              <div>
                <div className="font-bold" style={{ fontSize: 15, color: "hsl(var(--theo-blue))" }}>Add bank account</div>
                <div style={{ fontSize: 12, color: "hsl(var(--theo-mid))", marginTop: 1 }}>HTG withdrawals will be sent here via SPIH</div>
              </div>
              <button onClick={() => setShowAddBank(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(var(--theo-mid))", padding: 4 }}>
                <X size={18} />
              </button>
            </div>

            <div className="p-5">
              {/* Bank name */}
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Bank <span style={{ color: "#C00" }}>*</span></label>
                <select
                  value={addBankName}
                  onChange={(e) => setAddBankName(e.target.value)}
                  style={{ ...inputStyle, appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6B8A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center", paddingRight: 28, cursor: "pointer" }}
                >
                  <option value="">Select bank…</option>
                  {HAITI_BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>

              {/* Account name */}
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Account holder name <span style={{ color: "#C00" }}>*</span></label>
                <input
                  style={inputStyle}
                  type="text"
                  placeholder="Full legal name on account"
                  value={addAccountName}
                  onChange={(e) => setAddAccountName(e.target.value)}
                />
              </div>

              {/* Account number */}
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Account number <span style={{ color: "#C00" }}>*</span></label>
                <input
                  style={inputStyle}
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. 0012345678"
                  value={addAccountNumber}
                  onChange={(e) => setAddAccountNumber(e.target.value.replace(/[^\d]/g, ""))}
                />
              </div>

              {/* Routing / BIC */}
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Routing / BIC code <span style={{ color: "hsl(var(--theo-mid))", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span></label>
                <input
                  style={inputStyle}
                  type="text"
                  placeholder="e.g. BNCAHAHX"
                  value={addRoutingCode}
                  onChange={(e) => setAddRoutingCode(e.target.value.toUpperCase())}
                />
              </div>

              <div className="rounded-lg mb-4" style={{ background: "hsl(var(--theo-blue-soft))", border: "1px solid hsl(var(--theo-blue-chip))", padding: "10px 12px", fontSize: 11, color: "hsl(var(--theo-blue))", lineHeight: 1.6 }}>
                Your account details are stored securely and only used to process withdrawals you initiate.
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setShowAddBank(false)}
                  style={{ flex: 1, background: "transparent", border: "1.5px solid hsl(var(--theo-light))", color: "hsl(var(--theo-mid))", borderRadius: 9, padding: "10px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddBank}
                  disabled={addBankBusy || !addBankName || !addAccountName || !addAccountNumber}
                  style={{
                    flex: 2, background: !addBankName || !addAccountName || !addAccountNumber ? "hsl(var(--theo-mid))" : "hsl(var(--theo-blue))",
                    color: "#fff", border: "none", borderRadius: 9, padding: "10px", fontSize: 13,
                    fontWeight: 700, cursor: !addBankName || !addAccountName || !addAccountNumber ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {addBankBusy ? "Saving…" : "Save bank account"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Withdrawal Confirm Modal ────────────────────────────────────── */}
      {offConfirm && (() => {
        const bank = bankAccounts.find((b) => b.id === selectedBank);
        const wallet = walletOptions.find((w) => w.id === offSourceWallet);
        if (!bank) return null;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.2)", overflow: "hidden" }}>
              <div className="px-5 py-4" style={{ borderBottom: "1px solid hsl(var(--theo-light))" }}>
                <div className="font-bold" style={{ fontSize: 15, color: "hsl(var(--theo-blue))" }}>Confirm withdrawal</div>
                <div style={{ fontSize: 12, color: "hsl(var(--theo-mid))", marginTop: 1 }}>Review details before submitting</div>
              </div>

              <div className="p-5">
                {/* Summary rows */}
                {[
                  ["Amount", `$${offAmount} USDC`],
                  ["From", wallet?.label ?? "—"],
                  ["To bank", bank.bank_name],
                  ["Account", `${bank.account_name} · ${maskAccount(bank.account_number)}`],
                  ["Settlement", "1–2 business days via SPIH"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between py-2.5" style={{ borderBottom: "1px solid hsl(var(--theo-light))", fontSize: 13 }}>
                    <span style={{ color: "hsl(var(--theo-mid))" }}>{k}</span>
                    <span style={{ fontWeight: 700, color: "hsl(var(--theo-blue))" }}>{v}</span>
                  </div>
                ))}

                <div className="flex gap-2 mt-4">
                  <button
                    onClick={() => setOffConfirm(false)}
                    style={{ flex: 1, background: "transparent", border: "1.5px solid hsl(var(--theo-light))", color: "hsl(var(--theo-mid))", borderRadius: 9, padding: "10px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleWithdraw}
                    disabled={offBusy}
                    className="flex items-center justify-center gap-2"
                    style={{ flex: 2, background: offBusy ? "hsl(var(--theo-mid))" : "hsl(var(--theo-blue))", color: "#fff", border: "none", borderRadius: 9, padding: "10px", fontSize: 13, fontWeight: 700, cursor: offBusy ? "not-allowed" : "pointer", fontFamily: "inherit" }}
                  >
                    {offBusy ? "Processing…" : <><CheckCircle2 size={14} /> Confirm withdrawal</>}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </AppLayout>
  );
}
