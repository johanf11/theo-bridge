import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/lib/auth";
import { fmtHTG, fmtRate, fmtUSDC } from "@/lib/format";
import { Copy, ExternalLink, CheckCircle2, Clock, Loader2, CreditCard, AlertTriangle, Hourglass, Check, FileDown } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { generateReceipt } from "@/lib/receipt";

type Order = {
  id: string; status: string; htg_amount: number; usdc_amount: number; rate: number;
  reference_number: string; quote_expires_at: string; stellar_tx_hash: string | null;
  failure_reason: string | null; created_at: string; completed_at?: string | null; order_kind?: string | null;
  swap_direction?: string | null;
  wallet_id?: string | null;
  usdc_gross?: number | null; fee_usdc?: number | null; fee_bps?: number | null;
  principal_balance?: number | null;  // balance earning yield (yield orders only)
  net_apy?: number | null;            // APY as decimal (0.07 = 7%)
  accrued_amount?: number | null;     // yield earned (yield orders only)
  customers?: { company_name?: string | null } | null;
};

const STEPS_USDC = [
  { key: "QUOTED", label: "Quote locked", sub: "Rate confirmed" },
  { key: "FUNDED", label: "Payment received", sub: "SPIH confirmed" },
  { key: "RELEASING", label: "Releasing USDC", sub: "Theo broadcast" },
  { key: "COMPLETED", label: "Complete", sub: "USDC in account" },
];
const STEPS_MINT = [
  { key: "QUOTED", label: "Deposit reference", sub: "Order created" },
  { key: "FUNDED", label: "Payment received", sub: "SPIH confirmed" },
  { key: "RELEASING", label: "Minting HTG-C", sub: "Stellar broadcast" },
  { key: "COMPLETED", label: "Complete", sub: "HTG-C in wallet" },
];
function getSteps(kind: string | null | undefined) {
  return kind === "htgc_mint" ? STEPS_MINT : STEPS_USDC;
}
function stepIndex(status: string, steps: typeof STEPS_USDC) {
  const i = steps.findIndex((s) => s.key === status);
  if (status === "FAILED" || status === "EXPIRED") return -1;
  return i;
}

