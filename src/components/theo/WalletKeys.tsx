import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Eye, EyeOff, Copy, KeyRound, AlertTriangle, Pencil, Check } from "lucide-react";

type WalletKey = {
  id: string;
  label: string | null;
  stellar_address: string;
  stellar_secret: string | null;
};

const shortAddr = (a: string) => `${a.slice(0, 8)}...${a.slice(-6)}`;

export function WalletKeys() {
  const [wallets, setWallets] = useState<WalletKey[]>([]);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: c } = await supabase.from("customers").select("id").maybeSingle();
      if (!c) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from("wallets")
        .select("id, label, stellar_address, stellar_secret")
        .eq("customer_id", c.id)
        .order("created_at", { ascending: true });
      setWallets((data ?? []) as WalletKey[]);
      setLoading(false);
    })();
  }, []);

  const copy = async (val: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(val);
      toast({ title: msg });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-border" style={{ background: "hsl(var(--theo-blue-soft))" }}>
        <KeyRound className="flex-shrink-0" style={{ width: 14, height: 14, stroke: "hsl(var(--theo-blue))", fill: "none", strokeWidth: 2 }} />
        <div className="font-bold" style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>Wallet keys</div>
      </div>

      <div className="px-5 py-4">
        <div
          className="flex items-start gap-2 mb-4 rounded-lg"
          style={{ background: "hsl(var(--theo-gold-soft))", border: "1px solid hsl(var(--theo-gold))", padding: "10px 12px" }}
        >
          <AlertTriangle className="flex-shrink-0 mt-0.5" style={{ width: 14, height: 14, stroke: "hsl(var(--theo-blue))", strokeWidth: 2 }} />
          <div style={{ fontSize: 12, color: "hsl(var(--theo-blue))", fontWeight: 600 }}>
            Never share your secret key. Anyone with this key controls the wallet's funds.
          </div>
        </div>

        {loading ? (
          <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>Loading...</div>
        ) : wallets.length === 0 ? (
          <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>No wallets yet.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {wallets.map((w) => (
              <div key={w.id} className="border border-border rounded-lg" style={{ padding: 14 }}>
                <div className="flex items-center justify-between mb-2">
                  <div style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-blue))" }}>
                    {w.label ?? "Wallet"}
                  </div>
                </div>

                {/* Public key */}
                <div className="mb-2">
                  <div className="font-bold uppercase mb-1" style={{ fontSize: 10, letterSpacing: "0.12em", color: "hsl(var(--theo-mid))" }}>
                    Public key
                  </div>
                  <div className="flex items-center gap-2">
                    <code style={{ fontSize: 12, color: "hsl(var(--theo-ink))", flex: 1 }}>
                      {shortAddr(w.stellar_address)}
                    </code>
                    <button
                      onClick={() => copy(w.stellar_address, "Public key copied")}
                      className="flex items-center gap-1"
                      style={{ background: "transparent", border: "1px solid hsl(var(--border))", borderRadius: 6, padding: "4px 8px", fontSize: 11, fontWeight: 600, color: "hsl(var(--theo-blue))", cursor: "pointer", fontFamily: "inherit" }}
                    >
                      <Copy style={{ width: 11, height: 11 }} /> Copy
                    </button>
                  </div>
                </div>

                {/* Secret key */}
                <div>
                  <div className="font-bold uppercase mb-1" style={{ fontSize: 10, letterSpacing: "0.12em", color: "hsl(var(--theo-mid))" }}>
                    Secret key
                  </div>
                  {!w.stellar_secret ? (
                    <div style={{ fontSize: 12, color: "hsl(var(--theo-mid))", fontStyle: "italic" }}>
                      External wallet — secret not stored.
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <code
                        style={{
                          fontSize: 12,
                          color: revealed[w.id] ? "hsl(var(--theo-ink))" : "hsl(var(--theo-mid))",
                          flex: 1,
                          letterSpacing: revealed[w.id] ? "normal" : "0.2em",
                          wordBreak: "break-all",
                        }}
                      >
                        {revealed[w.id] ? w.stellar_secret : "•".repeat(20)}
                      </code>
                      <button
                        onClick={() => setRevealed((r) => ({ ...r, [w.id]: !r[w.id] }))}
                        className="flex items-center gap-1"
                        style={{ background: "transparent", border: "1px solid hsl(var(--border))", borderRadius: 6, padding: "4px 8px", fontSize: 11, fontWeight: 600, color: "hsl(var(--theo-blue))", cursor: "pointer", fontFamily: "inherit" }}
                      >
                        {revealed[w.id] ? (
                          <><EyeOff style={{ width: 11, height: 11 }} /> Hide</>
                        ) : (
                          <><Eye style={{ width: 11, height: 11 }} /> Reveal</>
                        )}
                      </button>
                      {revealed[w.id] && (
                        <button
                          onClick={() => copy(w.stellar_secret!, "Secret key copied")}
                          className="flex items-center gap-1"
                          style={{ background: "transparent", border: "1px solid hsl(var(--border))", borderRadius: 6, padding: "4px 8px", fontSize: 11, fontWeight: 600, color: "hsl(var(--theo-blue))", cursor: "pointer", fontFamily: "inherit" }}
                        >
                          <Copy style={{ width: 11, height: 11 }} /> Copy
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
