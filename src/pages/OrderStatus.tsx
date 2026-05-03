import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/theo/StatusBadge";
import { fmtHTG, fmtRate, fmtUSDC } from "@/lib/format";
import { Copy, ExternalLink, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Order = {
  id: string; status: string; htg_amount: number; usdc_amount: number; rate: number;
  reference_number: string; quote_expires_at: string; stellar_tx_hash: string | null;
  failure_reason: string | null; created_at: string;
};

const STEPS = [
  { key: "QUOTED", label: "Quote locked" },
  { key: "FUNDED", label: "Payment received" },
  { key: "RELEASING", label: "Releasing USDC" },
  { key: "COMPLETED", label: "Complete" },
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

    // Realtime + 5s polling fallback
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
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <Link to="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">← Back to dashboard</Link>
          <h1 className="font-display text-3xl md:text-4xl font-bold mt-1">Order {order.reference_number}</h1>
        </div>
        <StatusBadge status={order.status} />
      </div>

      {/* Progress */}
      <Card className="mb-6">
        <CardContent className="py-6">
          <div className="flex items-center justify-between gap-2">
            {STEPS.map((s, i) => {
              const reached = !isTerminalFail && i <= idx;
              const active = !isTerminalFail && i === idx && order.status !== "COMPLETED";
              return (
                <div key={s.key} className="flex-1 flex items-center">
                  <div className="flex flex-col items-center text-center min-w-0">
                    <div className={cn(
                      "h-9 w-9 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors",
                      reached ? "bg-theo-blue border-theo-blue text-white" : "bg-background border-border text-muted-foreground",
                      active && "ring-4 ring-theo-cyan/30 animate-pulse-soft"
                    )}>
                      {reached && i < idx ? <CheckCircle2 className="h-5 w-5" /> : i + 1}
                    </div>
                    <div className="mt-2 text-xs md:text-sm font-medium truncate">{s.label}</div>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={cn("flex-1 h-0.5 mx-2", reached && i < idx ? "bg-theo-blue" : "bg-border")} />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Quote details */}
      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <Card><CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">USDC</CardTitle></CardHeader>
          <CardContent><div className="font-display text-2xl font-bold">{fmtUSDC(Number(order.usdc_amount))}</div></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">HTG due</CardTitle></CardHeader>
          <CardContent><div className="font-display text-2xl font-bold">{fmtHTG(Number(order.htg_amount))}</div></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Rate</CardTitle></CardHeader>
          <CardContent><div className="font-display text-2xl font-bold">{fmtRate(Number(order.rate))}</div></CardContent></Card>
      </div>

      {/* QUOTED — show payment instructions + countdown */}
      {order.status === "QUOTED" && (
        <Card className="border-theo-cyan/30 bg-theo-blue-soft mb-6">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="font-display">Pay via SPIH</CardTitle>
            <div className={cn(
              "flex items-center gap-2 font-mono text-lg font-semibold",
              remaining < 60_000 ? "text-destructive" : "text-theo-blue"
            )}>
              <Clock className="h-4 w-4" /> {mm}:{ss}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <DetailRow label="Bank" value="UNIBANK S.A." />
              <DetailRow label="Account name" value="THEO HAITI S.A." />
              <DetailRow label="Account number" value="100-200-300-400" copyable onCopy={(v) => copy(v, "Account")} />
              <DetailRow label="SWIFT / BIC" value="UNIHTPAU" />
              <DetailRow label="Amount" value={fmtHTG(Number(order.htg_amount))} copyable onCopy={(v) => copy(String(order.htg_amount), "Amount")} />
              <DetailRow
                label="Reference (memo)"
                value={order.reference_number}
                emphasized
                copyable
                onCopy={(v) => copy(v, "Reference")}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              The reference must appear in the SPIH memo field exactly as shown. Without it, your payment cannot be matched automatically.
            </p>
            {isAdmin && (
              <div className="pt-3 border-t border-border/50">
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Admin debug</div>
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
          </CardContent>
        </Card>
      )}

      {/* RELEASING */}
      {(order.status === "FUNDED" || order.status === "RELEASING") && (
        <Card className="border-theo-blue/30 bg-theo-blue-soft mb-6">
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2 text-theo-blue">
              <Loader2 className="h-5 w-5 animate-spin" />
              {order.status === "FUNDED" ? "Payment received" : "Releasing USDC"}
            </CardTitle>
          </CardHeader>
          <CardContent>
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
          <CardHeader><CardTitle className="font-display flex items-center gap-2 text-success"><CheckCircle2 className="h-5 w-5" /> USDC delivered</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm text-muted-foreground">Receipt ID</div>
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
          <CardHeader><CardTitle className="text-destructive">Order {order.status.toLowerCase()}</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm">{order.failure_reason ?? "If a payment was sent, our team will contact you about a refund."}</p>
          </CardContent>
        </Card>
      )}
    </AppLayout>
  );
}

function DetailRow({ label, value, emphasized, copyable, onCopy }:
  { label: string; value: string; emphasized?: boolean; copyable?: boolean; onCopy?: (v: string) => void }) {
  return (
    <div className="bg-card rounded-lg p-3 border">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="flex items-center justify-between gap-2 mt-1">
        <div className={cn("font-mono", emphasized ? "text-theo-blue-deep font-bold text-lg" : "text-sm")}>{value}</div>
        {copyable && (
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => onCopy?.(value)}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
