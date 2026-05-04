import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchHorizonUsdcBalance } from "@/lib/balance";

/**
 * Shared customer balance hook.
 * Sums live Horizon USDC balances across ALL wallets in the `wallets` table
 * belonging to the current customer. Never reads customers.stellar_wallet_address
 * or any hardcoded distributor/treasury address.
 */
export function useCustomerBalance() {
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: c } = await supabase.from("customers").select("id").maybeSingle();
    if (!c) {
      setTotal(0);
      setLoading(false);
      return;
    }
    const { data: ws } = await supabase
      .from("wallets")
      .select("stellar_address")
      .eq("customer_id", c.id);
    const addrs = (ws ?? []).map((w) => w.stellar_address).filter(Boolean);
    const balances = await Promise.all(addrs.map((a) => fetchHorizonUsdcBalance(a)));
    setTotal(balances.reduce((s, v) => s + v, 0));
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { total, loading, refresh };
}
