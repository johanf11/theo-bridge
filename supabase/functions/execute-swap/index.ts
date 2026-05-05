// Real on-chain HTG-C ↔ USDC swap on Stellar testnet.
// Two-leg flow:
//   leg 1: user wallet sends source asset to distributor (signed by stored wallet secret)
//   leg 2: distributor sends destination asset back to user (signed by STELLAR_DISTRIBUTOR_SECRET)
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset, Horizon, Keypair, Memo, Networks, Operation, TransactionBuilder, BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HORIZON_URL = "https://horizon-testnet.stellar.org";

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
    const distributorSecret = Deno.env.get("STELLAR_DISTRIBUTOR_SECRET");
    const usdcIssuer = Deno.env.get("STELLAR_USDC_ISSUER");
    if (!distributorSecret) return json({ error: "STELLAR_DISTRIBUTOR_SECRET not configured" }, 500);
    if (!usdcIssuer) return json({ error: "STELLAR_USDC_ISSUER not configured" }, 500);

    // Auth — verify caller
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: ue } = await userClient.auth.getUser();
    if (ue || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, service);

    // Customer
    const { data: customer } = await admin
      .from("customers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!customer) return json({ error: "Customer not found" }, 404);

    // Body
    const body = await req.json().catch(() => ({}));
    const { wallet_id, amount, direction } = body as {
      wallet_id?: string; amount?: number; direction?: "htgc_to_usdc" | "usdc_to_htgc";
    };
    if (!wallet_id) return json({ error: "wallet_id required" }, 400);
    if (direction !== "htgc_to_usdc" && direction !== "usdc_to_htgc") {
      return json({ error: "direction must be 'htgc_to_usdc' or 'usdc_to_htgc'" }, 400);
    }
    const parsedAmount = Number(amount);
    if (!parsedAmount || parsedAmount <= 0) return json({ error: "Valid amount required" }, 400);

    // Wallet (must belong to caller, must have signing key)
    const { data: wallet } = await admin
      .from("wallets")
      .select("id, stellar_address, stellar_secret")
      .eq("id", wallet_id)
      .eq("customer_id", customer.id)
      .maybeSingle();
    if (!wallet) return json({ error: "Wallet not found" }, 404);
    if (!wallet.stellar_secret) return json({ error: "Wallet has no signing key" }, 400);

    // Latest spot rate
    const { data: rateRow } = await admin
      .from("rate_snapshots")
      .select("spot_rate")
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const rate = Number(rateRow?.spot_rate);
    if (!rate || rate <= 0) return json({ error: "No spot rate available" }, 500);

    // Compute legs
    const distributor = Keypair.fromSecret(distributorSecret);
    const usdc = new Asset("USDC", usdcIssuer);
    const htgc = new Asset("HTGC", distributor.publicKey());

    let sourceAsset: Asset;
    let destAsset: Asset;
    let sourceAmount: number;
    let destAmount: number;
    let htgAmount: number;
    let usdcAmount: number;

    if (direction === "htgc_to_usdc") {
      sourceAsset = htgc;
      destAsset = usdc;
      sourceAmount = parsedAmount;
      destAmount = parsedAmount / rate;
      htgAmount = parsedAmount;
      usdcAmount = destAmount;
    } else {
      sourceAsset = usdc;
      destAsset = htgc;
      sourceAmount = parsedAmount;
      destAmount = parsedAmount * rate;
      usdcAmount = parsedAmount;
      htgAmount = destAmount;
    }

    const server = new Horizon.Server(HORIZON_URL);
    const userKp = Keypair.fromSecret(wallet.stellar_secret);

    // Ensure user wallet has trustline for destAsset (so leg 2 succeeds).
    try {
      const userAccount = await server.loadAccount(wallet.stellar_address);
      const code = destAsset.getCode();
      const issuer = destAsset.getIssuer();
      const hasTrust = userAccount.balances.some((b: { asset_type: string; asset_code?: string; asset_issuer?: string }) =>
        b.asset_type !== "native" && b.asset_code === code && b.asset_issuer === issuer
      );
      if (!hasTrust) {
        const trustTx = new TransactionBuilder(userAccount, {
          fee: BASE_FEE, networkPassphrase: Networks.TESTNET,
        })
          .addOperation(Operation.changeTrust({ asset: destAsset }))
          .setTimeout(60)
          .build();
        trustTx.sign(userKp);
        await server.submitTransaction(trustTx);
      }
    } catch (trustErr: unknown) {
      const msg = (trustErr as { response?: { data?: unknown } })?.response?.data
        ? JSON.stringify((trustErr as { response: { data: unknown } }).response.data)
        : (trustErr as Error).message;
      return json({ error: `Trustline setup failed: ${msg}` }, 502);
    }

    const reference = `SWP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    // ── LEG 1: user → distributor ──────────────────────────────────────────
    let leg1Hash: string;
    try {
      const userAccount = await server.loadAccount(userKp.publicKey());
      const tx1 = new TransactionBuilder(userAccount, {
        fee: BASE_FEE, networkPassphrase: Networks.TESTNET,
      })
        .addOperation(Operation.payment({
          destination: distributor.publicKey(),
          asset: sourceAsset,
          amount: sourceAmount.toFixed(7),
        }))
        .addMemo(Memo.text(reference.slice(0, 28)))
        .setTimeout(60)
        .build();
      tx1.sign(userKp);
      const r1 = await server.submitTransaction(tx1);
      leg1Hash = (r1 as { hash: string }).hash;
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: unknown } })?.response?.data
        ? JSON.stringify((e as { response: { data: unknown } }).response.data)
        : (e as Error).message;
      return json({ error: `Leg 1 (user → distributor) failed: ${msg}` }, 502);
    }

    // ── LEG 2: distributor → user ──────────────────────────────────────────
    let leg2Hash: string | null = null;
    let leg2Error: string | null = null;
    try {
      const distAccount = await server.loadAccount(distributor.publicKey());
      const tx2 = new TransactionBuilder(distAccount, {
        fee: BASE_FEE, networkPassphrase: Networks.TESTNET,
      })
        .addOperation(Operation.payment({
          destination: wallet.stellar_address,
          asset: destAsset,
          amount: destAmount.toFixed(7),
        }))
        .addMemo(Memo.text(reference.slice(0, 28)))
        .setTimeout(60)
        .build();
      tx2.sign(distributor);
      const r2 = await server.submitTransaction(tx2);
      leg2Hash = (r2 as { hash: string }).hash;
    } catch (e: unknown) {
      leg2Error = (e as { response?: { data?: unknown } })?.response?.data
        ? JSON.stringify((e as { response: { data: unknown } }).response.data)
        : (e as Error).message;
    }

    // Persist order
    const completed = leg2Hash !== null;
    const now = new Date().toISOString();
    const { data: order, error: orderErr } = await admin
      .from("orders")
      .insert({
        customer_id: customer.id,
        order_kind: "htgc_usdc_swap",
        status: completed ? "COMPLETED" : "FAILED",
        htg_amount: htgAmount,
        usdc_amount: usdcAmount,
        rate,
        spot_rate: rate,
        reference_number: reference,
        destination_stellar_address: wallet.stellar_address,
        destination_wallet_address: wallet.stellar_address,
        stellar_tx_hash: leg2Hash ?? leg1Hash,
        quote_expires_at: new Date(Date.now() + 60_000).toISOString(),
        funded_at: now,
        released_at: completed ? now : null,
        completed_at: completed ? now : null,
        failure_reason: leg2Error
          ? `Leg 1 ok (${leg1Hash}); leg 2 failed: ${leg2Error.slice(0, 800)}`
          : null,
      })
      .select("id")
      .single();
    if (orderErr) {
      return json({ error: `Swap submitted on-chain but failed to persist: ${orderErr.message}`, leg1Hash, leg2Hash }, 500);
    }

    if (!completed) {
      return json({ error: `Swap partially failed. Leg 2: ${leg2Error}`, orderId: order.id, leg1Hash }, 502);
    }

    return json({ ok: true, orderId: order.id, hash: leg2Hash, reference });

  } catch (e) {
    console.error("execute-swap error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
