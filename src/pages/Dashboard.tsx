import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fmtUSDC, fmtHTG } from "@/lib/format";
import { ArrowRight, Wallet } from "lucide-react";
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

  return (
    <AppLayout>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <p className="text-muted-foreground text-sm">Welcome back</p>
          <h1 className="font-display text-3xl md:text-4xl font-bold">{customer?.company_name ?? "—"}</h1>
        </div>
        <Button asChild size="lg">
          <Link to="/convert">Start a conversion <ArrowRight className="h-4 w-4 ml-2" /></Link>
        </Button>
      </div>

      {customer && customer.kyb_status !== "APPROVED" && (
        <Card className="mb-6 border-warning/40 bg-warning/5">
          <CardContent className="py-4 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="font-semibold">
                {customer.kyb_status === "UNDER_REVIEW"
                  ? "KYB under review"
                  : customer.kyb_status === "REJECTED"
                  ? "KYB needs changes"
                  : "Complete your business verification"}
              </div>
              <p className="text-sm text-muted-foreground">
                {customer.kyb_status === "UNDER_REVIEW"
                  ? "We'll email you once your business is approved. This usually takes one business day."
                  : customer.kyb_status === "REJECTED"
                  ? "Please update your submission to continue."
                  : "You'll be able to request quotes once your business is approved."}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline">{customer.kyb_status.replace("_", " ")}</Badge>
              {(customer.kyb_status === "PENDING" || customer.kyb_status === "REJECTED") && (
                <Button asChild size="sm">
                  <Link to="/kyb">{customer.kyb_status === "REJECTED" ? "Update KYB" : "Start KYB"}</Link>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-3 gap-4 mb-8">
        <Card className="bg-primary text-primary-foreground border-0 shadow-sm-soft md:col-span-2">
          <CardHeader>
            <p className="eyebrow eyebrow-on-dark">USDC balance</p>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-bold tracking-tightest text-primary-foreground">{fmtUSDC(balance)}</div>
            <div className="mt-3 text-sm text-primary-foreground/80 flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              {customer?.stellar_wallet_address ?? "Wallet provisioning after KYB approval"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base font-medium text-muted-foreground">This year</CardTitle></CardHeader>
          <CardContent>
            <div className="font-display text-3xl font-bold">{orders.length}</div>
            <div className="text-sm text-muted-foreground">orders to date</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="font-display">Recent orders</CardTitle></CardHeader>
        <CardContent>
          {orders.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">No orders yet. <Link to="/convert" className="text-theo-blue font-medium hover:underline">Start your first conversion</Link>.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground border-b">
                  <tr><th className="py-2 font-medium">Reference</th><th className="font-medium">USDC</th><th className="font-medium">HTG</th><th className="font-medium">Status</th><th></th></tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id} className="border-b last:border-0 hover:bg-muted/40">
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
