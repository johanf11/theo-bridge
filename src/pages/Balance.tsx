import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { z } from "zod";
import { fetchHorizonUsdcBalance } from "@/lib/balance";
import { useCustomerBalance } from "@/hooks/useCustomerBalance";
import { usePermissions } from "@/hooks/usePermissions";
import { TrendingUp, Zap, X, Loader2, ArrowDownToLine, ArrowUpFromLine, Info } from "lucide-react";

type Wallet = {
  id: string;
  label: string | null;
  stellar_address: string;
  usdc_balance: number;
  wallet_type: "TREASURY" | "CUSTOMER";
};

type BlendPosition = {
  walletId: string;
  walletLabel: string;
  deposited: number;
  accrued: number;
  depositedAt: Date;
};

const BLEND_APY = 0.092; // 9.2% — update when pulling live from Blend oracle
const dailyYield = (principal: number) => principal * BLEND_APY / 365;
const monthlyYield = (principal: number) => principal * BLEND_APY / 12;
const annualYield = (principal: number) => principal * BLEND_APY;

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const labelSchema = z.string().trim().min(1, "Nickname is required").max(60);
const shortAddr = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

export default function Balance() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const { total, refresh: refreshTotal } = useCustomerBalance();
  const [loading, setLoading] = useState(true);

  // Add account modal
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [labelError, setLabelError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Inline rename
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  // Blend yield state
  const [blendPositions, setBlendPositions] = useState<Record<string, BlendPosition>>({});
  const [sweepWallet, setSweepWallet] = useState<Wallet | null>(null);
  const [sweepAmount, setSweepAmount] = useState("");
  const [sweeping, setSweeping] = useState(false);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);

  const totalEarning = useMemo(() =>
    Object.values(blendPositions).reduce((s, p) => s + p.deposited + p.accrued, 0), [blendPositions]);
  const totalAccruedToday = useMemo(() =>
    Object.values(blendPositions).reduce((s, p) => s + dailyYield(p.deposited), 0), [blendPositions]);
  const totalAccruedMonth = useMemo(() =>
    Object.values(blendPositions).reduce((s, p) => s + monthlyYield(p.deposited), 0), [blendPositions]);
  const hasPositions = Object.keys(blendPositions).length > 0;

  const sweepAmountNum = parseFloat(sweepAmount) || 0;
  const sweepWalletBalance = sweepWallet ? (balances[sweepWallet.id] ?? 0) : 0;
  const sweepValid = sweepAmountNum > 0 && sweepAmountNum <= sweepWalletBalance;

  const startEdit = (w: Wallet) => {
    setEditingId(w.id);
    setEditingValue(w.label ?? "");
  };

  const saveEdit = async (id: string) => {
    const parsed = labelSchema.safeParse(editingValue);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    const newLabel = parsed.data;
    setWallets((prev) => prev.map((w) => (w.id === id ? { ...w, label: newLabel } : w)));
    setEditingId(null);
    const { error } = await supabase.from("wallets").update({ label: newLabel }).eq("id", id);
    if (error) { toast.error(error.message); loadWallets(); }
  };

  const loadWallets = async () => {
    setLoading(true);
    const { data: c } = await supabase.from("customers").select("id, stellar_wallet_address").maybeSingle();
    if (!c) { setLoading(false); return; }

    let { data: w } = await supabase
      .from("wallets")
      .select("id, label, stellar_address, usdc_balance, wallet_type")
      .eq("customer_id", c.id)
      .order("created_at", { ascending: true });

    if ((!w || w.length === 0) && c.stellar_wallet_address) {
      const { data: inserted } = await supabase
        .from("wallets")
        .insert({ customer_id: c.id, label: "Primary — Operations", stellar_address: c.stellar_wallet_address, wallet_type: "CUSTOMER" })
        .select("id, label, stellar_address, usdc_balance, wallet_type");
      w = inserted ?? [];
    }

    const ws = (w ?? []) as Wallet[];
    setWallets(ws);
    const entries = await Promise.all(ws.map(async (x) => [x.id, await fetchHorizonUsdcBalance(x.stellar_address)] as const));
    setBalances(Object.fromEntries(entries));
    refreshTotal();
    setLoading(false);
  };

  useEffect(() => { loadWallets(); }, []);

  const handleCreateAccount = async () => {
    const parsed = labelSchema.safeParse(label);
    if (!parsed.success) { setLabelError(parsed.error.issues[0].message); return; }
    setLabelError(null);
    setCreating(true);
    const { data, error } = await supabase.functions.invoke("create-wallet", { body: { label: parsed.data } });
    setCreating(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Account created · ${(data as any)?.public_key?.slice(0, 12)}…`);
    setOpen(false);
    setLabel("");
    loadWallets();
  };

  const handleSweep = async () => {
    if (!sweepWallet || !sweepValid) return;
    setSweeping(true);
    // Stub: will call `sweep-to-blend` edge function once contract integration is wired
    await new Promise((r) => setTimeout(r, 1400));
    setBlendPositions((prev) => {
      const existing = prev[sweepWallet.id];
      return {
        ...prev,
        [sweepWallet.id]: {
          walletId: sweepWallet.id,
          walletLabel: sweepWallet.label ?? "Wallet",
          deposited: (existing?.deposited ?? 0) + sweepAmountNum,
          accrued: existing?.accrued ?? 0,
          depositedAt: existing?.depositedAt ?? new Date(),
        },
      };
    });
    // Simulate balance reduction
    setBalances((prev) => ({ ...prev, [sweepWallet.id]: (prev[sweepWallet.id] ?? 0) - sweepAmountNum }));
    setSweeping(false);
    setSweepWallet(null);
    setSweepAmount("");
    toast.success(`${fmt(sweepAmountNum)} USDC swept to Blend — earning at ${(BLEND_APY * 100).toFixed(1)}% APY`);
  };

  const handleWithdraw = async (walletId: string) => {
    const pos = blendPositions[walletId];
    if (!pos) return;
    setWithdrawingId(walletId);
    await new Promise((r) => setTimeout(r, 1200));
    const returned = pos.deposited + pos.accrued;
    setBalances((prev) => ({ ...prev, [walletId]: (prev[walletId] ?? 0) + returned }));
    setBlendPositions((prev) => { const n = { ...prev }; delete n[walletId]; return n; });
    setWithdrawingId(null);
    toast.success(`${fmt(returned)} USDC returned from Blend (incl. ${fmt(pos.accrued)} yield)`);
  };

  const walletColors = ["hsl(var(--theo-blue))", "#1A2966", "#0F1D54"];

  return (
    <AppLayout>
      {/* Header */}
      <div className="flex items-start justify-between mb-1">
        <div>
          <div className="font-extrabold" style={{ fontSize: 22, color: "hsl(var(--theo-blue))", letterSpacing: "-0.02em" }}>
            Balance
          </div>
          <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))", marginTop: 2 }}>
            Multi-wallet overview with Blend yield.
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate("/convert")}
            style={{
              background: "transparent", border: "1.5px solid hsl(var(--theo-blue))",
              color: "hsl(var(--theo-blue))", borderRadius: 7, padding: "6px 12px",
              fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            + Fund wallet
          </button>
          {can("accounts_manage") && (
            <button
              onClick={() => setOpen(true)}
              style={{
                background: "hsl(var(--theo-blue))", border: "none",
                color: "#fff", borderRadius: 7, padding: "6px 12px",
                fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              + Add account
            </button>
          )}
        </div>
      </div>
      <div className="mb-5" style={{ width: 28, height: 3, background: "hsl(var(--theo-gold))", borderRadius: 2, marginTop: 8 }} />

      {/* Total balance hero */}
      <div className="flex items-center justify-between mb-3" style={{ background: "hsl(var(--theo-blue))", borderRadius: 14, padding: "24px 28px" }}>
        <div>
          <div className="font-bold uppercase mb-2" style={{ fontSize: 10, letterSpacing: "0.14em", color: "hsl(var(--theo-gold))" }}>
            Total balance across all wallets
          </div>
          <div className="font-extrabold leading-none" style={{ fontSize: 40, letterSpacing: "-2px", color: "#fff" }}>
            ${fmt(total + totalEarning)}
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.50)", marginTop: 4 }}>
            USDC · Live · 1:1 verified
            {hasPositions && <span style={{ color: "rgba(255,255,255,0.4)", marginLeft: 8 }}>· incl. {fmt(totalEarning)} earning in Blend</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="rounded-full" style={{ width: 6, height: 6, background: "hsl(var(--theo-cyan))", animation: "pulse 2s infinite" }} />
          <span className="font-semibold" style={{ fontSize: 12, color: "hsl(var(--theo-cyan))" }}>Live · 1:1 verified</span>
        </div>
      </div>

      {/* ── Blend yield panel ── */}
      {hasPositions ? (
        <div className="rounded-2xl mb-4 overflow-hidden" style={{ border: "1.5px solid #86EFAC", background: "#F0FDF4" }}>
          {/* Header row */}
          <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: "1px solid #BBF7D0" }}>
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center rounded-lg" style={{ width: 28, height: 28, background: "#1A7F37" }}>
                <TrendingUp size={14} color="#fff" />
              </div>
              <span className="font-bold uppercase" style={{ fontSize: 11, letterSpacing: "0.14em", color: "#15803D" }}>
                Blend yield
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold rounded-full" style={{ fontSize: 12, background: "#1A7F37", color: "#fff", padding: "3px 10px" }}>
                {(BLEND_APY * 100).toFixed(1)}% APY
              </span>
              <a
                href="https://blend.capital"
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 11, color: "#15803D", fontWeight: 600, textDecoration: "none", opacity: 0.7 }}
              >
                Powered by Blend ↗
              </a>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 divide-x" style={{ borderBottom: "1px solid #BBF7D0", divideColor: "#BBF7D0" }}>
            {[
              { label: "Earning", value: `$${fmt(totalEarning)}`, sub: "deposited in Blend" },
              { label: "Accrued today", value: `+$${fmt(totalAccruedToday)}`, sub: "at current APY" },
              { label: "Est. this month", value: `+$${fmt(totalAccruedMonth)}`, sub: "projected yield" },
            ].map((s) => (
              <div key={s.label} className="px-5 py-4">
                <div className="font-bold uppercase mb-1" style={{ fontSize: 10, letterSpacing: "0.12em", color: "#15803D", opacity: 0.7 }}>
                  {s.label}
                </div>
                <div className="font-extrabold" style={{ fontSize: 22, color: "#14532D", letterSpacing: "-0.02em" }}>
                  {s.value}
                </div>
                <div style={{ fontSize: 11, color: "#166534", opacity: 0.65, marginTop: 2 }}>{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Position rows */}
          <div className="px-5 py-3 space-y-2">
            {Object.values(blendPositions).map((pos) => (
              <div key={pos.walletId} className="flex items-center justify-between gap-4 rounded-xl px-4 py-3" style={{ background: "#DCFCE7", border: "1px solid #BBF7D0" }}>
                <div>
                  <div className="font-bold" style={{ fontSize: 13, color: "#14532D" }}>{pos.walletLabel}</div>
                  <div style={{ fontSize: 11, color: "#166534", marginTop: 1 }}>
                    ${fmt(pos.deposited)} deposited · +${fmt(pos.accrued)} yield · ${fmt(dailyYield(pos.deposited))}/day
                  </div>
                </div>
                <button
                  onClick={() => handleWithdraw(pos.walletId)}
                  disabled={withdrawingId === pos.walletId}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    background: "#fff", border: "1.5px solid #86EFAC",
                    color: "#15803D", borderRadius: 7, padding: "6px 12px",
                    fontSize: 12, fontWeight: 700, cursor: withdrawingId === pos.walletId ? "wait" : "pointer",
                    fontFamily: "inherit", whiteSpace: "nowrap",
                  }}
                >
                  {withdrawingId === pos.walletId
                    ? <><Loader2 size={11} className="animate-spin" /> Withdrawing…</>
                    : <><ArrowUpFromLine size={11} /> Withdraw</>}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* Empty Blend CTA */
        <div
          className="rounded-2xl mb-4 flex items-center justify-between gap-4 px-5 py-4"
          style={{ border: "1.5px dashed #86EFAC", background: "#F0FDF4" }}
        >
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center rounded-xl" style={{ width: 40, height: 40, background: "#1A7F37" }}>
              <Zap size={18} color="#fff" />
            </div>
            <div>
              <div className="font-bold" style={{ fontSize: 14, color: "#14532D" }}>
                Earn {(BLEND_APY * 100).toFixed(1)}% APY on idle USDC
              </div>
              <div style={{ fontSize: 12, color: "#166534", marginTop: 2 }}>
                Sweep funds into Blend's USDC liquidity pool — withdraw anytime.
              </div>
            </div>
          </div>
          <button
            onClick={() => wallets.length > 0 && setSweepWallet(wallets[0])}
            style={{
              background: "#1A7F37", border: "none", color: "#fff",
              borderRadius: 8, padding: "8px 16px", fontSize: 12,
              fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
            }}
          >
            Sweep to Blend →
          </button>
        </div>
      )}

      {/* Wallet cards */}
      {wallets.length > 0 && (
        <>
          <div className="font-bold uppercase mb-2.5" style={{ fontSize: 11, letterSpacing: "0.14em", color: "hsl(var(--theo-mid))" }}>
            Wallets
          </div>
          <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: `repeat(${Math.min(wallets.length, 3)}, 1fr)` }}>
            {wallets.map((w, i) => {
              const pos = blendPositions[w.id];
              const bal = balances[w.id] ?? 0;
              return (
                <div
                  key={w.id}
                  className="relative overflow-hidden"
                  style={{ borderRadius: 14, padding: 20, background: walletColors[i % walletColors.length], minHeight: 130 }}
                >
                  <div className="absolute pointer-events-none" style={{ top: -30, right: -30, width: 120, height: 120, borderRadius: "50%", background: "rgba(255,255,255,0.07)" }} />

                  {/* Label */}
                  <div className="font-bold uppercase mb-2.5" style={{ fontSize: 10, letterSpacing: "0.12em", color: "rgba(255,255,255,0.50)" }}>
                    {editingId === w.id ? (
                      <input
                        autoFocus value={editingValue} maxLength={60}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onBlur={() => saveEdit(w.id)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveEdit(w.id); if (e.key === "Escape") setEditingId(null); }}
                        style={{
                          background: "rgba(255,255,255,0.12)", color: "#fff", border: "none", outline: "none",
                          padding: "2px 6px", borderRadius: 4, fontSize: 10, letterSpacing: "0.12em",
                          textTransform: "uppercase", fontWeight: 700, fontFamily: "inherit", width: "100%",
                        }}
                      />
                    ) : (
                      <span
                        onClick={() => can("accounts_manage") && startEdit(w)}
                        title={can("accounts_manage") ? "Click to rename" : undefined}
                        style={{ cursor: can("accounts_manage") ? "pointer" : "default" }}
                      >
                        {w.label ?? `Wallet ${i + 1}`}
                      </span>
                    )}
                  </div>

                  {/* Balance */}
                  <div className="font-extrabold leading-none" style={{ fontSize: 28, letterSpacing: "-1.5px", color: "#fff" }}>
                    ${fmt(bal)}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.50)", marginTop: 4 }}>USDC available</div>

                  {/* Blend position badge */}
                  {pos && (
                    <div className="flex items-center gap-1.5 mt-2" style={{ fontSize: 11, color: "#4ADE80", fontWeight: 600 }}>
                      <TrendingUp size={11} />
                      ${fmt(pos.deposited + pos.accrued)} earning · +${fmt(dailyYield(pos.deposited))}/day
                    </div>
                  )}

                  {/* Footer row */}
                  <div className="flex items-center justify-between mt-3">
                    <div className="flex items-center gap-1.5">
                      <div className="rounded-full" style={{ width: 6, height: 6, background: "hsl(var(--theo-cyan))" }} />
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.50)", fontWeight: 500 }}>Active · 1:1 verified</span>
                    </div>
                    <button
                      onClick={() => setSweepWallet(w)}
                      style={{
                        display: "flex", alignItems: "center", gap: 4,
                        background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)",
                        color: "#fff", borderRadius: 6, padding: "4px 9px",
                        fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                      }}
                    >
                      <ArrowDownToLine size={10} />
                      {pos ? "Add more" : "Earn"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Account ledger */}
      <div className="font-bold uppercase mb-2.5" style={{ fontSize: 11, letterSpacing: "0.14em", color: "hsl(var(--theo-mid))" }}>
        Account ledger
      </div>
      <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
        {wallets.length === 0 && !loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No wallets yet. Click "+ Add account" to create one.</div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ background: "hsl(var(--theo-cream))" }}>
                {["Account", "Account ID", "Available", "Earning (Blend)", "Status"].map((h) => (
                  <th key={h} className="text-left px-5 py-2.5 border-b border-border" style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.10em", color: "hsl(var(--theo-mid))" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {wallets.map((w, i) => (
                <LedgerRow
                  key={w.id} w={w} idx={i}
                  balance={balances[w.id] ?? 0}
                  blendPosition={blendPositions[w.id] ?? null}
                  canViewKeys={can("balance_view_keys")}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Sweep to Blend modal ── */}
      {sweepWallet && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(15, 29, 84, 0.5)" }}
          onClick={() => !sweeping && setSweepWallet(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 460, maxWidth: "92vw", borderRadius: 18, padding: 28, background: "#fff", boxShadow: "0 24px 64px rgba(0,0,0,0.22)" }}
          >
            {/* Modal header */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex items-center justify-center rounded-lg" style={{ width: 26, height: 26, background: "#1A7F37" }}>
                    <TrendingUp size={13} color="#fff" />
                  </div>
                  <span className="font-extrabold" style={{ fontSize: 18, color: "hsl(var(--theo-blue))", letterSpacing: "-0.02em" }}>
                    Sweep to Blend
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>
                  {sweepWallet.label ?? "Wallet"} · ${fmt(sweepWalletBalance)} USDC available
                </div>
              </div>
              <button
                onClick={() => setSweepWallet(null)}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: "hsl(var(--theo-mid))", padding: 4 }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Amount input */}
            <div className="mb-4">
              <div className="font-bold uppercase mb-1.5" style={{ fontSize: 11, letterSpacing: "0.14em", color: "hsl(var(--theo-mid))" }}>
                Amount to deposit
              </div>
              <div className="flex items-center gap-2 rounded-xl" style={{ border: "1.5px solid hsl(var(--border))", padding: "10px 14px" }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: "hsl(var(--theo-mid))", marginRight: 2 }}>$</span>
                <input
                  type="number"
                  value={sweepAmount}
                  onChange={(e) => setSweepAmount(e.target.value)}
                  placeholder="0.00"
                  min={0}
                  max={sweepWalletBalance}
                  style={{
                    flex: 1, border: "none", outline: "none", fontSize: 22,
                    fontWeight: 800, color: "hsl(var(--theo-ink))", fontFamily: "inherit",
                    letterSpacing: "-0.02em", background: "transparent",
                  }}
                />
                <span style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-mid))" }}>USDC</span>
                <button
                  onClick={() => setSweepAmount(String(sweepWalletBalance))}
                  style={{
                    background: "hsl(var(--theo-cream))", border: "1px solid hsl(var(--border))",
                    color: "hsl(var(--theo-blue))", borderRadius: 6, padding: "3px 8px",
                    fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  Max
                </button>
              </div>
            </div>

            {/* APY preview */}
            <div className="rounded-xl mb-5" style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", padding: "14px 16px" }}>
              <div className="flex items-center gap-1.5 mb-3">
                <span className="font-bold rounded-full" style={{ fontSize: 12, background: "#1A7F37", color: "#fff", padding: "2px 8px" }}>
                  {(BLEND_APY * 100).toFixed(1)}% APY
                </span>
                <span style={{ fontSize: 11, color: "#15803D" }}>via Blend USDC pool on Stellar</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Per day", value: sweepAmountNum > 0 ? `+$${fmt(dailyYield(sweepAmountNum))}` : "—" },
                  { label: "Per month", value: sweepAmountNum > 0 ? `+$${fmt(monthlyYield(sweepAmountNum))}` : "—" },
                  { label: "Per year", value: sweepAmountNum > 0 ? `+$${fmt(annualYield(sweepAmountNum))}` : "—" },
                ].map((s) => (
                  <div key={s.label}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "#15803D", opacity: 0.65, marginBottom: 2 }}>
                      {s.label}
                    </div>
                    <div className="font-extrabold" style={{ fontSize: 16, color: "#14532D", letterSpacing: "-0.02em" }}>
                      {s.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Risk notice */}
            <div className="flex items-start gap-2 mb-5" style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>
              <Info size={13} style={{ marginTop: 1, flexShrink: 0 }} />
              <span>Blend is a decentralised lending protocol. Funds earn yield from borrowers and can be withdrawn subject to pool utilisation. Smart contract risk applies.</span>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={() => { setSweepWallet(null); setSweepAmount(""); }}
                disabled={sweeping}
                style={{
                  flex: 1, background: "transparent", border: "1.5px solid hsl(var(--border))",
                  color: "hsl(var(--theo-ink))", borderRadius: 10, padding: "10px",
                  fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSweep}
                disabled={!sweepValid || sweeping}
                style={{
                  flex: 2, background: sweepValid ? "#1A7F37" : "#D1D5DB",
                  border: "none", color: "#fff", borderRadius: 10, padding: "10px",
                  fontSize: 13, fontWeight: 700, cursor: sweepValid && !sweeping ? "pointer" : "not-allowed",
                  fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  transition: "background 150ms",
                }}
              >
                {sweeping
                  ? <><Loader2 size={13} className="animate-spin" /> Sweeping…</>
                  : <><ArrowDownToLine size={13} /> Sweep {sweepAmountNum > 0 ? `$${fmt(sweepAmountNum)}` : ""} to Blend</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add account modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(15, 29, 84, 0.45)" }}
          onClick={() => !creating && setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 440, maxWidth: "92vw", borderRadius: 16, padding: 28, background: "#fff", boxShadow: "0 20px 60px rgba(0,0,0,0.18)" }}
          >
            <div className="font-extrabold mb-1" style={{ fontSize: 20, color: "hsl(var(--theo-blue))", letterSpacing: "-0.02em" }}>
              Create new account
            </div>
            <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))", marginBottom: 18 }}>
              Creates a new account ready to receive USDC.
            </div>
            <label className="block mb-5">
              <span className="font-bold uppercase block mb-1.5" style={{ fontSize: 11, letterSpacing: "0.14em", color: "hsl(var(--theo-mid))" }}>
                Wallet nickname
              </span>
              <input
                value={label} maxLength={60} disabled={creating}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Payroll, Reserve, …"
                className="w-full border border-border rounded-lg outline-none"
                style={{ padding: "9px 12px", fontSize: 14, fontFamily: "inherit" }}
              />
              {labelError && <div style={{ color: "#C0392B", fontSize: 12, marginTop: 4 }}>{labelError}</div>}
            </label>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)} disabled={creating}
                style={{
                  background: "transparent", border: "1.5px solid hsl(var(--border))",
                  color: "hsl(var(--theo-ink))", borderRadius: 10, padding: "8px 16px",
                  fontSize: 13, fontWeight: 600, cursor: creating ? "not-allowed" : "pointer", fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateAccount} disabled={creating}
                style={{
                  background: "hsl(var(--theo-blue))", border: "none", color: "#fff",
                  borderRadius: 10, padding: "8px 18px", fontSize: 13, fontWeight: 700,
                  cursor: creating ? "wait" : "pointer", fontFamily: "inherit", opacity: creating ? 0.7 : 1,
                }}
              >
                {creating ? "Creating…" : "Create account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}

function LedgerRow({
  w, idx, balance, blendPosition, canViewKeys,
}: {
  w: Wallet; idx: number; balance: number;
  blendPosition: BlendPosition | null;
  canViewKeys: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
      <td className="px-5 py-3" style={{ fontSize: 13, fontWeight: 600 }}>{w.label ?? `Account ${idx + 1}`}</td>
      <td className="px-5 py-3" style={{ fontFamily: "monospace", fontSize: 12 }}>
        {!canViewKeys ? (
          <span style={{ color: "hsl(var(--theo-mid))", fontSize: 12 }}>Hidden</span>
        ) : show ? (
          <span style={{ color: "hsl(var(--theo-ink))", wordBreak: "break-all" }}>{w.stellar_address}</span>
        ) : (
          <button
            onClick={() => setShow(true)}
            style={{ background: "transparent", border: "none", color: "hsl(var(--theo-cyan))", fontWeight: 600, fontSize: 12, cursor: "pointer", padding: 0, fontFamily: "inherit" }}
          >
            View ID
          </button>
        )}
      </td>
      <td className="px-5 py-3" style={{ fontSize: 13, fontWeight: 700 }}>
        ${balance.toLocaleString("en-US", { minimumFractionDigits: 2 })} USDC
      </td>
      <td className="px-5 py-3">
        {blendPosition ? (
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#15803D" }}>
              ${fmt(blendPosition.deposited + blendPosition.accrued)} USDC
            </div>
            <div style={{ fontSize: 11, color: "#15803D", opacity: 0.8 }}>
              +${fmt(dailyYield(blendPosition.deposited))}/day
            </div>
          </div>
        ) : (
          <span style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>—</span>
        )}
      </td>
      <td className="px-5 py-3">
        <span className="rounded-full font-bold" style={{ background: "#EFFBF3", color: "#1A7F37", fontSize: 11, padding: "3px 8px" }}>
          Active
        </span>
      </td>
    </tr>
  );
}
