// Release USDC on Stellar testnet. FUNDED -> RELEASING -> COMPLETED|FAILED.
// If the distributor's USDC balance is below the order amount, the issuer
// automatically mints the shortfall to the distributor first.
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
    const issuerSecret = Deno.env.get("STELLAR_HTGC_ISSUER_SECRET"); // also controls USDC on testnet
    if (!distributorSecret || !usdcIssuer) throw new Error("Stellar secrets not configured");

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
    const distributor = Keypair.fromSecret(distributorSecret);

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
    const sourceAccount = await server.loadAccount(distributor.publicKey());
    const usdc = new Asset("USDC", usdcIssuer);
    const amount = Number(locked.usdc_amount).toFixed(7);

    // Auto-top-up: if distributor USDC balance < order amount, mint shortfall from issuer
    const usdcBal = (sourceAccount.balances as Array<{ asset_code?: string; asset_issuer?: string; balance: string }>)
      .find((b) => b.asset_code === "USDC" && b.asset_issuer === usdcIssuer);
    const currentBal = parseFloat(usdcBal?.balance ?? "0");
    const needed = parseFloat(amount);
    if (currentBal < needed) {
      if (!issuerSecret) throw new Error("Distributor USDC insufficient and STELLAR_HTGC_ISSUER_SECRET not set");
      const topUp = (needed - currentBal + 1000).toFixed(7); // shortfall + 1 000 USDC buffer
      const issuerKp = Keypair.fromSecret(issuerSecret);
      const issuerAcct = await server.loadAccount(issuerKp.publicKey());
      const mintTx = new TransactionBuilder(issuerAcct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(Operation.payment({ destination: distributor.publicKey(), asset: usdc, amount: topUp }))
        .setTimeout(60)
        .build();
      mintTx.sign(issuerKp);
      await server.submitTransaction(mintTx);
      console.log(`Auto-minted ${topUp} USDC to distributor (was ${currentBal}, needed ${needed})`);
      // Reload distributor account so sequence number is fresh for the next tx
      const refreshed = await server.loadAccount(distributor.publicKey());
      Object.assign(sourceAccount, refreshed);
    }

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
