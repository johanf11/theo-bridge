import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import {
  Keypair,
  Horizon,
  TransactionBuilder,
  Operation,
  Asset,
  Networks,
  BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";

const HORIZON_URL = "https://horizon-testnet.stellar.org";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: claims, error: cErr } = await supabase.auth.getClaims(
      authHeader.replace("Bearer ", "")
    );
    if (cErr || !claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const label = String(body.label ?? "").trim().slice(0, 60) || "New account";

    // Find caller's customer record
    const { data: customer, error: custErr } = await supabase
      .from("customers")
      .select("id")
      .maybeSingle();
    if (custErr || !customer) {
      return new Response(JSON.stringify({ error: "Customer not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const issuer = Deno.env.get("STELLAR_USDC_ISSUER");
    const distributorSecret = Deno.env.get("STELLAR_DISTRIBUTOR_SECRET");
    if (!issuer || !distributorSecret) {
      return new Response(JSON.stringify({ error: "Stellar config missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Generate keypair
    const kp = Keypair.random();
    const publicKey = kp.publicKey();
    const secret = kp.secret();

    // 2. Friendbot fund
    const fb = await fetch(`https://friendbot.stellar.org/?addr=${publicKey}`);
    if (!fb.ok) {
      const txt = await fb.text();
      return new Response(JSON.stringify({ error: "Friendbot funding failed", detail: txt }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Establish trustlines (USDC + HTG-C) — signed by the new account itself.
    const server = new Horizon.Server(HORIZON_URL);
    const distributorKp = Keypair.fromSecret(distributorSecret);
    const usdc = new Asset("USDC", issuer);
    const htgc = new Asset("HTGC", distributorKp.publicKey());

    async function trust(asset: Asset) {
      const acct = await server.loadAccount(publicKey);
      const tx = new TransactionBuilder(acct, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(Operation.changeTrust({ asset }))
        .setTimeout(60)
        .build();
      tx.sign(kp);
      await server.submitTransaction(tx);
    }

    // Submit independently so one failure doesn't block the other.
    const trustResults: { asset: string; ok: boolean; error?: string }[] = [];
    for (const [code, asset] of [["USDC", usdc], ["HTGC", htgc]] as const) {
      try {
        await trust(asset);
        trustResults.push({ asset: code, ok: true });
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: unknown } })?.response?.data
          ? JSON.stringify((err as { response: { data: unknown } }).response.data)
          : (err as Error).message;
        trustResults.push({ asset: code, ok: false, error: String(msg).slice(0, 500) });
        console.error(`trustline ${code} failed for ${publicKey}`, msg);
      }
    }

    // 4. Persist (service role bypasses RLS; trustworthy because user verified above)
    const { data: inserted, error: insErr } = await admin
      .from("wallets")
      .insert({
        customer_id: customer.id,
        label,
        stellar_address: publicKey,
        stellar_secret: secret,
        wallet_type: "CUSTOMER",
        currency: "USDC",
        network: "Stellar",
      })
      .select("id, label, stellar_address")
      .single();

    if (insErr) {
      return new Response(JSON.stringify({ error: insErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ wallet: inserted, public_key: publicKey, trustlines: trustResults }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
