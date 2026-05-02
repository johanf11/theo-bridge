import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fmtUSDC, fmtHTG } from "@/lib/format";
import { ArrowRight, ArrowLeftRight, ShieldCheck } from "lucide-react";
import { StatusBadge } from "@/components/theo/StatusBadge";

type Customer = {
  id: string; company_name: string;
  kyb_status: "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";
  stellar_wallet_address: string | null;
};
type Order = { id: string; status: string; usdc_amount: number; htg_amount: number; reference_number: string; created_at: string };

export default function Dashboard() {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [balance, setBalance] = useState(0);

  useEffect(() => {
    (async () => {
      const { data: c } = await supabase.from("customers").select("id, company_name, kyb_status, stellar_wallet_address").maybeSingle();
      setCustomer(c as Customer | null);
      if (!c) return;
      const { data: o } = await supabase.from("orders").select("id, status, usdc_amount, htg_amount, reference_number, created_at").eq("customer_id", c.id).order("created_at", { ascending: false }).limit(20);
      setOrders((o ?? []) as Order[]);
      const { data: w } = await supabase.from("wallets").select("usdc_balance").eq("customer_id", c.id).maybeSingle();
      setBalance(Number(w?.usdc_balance ?? 0));
    })();
  }, []);

  const kybIncomplete = customer && customer.kyb_status !== "APPROVED";

  return (
    <AppLayout>
      {/* Page header */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-8">
        <div>
          <p className="eyebrow">Welcome back</p>
          <h1 className="mt-2 text-3xl md:text-4xl font-extrabold tracking-tightest">{customer?.company_name ?? "—"}</h1>
          <hr className="gold-rule mt-3" />
        </div>
        <Button asChild size="lg" className="shrink-0">
          <Link to="/convert"><ArrowLeftRight className="h-4 w-4 mr-2" /> Start a conversion</Link>
        </Button>
      </div>

      {/* KYB banner */}
      {kybIncomplete && (
        <Card className="mb-6 border-border/60">
          <CardContent className="py-5 flex items-center justify-between gap-4 flex-wrap bg-muted rounded-2xl">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-card text-primary shadow-xs">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div>
                <div className="font-semibold text-primary">
                  {customer.kyb_status === "UNDER_REVIEW"
                    ? "KYB under review"
                    : customer.kyb_status === "REJECTED"
                    ? "KYB needs changes"
                    : "Complete your KYB to start converting"}
                </div>
                <p className="text-sm text-muted-foreground">
                  {customer.kyb_status === "UNDER_REVIEW"
                    ? "We'll email you once your business is approved."
                    : customer.kyb_status === "REJECTED"
                    ? "Please update your submission to continue."
                    : "Business verification takes 1–2 business days after submission."}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {(customer.kyb_status === "PENDING" || customer.kyb_status === "REJECTED") ? (
                <Button asChild>
                  <Link to="/kyb">{customer.kyb_status === "REJECTED" ? "Update KYB" : "Complete KYB"} <ArrowRight className="h-4 w-4 ml-1.5" /></Link>
                </Button>
              ) : (
                <Badge variant="outline">{customer.kyb_status.replace("_", " ")}</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Balance + stats */}
      <div className="grid md:grid-cols-3 gap-6 mb-8">
        <div className="md:col-span-2 relative overflow-hidden rounded-2xl bg-secondary text-secondary-foreground p-7 shadow-sm-soft">
          <div
            aria-hidden
            className="absolute -right-10 top-6 h-48 w-48 rounded-full bg-primary/10 pointer-events-none"
          />
          <p className="eyebrow text-primary/70">USDC balance · Stellar</p>
          <div className="mt-3 flex items-baseline gap-1">
            <span className="text-3xl font-bold">$</span>
            <span className="text-6xl font-extrabold tracking-tightest leading-none">{fmtUSDC(balance).replace(/[^\d.]/g, "") || "0.00"}</span>
          </div>
          <p className="mt-1 text-xs font-bold tracking-wider uppercase opacity-70">USDC</p>
          <div className="mt-12 text-sm opacity-80 flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-60" />
            {customer?.stellar_wallet_address ?? "Wallet provisioned after KYB approval"}
          </div>
        </div>

        <Card>
          <CardContent className="py-6 space-y-5">
            <p className="eyebrow eyebrow-muted">This year</p>
            <div>
              <div className="text-5xl font-extrabold tracking-tightest text-primary leading-none">{orders.length}</div>
              <div className="text-sm text-muted-foreground mt-1">orders to date</div>
            </div>
            <div>
              <div className="text-3xl font-extrabold tracking-tightest text-primary leading-none">
                ${fmtUSDC(orders.reduce((s, o) => s + Number(o.usdc_amount), 0)).replace(/[^\d.]/g, "") || "0"}
              </div>
              <div className="text-sm text-muted-foreground mt-1">total USDC received</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent orders */}
      <Card>
        <CardContent className="p-0">
          <div className="px-6 py-5 border-b border-border">
            <h2 className="text-lg font-bold tracking-tightest text-primary">Recent orders</h2>
          </div>
          {orders.length === 0 ? (
            <div className="py-16 flex flex-col items-center text-center gap-3">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-primary">
                <ArrowLeftRight className="h-5 w-5" />
              </span>
              <div className="text-muted-foreground">
                No orders yet.{" "}
                <Link to="/convert" className="text-accent font-semibold hover:underline">Start your first conversion.</Link>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto px-6 pb-4">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="py-3 font-semibold uppercase tracking-wider text-xs">Reference</th>
                    <th className="font-semibold uppercase tracking-wider text-xs">USDC</th>
                    <th className="font-semibold uppercase tracking-wider text-xs">HTG</th>
                    <th className="font-semibold uppercase tracking-wider text-xs">Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40 transition-colors">
                      <td className="py-3 font-mono text-xs">{o.reference_number}</td>
                      <td>{fmtUSDC(Number(o.usdc_amount))}</td>
                      <td>{fmtHTG(Number(o.htg_amount))}</td>
                      <td><StatusBadge status={o.status} /></td>
                      <td className="text-right"><Button asChild size="sm" variant="ghost"><Link to={`/orders/${o.id}`}>View</Link></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </AppLayout>
  );
}
