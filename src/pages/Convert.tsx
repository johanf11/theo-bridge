import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtHTG, fmtRate, fmtUSDC } from "@/lib/format";
import { toast } from "sonner";
import { Calculator, Lock } from "lucide-react";

export default function Convert() {
  const [usdc, setUsdc] = useState<string>("10000");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(usdc);
    if (!Number.isFinite(amount) || amount < 1000 || amount > 50000) {
      toast.error("Enter an amount between 1,000 and 50,000 USDC");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("create-quote", { body: { usdc_amount: amount } });
    setBusy(false);
    if (error || data?.error) {
      toast.error(data?.error || error?.message || "Quote failed");
      return;
    }
    toast.success(`Quote locked. Reference ${data.reference_number}`);
    navigate(`/orders/${data.quote_id}`);
  };

  return (
    <AppLayout>
      <div className="mb-8">
        <p className="text-muted-foreground text-sm">New conversion</p>
        <h1 className="font-display text-3xl md:text-4xl font-bold">Convert HTG to USDC</h1>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <form onSubmit={submit} className="md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="font-display flex items-center gap-2">
                <Calculator className="h-5 w-5 text-theo-blue" /> Amount
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="usdc">USDC you want to receive</Label>
                <div className="relative">
                  <Input
                    id="usdc" type="number" min={1000} max={50000} step={1}
                    value={usdc} onChange={(e) => setUsdc(e.target.value)}
                    className="text-2xl h-14 pl-4 pr-20 font-display"
                    required
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 font-medium text-muted-foreground">USDC</span>
                </div>
                <div className="text-xs text-muted-foreground">Min $1,000 · Max $50,000 per order</div>
              </div>

              <div className="bg-theo-blue-soft rounded-xl p-4 text-sm space-y-1">
                <div className="flex items-center gap-2 text-theo-blue font-medium">
                  <Lock className="h-4 w-4" /> Rate locked for 15 minutes after quote
                </div>
                <p className="text-muted-foreground">Your final HTG amount and a unique payment reference will be issued the moment you confirm.</p>
              </div>

              <Button type="submit" size="lg" className="w-full" disabled={busy}>
                {busy ? "Generating quote…" : "Get quote"}
              </Button>
            </CardContent>
          </Card>
        </form>

        <Card className="bg-gradient-card">
          <CardHeader><CardTitle className="font-display text-lg">How it works</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            {[
              ["1", "Lock your rate", "We freeze the HTG/USDC rate for 15 minutes."],
              ["2", "Wire via SPIH", "Send HTG to our settlement account using the unique reference number."],
              ["3", "Receive USDC", "Once payment is matched, USDC is released to your Stellar wallet."],
            ].map(([n, t, d]) => (
              <div key={n} className="flex gap-3">
                <div className="h-7 w-7 rounded-full bg-theo-blue text-white flex items-center justify-center font-semibold shrink-0">{n}</div>
                <div>
                  <div className="font-semibold">{t}</div>
                  <div className="text-muted-foreground">{d}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
