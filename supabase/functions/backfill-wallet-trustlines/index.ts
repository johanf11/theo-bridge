// Admin-only one-shot: walks every Theo-owned wallet and runs ensureWalletReady
// on each. Fixes legacy wallets that were created before the auth-trustline
// flow existed. Safe to re-run anytime — it's a no-op for healthy wallets.
//
// Also wired as a daily cron to catch drift in production.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Horizon } from "npm:@stellar/stellar-sdk@12.3.0";
import { ensureWalletReady } from "../_shared/ensure-wallet-ready.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const HORIZON_URL = "https://horizon-testnet.stellar.org";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const usdcIssuer = Deno.env.get("STELLAR_USDC_ISSUER");
    const htgcIssuerSecret = Deno.env.get("STELLAR_HTGC_ISSUER_SECRET");
    if (!usdcIssuer) return json({ error: "STELLAR_USDC_ISSUER not configured" }, 500);
    if (!htgcIssuerSecret) return json({ error: "STELLAR_HTGC_ISSUER_SECRET not configured" }, 500);

    // Auth: admin user OR cron (uses service role apikey + our shared secret OR no auth header for cron-via-pg_net)
    const authHeader = req.headers.get("Authorization");
    const cronHeader = req.headers.get("x-cron-secret");
    const isCron = cronHeader && cronHeader === Deno.env.get("CRON_SECRET");
    if (!isCron) {
      if (!authHeader) return json({ error: "Unauthorized" }, 401);
      const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
      const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return json({ error: "Unauthorized" }, 401);
      const admin0 = createClient(url, service);
      const { data: roleRow } = await admin0
        .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
      if (!roleRow) return json({ error: "Admin only" }, 403);
    }

    const admin = createClient(url, service);
    const { data: wallets, error } = await admin
      .from("wallets")
      .select("id, label, stellar_address, stellar_secret, customer_id");
    if (error) return json({ error: error.message }, 500);

    const server = new Horizon.Server(HORIZON_URL);
    const results: { id: string; label: string | null; address: string; ok: boolean; healed?: string[]; error?: string }[] = [];

    for (const w of wallets ?? []) {
      if (!w.stellar_secret) {
        results.push({ id: w.id, label: w.label, address: w.stellar_address, ok: false, error: "no signing key" });
        continue;
      }
      const r = await ensureWalletReady({
        server, address: w.stellar_address, secret: w.stellar_secret,
        usdcIssuer, htgcIssuerSecret,
      });
      if (r.ok) results.push({ id: w.id, label: w.label, address: w.stellar_address, ok: true, healed: r.healed });
      else results.push({ id: w.id, label: w.label, address: w.stellar_address, ok: false, error: r.error });
    }

    const summary = {
      total: results.length,
      healthy: results.filter((r) => r.ok && (r.healed?.length ?? 0) === 0).length,
      healed: results.filter((r) => r.ok && (r.healed?.length ?? 0) > 0).length,
      failed: results.filter((r) => !r.ok).length,
    };
    return json({ ok: true, summary, results });
  } catch (e) {
    console.error("backfill-wallet-trustlines error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
