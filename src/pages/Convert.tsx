import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { DollarSign, Info, ShieldCheck } from "lucide-react";
import { useAuth, useRoles } from "@/lib/auth";

type KybStatus = "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";
type CustomerProfile = {
  kyb_status: KybStatus;
  stellar_wallet_address: string | null;
};

const STEPS = [
  ["Lock your rate", "We freeze the HTG/USDC rate for 15 minutes while you arrange payment."],
  ["Wire via SPIH", "Send HTG to our settlement account using the unique reference number provided."],
  ["Receive USDC", "Once matched, USDC arrives in your Stellar wallet in under 2 minutes."],
];

export default function Convert() {
  const [usdc, setUsdc] = useState<string>("10000");
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [spotRate, setSpotRate] = useState<number | null>(null);
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
      .then(({ data }) => {
        if (cancelled) return;
        setProfile(data as CustomerProfile | null);
        setProfileLoading(false);
      });

    supabase
      .from("rate_snapshots")
      .select("spot_rate")
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data?.spot_rate) setSpotRate(Number(data.spot_rate) + 5);
      });

    return () => { cancelled = true; };
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
    } finally {
      setBusy(false);
    }
  };

  const approveTestKyb = async () => {
    if (!user) return;
    setBusy(true);
    const { data } = await supabase
      .from("customers")
      .update({
        kyb_status: "APPROVED",
        stellar_wallet_address: profile?.stellar_wallet_address ?? "GTESTNETCUSTOMERPLACEHOLDER000000000000000000000000000000000",
      })
      .eq("user_id", user.id)
      .select("kyb_status, stellar_wallet_address")
      .maybeSingle();
    setBusy(false);
    setProfile(data as CustomerProfile | null);
    toast.success("KYB approved for testing");
  };

  const canRequestQuote = profile?.kyb_status === "APPROVED" && !profileLoading;

  return (
    <AppLayout>
      <div className="mb-8">
        <p className="eyebrow">New conversion</p>
        <h1 className="mt-2 text-3xl md:text-4xl font-extrabold tracking-tightest">Convert HTG to USDC</h1>
        <hr className="gold-rule mt-3" />
      </div>

      <div className="grid lg:grid-cols-[1fr,300px] gap-6 items-start">
        <form onSubmit={submit} className="space-y-6">
          <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-xs">
            <div className="bg-muted px-6 py-4 flex items-center gap-2 text-primary font-semibold">
              <DollarSign className="h-4 w-4" /> Amount
            </div>
            <div className="p-6 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="usdc" className="eyebrow eyebrow-muted">USDC you want to receive</Label>
                <div className="relative">
                  <Input
                    id="usdc" type="number" min={1000} max={50000} step={1}
                    value={usdc} onChange={(e) => setUsdc(e.target.value)}
                    className="text-xl h-14 pl-4 pr-20 font-semibold rounded-xl"
                    required
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold uppercase tracking-wider text-muted-foreground">USDC</span>
                </div>
                <div className="text-xs text-muted-foreground">Min $1,000 · Max $50,000 per order</div>
              </div>

              <div className="rounded-xl bg-accent/10 border border-accent/30 p-4 text-sm flex items-start gap-3">
                <Info className="h-4 w-4 text-accent shrink-0 mt-0.5" />
                <p>
                  <span className="font-semibold text-primary">Rate locked for 15 minutes after quote.</span>{" "}
                  <span className="text-muted-foreground">Your final HTG amount and a unique payment reference will be issued when you confirm.</span>
                </p>
              </div>

              {!canRequestQuote && (
                <div className="rounded-xl bg-secondary/15 border border-secondary/40 p-4 text-sm flex items-start gap-3">
                  <ShieldCheck className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <div className="space-y-2 flex-1">
                    <p>
                      <span className="font-semibold text-primary">KYB approval required</span>{" "}
                      <span className="text-muted-foreground">to unlock conversions.</span>
                    </p>
                    {!profileLoading && (profile?.kyb_status === "PENDING" || profile?.kyb_status === "REJECTED") && (
                      <Button asChild type="button" size="sm">
                        <Link to="/kyb">{profile?.kyb_status === "REJECTED" ? "Update KYB" : "Start KYB"}</Link>
                      </Button>
                    )}
                    {isAdmin && !profileLoading && profile?.kyb_status !== "APPROVED" && (
                      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={approveTestKyb}>
                        Approve test KYB
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <Button type="submit" size="lg" className="w-full h-14 text-base" disabled={busy || !canRequestQuote}>
            {busy ? "Generating quote…" : "Get quote"}
          </Button>
        </form>

        {/* Sidebar */}
        <aside className="space-y-6 lg:sticky lg:top-6">
          <div className="bg-card rounded-2xl border border-border p-6 shadow-xs">
            <p className="eyebrow eyebrow-muted">How it works</p>
            <ol className="mt-4 space-y-5">
              {STEPS.map(([title, desc], i) => (
                <li key={title} className="flex gap-3">
                  <span className="h-7 w-7 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
                    {i + 1}
                  </span>
                  <div className="text-sm">
                    <div className="font-semibold text-primary">{title}</div>
                    <div className="text-muted-foreground mt-1 leading-snug">{desc}</div>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="bg-card rounded-2xl border border-border p-6 shadow-xs">
            <p className="eyebrow eyebrow-muted">Current rate</p>
            <div className="mt-2 text-4xl font-extrabold tracking-tightest text-primary">
              {spotRate ? spotRate.toFixed(2) : "—"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">HTG per USDC</div>
            <div className="mt-3 flex items-center gap-2 text-xs">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-accent" />
              </span>
              <span className="text-accent font-semibold">Live</span>
            </div>
          </div>
        </aside>
      </div>
    </AppLayout>
  );
}
