import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fmtHTG, fmtRate, fmtUSDC } from "@/lib/format";
import { Copy, ExternalLink, CheckCircle2, Clock, Loader2, CreditCard, AlertTriangle, Hourglass } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Order = {
  id: string; status: string; htg_amount: number; usdc_amount: number; rate: number;
  reference_number: string; quote_expires_at: string; stellar_tx_hash: string | null;
  failure_reason: string | null; created_at: string;
};

const STEPS = [
  { key: "QUOTED", label: "Quote locked", sub: "Rate confirmed" },
  { key: "FUNDED", label: "Payment received", sub: "SPIH confirmed" },
  { key: "RELEASING", label: "Releasing USDC", sub: "Theo broadcast" },
  { key: "COMPLETED", label: "Complete", sub: "USDC in account" },
];
function stepIndex(status: string) {
  const i = STEPS.findIndex((s) => s.key === status);
  if (status === "FAILED" || status === "EXPIRED") return -1;
  return i;
}

export default function OrderStatus() {
  const { id } = useParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [now, setNow] = useState(Date.now());
  const [simulating, setSimulating] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const fetchedRef = useRef(false);
  const { isAdmin } = useRoles();

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      const { data } = await supabase.from("orders").select("*").eq("id", id).maybeSingle();
      setOrder(data as Order | null);
    };
    load();
    fetchedRef.current = true;

    const ch = supabase.channel(`order-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${id}` },
        (p) => setOrder(p.new as Order))
      .subscribe();
    const poll = setInterval(load, 5000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { supabase.removeChannel(ch); clearInterval(poll); clearInterval(tick); };
  }, [id]);

  const remaining = useMemo(() => {
    if (!order) return 0;
    return Math.max(0, new Date(order.quote_expires_at).getTime() - now);
  }, [order, now]);

  const mm = String(Math.floor(remaining / 60000)).padStart(2, "0");
  const ss = String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0");

  if (!order) {
    return <AppLayout><div className="text-muted-foreground">Loading order…</div></AppLayout>;
  }

  const idx = stepIndex(order.status);
  const isTerminalFail = order.status === "FAILED" || order.status === "EXPIRED";

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`));
  };

  return (
    <AppLayout>
      {/* Header */}
      <div className="mb-6">
        <Link to="/convert" className="text-sm font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          ← Back to Convert
        </Link>
        <div className="flex items-start justify-between gap-4 mt-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground mb-2">
              Conversion order
            </div>
            <h1 className="font-display text-3xl md:text-4xl font-extrabold text-theo-blue tracking-tight">
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
            <div className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1.5 text-sm font-semibold text-success">
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
      <Card className="mb-6">
        <CardContent className="py-7 px-6">
          <div className="flex items-start justify-between gap-2">
            {STEPS.map((s, i) => {
              const reached = !isTerminalFail && i <= idx;
              const done = !isTerminalFail && i < idx;
              const active = !isTerminalFail && i === idx && order.status !== "COMPLETED";
              return (
                <div key={s.key} className="flex-1 flex items-start">
                  <div className="flex flex-col items-center text-center min-w-0 flex-1">
                    <div className={cn(
                      "h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors",
                      reached ? "bg-primary border-primary text-primary-foreground" : "bg-card border-border text-muted-foreground",
                    )}>
                      {done || order.status === "COMPLETED" && i <= idx ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                    </div>
                    <div className={cn("mt-2 text-sm font-semibold truncate", reached ? "text-foreground" : "text-muted-foreground")}>
                      {s.label}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{s.sub}</div>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={cn("flex-1 h-[2px] mt-4 mx-1", reached && i < idx ? "bg-primary" : "bg-border")} />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Quote details — gold highlight on USDC */}
      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <div className="rounded-2xl bg-theo-gold p-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-theo-blue/80">USDC</div>
          <div className="font-display text-3xl font-extrabold text-theo-blue mt-2 tracking-tight">
            {fmtUSDC(Number(order.usdc_amount))}
          </div>
        </div>
        <div className="rounded-2xl bg-card border p-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">HTG due</div>
          <div className="font-display text-3xl font-extrabold text-theo-blue mt-2 tracking-tight">
            {fmtHTG(Number(order.htg_amount))}
          </div>
        </div>
        <div className="rounded-2xl bg-card border p-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Rate</div>
          <div className="font-display text-3xl font-extrabold text-theo-blue mt-2 tracking-tight">
            {fmtRate(Number(order.rate))}
          </div>
        </div>
      </div>

      {/* QUOTED panel */}
      {order.status === "QUOTED" && (
        <div className="rounded-2xl border bg-theo-blue-soft/60 mb-6 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
            <div className="flex items-center gap-2 font-display text-lg font-bold text-theo-blue">
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
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={simulating}
                    onClick={async () => {
                      setSimulating(true);
                      const { error } = await supabase.functions.invoke("simulate-spih-payment", { body: { orderId: order.id } });
                      setSimulating(false);
                      if (error) toast.error(error.message);
                      else toast.success("Payment simulated — releasing USDC");
                    }}
                  >
                    {simulating && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
                    Simulate SPIH payment received
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* RELEASING */}
      {(order.status === "FUNDED" || order.status === "RELEASING") && (
        <Card className="border-theo-cyan/30 bg-theo-blue-soft mb-6">
          <CardContent className="py-5">
            <div className="font-display text-lg font-bold text-theo-blue flex items-center gap-2 mb-1">
              <Loader2 className="h-5 w-5 animate-spin" />
              {order.status === "FUNDED" ? "Payment received" : "Releasing USDC"}
            </div>
            <p className="text-sm text-muted-foreground">
              {order.status === "FUNDED"
                ? "Queued for release. This usually completes within a few seconds."
                : "Confirming on the Theo network. Your receipt ID will appear here once confirmed."}
            </p>
          </CardContent>
        </Card>
      )}

      {/* COMPLETED */}
      {order.status === "COMPLETED" && order.stellar_tx_hash && (
        <Card className="border-success/30 bg-success/5 mb-6">
          <CardContent className="py-5 space-y-3">
            <div className="font-display text-lg font-bold text-success flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5" /> USDC delivered
            </div>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Receipt ID</div>
            <div className="flex items-center gap-2 flex-wrap">
              <code className="text-xs bg-muted px-2 py-1 rounded break-all">{order.stellar_tx_hash}</code>
              <Button asChild size="sm" variant="outline">
                <a href={`https://stellar.expert/explorer/testnet/tx/${order.stellar_tx_hash}`} target="_blank" rel="noreferrer">
                  Verify payment <ExternalLink className="h-3 w-3 ml-1" />
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isTerminalFail && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="py-5">
            <div className="font-display text-lg font-bold text-destructive mb-2">Order {order.status.toLowerCase()}</div>
            <p className="text-sm">{order.failure_reason ?? "If a payment was sent, our team will contact you about a refund."}</p>
          </CardContent>
        </Card>
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
        <div className="font-mono text-sm font-semibold text-theo-blue">{value}</div>
        {copyable && (
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground" onClick={() => onCopy?.(value)}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function ReferenceRow({ value, onCopy }: { value: string; onCopy: (v: string) => void }) {
  return (
    <div className="rounded-xl p-4 bg-primary text-primary-foreground">
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-theo-gold">
        Reference (memo) — Required
      </div>
      <div className="flex items-center justify-between gap-2 mt-1.5">
        <div className="font-mono text-base font-bold">{value}</div>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-primary-foreground hover:bg-white/10 hover:text-primary-foreground" onClick={() => onCopy(value)}>
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
