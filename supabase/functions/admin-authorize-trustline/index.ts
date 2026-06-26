import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "npm:@stellar/stellar-sdk@13.1.0";

const HORIZON_URL = "https://horizon-testnet.stellar.org";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
  if (!roleRow) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { trustor?: string; asset_code?: string } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const trustor = body.trustor;
  const assetCode = body.asset_code ?? "USDC";
  if (!trustor) {
    return new Response(JSON.stringify({ error: "trustor required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const issuerSecret = Deno.env.get("STELLAR_USDC_ISSUER_SECRET") ?? Deno.env.get("STELLAR_HTGC_ISSUER_SECRET");
  if (!issuerSecret) {
    return new Response(JSON.stringify({ error: "issuer secret not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const server = new Horizon.Server(HORIZON_URL);
    const issuerKp = Keypair.fromSecret(issuerSecret);
    const issuerAcct = await server.loadAccount(issuerKp.publicKey());
    const tx = new TransactionBuilder(issuerAcct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.setTrustLineFlags({
        trustor,
        asset: new Asset(assetCode, issuerKp.publicKey()),
        flags: { authorized: true },
      }))
      .setTimeout(60)
      .build();
    tx.sign(issuerKp);
    const res = await server.submitTransaction(tx);
    return new Response(JSON.stringify({ ok: true, hash: res.hash, issuer: issuerKp.publicKey() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const err = e as { response?: { data?: unknown }; message?: string };
    return new Response(JSON.stringify({ error: err.message, data: err.response?.data }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
