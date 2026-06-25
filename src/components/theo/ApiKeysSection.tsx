import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Copy, Check, KeyRound, Loader2, Plus, Trash2, X } from "lucide-react";

type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  last_four: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

const ENDPOINT_BASE = `${import.meta.env.VITE_SUPABASE_URL || ""}/functions/v1`;

export function ApiKeysSection({ customerId, isOwner }: { customerId: string | null; isOwner: boolean }) {
  const [rows, setRows] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<{ raw: string; prefix: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedEndpoint, setCopiedEndpoint] = useState(false);

  useEffect(() => {
    if (!customerId) return;
    load();
  }, [customerId]);

  const load = async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("api_keys")
      .select("id, name, prefix, last_four, scopes, created_at, last_used_at, revoked_at")
      .order("created_at", { ascending: false });
    setRows((data ?? []) as ApiKeyRow[]);
    setLoading(false);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    const { data, error } = await supabase.functions.invoke("api-keys", {
      body: { action: "create", name },
    });
    setCreating(false);
    if (error) { toast.error(error.message); return; }
    const r = data as { ok?: boolean; api_key?: string; prefix?: string; error?: string } | null;
    if (!r?.ok || !r.api_key) { toast.error(r?.error || "Could not create key"); return; }
    setJustCreated({ raw: r.api_key, prefix: r.prefix || "" });
    setNewName("");
    setShowCreate(false);
    load();
  };

  const handleRevoke = async (id: string, label: string) => {
    if (!confirm(`Revoke key "${label}"? Any plugins using it will stop working immediately.`)) return;
    const { error } = await supabase.functions.invoke("api-keys", { body: { action: "revoke", id } });
    if (error) { toast.error(error.message); return; }
    toast.success("Key revoked");
    load();
  };

  const copy = async (text: string, setter: (v: boolean) => void) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setter(true);
    setTimeout(() => setter(false), 2000);
  };

  return (
    <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden mb-4">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border" style={{ background: "hsl(var(--theo-blue-soft))" }}>
        <div className="flex items-center gap-2.5">
          <KeyRound className="flex-shrink-0" style={{ width: 14, height: 14, stroke: "hsl(var(--theo-blue))", strokeWidth: 2 }} />
          <div className="font-bold" style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>API & Integrations</div>
          <span style={{ fontSize: 11, color: "hsl(var(--theo-mid))", fontWeight: 500 }}>Connect Odoo or your own systems</span>
        </div>
        <Link to="/docs/odoo" style={{ fontSize: 11, fontWeight: 700, color: "hsl(var(--theo-cyan))", textDecoration: "none" }}>
          Install the Odoo plugin →
        </Link>
      </div>

      <div className="px-5 py-4">
        {/* Endpoint */}
        <div className="mb-4">
          <div className="block font-bold uppercase mb-1.5" style={{ fontSize: 10, letterSpacing: "0.10em", color: "hsl(var(--theo-mid))" }}>
            API endpoint
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code style={{
              flex: 1, fontSize: 12, padding: "8px 12px", borderRadius: 9,
              border: "1px solid hsl(var(--theo-light))", background: "hsl(var(--theo-cream))",
              color: "hsl(var(--theo-ink))", fontFamily: "ui-monospace, Menlo, monospace",
            }}>{ENDPOINT_BASE}</code>
            <button
              onClick={() => copy(ENDPOINT_BASE, setCopiedEndpoint)}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, padding: "8px 10px", borderRadius: 7, border: "1px solid hsl(var(--theo-light))", background: "#fff", color: "hsl(var(--theo-blue))", cursor: "pointer", fontFamily: "inherit" }}
            >
              {copiedEndpoint ? <Check size={11} /> : <Copy size={11} />}
              {copiedEndpoint ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        {!isOwner && (
          <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))", padding: "10px 0" }}>
            Only org owners can create or revoke API keys.
          </div>
        )}

        {isOwner && (
          <>
            {/* Raw key reveal */}
            {justCreated && (
              <div style={{
                border: "1.5px solid hsl(var(--theo-gold))",
                background: "hsl(var(--theo-gold-soft, 49 100% 95%))",
                borderRadius: 10, padding: 14, marginBottom: 14,
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "hsl(var(--theo-blue))", marginBottom: 6 }}>
                  Copy this key now — it won't be shown again.
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <code style={{
                    flex: 1, fontSize: 12, padding: "8px 12px", borderRadius: 7,
                    border: "1px solid hsl(var(--theo-light))", background: "#fff",
                    color: "hsl(var(--theo-ink))", fontFamily: "ui-monospace, Menlo, monospace",
                    overflowX: "auto", whiteSpace: "nowrap",
                  }}>{justCreated.raw}</code>
                  <button
                    onClick={() => copy(justCreated.raw, setCopiedKey)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, padding: "8px 12px", borderRadius: 7, border: "none", background: "hsl(var(--theo-blue))", color: "#fff", cursor: "pointer", fontFamily: "inherit" }}
                  >
                    {copiedKey ? <Check size={11} /> : <Copy size={11} />}
                    {copiedKey ? "Copied" : "Copy"}
                  </button>
                  <button
                    onClick={() => setJustCreated(null)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(var(--theo-mid))" }}
                  ><X size={14} /></button>
                </div>
              </div>
            )}

            {/* Existing keys */}
            <div style={{ marginBottom: 10 }}>
              {loading ? (
                <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>Loading…</div>
              ) : rows.length === 0 && !showCreate ? (
                <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))" }}>No API keys yet.</div>
              ) : (
                rows.map((k) => {
                  const revoked = !!k.revoked_at;
                  return (
                    <div key={k.id} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "11px 0", borderBottom: "1px solid hsl(var(--theo-light))",
                      gap: 12, opacity: revoked ? 0.55 : 1,
                    }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "hsl(var(--theo-blue))" }}>
                          {k.name}{revoked && <span style={{ marginLeft: 8, fontSize: 11, color: "#B91C1C" }}>(revoked)</span>}
                        </div>
                        <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginTop: 2, fontFamily: "ui-monospace, Menlo, monospace" }}>
                          {k.prefix}···{k.last_four}
                          <span style={{ fontFamily: "inherit", marginLeft: 8 }}>
                            · Created {new Date(k.created_at).toLocaleDateString()}
                            {k.last_used_at && ` · Last used ${new Date(k.last_used_at).toLocaleDateString()}`}
                          </span>
                        </div>
                      </div>
                      {!revoked && (
                        <button
                          onClick={() => handleRevoke(k.id, k.name)}
                          style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, padding: "5px 10px", borderRadius: 7, border: "1px solid #FECACA", background: "#FEF2F2", color: "#B91C1C", cursor: "pointer", fontFamily: "inherit" }}
                        >
                          <Trash2 size={11} /> Revoke
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Add form */}
            {showCreate ? (
              <div style={{ paddingTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  placeholder="e.g. Odoo production"
                  maxLength={80}
                  autoFocus
                  style={{ flex: 1, fontFamily: "inherit", fontSize: 13, padding: "9px 12px", borderRadius: 9, border: "1.5px solid hsl(var(--theo-light))", outline: "none" }}
                />
                <button
                  onClick={handleCreate}
                  disabled={creating || !newName.trim()}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "inherit", fontSize: 12, fontWeight: 700, padding: "9px 16px", borderRadius: 9, border: "none", background: "hsl(var(--theo-blue))", color: "#fff", cursor: creating ? "wait" : "pointer", opacity: !newName.trim() ? 0.5 : 1 }}
                >
                  {creating ? <Loader2 size={12} className="animate-spin" /> : null}
                  Generate
                </button>
                <button
                  onClick={() => { setShowCreate(false); setNewName(""); }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(var(--theo-mid))", display: "flex", alignItems: "center" }}
                ><X size={14} /></button>
              </div>
            ) : (
              <button
                onClick={() => setShowCreate(true)}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 6, fontSize: 12, fontWeight: 600, color: "hsl(var(--theo-blue))", background: "hsl(var(--theo-blue-soft))", border: "none", borderRadius: 7, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit" }}
              >
                <Plus size={12} /> Generate API key
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
