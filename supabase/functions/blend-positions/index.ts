// List the current customer's Blend positions (DB-tracked, augmented with wallet labels).
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, service);
    const { data: customer } = await admin.from("customers").select("id").eq("user_id", user.id).maybeSingle();
    if (!customer) return json({ positions: [], apy: 0.092 });

    const { data: positions } = await admin
      .from("blend_positions")
      .select("id, wallet_id, pool_address, deposited_usdc, last_tx_hash, last_synced_at, wallets(label, stellar_address)")
      .eq("customer_id", customer.id);

    const out = (positions ?? []).map((p) => ({
      id: p.id,
      walletId: p.wallet_id,
      walletLabel: (p.wallets as { label: string | null } | null)?.label ?? "Wallet",
      walletAddress: (p.wallets as { stellar_address: string } | null)?.stellar_address ?? null,
      deposited: Number(p.deposited_usdc),
      lastTxHash: p.last_tx_hash,
      lastSyncedAt: p.last_synced_at,
      poolAddress: p.pool_address,
    }));

    // APY is currently a constant; can be replaced with live pool oracle read later.
    return json({ positions: out, apy: 0.092 });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
