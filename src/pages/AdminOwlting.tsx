import { useEffect, useState } from "react";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, ExternalLink, CheckCircle2, Copy } from "lucide-react";
import { fmtUSDC } from "@/lib/format";

type Wire = {
  id: string;
  payout_id: string;
  vendor_name: string;
  vendor_country: string | null;
  bank_name: string | null;
  account_number: string | null;
  swift_bic: string | null;
  reference: string | null;
  note: string | null;
  amount_usdc: number;
  owlting_status: "RECEIVED" | "WIRED" | "FAILED";
  simulated_wire_ref: string | null;
  wired_at: string | null;
  created_at: string;
  payouts?: { stellar_tx_hash: string | null; recipient_name: string | null } | null;
};

export default function AdminOwlting() {
  const [omnibus, setOmnibus] = useState<{ address: string | null }>({ address: null });
  const [wires, setWires] = useState<Wire[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    const [s, w] = await Promise.all([
      supabase.from("app_settings").select("value").eq("key", "owlting_omnibus_address").maybeSingle(),
      supabase.from("vendor_wire_instructions").select(`
        id, payout_id, vendor_name, vendor_country, bank_name, account_number, swift_bic,
        reference, note, amount_usdc, owlting_status, simulated_wire_ref, wired_at, created_at,
        payouts ( stellar_tx_hash, recipient_name )
      `).order("created_at", { ascending: false }).limit(200),
    ]);
    setOmnibus({ address: (s.data?.value as { address?: string } | null)?.address ?? null });
    setWires((w.data ?? []) as Wire[]);
    setLoading(false);
  }
  useEffect(() => { loadAll(); }, []);


  async function markWired(id: string) {
    setBusyId(id);
    try {
      const { error } = await supabase.functions.invoke("admin-mark-wire-sent", { body: { wireId: id, status: "WIRED" } });
      if (error) throw error;
      toast.success("Marked wired");
      await loadAll();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  function copy(s: string) { navigator.clipboard.writeText(s); toast.success("Copied"); }

  return (
    <AppLayout>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "hsl(var(--theo-cyan))", marginBottom: 8 }}>
            Admin · Off-ramp
          </div>
          <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.02em", color: "hsl(var(--theo-ink))", margin: 0 }}>
            Owlting Queue
          </h1>
          <p style={{ color: "hsl(var(--theo-mid))", marginTop: 8 }}>
            USDC received at the Owlting omnibus collector. Mark as wired once the simulated fiat leg is complete.
          </p>
        </div>

        {/* Omnibus setup card */}
        <div style={{ background: "white", border: "1px solid hsl(var(--theo-light))", borderRadius: 16, padding: 20, marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "hsl(var(--theo-mid))", marginBottom: 10 }}>
            Omnibus collector wallet
          </div>
          {omnibus.address ? (
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <CheckCircle2 size={18} style={{ color: "hsl(var(--theo-blue))" }} />
              <code style={{ fontSize: 13, color: "hsl(var(--theo-ink))", background: "hsl(var(--theo-cream))", padding: "6px 10px", borderRadius: 6 }}>
                {omnibus.address}
              </code>
              <button onClick={() => copy(omnibus.address!)} style={iconBtn} title="Copy"><Copy size={14} /></button>
              <a href={`https://stellar.expert/explorer/testnet/account/${omnibus.address}`} target="_blank" rel="noreferrer" style={{ ...iconBtn, textDecoration: "none" }}>
                <ExternalLink size={14} />
              </a>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span style={{ color: "hsl(var(--theo-mid))" }}>Not configured yet.</span>
              <button onClick={setupOmnibus} disabled={loadingSetup} style={primaryBtn}>
                {loadingSetup ? <Loader2 size={14} className="animate-spin" /> : null}
                {loadingSetup ? "Setting up…" : "Create omnibus wallet"}
              </button>
            </div>
          )}
        </div>

        {/* Queue */}
        <div style={{ background: "white", border: "1px solid hsl(var(--theo-light))", borderRadius: 16, overflow: "hidden" }}>
          {loading ? (
            <div style={{ padding: 32, textAlign: "center", color: "hsl(var(--theo-mid))" }}><Loader2 className="animate-spin" /></div>
          ) : wires.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "hsl(var(--theo-mid))" }}>No vendor payments yet.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ background: "hsl(var(--theo-cream))" }}>
                  <Th>Date</Th><Th>Vendor</Th><Th>Bank</Th><Th>Reference</Th><Th>Amount</Th><Th>Status</Th><Th>Tx</Th><Th></Th>
                </tr>
              </thead>
              <tbody>
                {wires.map((w) => (
                  <tr key={w.id} style={{ borderTop: "1px solid hsl(var(--theo-light))" }}>
                    <Td>{new Date(w.created_at).toLocaleDateString()}</Td>
                    <Td>
                      <div style={{ fontWeight: 600 }}>{w.vendor_name}</div>
                      {w.vendor_country && <div style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>{w.vendor_country}</div>}
                    </Td>
                    <Td>
                      <div>{w.bank_name || "—"}</div>
                      <div style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>
                        {w.account_number || ""} {w.swift_bic ? `· ${w.swift_bic}` : ""}
                      </div>
                    </Td>
                    <Td>{w.reference || "—"}</Td>
                    <Td><strong>{fmtUSDC(w.amount_usdc)}</strong> USDC</Td>
                    <Td>
                      <StatusPill status={w.owlting_status} />
                      {w.simulated_wire_ref && (
                        <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginTop: 2 }}>{w.simulated_wire_ref}</div>
                      )}
                    </Td>
                    <Td>
                      {w.payouts?.stellar_tx_hash ? (
                        <a href={`https://stellar.expert/explorer/testnet/tx/${w.payouts.stellar_tx_hash}`} target="_blank" rel="noreferrer"
                          style={{ color: "hsl(var(--theo-cyan))", display: "inline-flex", gap: 4, alignItems: "center", textDecoration: "none" }}>
                          View <ExternalLink size={12} />
                        </a>
                      ) : "—"}
                    </Td>
                    <Td>
                      {w.owlting_status === "RECEIVED" && (
                        <button onClick={() => markWired(w.id)} disabled={busyId === w.id} style={smallBtn}>
                          {busyId === w.id ? <Loader2 size={12} className="animate-spin" /> : "Mark wired"}
                        </button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th style={{ textAlign: "left", padding: "10px 12px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "hsl(var(--theo-mid))" }}>{children}</th>;
}
function Td({ children }: { children?: React.ReactNode }) {
  return <td style={{ padding: "12px", color: "hsl(var(--theo-ink))", verticalAlign: "top" }}>{children}</td>;
}
function StatusPill({ status }: { status: "RECEIVED" | "WIRED" | "FAILED" }) {
  const map = {
    RECEIVED: { bg: "hsl(var(--theo-blue-soft))", color: "hsl(var(--theo-blue))", label: "Received" },
    WIRED:    { bg: "#E5F8EE", color: "#0F8A4B", label: "Wired" },
    FAILED:   { bg: "#FCE8E8", color: "#B42318", label: "Failed" },
  } as const;
  const s = map[status];
  return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color }}>{s.label}</span>;
}

const primaryBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "none",
  background: "hsl(var(--theo-gold))", color: "hsl(var(--theo-blue))", fontWeight: 700, fontSize: 13, cursor: "pointer",
};
const smallBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 10px", borderRadius: 6, border: "1px solid hsl(var(--theo-light))",
  background: "white", color: "hsl(var(--theo-ink))", fontSize: 12, fontWeight: 600, cursor: "pointer",
};
const iconBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 6,
  border: "1px solid hsl(var(--theo-light))", background: "white", color: "hsl(var(--theo-ink))", cursor: "pointer",
};
