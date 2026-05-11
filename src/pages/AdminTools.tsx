import { useState } from "react";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, ShieldCheck, AlertCircle, CheckCircle2 } from "lucide-react";
import { IssuanceControls } from "@/components/theo/IssuanceControls";

type BackfillResult = {
  ok: boolean;
  checked: number;
  usdcAdded: number;
  htgcAdded: number;
  errors: { walletId: string; asset: string; error: string }[];
};

export default function AdminTools() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BackfillResult | null>(null);

  async function runBackfill() {
    setRunning(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("backfill-trustlines");
      if (error) throw error;
      setResult(data as BackfillResult);
      const r = data as BackfillResult;
      toast.success(
        `Checked ${r.checked} wallet${r.checked === 1 ? "" : "s"}. Added ${r.usdcAdded} USDC + ${r.htgcAdded} HTG-C trustline${r.usdcAdded + r.htgcAdded === 1 ? "" : "s"}.`
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto py-10 space-y-8">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-theo-cyan mb-2">
            Admin tools
          </p>
          <h1 className="text-3xl font-bold text-foreground">Operations</h1>
        </div>

        <IssuanceControls />

        <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
          <div className="flex items-start gap-4">
            <div className="rounded-[22%] bg-primary/10 p-3 text-primary">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-foreground">Backfill trustlines</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Walks every customer wallet and ensures USDC + HTG-C trustlines are
                established. Idempotent — wallets already trusting an asset are skipped.
              </p>
            </div>
          </div>

          <button
            onClick={runBackfill}
            disabled={running}
            className="w-full sm:w-auto rounded-[10px] bg-primary text-primary-foreground px-5 py-2.5 font-semibold text-sm disabled:opacity-60 inline-flex items-center gap-2"
          >
            {running ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Running…
              </>
            ) : (
              "Run backfill"
            )}
          </button>

          {result && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Checked" value={result.checked} />
                <Stat label="USDC added" value={result.usdcAdded} />
                <Stat label="HTG-C added" value={result.htgcAdded} />
              </div>

              {result.errors.length === 0 ? (
                <div className="flex items-center gap-2 rounded-xl bg-[hsl(var(--theo-cream))] border border-border p-3 text-sm text-foreground">
                  <CheckCircle2 className="h-4 w-4 text-[#1A7F37]" />
                  All wallets are healthy.
                </div>
              ) : (
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="flex items-center gap-2 bg-[#FDE8E8] text-[#B91C1C] px-4 py-2 text-xs font-bold uppercase tracking-wider">
                    <AlertCircle className="h-4 w-4" />
                    {result.errors.length} error{result.errors.length === 1 ? "" : "s"}
                  </div>
                  <div className="divide-y divide-border max-h-72 overflow-auto">
                    {result.errors.map((e, i) => (
                      <div key={i} className="px-4 py-2 text-xs">
                        <div className="font-mono text-foreground">
                          {e.walletId.slice(0, 8)}… · <span className="font-bold">{e.asset}</span>
                        </div>
                        <div className="text-muted-foreground mt-0.5 break-all">{e.error}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-[hsl(var(--theo-cream))] border border-border p-3">
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="text-2xl font-bold text-foreground mt-1">{value}</div>
    </div>
  );
}
