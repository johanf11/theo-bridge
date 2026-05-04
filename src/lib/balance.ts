import { supabase } from "@/integrations/supabase/client";

/** Fetch live USDC balance for a Stellar address from Horizon testnet. */
export async function fetchHorizonUsdcBalance(address: string): Promise<number> {
  try {
    const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${address}`);
    if (!res.ok) return 0;
    const json = await res.json();
    const usdc = (json.balances ?? []).find((b: any) => b.asset_code === "USDC");
    return usdc ? Number(usdc.balance) : 0;
  } catch {
    return 0;
  }
}

/** Fetch both USDC and HTG-C balances in a single Horizon call. */
export async function fetchHorizonBalances(address: string): Promise<{ usdc: number; htgc: number }> {
  try {
    const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${address}`);
    if (!res.ok) return { usdc: 0, htgc: 0 };
    const json = await res.json();
    const bals: any[] = json.balances ?? [];
    const usdc = bals.find((b) => b.asset_code === "USDC");
    // Match any HTGC asset (the distributor is also the HTG-C issuer in this demo).
    const htgc = bals.find((b) => b.asset_code === "HTGC");
    return {
      usdc: usdc ? Number(usdc.balance) : 0,
      htgc: htgc ? Number(htgc.balance) : 0,
    };
  } catch {
    return { usdc: 0, htgc: 0 };
  }
}

/** Sum usdc_amount across COMPLETED orders for a customer. */
export async function fetchCompletedOrdersTotal(customerId: string): Promise<number> {
  const { data } = await supabase
    .from("orders")
    .select("usdc_amount")
    .eq("customer_id", customerId)
    .eq("status", "COMPLETED");
  return (data ?? []).reduce((s, o) => s + Number(o.usdc_amount), 0);
}

/**
 * Total balance: prefer live Horizon USDC for the customer's stellar wallet;
 * if that is 0 or unavailable, fall back to sum of completed orders.
 */
export async function fetchTotalUsdcBalance(
  customerId: string,
  stellarAddress: string | null
): Promise<number> {
  let live = 0;
  if (stellarAddress) live = await fetchHorizonUsdcBalance(stellarAddress);
  if (live > 0) return live;
  return fetchCompletedOrdersTotal(customerId);
}