export default function OrderStatus() {
  const { id } = useParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [walletLabel, setWalletLabel] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [simulating, setSimulating] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const fetchedRef = useRef(false);
  const { isAdmin } = useRoles();

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      const { data } = await supabase.from("orders").select("*, customers(company_name)").eq("id", id).maybeSingle();
      setOrder(data as Order | null);
    };
    load();
    fetchedRef.current = true;

    const ch = supabase.channel(`order-${id}`, { config: { private: true } })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${id}` },
        (p) => setOrder(p.new as Order))
      .subscribe();
    const poll = setInterval(load, 5000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { supabase.removeChannel(ch); clearInterval(poll); clearInterval(tick); };
  }, [id]);

  // Fetch wallet label whenever wallet_id is known
  useEffect(() => {
    if (!order?.wallet_id) return;
    supabase
      .from("wallets")
      .select("label")
      .eq("id", order.wallet_id)
      .maybeSingle()
      .then(({ data }) => setWalletLabel(data?.label ?? null));
  }, [order?.wallet_id]);

  const remaining = useMemo(() => {
    if (!order) return 0;
    return Math.max(0, new Date(order.quote_expires_at).getTime() - now);
  }, [order, now]);

  const mm = String(Math.floor(remaining / 60000)).padStart(2, "0");
  const ss = String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0");

  if (!order) {
    return <AppLayout><div className="text-muted-foreground">Loading order…</div></AppLayout>;
  }

  const STEPS = getSteps(order.order_kind);
  const idx = stepIndex(order.status, STEPS);
  const isTerminalFail = order.status === "FAILED" || order.status === "EXPIRED";

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`));
  };

  const settledTo = walletLabel ?? "your wallet";

  return (
    <AppLayout>
      {/* Header */}
      <div className="mb-6">
        <Link to="/convert" className="text-sm font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          ← Back to On / Off Ramp
        </Link>
        <div className="flex items-start justify-between gap-4 mt-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground mb-2">
              {order.order_kind === "htgc_mint" ? "Deposit order" : "Conversion order"}
            </div>
            <h1 className="text-3xl md:text-4xl font-extrabold text-theo-blue tracking-tight">
              Order <span className="ml-2">{order.reference_number}</span>
            </h1>
            <div className="h-[3px] w-10 bg-theo-gold mt-3" />
          </div>
          {order.status === "QUOTED" && (
            <div className="inline-flex items-center gap-1.5 rounded-full bg-theo-gold-soft px-3 py-1.5 text-sm font-semibold text-theo-blue">
              <Hourglass className="h-3.5 w-3.5" /> Awaiting payment
            </div>
          )}
          {(order.status === "FUNDED" || order.status === "RELEASING") && (
            <div className="inline-flex items-center gap-1.5 rounded-full bg-theo-cyan-soft px-3 py-1.5 text-sm font-semibold text-theo-cyan">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing
            </div>
          )}
          {order.status === "COMPLETED" && (
            <div className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1.5 text-sm font-semibold text-success border border-success/30">
              <CheckCircle2 className="h-3.5 w-3.5" /> Complete
            </div>
          )}
          {isTerminalFail && (
            <div className="inline-flex items-center gap-1.5 rounded-full bg-destructive/15 px-3 py-1.5 text-sm font-semibold text-destructive">
              {order.status === "EXPIRED" ? "Expired" : "Failed"}
            </div>
          )}
        </div>
      </div>

      {/* Stepper */}
      <div className="rounded-2xl border border-border bg-card mb-6 px-6 py-7">
        <div className="flex items-start">
          {STEPS.map((s, i) => {
            const reached = !isTerminalFail && i <= idx;
            const done = !isTerminalFail && i < idx;
            return (
              <>
                <div key={s.key} className="flex flex-col items-center text-center" style={{ flex: "0 0 auto", width: 90 }}>
                  <div style={{
                    height: 32, width: 32, borderRadius: 99,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 700, transition: "all 150ms",
                    background: reached ? "hsl(var(--theo-blue))" : "transparent",
                    border: `2px solid ${reached ? "hsl(var(--theo-blue))" : "hsl(var(--border))"}`,
                    color: reached ? "#fff" : "hsl(var(--theo-mid))",
                  }}>
                    {(done || (order.status === "COMPLETED" && i <= idx)) ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                  </div>
                  <div style={{
                    marginTop: 8, fontSize: 13, fontWeight: 700,
                    color: reached ? "hsl(var(--theo-blue))" : "hsl(var(--theo-mid))",
                  }}>
                    {s.label}
                  </div>
                  <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginTop: 2 }}>{s.sub}</div>
                </div>
                {i < STEPS.length - 1 && (
                  <div style={{
                    flex: 1, height: 2, marginTop: 15,
                    background: (reached && i < idx) ? "hsl(var(--theo-blue))" : "hsl(var(--border))",
                  }} />
                )}
              </>
            );
          })}
        </div>
      </div>

      {/* Quote details */}
      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <div className="rounded-2xl bg-theo-gold p-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-theo-blue/80">
            {order.order_kind === "htgc_mint" ? "HTG-C" : "USDC"}
          </div>
          <div className="text-3xl font-extrabold text-theo-blue mt-2 tracking-tight">
            {order.order_kind === "htgc_mint"
              ? `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(order.htg_amount))} HTG-C`
              : fmtUSDC(Number(order.usdc_amount))}
          </div>
        </div>
        <div className="rounded-2xl bg-card border p-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">HTG due</div>
          <div className="text-3xl font-extrabold text-theo-blue mt-2 tracking-tight">
            {fmtHTG(Number(order.htg_amount))}
          </div>
        </div>
        <div className="rounded-2xl bg-card border p-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Rate</div>
          <div className="text-3xl font-extrabold text-theo-blue mt-2 tracking-tight">
            {fmtRate(Number(order.rate))}
          </div>
        </div>
      </div>

      {/* QUOTED panel */}
      {order.status === "QUOTED" && (
        <div className="rounded-2xl border bg-theo-blue-soft/60 mb-6 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
            <div className="flex items-center gap-2 text-lg font-bold text-theo-blue">
              <CreditCard className="h-4 w-4" /> Pay via SPIH
            </div>
            <div className={cn(
              "flex items-center gap-2 font-mono text-base font-semibold",
              remaining < 60_000 ? "text-destructive" : "text-theo-blue"
            )}>
              <Clock className="h-4 w-4" /> {mm}:{ss}
              <span className="text-xs font-normal text-muted-foreground ml-1">remaining</span>
            </div>
          </div>

          <div className="p-5 space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <DetailRow label="Bank" value="UNIBANK S.A." />
              <DetailRow label="Account name" value="THEO HAITI S.A." />
              <DetailRow label="Account number" value="100-200-300-400" copyable onCopy={(v) => copy(v, "Account")} />
              <DetailRow label="SWIFT / BIC" value="UNIHTPAU" />
              <DetailRow label="Amount" value={fmtHTG(Number(order.htg_amount))} copyable onCopy={() => copy(String(order.htg_amount), "Amount")} />
              <ReferenceRow value={order.reference_number} onCopy={(v) => copy(v, "Reference")} />
            </div>

            <div className="flex items-start gap-3 rounded-xl border border-theo-gold/40 bg-theo-gold-soft/60 p-4">
              <AlertTriangle className="h-4 w-4 text-theo-blue mt-0.5 shrink-0" />
              <p className="text-sm text-theo-blue">
                <span className="font-semibold">The reference must appear in the SPIH memo field exactly as shown.</span>{" "}
                <span className="text-muted-foreground">Without it, your payment cannot be matched automatically.</span>
              </p>
            </div>
          </div>

          {isAdmin && (
            <div className="border-t border-border/50">
              <button
                onClick={() => setDebugOpen((v) => !v)}
                className="w-full flex items-center gap-2 px-5 py-3 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
              >
                <span>•••</span> Admin debug
              </button>
              {debugOpen && (
                <div className="px-5 pb-4">
                  <button
                    disabled={simulating}
                    onClick={async () => {
                      setSimulating(true);
                      const { error } = await supabase.functions.invoke("simulate-spih-payment", { body: { orderId: order.id } });
                      setSimulating(false);
                      if (error) toast.error(error.message);
                      else toast.success("Payment simulated — releasing HTG-C");
                    }}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      background: "transparent", border: "1.5px solid hsl(var(--border))",
                      color: "hsl(var(--theo-ink))", borderRadius: 7, padding: "7px 14px",
                      fontSize: 12, fontWeight: 600, cursor: simulating ? "wait" : "pointer",
                      fontFamily: "inherit", opacity: simulating ? 0.6 : 1,
                    }}
                  >
                    {simulating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Simulate SPIH payment received
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* RELEASING */}
      {(order.status === "FUNDED" || order.status === "RELEASING") && (
        <div className="rounded-2xl mb-6 p-5 flex items-center gap-4" style={{ background: "hsl(var(--theo-cyan-soft))", border: "1.5px solid hsl(var(--theo-cyan) / 0.35)" }}>
          <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "hsl(var(--theo-blue) / 0.08)", border: "1.5px solid hsl(var(--theo-cyan) / 0.35)" }}>
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: "hsl(var(--theo-blue))" }} />
          </div>
          <div>
            <div className="font-bold text-base" style={{ color: "hsl(var(--theo-blue))", letterSpacing: "-0.01em" }}>
              {order.status === "FUNDED" ? "Payment received" : order.order_kind === "htgc_mint" ? "Minting HTG-C" : "Releasing USDC"}
            </div>
            <div className="text-sm mt-0.5" style={{ color: "hsl(var(--theo-mid))" }}>
              {order.status === "FUNDED"
                ? "Queued for release. This usually completes within a few seconds."
                : "Confirming on the Stellar network. Your transaction hash will appear once confirmed."}
            </div>
          </div>
        </div>
      )}

      {/* COMPLETED */}
      {order.status === "COMPLETED" && (
        <>
          {/* Completion banner */}
          <div className="rounded-2xl mb-4 overflow-hidden" style={{ border: "1.5px solid hsl(var(--theo-blue))" }}>
            {/* Top: amount + actions */}
            <div className="flex items-center gap-5 px-6 py-5" style={{ background: "hsl(var(--theo-blue))" }}>
              <div
                className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "rgba(255,255,255,0.10)", border: "1.5px solid rgba(255,255,255,0.18)" }}
              >
                <Check className="h-5 w-5" style={{ color: "hsl(var(--theo-gold))" }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] mb-1" style={{ color: "hsl(var(--theo-gold))" }}>
                  {order.order_kind === "htgc_mint" ? "Deposit complete" : "Conversion complete"}
                </div>
                <div className="font-extrabold text-2xl tracking-tight" style={{ color: "#fff", letterSpacing: "-0.02em" }}>
                  {order.order_kind === "htgc_mint"
                    ? `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(order.htg_amount))} HTG-C delivered`
                    : `${fmtUSDC(Number(order.usdc_amount))} delivered`}
                </div>
              </div>
              {/* Actions — right-aligned */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => generateReceipt({
                    kind: (order.order_kind ?? "conversion") as Parameters<typeof generateReceipt>[0]["kind"],
                    referenceNumber: order.reference_number,
                    createdAt: order.created_at,
                    completedAt: order.completed_at ?? null,
                    htgAmount: Number(order.htg_amount),
                    usdcAmount: Number(order.usdc_amount),
                    usdcGross: order.usdc_gross != null ? Number(order.usdc_gross) : undefined,
                    feeUsdc: order.fee_usdc != null ? Number(order.fee_usdc) : undefined,
                    feeBps: order.fee_bps != null ? Number(order.fee_bps) : undefined,
                    swapDirection:
                      order.order_kind === "htgc_usdc_swap" &&
                      (order.swap_direction === "htgc_to_usdc" || order.swap_direction === "usdc_to_htgc")
                        ? order.swap_direction
                        : undefined,
                    htgGross:
                      order.order_kind === "htgc_usdc_swap" && order.swap_direction === "usdc_to_htgc"
                        ? Math.round(Number(order.usdc_gross ?? 0) * Number(order.rate ?? 0))
                        : undefined,
                    principalBalance: order.principal_balance != null ? Number(order.principal_balance) : undefined,
                    netApy: order.net_apy != null ? Number(order.net_apy) : undefined,
                    accruedAmount: order.accrued_amount != null ? Number(order.accrued_amount) : undefined,
                    rate: Number(order.rate),
                    stellarTxHash: order.stellar_tx_hash,
                    status: order.status,
                    customerName: order.customers?.company_name ?? undefined,
                  })}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    background: "rgba(255,255,255,0.10)",
                    border: "1.5px solid rgba(255,255,255,0.22)",
                    color: "#fff", borderRadius: 8, padding: "8px 14px",
                    fontSize: 12, fontWeight: 700, fontFamily: "inherit",
                    cursor: "pointer", whiteSpace: "nowrap",
                  }}
                >
                  <FileDown style={{ width: 13, height: 13 }} />
                  Receipt
                </button>
                <Link
                  to="/balance"
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    background: "hsl(var(--theo-gold))", color: "hsl(var(--theo-blue))",
                    borderRadius: 8, padding: "8px 16px", fontSize: 12,
                    fontWeight: 700, fontFamily: "inherit", textDecoration: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  View balance →
                </Link>
              </div>
            </div>

            {/* Bottom: settled-to details bar */}
            <div
              className="flex items-center gap-3 px-6 py-3 border-t"
              style={{ background: "hsl(var(--theo-cream))", borderColor: "hsl(var(--theo-light))" }}
            >
              <div
                style={{
                  width: 6, height: 6, borderRadius: 99, background: "#1A7F37", flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>
                Settled to{" "}
                <span style={{ fontWeight: 700, color: "hsl(var(--theo-ink))" }}>{settledTo}</span>
                {" · "}Stellar network
              </span>
            </div>
          </div>

          {/* Stellar TX */}
          {order.stellar_tx_hash && (
            <div className="rounded-xl border border-border bg-card mb-6 overflow-hidden">
              <div className="px-5 py-3 border-b border-border" style={{ background: "hsl(var(--theo-cream))" }}>
                <div className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: "hsl(var(--theo-mid))" }}>
                  Stellar transaction
                </div>
              </div>
              <div className="px-5 py-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <code className="text-xs md:text-sm font-mono break-all" style={{ color: "hsl(var(--theo-ink))" }}>
                    {order.stellar_tx_hash}
                  </code>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => copy(order.stellar_tx_hash!, "Transaction hash")}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        height: 30, width: 30, background: "transparent",
                        border: "1.5px solid hsl(var(--border))", borderRadius: 6,
                        color: "hsl(var(--theo-mid))", cursor: "pointer",
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <a
                      href={`https://stellar.expert/explorer/testnet/tx/${order.stellar_tx_hash}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "flex", alignItems: "center", gap: 4,
                        background: "hsl(var(--theo-cyan-soft))",
                        border: "1.5px solid hsl(var(--theo-cyan) / 0.3)",
                        color: "hsl(var(--theo-blue))", borderRadius: 6, padding: "5px 10px",
                        fontSize: 12, fontWeight: 600, fontFamily: "inherit", textDecoration: "none",
                      }}
                    >
                      View <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
                <div className="pt-3 border-t border-border flex items-center gap-2" style={{ fontSize: 13, fontWeight: 600, color: "#1A7F37" }}>
                  <span style={{ height: 8, width: 8, borderRadius: 99, background: "#1A7F37", display: "inline-block" }} />
                  Confirmed on Stellar testnet
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {isTerminalFail && (
        <div className="rounded-2xl p-5 mb-6" style={{ background: "#FDE8E8", border: "1.5px solid #FCA5A5" }}>
          <div className="font-bold text-base mb-1.5" style={{ color: "#B91C1C" }}>
            Order {order.status === "EXPIRED" ? "expired" : "failed"}
          </div>
          <p className="text-sm" style={{ color: "#7F1D1D" }}>
            {order.failure_reason ?? "If a payment was sent, our team will contact you about a refund."}
          </p>
        </div>
      )}
    </AppLayout>
  );
}

function DetailRow({ label, value, copyable, onCopy }:
  { label: string; value: string; copyable?: boolean; onCopy?: (v: string) => void }) {
  return (
    <div className="bg-card rounded-xl p-4 border">
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="flex items-center justify-between gap-2 mt-1.5">
        <div className="font-mono text-sm font-semibold" style={{ color: "hsl(var(--theo-ink))" }}>{value}</div>
        {copyable && (
          <button
            onClick={() => onCopy?.(value)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              height: 28, width: 28, background: "transparent", border: "none",
              color: "hsl(var(--theo-mid))", cursor: "pointer", borderRadius: 6,
            }}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function ReferenceRow({ value, onCopy }: { value: string; onCopy: (v: string) => void }) {
  return (
    <div className="rounded-xl p-4" style={{ background: "hsl(var(--theo-blue))", color: "#fff" }}>
      <div className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: "hsl(var(--theo-gold))" }}>
        Reference / Memo — Required
      </div>
      <div className="flex items-center justify-between gap-2 mt-1.5">
        <div className="font-mono text-base font-bold">{value}</div>
        <button
          onClick={() => onCopy(value)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: 32, width: 32, background: "rgba(255,255,255,0.12)", border: "none",
            color: "#fff", cursor: "pointer", borderRadius: 6,
          }}
        >
          <Copy className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
