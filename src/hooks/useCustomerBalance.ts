import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchHorizonBalances } from "@/lib/balance";

/**
 * Shared customer balance hook.
 * Sums live Horizon USDC + HTG-C balances across ALL wallets in the `wallets`
 * table belonging to the current customer.
 */
export function useCustomerBalance() {
  const [total, setTotal] = useState(0);
  const [htgcTotal, setHtgcTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setTotal(0); setHtgcTotal(0); setLoading(false); return; }
    // Resolve effective customer — org member takes priority over own row
    // (every new user gets an auto-created customers row from the trigger,
    //  so we must check org_members first to avoid reading the blank own row)
    let cid: string | null = null;
    const { data: mem } = await supabase.from("org_members").select("customer_id").eq("user_id", auth.user.id).not("accepted_at", "is", null).maybeSingle();
    if (mem?.customer_id) {
      cid = mem.customer_id;
    } else {
      const { data: own } = await supabase.from("customers").select("id").eq("user_id", auth.user.id).maybeSingle();
      cid = own?.id ?? null;
    }
    const c = cid ? { id: cid } : null;
    if (!c) {
      setTotal(0);
      setHtgcTotal(0);
      setLoading(false);
      return;
    }
    const { data: ws } = await supabase
      .from("wallets")
      .select("stellar_address")
      .eq("customer_id", c.id);
    const addrs = (ws ?? []).map((w) => w.stellar_address).filter(Boolean);
    const balances = await Promise.all(addrs.map((a) => fetchHorizonBalances(a)));
    setTotal(balances.reduce((s, v) => s + v.usdc, 0));
    setHtgcTotal(balances.reduce((s, v) => s + v.htgc, 0));
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { total, htgcTotal, loading, refresh };
}
