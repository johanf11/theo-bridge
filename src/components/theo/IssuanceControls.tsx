import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/lib/auth";
import { toast } from "sonner";
import { Coins, Flame, Loader2, CheckCircle2 } from "lucide-react";

type IssuanceAction = "mint" | "burn";
type Wallet = {
  id: string;
  label: string | null;
  stellar_address: string;
  company_name: string | null;
};

const N   = "hsl(var(--theo-blue))";
const MID = "hsl(var(--theo-mid))";
const LT  = "hsl(var(--theo-light))";
const INK = "hsl(var(--theo-ink))";
const G_FG = "#1A7F37";

export function IssuanceControls() {
  const { isAdmin } = useRoles();

  const [tab, setTab]         = useState<IssuanceAction>("mint");
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [wallet, setWallet]   = useState("");
  const [amount, setAmount]   = useState("");
  const [memo, setMemo]       = useState("");
  const [busy, setBusy]       = useState(false);
  const [txHash, setTxHash]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadWallets = async () => {
    setLoading(true);
    // Firm-wide: query all wallets joined with customer company name.
    // Requires the wallets_admin_select_all RLS policy.
    const { data, error } = await supabase
      .from("wallets")
      .select("id, label, stellar_address, customers(company_name)")
      .order("created_at", { ascending: true });

    if (error) {
      toast.error("Could not load wallets: " + error.message);
      setLoading(false);
      return;
    }

    const list: Wallet[] = (data ?? []).map((w: {
      id: string;
      label: string | null;
      stellar_address: string;
      customers: { company_name: string } | null;
    }) => ({
      id: w.id,
      label: w.label,
      stellar_address: w.stellar_address,
      company_name: w.customers?.company_name ?? null,
    }));

    setWallets(list);
    if (list.length > 0) setWallet(list[0].stellar_address);
    setLoading(false);
  };

  useEffect(() => {
    if (isAdmin) loadWallets();
  }, [isAdmin]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) { toast.error("Enter a valid amount"); return; }
    if (!wallet) { toast.error("Select a wallet"); return; }

    setBusy(true);
    setTxHash(null);
    try {
      const body = tab === "mint"
        ? { action: "mint", destinationAddress: wallet, amount: parsed, memo }
        : { action: "burn", sourceAddress: wallet, amount: parsed, memo };

      const res = await supabase.functions.invoke("htgc-issuance", { body });
      if (res.error || (res.data as { error?: string } | null)?.error) {
        throw new Error((res.data as { error?: string } | null)?.error ?? res.error?.message);
      }

      const hash = (res.data as { hash?: string })?.hash;
      setTxHash(hash ?? null);
      toast.success(`${tab === "mint" ? "Minted" : "Burned"} ${parsed.toLocaleString()} HTG-C`);
      setAmount("");
      setMemo("");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!isAdmin) return null;

  const walletLabel = (w: Wallet) => {
    const company = w.company_name ? `${w.company_name} — ` : "";
    const label   = w.label ?? "Wallet";
    const addr    = `${w.stellar_address.slice(0, 6)}…${w.stellar_address.slice(-4)}`;
    return `${company}${label} (${addr})`;
  };

  return (
    <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3.5 border-b border-border"
        style={{ background: "hsl(var(--theo-blue-soft))" }}
      >
        <div className="flex items-center gap-2.5">
          <Coins
            className="flex-shrink-0"
            style={{ width: 14, height: 14, stroke: N, fill: "none", strokeWidth: 2 }}
          />
          <div className="font-bold" style={{ fontSize: 13, color: N }}>
            HTG-C Issuance controls
          </div>
        </div>
        <div style={{ fontSize: 11, color: MID, fontWeight: 600 }}>
          Admin only · Stellar Testnet
        </div>
      </div>

      <div style={{ padding: "20px 22px" }}>
        {/* Tab toggle */}
        <div style={{ display: "flex", borderRadius: 9, border: `1px solid ${LT}`, overflow: "hidden", width: "fit-content", marginBottom: 18 }}>
          {(["mint", "burn"] as IssuanceAction[]).map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => { setTab(action); setTxHash(null); }}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 16px", border: "none", fontFamily: "inherit",
                fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "all 120ms",
                background: tab === action ? (action === "mint" ? N : "#B91C1C") : "#fff",
                color: tab === action ? "#fff" : MID,
              }}
            >
              {action === "mint" ? <Coins size={13} /> : <Flame size={13} />}
              {action === "mint" ? "Mint HTG-C" : "Burn HTG-C"}
            </button>
          ))}
        </div>

        {/* Context description */}
        <div style={{
          padding: "10px 14px", borderRadius: 8, marginBottom: 16,
          background: tab === "mint" ? "hsl(var(--theo-blue-soft))" : "#FEF2F2",
          border: `1px solid ${tab === "mint" ? LT : "#FECACA"}`,
          fontSize: 12, color: tab === "mint" ? N : "#B91C1C", lineHeight: 1.6,
        }}>
          {tab === "mint"
            ? <><strong>Mint:</strong> Issue new HTG-C from the issuer account into a Theo client wallet. Use when a client has deposited HTG cash at the SPIH bank account and the reserve is confirmed.</>
            : <><strong>Burn:</strong> Send HTG-C from a Theo wallet back to the issuer, permanently destroying those tokens. Use when a client redeems HTG-C for physical HTG cash.</>
          }
        </div>

        {loading ? (
          <div style={{ fontSize: 13, color: MID }}>Loading wallets…</div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>
              {/* Wallet selector */}
              <div>
                <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.10em", color: MID, marginBottom: 5 }}>
                  {tab === "mint" ? "Destination wallet" : "Source wallet"}
                </label>
                {wallets.length === 0 ? (
                  <div style={{ fontSize: 13, color: MID }}>No wallets found</div>
                ) : (
                  <select
                    value={wallet}
                    onChange={(e) => setWallet(e.target.value)}
                    style={{ width: "100%", fontFamily: "inherit", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: `1.5px solid ${LT}`, background: "#fff", color: INK, outline: "none", cursor: "pointer" }}
                  >
                    {wallets.map((w) => (
                      <option key={w.id} value={w.stellar_address}>
                        {walletLabel(w)}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Amount */}
              <div>
                <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.10em", color: MID, marginBottom: 5 }}>
                  Amount (HTG-C)
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    type="number"
                    min={0.0000001}
                    step={0.01}
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                    style={{ width: "100%", fontFamily: "inherit", fontSize: 13, padding: "8px 52px 8px 10px", borderRadius: 8, border: `1.5px solid ${LT}`, background: "#fff", color: INK, outline: "none", boxSizing: "border-box" }}
                  />
                  <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, fontWeight: 700, color: MID }}>HTG-C</span>
                </div>
              </div>

              {/* Memo */}
              <div>
                <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.10em", color: MID, marginBottom: 5 }}>
                  Memo (optional)
                </label>
                <input
                  type="text"
                  maxLength={28}
                  placeholder="SPIH-REF-2026-001"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  style={{ width: "100%", fontFamily: "inherit", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: `1.5px solid ${LT}`, background: "#fff", color: INK, outline: "none", boxSizing: "border-box" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <button
                type="submit"
                disabled={busy}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 7,
                  padding: "9px 20px", borderRadius: 8, border: "none",
                  background: busy ? LT : tab === "mint" ? N : "#B91C1C",
                  color: busy ? MID : "#fff",
                  fontSize: 13, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer",
                  fontFamily: "inherit", transition: "all 130ms",
                }}
              >
                {busy
                  ? <><Loader2 size={13} className="animate-spin" /> Processing…</>
                  : tab === "mint"
                  ? <><Coins size={13} /> Mint HTG-C on Stellar</>
                  : <><Flame size={13} /> Burn HTG-C on Stellar</>
                }
              </button>

              {txHash && (
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12, fontWeight: 700, color: G_FG, display: "flex", alignItems: "center", gap: 5, textDecoration: "none" }}
                >
                  <CheckCircle2 size={13} />
                  View on Stellar Expert ↗
                </a>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
