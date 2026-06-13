/**
 * set-wallet-home-domain
 *
 * Sets home_domain = "theokingdom.com" on a customer Stellar wallet via
 * a SET_OPTIONS transaction. Called automatically when a federation address
 * is created in Settings, so stellar.expert can resolve the alias.
 *
 * Body: { stellar_address: string }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  BASE_FEE,
  Horizon,
  Networks,
  Operation,
  TransactionBuilder,
} from "npm:@stellar/stellar-sdk@12.3.0";
import { signWithSecret } from "../_shared/stellar-signer.ts";
import { corsHeaders } from "../_shared/cors.ts";

const HOME_DOMAIN   = "theokingdom.com";
const HORIZON_URL   = "https://horizon-testnet.stellar.org";
const NETWORK_PASS  = Networks.TESTNET;

Deno.serve(async (req) => {
  const headers = corsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { headers });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // ── Auth ─────────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const { stellar_address } = await req.json();
  if (!stellar_address) return json({ error: "stellar_address required" }, 400);

  const admin = createClient(supabaseUrl, serviceKey);

  // ── Verify caller owns this wallet ───────────────────────────────────────────
  const { data: wallet } = await admin
    .from("wallets")
    .select("stellar_secret, customer_id")
    .eq("stellar_address", stellar_address)
    .maybeSingle();

  if (!wallet) return json({ error: "Wallet not found" }, 404);

  // Check ownership via customers row or org membership
  const { data: customer } = await admin
    .from("customers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  const { data: membership } = await admin
    .from("org_members")
    .select("customer_id")
    .eq("user_id", user.id)
    .not("accepted_at", "is", null)
    .maybeSingle();

  const effectiveCustomerId = customer?.id ?? membership?.customer_id;
  if (!effectiveCustomerId || effectiveCustomerId !== wallet.customer_id) {
    return json({ error: "Forbidden" }, 403);
  }

  // ── Check if home_domain already correct ─────────────────────────────────────
  const server = new Horizon.Server(HORIZON_URL);
  const account = await server.loadAccount(stellar_address);

  if ((account as any).home_domain === HOME_DOMAIN) {
    return json({ ok: true, skipped: true, reason: "home_domain already set" });
  }

  // ── Build + sign SET_OPTIONS transaction ─────────────────────────────────────
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASS,
  })
    .addOperation(Operation.setOptions({ homeDomain: HOME_DOMAIN }))
    .setTimeout(30)
    .build();

  signWithSecret(tx, wallet.stellar_secret);

  const result = await server.submitTransaction(tx);

  return json({ ok: true, hash: result.hash });
});
