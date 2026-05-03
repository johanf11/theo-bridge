// Release USDC on Stellar testnet. FUNDED -> RELEASING -> COMPLETED|FAILED.
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset, Horizon, Keypair, Memo, Networks, Operation, TransactionBuilder, BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HORIZON = "https://horizon-testnet.stellar.org";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, service);

  let orderId: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    orderId = body.orderId;
    if (!orderId) {
      return new Response(JSON.stringify({ error: "orderId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const distributorSecret = Deno.env.get("STELLAR_DISTRIBUTOR_SECRET");
    const usdcIssuer = Deno.env.get("STELLAR_USDC_ISSUER");
    if (!distributorSecret || !usdcIssuer) throw new Error("Stellar secrets not configured");

    // Lock: FUNDED -> RELEASING
    const { data: locked, error: lockErr } = await admin
      .from("orders")
      .update({ status: "RELEASING" })
      .eq("id", orderId)
      .eq("status", "FUNDED")
      .select("id, usdc_amount, reference_number, customer_id")
      .maybeSingle();
    if (lockErr) throw lockErr;
    if (!locked) {
      return new Response(JSON.stringify({ error: "Order not in FUNDED state" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Customer wallet
    const { data: customer, error: cErr } = await admin
      .from("customers")
      .select("stellar_wallet_address")
      .eq("id", locked.customer_id)
      .maybeSingle();
    if (cErr) throw cErr;
    const dest = customer?.stellar_wallet_address;
    if (!dest || !dest.startsWith("G")) throw new Error("Customer has no Stellar wallet address");

    // Build & submit Stellar payment
    const server = new Horizon.Server(HORIZON);
    const distributor = Keypair.fromSecret(distributorSecret);
    const sourceAccount = await server.loadAccount(distributor.publicKey());
    const usdc = new Asset("USDC", usdcIssuer);
    const amount = Number(locked.usdc_amount).toFixed(7);

    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.payment({ destination: dest, asset: usdc, amount }))
      .addMemo(Memo.text(locked.reference_number.slice(0, 28)))
      .setTimeout(60)
      .build();
    tx.sign(distributor);

    const result = await server.submitTransaction(tx);
    const hash = (result as { hash: string }).hash;

    const now = new Date().toISOString();
    await admin
      .from("orders")
      .update({ status: "COMPLETED", stellar_tx_hash: hash, released_at: now, completed_at: now })
      .eq("id", orderId);

    return new Response(JSON.stringify({ ok: true, hash }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("release-usdc error", e);
    const msg = (e as { response?: { data?: { extras?: unknown } }; message?: string })?.response?.data
      ? JSON.stringify((e as { response: { data: unknown } }).response.data)
      : (e as Error).message;
    if (orderId) {
      await admin.from("orders")
        .update({ status: "FAILED", failure_reason: String(msg).slice(0, 1000) })
        .eq("id", orderId);
    }
    return new Response(JSON.stringify({ error: String(msg) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
