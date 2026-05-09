import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Eye, EyeOff, Copy, KeyRound, AlertTriangle, Pencil, Check } from "lucide-react";

type WalletKey = {
  id: string;
  label: string | null;
  stellar_address: string;
  has_signing_key: boolean;
};

const shortAddr = (a: string) => `${a.slice(0, 8)}...${a.slice(-6)}`;

export function WalletKeys() {
  const [wallets, setWallets] = useState<WalletKey[]>([]);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealing, setRevealing] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);

  const startEdit = (w: WalletKey) => {
    setEditingId(w.id);
    setEditingValue(w.label ?? "");
  };

  const saveEdit = async (id: string) => {
    const newLabel = editingValue.trim().slice(0, 60);
    if (!newLabel) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    const prev = wallets;
    setWallets((ws) => ws.map((w) => (w.id === id ? { ...w, label: newLabel } : w)));
    setEditingId(null);
    const { error } = await supabase.from("wallets").update({ label: newLabel }).eq("id", id);
    if (error) {
      setWallets(prev);
      toast({ title: "Could not rename", description: error.message, variant: "destructive" });
      return;
    }
    setSavedId(id);
    setTimeout(() => setSavedId((s) => (s === id ? null : s)), 1500);
  };

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) { setLoading(false); return; }
      const { data: c } = await supabase.from("customers").select("id").eq("user_id", auth.user.id).maybeSingle();
      if (!c) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from("wallets")
        .select("id, label, stellar_address, has_signing_key")
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

  const toggleReveal = async (id: string) => {
    if (revealed[id]) {
      setRevealed((r) => {
        const next = { ...r };
        delete next[id];
        return next;
      });
      return;
    }
    setRevealing((r) => ({ ...r, [id]: true }));
    try {
      const { data, error } = await supabase.functions.invoke("reveal-wallet-secret", {
        body: { walletId: id },
      });
      if (error || !data?.secret) {
        toast({ title: "Could not reveal key", description: error?.message ?? "Unknown error", variant: "destructive" });
        return;
      }
      setRevealed((r) => ({ ...r, [id]: data.secret as string }));
    } finally {
      setRevealing((r) => {
        const next = { ...r };
        delete next[id];
        return next;
      });
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-border" style={{ background: "hsl(var(--theo-blue-soft))" }}>
        <KeyRound className="flex-shrink-0" style={{ width: 14, height: 14, stroke: "hsl(var(--theo-blue))", fill: "none", strokeWidth: 2 }} />
        <div className="font-bold" style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>Account credentials</div>
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
                <div className="flex items-center justify-between mb-2 gap-2">
                  {editingId === w.id ? (
                    <input
                      autoFocus
                      value={editingValue}
                      maxLength={60}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onBlur={() => saveEdit(w.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit(w.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      style={{
                        flex: 1, fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-blue))",
                        border: "1px solid hsl(var(--border))", borderRadius: 6,
                        padding: "4px 8px", outline: "none", fontFamily: "inherit",
                        background: "#fff",
                      }}
                    />
                  ) : (
                    <div className="flex items-center gap-2" style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-blue))" }}>
                        {w.label ?? "Wallet"}
                      </div>
                      <button
                        onClick={() => startEdit(w)}
                        title="Rename"
                        style={{ background: "transparent", border: "none", padding: 2, cursor: "pointer", color: "hsl(var(--theo-mid))", display: "inline-flex" }}
                      >
                        <Pencil style={{ width: 12, height: 12 }} />
                      </button>
                      {savedId === w.id && (
                        <span className="flex items-center gap-1" style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--theo-cyan))" }}>
                          <Check style={{ width: 11, height: 11 }} /> Saved
                        </span>
                      )}
                    </div>
                  )}
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
                  {!w.has_signing_key ? (
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
                        {revealed[w.id] ?? "•".repeat(20)}
                      </code>
                      <button
                        onClick={() => toggleReveal(w.id)}
                        disabled={revealing[w.id]}
                        className="flex items-center gap-1"
                        style={{ background: "transparent", border: "1px solid hsl(var(--border))", borderRadius: 6, padding: "4px 8px", fontSize: 11, fontWeight: 600, color: "hsl(var(--theo-blue))", cursor: revealing[w.id] ? "wait" : "pointer", fontFamily: "inherit", opacity: revealing[w.id] ? 0.6 : 1 }}
                      >
                        {revealed[w.id] ? (
                          <><EyeOff style={{ width: 11, height: 11 }} /> Hide</>
                        ) : (
                          <><Eye style={{ width: 11, height: 11 }} /> {revealing[w.id] ? "Loading…" : "Reveal"}</>
                        )}
                      </button>
                      {revealed[w.id] && (
                        <button
                          onClick={() => copy(revealed[w.id], "Secret key copied")}
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
