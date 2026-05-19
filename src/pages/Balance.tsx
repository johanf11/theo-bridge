import { useEffect, useState, useMemo, useRef, type ReactNode, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { z } from "zod";
import { fetchHorizonBalances } from "@/lib/balance";
import { useCustomerBalance } from "@/hooks/useCustomerBalance";
import { useBlendPositions } from "@/hooks/useBlendPositions";
import { usePermissions } from "@/hooks/usePermissions";
import { useRoles } from "@/lib/auth";
import { TrendingUp, Zap, X, Loader2, ArrowDownToLine, ArrowUpFromLine, Info, ArrowLeftRight } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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
};

// Default APY shown until live values load from the blend-positions edge function.
const DEFAULT_NET_APY = 0.07;
const DEFAULT_GROSS_APY = 0.09;
const DEFAULT_FEE_BPS = 200;

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt4 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

const labelSchema = z.string().trim().min(1, "Nickname is required").max(60);
const shortAddr = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

export default function Balance() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const { isAdmin } = useRoles();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [htgcBalances, setHtgcBalances] = useState<Record<string, number>>({});
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

  // Yield — live from edge function (now synthetic gross/net/fee split)
  const {
    positions: livePositions,
    grossApy: liveGrossApy,
    netApy: liveNetApy,
    feeBps: liveFeeBps,
    refresh: refreshBlend,
  } = useBlendPositions();
  const NET_APY = liveNetApy || DEFAULT_NET_APY;
  const GROSS_APY = liveGrossApy || DEFAULT_GROSS_APY;
  const FEE_BPS = liveFeeBps || DEFAULT_FEE_BPS;
  const dailyYield = (principal: number) => principal * NET_APY / 365;
  const monthlyYield = (principal: number) => principal * NET_APY / 12;
  const annualYield = (principal: number) => principal * NET_APY;

  const blendPositions: Record<string, BlendPosition> = useMemo(() => {
    const map: Record<string, BlendPosition> = {};
    for (const p of livePositions) {
      map[p.walletId] = {
        walletId: p.walletId,
        walletLabel: p.walletLabel,
        deposited: p.deposited,
        accrued: p.accrued,
      };
    }
    return map;
  }, [livePositions]);

  const [sweepWallet, setSweepWallet] = useState<Wallet | null>(null);
  const [sweepAmount, setSweepAmount] = useState("");
  const [sweeping, setSweeping] = useState(false);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Wallet | null>(null);
  const [showBlendTooltip, setShowBlendTooltip] = useState(false);

  // Blend withdraw modal
  const [blendWithdrawPos, setBlendWithdrawPos] = useState<BlendPosition | null>(null);
  const [blendWithdrawAmount, setBlendWithdrawAmount] = useState("");
  const [blendWithdrawing, setBlendWithdrawing] = useState(false);

  // Move funds (between own wallets) modal
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveAsset, setMoveAsset] = useState<"USDC" | "HTGC">("USDC");
  const [moveSourceId, setMoveSourceId] = useState<string>("");
  const [moveDestId, setMoveDestId] = useState<string>("");
  const [moveAmount, setMoveAmount] = useState("");
  const [moveMemo, setMoveMemo] = useState("");
  const [moving, setMoving] = useState(false);

  const totalEarning = useMemo(() =>
    Object.values(blendPositions).reduce((s, p) => s + p.deposited + p.accrued, 0), [blendPositions]);
  const totalAccruedToday = Object.values(blendPositions).reduce((s, p) => s + dailyYield(p.deposited), 0);
  const totalAccruedMonth = Object.values(blendPositions).reduce((s, p) => s + monthlyYield(p.deposited), 0);
  const hasPositions = Object.keys(blendPositions).length > 0;

  const sweepAmountNum = parseFloat(sweepAmount) || 0;
  const sweepWalletBalance = sweepWallet ? (balances[sweepWallet.id] ?? 0) : 0;
  const sweepCap = sweepWalletBalance;
  const sweepValid = sweepAmountNum > 0 && sweepAmountNum <= sweepCap;

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
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setLoading(false); return; }
    const { data: c } = await supabase.from("customers").select("id, stellar_wallet_address").eq("user_id", auth.user.id).maybeSingle();
    if (!c) { setLoading(false); return; }

    let { data: w } = await supabase
      .from("wallets")
      .select("id, label, stellar_address, usdc_balance, wallet_type")
      .eq("customer_id", c.id)
      .order("display_order", { ascending: true, nullsFirst: false })
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
    const entries = await Promise.all(ws.map(async (x) => {
      const bals = await fetchHorizonBalances(x.stellar_address);
      return { id: x.id, usdc: bals.usdc, htgc: bals.htgc };
    }));
    setBalances(Object.fromEntries(entries.map((e) => [e.id, e.usdc])));
    setHtgcBalances(Object.fromEntries(entries.map((e) => [e.id, e.htgc])));
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

  const openSweepModal = (wallet: Wallet) => {
    setSweepWallet(wallet);
    setSweepAmount("");
  };

  const closeSweepModal = () => {
    setSweepWallet(null);
    setSweepAmount("");
  };

  const handleSweep = async () => {
    if (!sweepWallet) return;
    const amountToSweep = Math.min(sweepAmountNum, sweepCap);
    if (amountToSweep <= 0) return;
    setSweeping(true);
    const { data, error } = await supabase.functions.invoke("blend-sweep", {
      body: { sourceWalletId: sweepWallet.id, amount: amountToSweep },
    });
    setSweeping(false);
    if (error || (data as { error?: string })?.error) {
      const msg = (data as { error?: string })?.error ?? error?.message ?? "Sweep failed";
      toast.error(msg);
      return;
    }
    const hash = (data as { hash?: string })?.hash ?? "";
    toast.success(`Swept ${fmt(amountToSweep)} USDC to Blend · ${hash.slice(0, 8)}…`);
    closeSweepModal();
    await Promise.all([loadWallets(), refreshBlend(), refreshTotal()]);
  };

  const openBlendWithdraw = (walletId: string) => {
    const pos = blendPositions[walletId];
    if (!pos) return;
    const total = pos.deposited + pos.accrued;
    setBlendWithdrawPos(pos);
    setBlendWithdrawAmount(total.toFixed(2));
  };

  const closeBlendWithdraw = () => {
    if (blendWithdrawing) return;
    setBlendWithdrawPos(null);
    setBlendWithdrawAmount("");
  };

  const handleBlendWithdraw = async () => {
    if (!blendWithdrawPos) return;
    const amount = parseFloat(blendWithdrawAmount);
    if (!amount || amount <= 0) return;
    setBlendWithdrawing(true);
    const { data, error } = await supabase.functions.invoke("blend-withdraw", {
      body: { walletId: blendWithdrawPos.walletId, amount },
    });
    setBlendWithdrawing(false);
    if (error || (data as { error?: string })?.error) {
      toast.error((data as { error?: string })?.error ?? error?.message ?? "Withdraw failed");
      return;
    }
    const hash = (data as { hash?: string; withdrawn?: number; accrued?: number })?.hash ?? "";
    const withdrawn = (data as { withdrawn?: number })?.withdrawn ?? amount;
    const accrued = (data as { accrued?: number })?.accrued ?? 0;
    toast.success(`Withdrawn $${fmt(withdrawn)} USDC from Blend · ${hash.slice(0, 8)}…`);
    // Generate receipt
    const { generateReceipt } = await import("@/lib/receipt");
    generateReceipt({
      kind: "yield",
      referenceNumber: `blend-withdraw`,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      usdcAmount: withdrawn,
      accruedAmount: accrued,
      principalBalance: blendWithdrawPos.deposited,
      stellarTxHash: hash,
      status: "COMPLETED",
      walletLabel: blendWithdrawPos.walletLabel,
      memo: "blend-withdraw",
    });
    closeBlendWithdraw();
    await Promise.all([loadWallets(), refreshBlend(), refreshTotal()]);
  };

  const handleRectifyHtgc = async (walletId: string) => {
    const { data, error } = await supabase.functions.invoke("admin-rectify-htgc", { body: { walletId } });
    if (error || (data as { error?: string })?.error) {
      toast.error((data as { error?: string })?.error ?? error?.message ?? "Rectify failed");
      return;
    }
    const steps = (data as { steps?: string[] })?.steps ?? [];
    toast.success(steps.length ? steps[steps.length - 1].slice(0, 80) : "HTGC rectified");
    await loadWallets();
  };

  const openMoveModal = (sourceId?: string) => {
    const src = sourceId && wallets.find((w) => w.id === sourceId) ? sourceId : (wallets[0]?.id ?? "");
    const dst = wallets.find((w) => w.id !== src)?.id ?? "";
    setMoveAsset("USDC");
    setMoveSourceId(src);
    setMoveDestId(dst);
    setMoveAmount("");
    setMoveMemo("");
    setMoveOpen(true);
  };

  const handleDeleteWallet = (wallet: Wallet) => {
    setDeleteTarget(wallet);
  };

  const confirmDeleteWallet = async () => {
    if (!deleteTarget) return;
    const walletId = deleteTarget.id;
    setDeletingId(walletId);
    const { error } = await supabase.from("wallets").delete().eq("id", walletId);
    setDeletingId(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Wallet deleted.");
    setDeleteTarget(null);
    loadWallets();
  };

  // Drag-and-drop reordering (hold to pick up)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = wallets.findIndex((w) => w.id === active.id);
    const newIndex = wallets.findIndex((w) => w.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(wallets, oldIndex, newIndex);
    setWallets(next);
    // Persist new order
    const updates = next.map((w, idx) =>
      supabase.from("wallets").update({ display_order: idx + 1 }).eq("id", w.id)
    );
    const results = await Promise.all(updates);
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      toast.error("Could not save new order");
      loadWallets();
    }
  };

  const moveAmountNum = parseFloat(moveAmount) || 0;
  const moveAssetBalances = moveAsset === "HTGC" ? htgcBalances : balances;
  const moveSourceBalance = moveSourceId ? (moveAssetBalances[moveSourceId] ?? 0) : 0;
  const moveSourceLabel = wallets.find((w) => w.id === moveSourceId)?.label ?? "Source";
  const moveDestLabel = wallets.find((w) => w.id === moveDestId)?.label ?? "Destination";
  const moveAssetLabel = moveAsset === "HTGC" ? "HTG-C" : "USDC";
  const moveAmountPrefix = moveAsset === "HTGC" ? "" : "$";
  const moveAmountSuffix = moveAsset === "HTGC" ? " HTG-C" : "";
  const fmtMoveAmount = (n: number) => `${moveAmountPrefix}${fmt(n)}${moveAmountSuffix}`;
  const moveValid =
    moveSourceId && moveDestId && moveSourceId !== moveDestId &&
    moveAmountNum > 0 && moveAmountNum <= moveSourceBalance;

  const handleMove = async () => {
    if (!moveValid) return;
    setMoving(true);
    const { data, error } = await supabase.functions.invoke("move-funds", {
      body: {
        sourceWalletId: moveSourceId,
        destinationWalletId: moveDestId,
        amount: moveAmountNum,
        asset: moveAsset,
        memo: moveMemo.trim() || undefined,
      },
    });
    setMoving(false);
    if (error || (data as { error?: string })?.error) {
      const msg = (data as { error?: string })?.error ?? error?.message ?? "Transfer failed";
      toast.error(msg);
      return;
    }
    const hash = (data as { hash?: string })?.hash ?? "";
    toast.success(`Moved ${fmtMoveAmount(moveAmountNum)} from ${moveSourceLabel} to ${moveDestLabel} · ${hash.slice(0, 8)}…`);
    setMoveOpen(false);
    await Promise.all([loadWallets(), refreshTotal()]);
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
            Multi-wallet overview with yield.
          </div>
        </div>
        <div className="flex gap-2">
          {can("payout_send") && wallets.length >= 2 && (
            <button
              onClick={() => openMoveModal()}
              style={{
                background: "transparent", border: "1.5px solid hsl(var(--theo-blue))",
                color: "hsl(var(--theo-blue))", borderRadius: 7, padding: "6px 12px",
                fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}
            >
              <ArrowLeftRight size={12} /> Move funds
            </button>
          )}
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

      {/* ── Yield panel ── */}
      {hasPositions ? (
        <div className="rounded-2xl mb-4 overflow-hidden" style={{ border: "1.5px solid #86EFAC", background: "#F0FDF4" }}>
          {/* Header row */}
          <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: "1px solid #BBF7D0" }}>
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center rounded-lg" style={{ width: 28, height: 28, background: "#1A7F37" }}>
                <TrendingUp size={14} color="#fff" />
              </div>
              <div className="flex flex-col" style={{ lineHeight: 1.1 }}>
                <span className="font-bold uppercase" style={{ fontSize: 11, letterSpacing: "0.14em", color: "#15803D" }}>
                  Yield
                </span>
                <a
                  href="https://blend.capital"
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 10, color: "#15803D", fontWeight: 600, textDecoration: "none", opacity: 0.7, marginTop: 3 }}
                >
                  Powered by Blend ↗
                </a>
              </div>
            </div>
            <div className="flex flex-col items-end" style={{ lineHeight: 1.1 }}>
              <span className="font-bold rounded-full" style={{ fontSize: 12, background: "#1A7F37", color: "#fff", padding: "3px 10px" }}>
                {(NET_APY * 100).toFixed(2)}% net APY
              </span>
              <span style={{ fontSize: 10, color: "#15803D", opacity: 0.7, marginTop: 3, fontWeight: 600 }}>
                {(GROSS_APY * 100).toFixed(2)}% gross · {(FEE_BPS / 100).toFixed(2)}% platform fee
              </span>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 divide-x divide-[#BBF7D0]" style={{ borderBottom: "1px solid #BBF7D0" }}>
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
                  onClick={() => openBlendWithdraw(pos.walletId)}
                  disabled={blendWithdrawing && blendWithdrawPos?.walletId === pos.walletId}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    background: "#fff", border: "1.5px solid #86EFAC",
                    color: "#15803D", borderRadius: 7, padding: "6px 12px",
                    fontSize: 12, fontWeight: 700, cursor: blendWithdrawing && blendWithdrawPos?.walletId === pos.walletId ? "wait" : "pointer",
                    fontFamily: "inherit", whiteSpace: "nowrap",
                  }}
                >
                  {blendWithdrawing && blendWithdrawPos?.walletId === pos.walletId
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
              <div className="font-bold flex items-center gap-1.5" style={{ fontSize: 14, color: "#14532D" }}>
                Earn {(NET_APY * 100).toFixed(2)}% APY on idle USDC
                <span
                  style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
                  onMouseEnter={() => setShowBlendTooltip(true)}
                  onMouseLeave={() => setShowBlendTooltip(false)}
                >
                  <Info size={13} color="#166534" style={{ cursor: "pointer", opacity: 0.7 }} />
                  {showBlendTooltip && (
                    <div style={{
                      position: "absolute", bottom: "calc(100% + 6px)", left: "50%",
                      transform: "translateX(-50%)", background: "#14532D", color: "#fff",
                      borderRadius: 7, padding: "7px 10px", fontSize: 11, whiteSpace: "nowrap",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.18)", zIndex: 50, lineHeight: 1.5,
                    }}>
                      Powered by Blend Protocol on Stellar.
                      <br />
                      <a
                        href="https://blend.capital"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "#86EFAC", fontWeight: 700, textDecoration: "underline" }}
                      >
                        Learn more at blend.capital ↗
                      </a>
                      {/* tooltip arrow */}
                      <div style={{
                        position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)",
                        width: 0, height: 0,
                        borderLeft: "5px solid transparent", borderRight: "5px solid transparent",
                        borderTop: "5px solid #14532D",
                      }} />
                    </div>
                  )}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#166534", marginTop: 2 }}>
                Sweep funds into Blend's USDC liquidity pool — withdraw anytime.
              </div>
            </div>
          </div>
          <button
            onClick={() => wallets.length > 0 && openSweepModal(wallets[0])}
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
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={wallets.map((w) => w.id)} strategy={rectSortingStrategy}>
              <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: `repeat(${Math.min(wallets.length, 3)}, 1fr)` }}>
                {wallets.map((w, i) => {
                  const pos = blendPositions[w.id];
                  const bal = balances[w.id] ?? 0;
                  const htgc = htgcBalances[w.id] ?? 0;
                  const displayUsdcZero = Number(bal.toFixed(2)) === 0;
                  const displayHtgcZero = Math.round(htgc) === 0;
                  const canDeleteWallet = displayUsdcZero && displayHtgcZero && !pos;
                  return (
                    <SortableWalletCard
                      key={w.id}
                      id={w.id}
                      background={walletColors[i % walletColors.length]}
                    >
                  {canDeleteWallet && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteWallet(w); }}
                      onPointerDown={(e) => e.stopPropagation()}
                      disabled={deletingId === w.id}
                      title="Delete empty wallet"
                      style={{
                        position: "absolute", top: 10, right: 10, zIndex: 2,
                        background: "rgba(255,255,255,0.15)", border: "none",
                        color: "rgba(255,255,255,0.6)", borderRadius: "50%",
                        width: 22, height: 22, cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        padding: 0, fontFamily: "inherit",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,80,80,0.5)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.15)")}
                    >
                      <X size={12} />
                    </button>
                  )}
                  <div className="absolute pointer-events-none" style={{ top: -30, right: -30, width: 120, height: 120, borderRadius: "50%", background: "rgba(255,255,255,0.07)" }} />

                  {/* Label */}
                  <div className="font-bold uppercase mb-2.5" style={{ fontSize: 10, letterSpacing: "0.12em", color: "rgba(255,255,255,0.50)" }}>
                    {editingId === w.id ? (
                      <input
                        autoFocus value={editingValue} maxLength={60}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onBlur={() => saveEdit(w.id)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveEdit(w.id); if (e.key === "Escape") setEditingId(null); }}
                        onPointerDown={(e) => e.stopPropagation()}
                        style={{
                          background: "rgba(255,255,255,0.12)", color: "#fff", border: "none", outline: "none",
                          padding: "2px 6px", borderRadius: 4, fontSize: 10, letterSpacing: "0.12em",
                          textTransform: "uppercase", fontWeight: 700, fontFamily: "inherit", width: "100%",
                        }}
                      />
                    ) : (
                      <span
                        onClick={() => can("accounts_manage") && startEdit(w)}
                        title={can("accounts_manage") ? "Click to rename · hold to drag" : "Hold to drag"}
                        style={{ cursor: can("accounts_manage") ? "pointer" : "default" }}
                      >
                        {w.label ?? `Wallet ${i + 1}`}
                      </span>
                    )}
                  </div>

                  {/* Balance — USDC primary */}
                  <div className="font-extrabold leading-none" style={{ fontSize: 28, letterSpacing: "-1.5px", color: "#fff" }}>
                    ${fmt(bal)}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.50)", marginTop: 3 }}>USDC</div>

                  {/* HTG-C balance row */}
                  {!displayHtgcZero && (
                    <div className="flex items-center gap-1.5 mt-2.5 pt-2.5" style={{ borderTop: "1px solid rgba(255,255,255,0.12)" }}>
                      <span style={{ fontSize: 16, fontWeight: 800, color: "hsl(var(--theo-gold))", letterSpacing: "-0.5px" }}>
                        {Math.round(htgc).toLocaleString("en-US")}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "hsl(var(--theo-gold))", opacity: 0.85 }}>HTG-C</span>
                    </div>
                  )}

                  {/* Blend position badge — reserve a fixed-height row so all cards align */}
                  {pos ? (
                    <div className="flex items-center gap-1.5 mt-2" style={{ height: 16, fontSize: 11, color: "#4ADE80", fontWeight: 600 }}>
                      <TrendingUp size={11} />
                      ${fmt(pos.deposited + pos.accrued)} earning · +${fmt(dailyYield(pos.deposited))}/day
                    </div>
                  ) : (
                    <div className="mt-2" style={{ height: 16 }} aria-hidden />
                  )}

                  {/* Status row */}
                  <div className="flex items-center gap-1.5 mt-3">
                    <div className="rounded-full" style={{ width: 6, height: 6, background: "hsl(var(--theo-cyan))" }} />
                    <a
                      href={`https://stellar.expert/explorer/testnet/account/${w.stellar_address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onPointerDown={(e) => e.stopPropagation()}
                      style={{
                        fontSize: 11, color: "rgba(255,255,255,0.50)", fontWeight: 500,
                        textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 3,
                      }}
                      onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.85)")}
                      onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.50)")}
                    >
                      Active · 1:1 verified ↗
                    </a>
                  </div>

                  {/* Action buttons pinned to the bottom */}
                  <div className="flex items-center gap-1.5 mt-3 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.10)" }}>
                    {can("payout_send") && wallets.length >= 2 && (
                      <button
                        onClick={() => openMoveModal(w.id)}
                        onPointerDown={(e) => e.stopPropagation()}
                        title="Move funds to another account"
                        style={{
                          flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                          background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)",
                          color: "#fff", borderRadius: 6, padding: "5px 9px",
                          fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                        }}
                      >
                        <ArrowLeftRight size={10} />
                        Move
                      </button>
                    )}
                    <button
                      onClick={() => openSweepModal(w)}
                      onPointerDown={(e) => e.stopPropagation()}
                      style={{
                        flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                        background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)",
                        color: "#fff", borderRadius: 6, padding: "5px 9px",
                        fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                      }}
                    >
                      <ArrowDownToLine size={10} />
                      Earn
                    </button>
                  </div>
                    </SortableWalletCard>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
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
                {["Account", "Account ID", "USDC Available", "HTG-C AVAILABLE", "Yield Balance"].map((h) => (
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
                  htgcBalance={htgcBalances[w.id] ?? 0}
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
          onClick={() => !sweeping && closeSweepModal()}
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
                onClick={closeSweepModal}
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
                  type="text"
                  inputMode="decimal"
                  value={sweepAmount === "" ? "" : Number(sweepAmount).toLocaleString("en-US")}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/,/g, "");
                    if (raw === "") { setSweepAmount(""); return; }
                    if (!/^\d*\.?\d*$/.test(raw)) return;
                    const v = parseFloat(raw);
                    if (!isNaN(v) && v > sweepCap) { setSweepAmount(String(sweepCap)); return; }
                    setSweepAmount(raw);
                  }}
                  placeholder="0.00"
                  style={{
                    flex: 1, border: "none", outline: "none", fontSize: 22,
                    fontWeight: 800, color: "hsl(var(--theo-ink))", fontFamily: "inherit",
                    letterSpacing: "-0.02em", background: "transparent",
                  }}
                />
                <span style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-mid))" }}>USDC</span>
              </div>
            </div>

            {/* APY preview */}
            <div className="rounded-xl mb-5" style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", padding: "14px 16px" }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold rounded-full" style={{ fontSize: 12, background: "#1A7F37", color: "#fff", padding: "2px 8px" }}>
                    {(NET_APY * 100).toFixed(2)}% net APY
                  </span>
                  <span style={{ fontSize: 11, color: "#15803D" }}>paid to you</span>
                </div>
                <span style={{ fontSize: 10, color: "#15803D", opacity: 0.7, fontWeight: 600 }}>
                  Gross {(GROSS_APY * 100).toFixed(2)}% · Fee {(FEE_BPS / 100).toFixed(2)}%
                </span>
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
                onClick={closeSweepModal}
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

      {/* ── Delete wallet confirmation modal ── */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(15, 29, 84, 0.45)" }}
          onClick={() => !deletingId && setDeleteTarget(null)}
        >
          <div
            className="bg-card rounded-2xl shadow-xl"
            style={{ width: 420, maxWidth: "90vw", padding: 24 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center rounded-lg" style={{ width: 32, height: 32, background: "rgba(220, 38, 38, 0.1)" }}>
                  <X size={16} color="hsl(0 72% 51%)" />
                </div>
                <div>
                  <div className="font-extrabold" style={{ fontSize: 16, color: "hsl(var(--theo-blue))", letterSpacing: "-0.01em" }}>
                    Delete wallet?
                  </div>
                  <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginTop: 1 }}>
                    This action cannot be undone
                  </div>
                </div>
              </div>
              <button
                onClick={() => !deletingId && setDeleteTarget(null)}
                style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4 }}
                aria-label="Close"
              >
                <X size={16} color="hsl(var(--theo-mid))" />
              </button>
            </div>

            <div style={{ fontSize: 13, color: "hsl(var(--theo-ink))", lineHeight: 1.5, marginBottom: 20 }}>
              You are about to permanently delete the{" "}
              <span style={{ fontWeight: 700 }}>{deleteTarget.label}</span> wallet. It has no
              balance and no active positions, so nothing will be lost — but the wallet itself
              will be removed from your account.
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={!!deletingId}
                style={{
                  padding: "10px 16px", borderRadius: 10, border: "1px solid hsl(var(--border))",
                  background: "transparent", color: "hsl(var(--theo-ink))",
                  fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteWallet}
                disabled={!!deletingId}
                style={{
                  padding: "10px 16px", borderRadius: 10, border: "none",
                  background: "hsl(0 72% 51%)", color: "white",
                  fontSize: 13, fontWeight: 700, cursor: deletingId ? "not-allowed" : "pointer",
                  fontFamily: "inherit", opacity: deletingId ? 0.6 : 1,
                }}
              >
                {deletingId ? "Deleting…" : "Delete wallet"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Move funds modal ── */}
      {moveOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(15, 29, 84, 0.45)" }}
          onClick={() => !moving && setMoveOpen(false)}
        >
          <div
            className="bg-card rounded-2xl shadow-xl"
            style={{ width: 460, maxWidth: "90vw", padding: 24 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center rounded-lg" style={{ width: 32, height: 32, background: "hsl(var(--theo-blue-soft))" }}>
                  <ArrowLeftRight size={15} color="hsl(var(--theo-blue))" />
                </div>
                <div>
                  <div className="font-extrabold" style={{ fontSize: 16, color: "hsl(var(--theo-blue))", letterSpacing: "-0.01em" }}>
                    Move funds
                  </div>
                  <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginTop: 1 }}>
                    Between your own accounts · settles in seconds
                  </div>
                </div>
              </div>
              <button
                onClick={() => setMoveOpen(false)}
                style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4 }}
                aria-label="Close"
              >
                <X size={16} color="hsl(var(--theo-mid))" />
              </button>
            </div>

            {/* Asset toggle */}
            <div className="mb-3">
              <div className="font-bold uppercase mb-1.5" style={{ fontSize: 10, letterSpacing: "0.12em", color: "hsl(var(--theo-mid))" }}>
                Asset
              </div>
              <div
                className="grid grid-cols-2 rounded-lg overflow-hidden"
                style={{ border: "1px solid hsl(var(--border))", padding: 3, gap: 3, background: "hsl(var(--theo-blue-soft))" }}
              >
                {(["USDC", "HTGC"] as const).map((a) => {
                  const active = moveAsset === a;
                  const aLabel = a === "HTGC" ? "HTG-C" : "USDC";
                  return (
                    <button
                      key={a}
                      type="button"
                      onClick={() => { setMoveAsset(a); setMoveAmount(""); }}
                      disabled={moving}
                      style={{
                        background: active ? "hsl(var(--theo-blue))" : "transparent",
                        color: active ? "#fff" : "hsl(var(--theo-blue))",
                        border: "none", borderRadius: 7,
                        padding: "8px 0", fontSize: 12, fontWeight: 700,
                        cursor: moving ? "wait" : "pointer", fontFamily: "inherit",
                      }}
                    >
                      {aLabel}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* From */}
            <label className="block mb-3">
              <div className="font-bold uppercase mb-1.5" style={{ fontSize: 10, letterSpacing: "0.12em", color: "hsl(var(--theo-mid))" }}>
                From
              </div>
              <select
                value={moveSourceId}
                onChange={(e) => setMoveSourceId(e.target.value)}
                disabled={moving}
                className="w-full bg-card border border-border rounded-lg"
                style={{ padding: "10px 12px", fontSize: 13, fontFamily: "inherit", color: "hsl(var(--theo-ink))" }}
              >
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label ?? "Wallet"} · {fmt(moveAssetBalances[w.id] ?? 0)} {moveAssetLabel} available
                  </option>
                ))}
              </select>
            </label>

            {/* To */}
            <label className="block mb-3">
              <div className="font-bold uppercase mb-1.5" style={{ fontSize: 10, letterSpacing: "0.12em", color: "hsl(var(--theo-mid))" }}>
                To
              </div>
              <select
                value={moveDestId}
                onChange={(e) => setMoveDestId(e.target.value)}
                disabled={moving}
                className="w-full bg-card border border-border rounded-lg"
                style={{ padding: "10px 12px", fontSize: 13, fontFamily: "inherit", color: "hsl(var(--theo-ink))" }}
              >
                {wallets.filter((w) => w.id !== moveSourceId).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label ?? "Wallet"} · {fmt(moveAssetBalances[w.id] ?? 0)} {moveAssetLabel} balance
                  </option>
                ))}
              </select>
            </label>

            {/* Amount */}
            <label className="block mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-bold uppercase" style={{ fontSize: 10, letterSpacing: "0.12em", color: "hsl(var(--theo-mid))" }}>
                  Amount
                </span>
                <button
                  type="button"
                  onClick={() => setMoveAmount(String(moveSourceBalance))}
                  style={{
                    background: "hsl(var(--theo-blue-soft))", border: "none",
                    color: "hsl(var(--theo-blue))", borderRadius: 5, padding: "2px 8px",
                    fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  Max {fmtMoveAmount(moveSourceBalance)}
                </button>
              </div>
              <div className="flex items-center bg-card border border-border rounded-lg" style={{ padding: "0 12px" }}>
                {moveAsset === "USDC" && (
                  <span style={{ fontSize: 16, fontWeight: 700, color: "hsl(var(--theo-mid))", marginRight: 6 }}>$</span>
                )}
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={moveAmount}
                  onChange={(e) => setMoveAmount(e.target.value)}
                  placeholder="0.00"
                  disabled={moving}
                  className="flex-1 bg-transparent outline-none"
                  style={{ padding: "10px 0", fontSize: 18, fontWeight: 700, fontFamily: "inherit", color: "hsl(var(--theo-ink))" }}
                />
                <span style={{ fontSize: 12, fontWeight: 700, color: "hsl(var(--theo-mid))" }}>{moveAssetLabel}</span>
              </div>
              {moveAmountNum > moveSourceBalance && (
                <div style={{ fontSize: 11, color: "hsl(0 70% 45%)", marginTop: 4 }}>
                  Exceeds available balance.
                </div>
              )}
            </label>

            {/* Memo (optional) */}
            <label className="block mb-4">
              <div className="font-bold uppercase mb-1.5" style={{ fontSize: 10, letterSpacing: "0.12em", color: "hsl(var(--theo-mid))" }}>
                Memo · optional
              </div>
              <input
                type="text"
                maxLength={28}
                value={moveMemo}
                onChange={(e) => setMoveMemo(e.target.value)}
                placeholder="e.g. payroll top-up"
                disabled={moving}
                className="w-full bg-card border border-border rounded-lg"
                style={{ padding: "10px 12px", fontSize: 13, fontFamily: "inherit", color: "hsl(var(--theo-ink))" }}
              />
            </label>

            <div className="flex items-start gap-2 mb-4" style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>
              <Info size={13} style={{ marginTop: 1, flexShrink: 0, color: "hsl(var(--theo-cyan))" }} />
              <span>On-chain Stellar transfer between your own accounts. No platform fee.</span>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setMoveOpen(false)}
                disabled={moving}
                style={{
                  background: "transparent", border: "1.5px solid hsl(var(--theo-mid))",
                  color: "hsl(var(--theo-mid))", borderRadius: 7, padding: "8px 16px",
                  fontSize: 13, fontWeight: 700, cursor: moving ? "wait" : "pointer", fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleMove}
                disabled={!moveValid || moving}
                style={{
                  background: moveValid && !moving ? "hsl(var(--theo-blue))" : "hsl(var(--theo-mid))",
                  border: "none", color: "#fff", borderRadius: 7, padding: "8px 16px",
                  fontSize: 13, fontWeight: 700, cursor: moveValid && !moving ? "pointer" : "not-allowed",
                  fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 6,
                }}
              >
                {moving
                  ? <><Loader2 size={13} className="animate-spin" /> Moving…</>
                  : <><ArrowLeftRight size={13} /> Move {moveAmountNum > 0 ? fmtMoveAmount(moveAmountNum) : ""} →</>}
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
      {/* ── Withdraw from Blend modal ── */}
      {blendWithdrawPos && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(15, 29, 84, 0.5)" }}
          onClick={() => !blendWithdrawing && closeBlendWithdraw()}
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
                    Withdraw from Blend
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>
                  {blendWithdrawPos.walletLabel} · ${fmt(blendWithdrawPos.deposited + blendWithdrawPos.accrued)} available
                </div>
              </div>
              <button
                onClick={closeBlendWithdraw}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: "hsl(var(--theo-mid))", padding: 4 }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Breakdown */}
            <div className="rounded-xl mb-4" style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", padding: "14px 16px" }}>
              {[
                { label: "Principal deposited", value: `$${fmt(blendWithdrawPos.deposited)}` },
                { label: "Accrued yield", value: `+$${fmt(blendWithdrawPos.accrued)}` },
              ].map((s) => (
                <div key={s.label} className="flex items-center justify-between mb-2 last:mb-0">
                  <span style={{ fontSize: 12, color: "#15803D" }}>{s.label}</span>
                  <span className="font-bold" style={{ fontSize: 13, color: "#14532D" }}>{s.value}</span>
                </div>
              ))}
            </div>

            {/* Amount input */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-bold uppercase" style={{ fontSize: 11, letterSpacing: "0.14em", color: "hsl(var(--theo-mid))" }}>
                  Amount to withdraw
                </span>
                <button
                  onClick={() => setBlendWithdrawAmount((blendWithdrawPos.deposited + blendWithdrawPos.accrued).toFixed(2))}
                  style={{ background: "#F0FDF4", border: "none", color: "#15803D", borderRadius: 5, padding: "2px 8px", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                >
                  Max ${fmt(blendWithdrawPos.deposited + blendWithdrawPos.accrued)}
                </button>
              </div>
              <div className="flex items-center gap-2 rounded-xl" style={{ border: "1.5px solid hsl(var(--border))", padding: "10px 14px" }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: "hsl(var(--theo-mid))", marginRight: 2 }}>$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={blendWithdrawAmount}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/,/g, "");
                    if (raw === "" || /^\d*\.?\d*$/.test(raw)) setBlendWithdrawAmount(raw);
                  }}
                  placeholder="0.00"
                  style={{ flex: 1, border: "none", outline: "none", fontSize: 22, fontWeight: 800, color: "hsl(var(--theo-ink))", fontFamily: "inherit", letterSpacing: "-0.02em", background: "transparent" }}
                />
                <span style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-mid))" }}>USDC</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={closeBlendWithdraw}
                disabled={blendWithdrawing}
                style={{
                  flex: 1, background: "transparent", border: "1.5px solid hsl(var(--border))",
                  color: "hsl(var(--theo-ink))", borderRadius: 10, padding: "10px",
                  fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleBlendWithdraw}
                disabled={!blendWithdrawAmount || parseFloat(blendWithdrawAmount) <= 0 || parseFloat(blendWithdrawAmount) > blendWithdrawPos.deposited + blendWithdrawPos.accrued + 0.001 || blendWithdrawing}
                style={{
                  flex: 2, background: "#1A7F37", border: "none", color: "#fff", borderRadius: 10, padding: "10px",
                  fontSize: 13, fontWeight: 700, cursor: blendWithdrawing ? "wait" : "pointer", fontFamily: "inherit",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  opacity: blendWithdrawing ? 0.7 : 1,
                }}
              >
                {blendWithdrawing
                  ? <><Loader2 size={13} className="animate-spin" /> Withdrawing…</>
                  : <><ArrowUpFromLine size={13} /> Withdraw ${blendWithdrawAmount ? fmt(parseFloat(blendWithdrawAmount) || 0) : "0.00"}</>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}

function LedgerRow({
  w, idx, balance, htgcBalance, blendPosition, canViewKeys,
}: {
  w: Wallet; idx: number; balance: number; htgcBalance: number;
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
      <td className="px-5 py-3">
        <div style={{ fontSize: 13, fontWeight: 700 }}>
          ${balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC
        </div>
      </td>
      <td className="px-5 py-3">
        {htgcBalance > 0 ? (
          <div style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-blue))" }}>
            {Math.round(htgcBalance).toLocaleString("en-US")}{" "}
            <span style={{ fontSize: 11, fontWeight: 700, color: "hsl(var(--theo-mid))" }}>HTG-C</span>
          </div>
        ) : (
          <span style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>—</span>
        )}
      </td>
      <td className="px-5 py-3">
        {blendPosition ? (
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#15803D" }}>
              ${fmt(blendPosition.deposited + blendPosition.accrued)} USDC
            </div>
            <div style={{ fontSize: 11, color: "#15803D", opacity: 0.8 }}>
              +${fmt(blendPosition.deposited * DEFAULT_NET_APY / 365)}/day
            </div>
          </div>
        ) : (
          <span style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>—</span>
        )}
      </td>
    </tr>
  );
}

function SortableWalletCard({
  id,
  background,
  children,
}: {
  id: string;
  background: string;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const [hoverLong, setHoverLong] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEnter = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHoverLong(true), 600);
  };
  const onLeave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHoverLong(false);
  };
  const style: CSSProperties = {
    borderRadius: 14,
    padding: 20,
    background,
    minHeight: 130,
    transform: CSS.Transform.toString(transform),
    transition,
    cursor: isDragging ? "grabbing" : hoverLong ? "grab" : "default",
    touchAction: "none",
    zIndex: isDragging ? 10 : "auto",
    boxShadow: isDragging ? "0 18px 40px -12px rgba(0,0,0,0.45)" : undefined,
    opacity: isDragging ? 0.96 : 1,
  };
  return (
    <div ref={setNodeRef} className="relative overflow-hidden" style={style} {...attributes} {...listeners} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {children}
    </div>
  );
}
