import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Calculator, Lock, ShieldCheck } from "lucide-react";
import { useAuth, useRoles } from "@/lib/auth";

type KybStatus = "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";
type CustomerProfile = {
  kyb_status: KybStatus;
  stellar_wallet_address: string | null;
};

export default function Convert() {
  const [usdc, setUsdc] = useState<string>("10000");
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin } = useRoles();

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    setProfileLoading(true);

    supabase
      .from("customers")
      .select("kyb_status, stellar_wallet_address")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          toast.error("Could not load KYB status");
          setProfile(null);
        } else {
          setProfile(data as CustomerProfile | null);
        }
        setProfileLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (profile?.kyb_status !== "APPROVED") {
      toast.error("KYB approval is required before requesting quotes");
      return;
    }
    const amount = Number(usdc);
    if (!Number.isFinite(amount) || amount < 1000 || amount > 50000) {
      toast.error("Enter an amount between 1,000 and 50,000 USDC");
      return;
    }
    try {
      setBusy(true);
      const { data, error } = await supabase.functions.invoke("create-quote", { body: { usdc_amount: amount } });
      if (error || data?.error) {
        toast.error(data?.error || error?.message || "Quote failed");
        return;
      }
      toast.success(`Quote locked. Reference ${data.reference_number}`);
      navigate(`/orders/${data.quote_id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Quote failed");
    } finally {
      setBusy(false);
    }
  };

  const approveTestKyb = async () => {
    if (!user) return;

    setBusy(true);
    const { data, error } = await supabase
      .from("customers")
      .update({
        kyb_status: "APPROVED",
        stellar_wallet_address: profile?.stellar_wallet_address ?? "GTESTNETCUSTOMERPLACEHOLDER000000000000000000000000000000000",
      })
      .eq("user_id", user.id)
      .select("kyb_status, stellar_wallet_address")
      .maybeSingle();
    setBusy(false);

    if (error) {
      toast.error(error.message || "Could not approve KYB");
      return;
    }

    setProfile(data as CustomerProfile | null);
    toast.success("KYB approved for testing");
  };

  const canRequestQuote = profile?.kyb_status === "APPROVED" && !profileLoading;

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

              {!canRequestQuote && (
                <div className="rounded-xl border bg-muted/40 p-4 text-sm space-y-2">
                  <div className="flex items-center gap-2 font-medium">
                    <ShieldCheck className="h-4 w-4 text-primary" /> KYB approval required
                  </div>
                  <p className="text-muted-foreground">
                    {profileLoading
                      ? "Checking your business verification status…"
                      : profile?.kyb_status === "UNDER_REVIEW"
                      ? "Your KYB submission is under review. We'll email you once it's approved."
                      : profile?.kyb_status === "REJECTED"
                      ? "Your KYB needs changes. Please update your submission to continue."
                      : "Submit your business details to unlock conversions."}
                  </p>
                  {!profileLoading && (profile?.kyb_status === "PENDING" || profile?.kyb_status === "REJECTED") && (
                    <Button asChild type="button" className="mt-1">
                      <Link to="/kyb">{profile?.kyb_status === "REJECTED" ? "Update KYB" : "Start KYB"}</Link>
                    </Button>
                  )}
                  {isAdmin && !profileLoading && profile?.kyb_status !== "APPROVED" && (
                    <Button type="button" variant="outline" className="mt-2" disabled={busy} onClick={approveTestKyb}>
                      Approve test KYB
                    </Button>
                  )}
                </div>
              )}

              <Button type="submit" size="lg" className="w-full" disabled={busy || !canRequestQuote}>
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
