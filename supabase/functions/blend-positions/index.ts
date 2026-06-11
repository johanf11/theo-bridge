// List the current customer's yield positions with live-accrued interest.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { resolveCustomerId } from "../_shared/resolve-customer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Fallback yield config if no positions yet.
const DEFAULT_GROSS_APY = 0.09;
const DEFAULT_NET_APY = 0.07;
const DEFAULT_FEE_BPS = 200;

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
    const customerId = await resolveCustomerId(admin, user.id);
    if (!customerId) return json({
      positions: [], grossApy: DEFAULT_GROSS_APY, netApy: DEFAULT_NET_APY, feeBps: DEFAULT_FEE_BPS,
    });
    const customer = { id: customerId };

    const { data: positions, error: posErr } = await admin
      .from("blend_positions")
      .select("id, wallet_id, pool_address, deposited_usdc, deposited_at, gross_apy, net_apy, fee_bps, last_tx_hash, last_synced_at")
      .eq("customer_id", customer.id);
    if (posErr) console.error("blend-positions query error", posErr);

    const walletIds = Array.from(new Set((positions ?? []).map((p) => p.wallet_id)));
    const { data: walletsData } = walletIds.length
      ? await admin.from("wallets").select("id, label, stellar_address").in("id", walletIds)
      : { data: [] as { id: string; label: string | null; stellar_address: string }[] };
    const walletMap = new Map((walletsData ?? []).map((w) => [w.id, w]));

    const now = Date.now();
    const out = (positions ?? []).map((p) => {
      const principal = Number(p.deposited_usdc);
      const netApy = Number(p.net_apy);
      const elapsedSec = (now - new Date(p.deposited_at).getTime()) / 1000;
      const years = elapsedSec / (365 * 24 * 3600);
      // Continuous compounding: accrued = P * (e^(r*t) - 1)
      const accrued = principal * (Math.exp(netApy * years) - 1);
      const w = walletMap.get(p.wallet_id);
      return {
        id: p.id,
        walletId: p.wallet_id,
        walletLabel: w?.label ?? "Wallet",
        walletAddress: w?.stellar_address ?? null,
        deposited: principal,
        accrued,
        grossApy: Number(p.gross_apy),
        netApy,
        feeBps: Number(p.fee_bps),
        depositedAt: p.deposited_at,
        lastTxHash: p.last_tx_hash,
        lastSyncedAt: p.last_synced_at,
        poolAddress: p.pool_address,
      };
    });

    // Surface a "current" config from the most-recent position, falling back to defaults.
    const newest = (positions ?? []).slice().sort(
      (a, b) => new Date(b.deposited_at).getTime() - new Date(a.deposited_at).getTime()
    )[0];

    return json({
      positions: out,
      grossApy: newest ? Number(newest.gross_apy) : DEFAULT_GROSS_APY,
      netApy: newest ? Number(newest.net_apy) : DEFAULT_NET_APY,
      feeBps: newest ? Number(newest.fee_bps) : DEFAULT_FEE_BPS,
      // Backwards-compat field used by older client code.
      apy: newest ? Number(newest.net_apy) : DEFAULT_NET_APY,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
