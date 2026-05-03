import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";

type Wallet = {
  id: string; label: string | null; usdc_balance: number;
  stellar_address: string | null; updated_at: string;
};

export default function Balance() {
  const navigate = useNavigate();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [total, setTotal] = useState(0);
  const [stellarAddress, setStellarAddress] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: c } = await supabase
        .from("customers")
        .select("id, stellar_wallet_address")
        .maybeSingle();
      if (!c) return;
      setStellarAddress(c.stellar_wallet_address);

      const [{ data: w }, { data: o }] = await Promise.all([
        supabase
          .from("wallets")
          .select("id, label, usdc_balance, stellar_address, updated_at")
          .eq("customer_id", c.id),
        supabase
          .from("orders")
          .select("usdc_amount")
          .eq("customer_id", c.id)
          .eq("status", "COMPLETED"),
      ]);

      const completedTotal = (o ?? []).reduce((s, x) => s + Number(x.usdc_amount), 0);
      setTotal(completedTotal);
      setWallets((w ?? []) as Wallet[]);
    })();
  }, []);

  const walletColors = ["hsl(var(--theo-blue))", "#1A2966", "#0F1D54"];
  const shortAddr = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

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
        <button
          onClick={() => navigate("/convert")}
          className="flex items-center gap-1.5 font-bold text-white transition-colors"
          style={{
            background: "hsl(var(--theo-blue))", borderRadius: 7, padding: "6px 12px",
            fontSize: 12, border: "none", cursor: "pointer", fontFamily: "inherit",
          }}
          onMouseEnter={e => (e.currentTarget.style.background = "#3E40B0")}
          onMouseLeave={e => (e.currentTarget.style.background = "hsl(var(--theo-blue))")}
        >
          + Fund account
        </button>
      </div>
      <div className="mb-5" style={{ width: 28, height: 3, background: "hsl(var(--theo-gold))", borderRadius: 2, marginTop: 8 }} />

      {/* Total balance hero */}
      <div
        className="flex items-center justify-between mb-4"
        style={{ background: "hsl(var(--theo-blue))", borderRadius: 14, padding: "24px 28px" }}
      >
        <div>
          <div className="font-bold uppercase mb-2" style={{ fontSize: 10, letterSpacing: "0.14em", color: "hsl(var(--theo-gold))" }}>
            Total balance across all wallets
          </div>
          <div className="font-extrabold leading-none" style={{ fontSize: 40, letterSpacing: "-2px", color: "#fff" }}>
            ${total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.50)", marginTop: 4 }}>
            USDC · Stellar network
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="rounded-full" style={{ width: 6, height: 6, background: "hsl(var(--theo-cyan))", animation: "pulse 2s infinite" }} />
          <span className="font-semibold" style={{ fontSize: 12, color: "hsl(var(--theo-cyan))" }}>Live · 1:1 verified</span>
        </div>
      </div>

      {/* Wallet cards */}
      {wallets.length > 0 ? (
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
                <div
                  className="absolute pointer-events-none"
                  style={{ top: -30, right: -30, width: 120, height: 120, borderRadius: "50%", background: "rgba(255,255,255,0.07)" }}
                />
                <div className="font-bold uppercase mb-2.5" style={{ fontSize: 10, letterSpacing: "0.12em", color: "rgba(255,255,255,0.50)" }}>
                  {w.label ?? `Wallet ${i + 1}`}
                </div>
                <div className="font-extrabold leading-none" style={{ fontSize: 30, letterSpacing: "-1.5px", color: "#fff" }}>
                  ${Number(w.usdc_balance).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.50)", marginTop: 4 }}>USDC</div>
                {(w.stellar_address || stellarAddress) && (
                  <div className="flex items-center gap-1.5 mt-3">
                    <div className="rounded-full" style={{ width: 6, height: 6, background: "hsl(var(--theo-cyan))" }} />
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.50)", fontWeight: 500 }}>
                      Stellar · {shortAddr((w.stellar_address ?? stellarAddress)!)}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          {[
            { label: "Primary — Operations", balance: total },
          ].map((w, i) => (
            <div key={i} className="relative overflow-hidden" style={{ borderRadius: 14, padding: 20, background: walletColors[0], minHeight: 120 }}>
              <div className="absolute pointer-events-none" style={{ top: -30, right: -30, width: 120, height: 120, borderRadius: "50%", background: "rgba(255,255,255,0.07)" }} />
              <div className="font-bold uppercase mb-2.5" style={{ fontSize: 10, letterSpacing: "0.12em", color: "rgba(255,255,255,0.50)" }}>{w.label}</div>
              <div className="font-extrabold leading-none" style={{ fontSize: 30, letterSpacing: "-1.5px", color: "#fff" }}>
                ${w.balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.50)", marginTop: 4 }}>USDC</div>
              <div className="flex items-center gap-1.5 mt-3">
                <div className="rounded-full" style={{ width: 6, height: 6, background: "hsl(var(--theo-cyan))" }} />
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.50)", fontWeight: 500 }}>
                  {stellarAddress ? `Stellar · ${shortAddr(stellarAddress)}` : "Provisioned after KYB"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Account ledger */}
      <div className="font-bold uppercase mb-2.5" style={{ fontSize: 11, letterSpacing: "0.14em", color: "hsl(var(--theo-mid))" }}>
        Account ledger
      </div>
      <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
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
            {(wallets.length > 0 ? wallets : [{ id: "1", label: "Primary — Operations", usdc_balance: total, stellar_address: stellarAddress, updated_at: "" }]).map((w, i) => (
              <tr key={w.id} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                <td className="px-5 py-3" style={{ fontSize: 13, fontWeight: 600 }}>{w.label ?? `Wallet ${i + 1}`}</td>
                <td className="px-5 py-3" style={{ fontFamily: "monospace", fontSize: 12, color: "hsl(var(--theo-mid))" }}>
                  {(w.stellar_address ?? stellarAddress)
                    ? shortAddr((w.stellar_address ?? stellarAddress)!)
                    : "Provisioned after KYB"}
                </td>
                <td className="px-5 py-3" style={{ fontSize: 13, fontWeight: 700 }}>
                  ${Number(w.usdc_balance).toLocaleString("en-US", { minimumFractionDigits: 2 })} USDC
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
      </div>
    </AppLayout>
  );
}
