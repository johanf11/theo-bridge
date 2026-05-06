// Release USDC on Stellar testnet. FUNDED -> RELEASING -> COMPLETED|FAILED.
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset, Horizon, Memo, Networks, Operation, TransactionBuilder, BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";
import { distributorKeypair, signWithDistributor } from "../_shared/stellar-signer.ts";
import { assertWithinLimits } from "../_shared/tx-limits.ts";

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

    const usdcIssuer = Deno.env.get("STELLAR_USDC_ISSUER");
    if (!usdcIssuer) throw new Error("STELLAR_USDC_ISSUER not configured");

    // Lock: FUNDED -> RELEASING
    const { data: locked, error: lockErr } = await admin
      .from("orders")
      .update({ status: "RELEASING" })
      .eq("id", orderId)
      .eq("status", "FUNDED")
      .select("id, usdc_amount, reference_number, customer_id, destination_wallet_address, destination_stellar_address")
      .maybeSingle();
    if (lockErr) throw lockErr;
    if (!locked) {
      return new Response(JSON.stringify({ error: "Order not in FUNDED state" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build & submit Stellar payment
    const server = new Horizon.Server(HORIZON);
    const distributor = distributorKeypair();

    // Resolve destination: order-level override first, then customer's primary wallet
    let dest = (locked.destination_stellar_address ?? locked.destination_wallet_address) as string | null;
    if (!dest) {
      const { data: customer, error: cErr } = await admin
        .from("customers")
        .select("stellar_wallet_address")
        .eq("id", locked.customer_id)
        .maybeSingle();
      if (cErr) throw cErr;
      dest = customer?.stellar_wallet_address ?? null;
    }
    if (!dest || !dest.startsWith("G")) throw new Error("No Stellar destination wallet for this order");
    if (dest === distributor.publicKey()) throw new Error("Destination cannot be the distributor account");

    const usdcAmount = Number(locked.usdc_amount);
    assertWithinLimits(usdcAmount, "USDC release");

    const sourceAccount = await server.loadAccount(distributor.publicKey());
    const usdc = new Asset("USDC", usdcIssuer);

    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.payment({ destination: dest, asset: usdc, amount: usdcAmount.toFixed(7) }))
      .addMemo(Memo.text(locked.reference_number.slice(0, 28)))
      .setTimeout(60)
      .build();
    signWithDistributor(tx);

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
