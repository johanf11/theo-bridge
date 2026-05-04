import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth, useRoles } from "@/lib/auth";

type Tab = "on" | "off";
type KybStatus = "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";
type Profile = { kyb_status: KybStatus; stellar_wallet_address: string | null; fee_bps: number; corridor_bps: number };
type WalletOption = { id: string; label: string; stellar_address: string };

export default function Convert() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin } = useRoles();

  const [tab, setTab] = useState<Tab>("on");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [spotRate, setSpotRate] = useState(135.0);
  const [liveRate, setLiveRate] = useState(135.0);
  const [usdcRaw, setUsdcRaw] = useState(10000);
  const [usdcDisplay, setUsdcDisplay] = useState("10,000");
  const [lockSecs, setLockSecs] = useState(15 * 60);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockedRef, setLockedRef] = useState("");
  const [walletOptions, setWalletOptions] = useState<WalletOption[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<string>("");

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
        if (opts.length > 0) setSelectedWallet(opts[0].stellar_address);
        else setSelectedWallet("");
      }
    });
    supabase.from("rate_snapshots").select("spot_rate").order("captured_at", { ascending: false }).limit(1).maybeSingle().then(({ data }) => {
      if (cancelled || !data?.spot_rate) return;
      const r = Number(data.spot_rate) + 5;
      setSpotRate(r); setLiveRate(r);
    });
    return () => { cancelled = true; };
  }, [user]);

  // Rate ticker
  useEffect(() => {
    const id = setInterval(() => {
      setLiveRate((r) => parseFloat((r + (Math.random() - 0.5) * 0.12).toFixed(2)));
    }, 5000);
    return () => clearInterval(id);
  }, []);

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

  const htg = Math.round(usdcRaw * liveRate);
  const timerLabel = `${Math.floor(lockSecs / 60)}:${String(lockSecs % 60).padStart(2, "0")}`;
  const canQuote = profile?.kyb_status === "APPROVED" && !profileLoading;

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
                  <span style={{ fontSize: 15, fontWeight: 800, color: "hsl(var(--theo-blue))" }}>{htg.toLocaleString("en-US")}</span>
                </div>
                <div className="flex justify-between mb-1.5">
                  <span style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>Rate</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-blue))" }}>{liveRate.toFixed(2)} HTG/USDC</span>
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
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>USDC to withdraw</label>
                <div style={{ position: "relative" }}>
                  <input style={{ ...inputStyle, paddingRight: 56 }} type="text" inputMode="numeric" defaultValue="5,000" />
                  <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 12, fontWeight: 700, color: "hsl(var(--theo-mid))" }}>USDC</span>
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Source account</label>
                <select style={{ ...inputStyle, appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6B8A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center", paddingRight: 28, cursor: "pointer" }}>
                  {walletOptions.length === 0
                    ? <option>No accounts yet</option>
                    : walletOptions.map((w) => <option key={w.id}>{w.label}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Destination bank account</label>
                <select style={{ ...inputStyle, appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6B8A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center", paddingRight: 28, cursor: "pointer" }}>
                  <option>BNC — **** 4821</option>
                  <option>Sogebank — **** 3301</option>
                  <option>+ Add new account</option>
                </select>
              </div>
              <div className="rounded-xl mb-4" style={{ background: "hsl(var(--theo-gold-soft))", border: "1px solid #F0C000", padding: "12px 14px", fontSize: 12, color: "#7A5F00", lineHeight: 1.5 }}>
                <strong>Note:</strong> Off-ramp withdrawals are processed via SPIH and typically arrive in 1–2 business days.
              </div>
              <button
                className="w-full font-bold text-white"
                style={{ background: "hsl(var(--theo-blue))", borderRadius: 9, padding: "12px", fontSize: 14, border: "none", cursor: "pointer", fontFamily: "inherit" }}
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
            <div className="font-bold mb-2" style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>Live rate</div>
            <div className="font-extrabold leading-none" style={{ fontSize: 28, letterSpacing: "-1px", color: "hsl(var(--theo-blue))" }}>
              {liveRate.toFixed(2)}
            </div>
            <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginTop: 2 }}>HTG per USDC</div>
            <div className="flex items-center gap-1.5 mt-1.5">
              <div className="rounded-full" style={{ width: 6, height: 6, background: "hsl(var(--theo-cyan))", animation: "pulse 2s infinite" }} />
              <span style={{ fontSize: 11, color: "hsl(var(--theo-cyan))", fontWeight: 600 }}>Live · updates every 5s</span>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
