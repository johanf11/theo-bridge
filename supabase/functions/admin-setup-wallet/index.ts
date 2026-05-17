// Admin-only: run ensureWalletReady for a given wallet id.
// Idempotent — opens USDC + HTGC trustlines and authorizes HTGC if needed.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Horizon } from "npm:@stellar/stellar-sdk@12.3.0";
import { ensureWalletReady } from "../_shared/ensure-wallet-ready.ts";

const HORIZON_URL = "https://horizon-testnet.stellar.org";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const usdcIssuer = Deno.env.get("STELLAR_USDC_ISSUER");
    const htgcIssuerSecret = Deno.env.get("STELLAR_HTGC_ISSUER_SECRET") ?? undefined;
    if (!usdcIssuer) return json({ error: "STELLAR_USDC_ISSUER not configured" }, 500);

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: ue } = await userClient.auth.getUser();
    if (ue || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, service);
    const { data: roleRow } = await admin
      .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ error: "Forbidden — admin only" }, 403);

    const body = await req.json().catch(() => ({}));
    const { walletId } = body as { walletId?: string };
    if (!walletId) return json({ error: "walletId required" }, 400);

    const { data: wallet } = await admin
      .from("wallets")
      .select("stellar_address, stellar_secret")
      .eq("id", walletId)
      .maybeSingle();
    if (!wallet) return json({ error: "Wallet not found" }, 404);
    if (!wallet.stellar_secret) return json({ error: "Wallet has no signing key" }, 400);

    const server = new Horizon.Server(HORIZON_URL);
    const result = await ensureWalletReady({
      server,
      address: wallet.stellar_address,
      secret: wallet.stellar_secret,
      usdcIssuer,
      htgcIssuerSecret,
    });

    if (!result.ok) return json({ error: result.error }, 502);
    return json({ ok: true, healed: result.healed });
  } catch (e) {
    console.error("admin-setup-wallet error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
