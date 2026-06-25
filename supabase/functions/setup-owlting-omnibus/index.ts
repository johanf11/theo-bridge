// Admin-only: create (or return existing) Owlting omnibus collector wallet.
// Generates a fresh Stellar testnet keypair, funds it via friendbot, opens
// USDC trustline (HTGC too for safety), and stores the address + secret in
// public.app_settings under key `owlting_omnibus_address`.
//
// Demo only: in mainnet this wallet would be managed by Owlting and we'd
// store only the address (no secret).

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder,
} from "npm:@stellar/stellar-sdk@12.3.0";
import { HTGC_ISSUER } from "../_shared/stellar-assets.ts";
import { corsHeaders } from "../_shared/cors.ts";

const HORIZON_URL = "https://horizon-testnet.stellar.org";

Deno.serve(async (req) => {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers });

  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...headers, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const usdcIssuer = Deno.env.get("STELLAR_USDC_ISSUER")!;
    const usdcIssuerSecret = Deno.env.get("STELLAR_USDC_ISSUER_SECRET");
    const htgcIssuerSecret = Deno.env.get("STELLAR_HTGC_ISSUER_SECRET");

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, service);
    const { data: role } = await admin.from("user_roles")
      .select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!role) return json({ error: "Admin only" }, 403);

    // 1) If we already have an omnibus address, return it.
    const { data: existing } = await admin.from("app_settings")
      .select("value").eq("key", "owlting_omnibus_address").maybeSingle();
    if (existing?.value?.address) {
      return json({ ok: true, alreadyExists: true, address: existing.value.address });
    }

    // 2) Generate keypair + friendbot fund.
    const kp = Keypair.random();
    const publicKey = kp.publicKey();

    const fb = await fetch(`https://friendbot.stellar.org/?addr=${publicKey}`);
    if (!fb.ok) return json({ error: "Friendbot funding failed", detail: await fb.text() }, 502);

    // 3) Trustlines.
    const server = new Horizon.Server(HORIZON_URL);
    const usdc = new Asset("USDC", usdcIssuer);
    const htgc = new Asset("HTGC", HTGC_ISSUER);

    async function trust(asset: Asset) {
      const acct = await server.loadAccount(publicKey);
      const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(Operation.changeTrust({ asset }))
        .setTimeout(60).build();
      tx.sign(kp);
      await server.submitTransaction(tx);
    }
    const trustResults: Array<{ asset: string; ok: boolean; error?: string }> = [];
    for (const [code, asset] of [["USDC", usdc], ["HTGC", htgc]] as const) {
      try { await trust(asset); trustResults.push({ asset: code, ok: true }); }
      catch (e) { trustResults.push({ asset: code, ok: false, error: (e as Error).message.slice(0, 300) }); }
    }

    // 4) Authorize trustlines from issuers.
    async function authFrom(issuerSecret: string, asset: Asset) {
      const issuerKp = Keypair.fromSecret(issuerSecret);
      const issuerAcct = await server.loadAccount(issuerKp.publicKey());
      const tx = new TransactionBuilder(issuerAcct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(Operation.setTrustLineFlags({ trustor: publicKey, asset, flags: { authorized: true } }))
        .setTimeout(60).build();
      tx.sign(issuerKp);
      await server.submitTransaction(tx);
    }
    if (usdcIssuerSecret) { try { await authFrom(usdcIssuerSecret, usdc); } catch (e) { console.warn("USDC auth:", (e as Error).message); } }
    if (htgcIssuerSecret) { try { await authFrom(htgcIssuerSecret, htgc); } catch (e) { console.warn("HTGC auth:", (e as Error).message); } }

    // 5) Persist (address + secret) in app_settings — admin-only readable.
    const value = { address: publicKey, secret: kp.secret(), created_at: new Date().toISOString() };
    const { error: upErr } = await admin.from("app_settings")
      .upsert({ key: "owlting_omnibus_address", value, updated_at: new Date().toISOString() });
    if (upErr) return json({ error: upErr.message }, 500);

    return json({ ok: true, address: publicKey, trustlines: trustResults });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
