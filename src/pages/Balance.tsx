import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { z } from "zod";
import { fetchHorizonUsdcBalance } from "@/lib/balance";

type Wallet = {
  id: string;
  label: string | null;
  stellar_address: string;
  usdc_balance: number;
  wallet_type: "TREASURY" | "CUSTOMER";
};

const labelSchema = z.string().trim().min(1, "Nickname is required").max(60);
const shortAddr = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

export default function Balance() {
  const navigate = useNavigate();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [labelError, setLabelError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const startEdit = (w: Wallet) => {
    setEditingId(w.id);
    setEditingValue(w.label ?? "");
  };

  const saveEdit = async (id: string) => {
    const parsed = labelSchema.safeParse(editingValue);
    if (!parsed.success) {
      toast({ title: "Invalid name", description: parsed.error.issues[0].message, variant: "destructive" });
      return;
    }
    const newLabel = parsed.data;
    setWallets((prev) => prev.map((w) => (w.id === id ? { ...w, label: newLabel } : w)));
    setEditingId(null);
    const { error } = await supabase.from("wallets").update({ label: newLabel }).eq("id", id);
    if (error) {
      toast({ title: "Could not rename", description: error.message, variant: "destructive" });
      loadWallets();
    }
  };

  const loadWallets = async () => {
    setLoading(true);
    const { data: c } = await supabase
      .from("customers")
      .select("id, stellar_wallet_address")
      .maybeSingle();
    if (!c) {
      setLoading(false);
      return;
    }

    let { data: w } = await supabase
      .from("wallets")
      .select("id, label, stellar_address, usdc_balance, wallet_type")
      .eq("customer_id", c.id)
      .order("created_at", { ascending: true });

    // Auto-seed Primary wallet from the customer's KYB-approved address
    if ((!w || w.length === 0) && c.stellar_wallet_address) {
      const { data: inserted } = await supabase
        .from("wallets")
        .insert({
          customer_id: c.id,
          label: "Primary — Operations",
          stellar_address: c.stellar_wallet_address,
          wallet_type: "CUSTOMER",
        })
        .select("id, label, stellar_address, usdc_balance, wallet_type");
      w = inserted ?? [];
    }

    const ws = (w ?? []) as Wallet[];
    setWallets(ws);

    const entries = await Promise.all(
      ws.map(async (x) => [x.id, await fetchHorizonUsdcBalance(x.stellar_address)] as const)
    );
    const balanceMap = Object.fromEntries(entries);
    setBalances(balanceMap);
    setTotal(Object.values(balanceMap).reduce((s, v) => s + v, 0));
    setLoading(false);
  };

  useEffect(() => {
    loadWallets();
  }, []);

  const handleCreateAccount = async () => {
    const parsed = labelSchema.safeParse(label);
    if (!parsed.success) {
      setLabelError(parsed.error.issues[0].message);
      return;
    }
    setLabelError(null);
    setCreating(true);
    const { data, error } = await supabase.functions.invoke("create-wallet", {
      body: { label: parsed.data },
    });
    setCreating(false);
    if (error) {
      toast({ title: "Could not create account", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: "Account created",
      description: `Public key: ${(data as any)?.public_key?.slice(0, 12)}...`,
    });
    setOpen(false);
    setLabel("");
    loadWallets();
  };

  const walletColors = ["hsl(var(--theo-blue))", "#1A2966", "#0F1D54"];

  return (
    <AppLayout>
      <div className="flex items-start justify-between mb-1">
        <div>
          <div className="font-extrabold" style={{ fontSize: 22, color: "hsl(var(--theo-blue))", letterSpacing: "-0.02em" }}>
            Balance
          </div>
          <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))", marginTop: 2 }}>
            Multi-wallet and multi-account overview.
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate("/convert")}
            className="flex items-center gap-1.5 font-bold transition-colors"
            style={{
              background: "transparent", border: "1.5px solid hsl(var(--theo-blue))",
              color: "hsl(var(--theo-blue))", borderRadius: 7, padding: "6px 12px",
              fontSize: 12, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            + Fund wallet
          </button>
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-1.5 font-bold text-white transition-colors"
            style={{
              background: "hsl(var(--theo-blue))", borderRadius: 7, padding: "6px 12px",
              fontSize: 12, border: "none", cursor: "pointer", fontFamily: "inherit",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "#3E40B0")}
            onMouseLeave={e => (e.currentTarget.style.background = "hsl(var(--theo-blue))")}
          >
            + Add account
          </button>
        </div>
      </div>
      <div className="mb-5" style={{ width: 28, height: 3, background: "hsl(var(--theo-gold))", borderRadius: 2, marginTop: 8 }} />

      {/* Total balance hero */}
      <div className="flex items-center justify-between mb-4" style={{ background: "hsl(var(--theo-blue))", borderRadius: 14, padding: "24px 28px" }}>
        <div>
          <div className="font-bold uppercase mb-2" style={{ fontSize: 10, letterSpacing: "0.14em", color: "hsl(var(--theo-gold))" }}>
            Total balance across all wallets
          </div>
          <div className="font-extrabold leading-none" style={{ fontSize: 40, letterSpacing: "-2px", color: "#fff" }}>
            ${total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.50)", marginTop: 4 }}>
            USDC · Stellar testnet · Live from Horizon
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="rounded-full" style={{ width: 6, height: 6, background: "hsl(var(--theo-cyan))", animation: "pulse 2s infinite" }} />
          <span className="font-semibold" style={{ fontSize: 12, color: "hsl(var(--theo-cyan))" }}>Live · 1:1 verified</span>
        </div>
      </div>

      {/* Wallet cards */}
      {wallets.length > 0 && (
        <>
          <div className="font-bold uppercase mb-2.5" style={{ fontSize: 11, letterSpacing: "0.14em", color: "hsl(var(--theo-mid))" }}>
            Wallets
          </div>
          <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: `repeat(${Math.min(wallets.length, 3)}, 1fr)` }}>
            {wallets.map((w, i) => (
              <div
                key={w.id}
                className="relative overflow-hidden"
                style={{ borderRadius: 14, padding: 20, background: walletColors[i % walletColors.length], minHeight: 120 }}
              >
                <div className="absolute pointer-events-none" style={{ top: -30, right: -30, width: 120, height: 120, borderRadius: "50%", background: "rgba(255,255,255,0.07)" }} />
                <div className="font-bold uppercase mb-2.5" style={{ fontSize: 10, letterSpacing: "0.12em", color: "rgba(255,255,255,0.50)" }}>
                  {w.label ?? `Wallet ${i + 1}`}
                </div>
                <div className="font-extrabold leading-none" style={{ fontSize: 30, letterSpacing: "-1.5px", color: "#fff" }}>
                  ${(balances[w.id] ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.50)", marginTop: 4 }}>USDC</div>
                <div className="flex items-center gap-1.5 mt-3">
                  <div className="rounded-full" style={{ width: 6, height: 6, background: "hsl(var(--theo-cyan))" }} />
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.50)", fontWeight: 500 }}>
                    Stellar · {shortAddr(w.stellar_address)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Account ledger */}
      <div className="font-bold uppercase mb-2.5" style={{ fontSize: 11, letterSpacing: "0.14em", color: "hsl(var(--theo-mid))" }}>
        Account ledger
      </div>
      <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
        {wallets.length === 0 && !loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No wallets yet. Click "+ Add account" to create one.
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ background: "hsl(var(--theo-cream))" }}>
                {["Account", "Wallet address", "Balance", "Status"].map((h) => (
                  <th key={h} className="text-left px-5 py-2.5 border-b border-border" style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.10em", color: "hsl(var(--theo-mid))" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {wallets.map((w, i) => (
                <tr key={w.id} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                  <td className="px-5 py-3" style={{ fontSize: 13, fontWeight: 600 }}>{w.label ?? `Wallet ${i + 1}`}</td>
                  <td className="px-5 py-3" style={{ fontFamily: "monospace", fontSize: 12 }}>
                    <a
                      href={`https://stellar.expert/explorer/testnet/account/${w.stellar_address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "hsl(var(--theo-cyan))", fontWeight: 600, wordBreak: "break-all" }}
                    >
                      {w.stellar_address}
                    </a>
                  </td>
                  <td className="px-5 py-3" style={{ fontSize: 13, fontWeight: 700 }}>
                    ${(balances[w.id] ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} USDC
                  </td>
                  <td className="px-5 py-3">
                    <span className="rounded-full font-bold" style={{ background: "#EFFBF3", color: "#1A7F37", fontSize: 11, padding: "3px 8px" }}>
                      Active
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add account modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(15, 29, 84, 0.45)" }}
          onClick={() => !creating && setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-card"
            style={{ width: 440, maxWidth: "92vw", borderRadius: 16, padding: 28, boxShadow: "0 20px 60px rgba(0,0,0,0.18)" }}
          >
            <div className="font-extrabold mb-1" style={{ fontSize: 20, color: "hsl(var(--theo-blue))", letterSpacing: "-0.02em" }}>
              Create new account
            </div>
            <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))", marginBottom: 18 }}>
              Generates a new Stellar account on testnet, funds it via Friendbot, and opens a USDC trustline.
            </div>

            <label className="block mb-5">
              <span className="font-bold uppercase block mb-1.5" style={{ fontSize: 11, letterSpacing: "0.14em", color: "hsl(var(--theo-mid))" }}>
                Wallet nickname
              </span>
              <input
                value={label}
                maxLength={60}
                disabled={creating}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Payroll, Reserve, ..."
                className="w-full border border-border rounded-lg outline-none"
                style={{ padding: "9px 12px", fontSize: 14, fontFamily: "inherit" }}
              />
              {labelError && <div style={{ color: "#C0392B", fontSize: 12, marginTop: 4 }}>{labelError}</div>}
            </label>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                disabled={creating}
                style={{
                  background: "transparent", border: "1.5px solid hsl(var(--border))",
                  color: "hsl(var(--theo-ink))", borderRadius: 10, padding: "8px 16px",
                  fontSize: 13, fontWeight: 600, cursor: creating ? "not-allowed" : "pointer", fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateAccount}
                disabled={creating}
                className="text-white"
                style={{
                  background: "hsl(var(--theo-blue))", border: "none",
                  borderRadius: 10, padding: "8px 18px",
                  fontSize: 13, fontWeight: 700, cursor: creating ? "wait" : "pointer", fontFamily: "inherit",
                  opacity: creating ? 0.7 : 1,
                }}
              >
                {creating ? "Creating..." : "Create account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
