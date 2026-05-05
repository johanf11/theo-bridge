// Move USDC between two wallets that both belong to the calling customer.
// Records the move as a `payouts` row tagged memo='internal-transfer' so the
// Transactions UI can render it as a Transfer instead of an external Payout.
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset, Horizon, Keypair, Memo, Networks,
  Operation, TransactionBuilder, BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const INTERNAL_MEMO_TAG = "internal-transfer";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const usdcIssuer = Deno.env.get("STELLAR_USDC_ISSUER");
    const distributorSecret = Deno.env.get("STELLAR_DISTRIBUTOR_SECRET");
    if (!usdcIssuer) return json({ error: "STELLAR_USDC_ISSUER not configured" }, 500);

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, service);
    const { data: customer } = await admin
      .from("customers").select("id").eq("user_id", user.id).maybeSingle();
    if (!customer) return json({ error: "Customer not found" }, 404);

    const body = await req.json().catch(() => ({}));
    const { sourceWalletId, destinationWalletId, amount, memo, asset } = body;
    const assetCode = (asset === "HTGC" || asset === "HTG-C") ? "HTGC" : "USDC";

    if (!sourceWalletId) return json({ error: "sourceWalletId required" }, 400);
    if (!destinationWalletId) return json({ error: "destinationWalletId required" }, 400);
    if (sourceWalletId === destinationWalletId) return json({ error: "Source and destination must differ" }, 400);
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) return json({ error: "Valid amount required" }, 400);

    // Both wallets must belong to this customer.
    const { data: srcWallet } = await admin
      .from("wallets")
      .select("id, label, stellar_address, stellar_secret")
      .eq("id", sourceWalletId).eq("customer_id", customer.id).maybeSingle();
    if (!srcWallet) return json({ error: "Source wallet not found" }, 404);
    if (!srcWallet.stellar_secret) return json({ error: "Source wallet has no signing key" }, 400);

    const { data: dstWallet } = await admin
      .from("wallets")
      .select("id, label, stellar_address, stellar_secret")
      .eq("id", destinationWalletId).eq("customer_id", customer.id).maybeSingle();
    if (!dstWallet) return json({ error: "Destination wallet not found" }, 404);

    // Record the move as a PENDING payout tagged as an internal transfer.
    const { data: payout, error: payErr } = await admin
      .from("payouts")
      .insert({
        customer_id: customer.id,
        source_wallet_id: srcWallet.id,
        recipient_name: dstWallet.label ?? "Wallet",
        recipient_address: dstWallet.stellar_address,
        amount_usdc: parsedAmount,
        asset_code: assetCode,
        memo: INTERNAL_MEMO_TAG,
        status: "PENDING",
      })
      .select("id")
      .single();
    if (payErr) throw payErr;

    // Build & submit Stellar payment for the chosen asset.
    const server = new Horizon.Server(HORIZON_URL);
    const sourceKp = Keypair.fromSecret(srcWallet.stellar_secret);
    const sourceAccount = await server.loadAccount(sourceKp.publicKey());

    let paymentAsset: Asset;
    if (assetCode === "HTGC") {
      if (!distributorSecret) {
        await admin.from("payouts").update({
          status: "FAILED",
          failure_reason: "STELLAR_DISTRIBUTOR_SECRET not configured",
        }).eq("id", payout.id);
        return json({ error: "STELLAR_DISTRIBUTOR_SECRET not configured" }, 500);
      }
      const distributor = Keypair.fromSecret(distributorSecret);
      paymentAsset = new Asset("HTGC", distributor.publicKey());
    } else {
      paymentAsset = new Asset("USDC", usdcIssuer);
    }

    const txBuilder = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE, networkPassphrase: Networks.TESTNET,
    }).addOperation(Operation.payment({
      destination: dstWallet.stellar_address, asset: paymentAsset, amount: parsedAmount.toFixed(7),
    }));

    // User-supplied memo, capped to Stellar text-memo limit (28 bytes).
    const userMemo = (memo ?? "").toString().trim().slice(0, 28);
    if (userMemo) txBuilder.addMemo(Memo.text(userMemo));
    else txBuilder.addMemo(Memo.text("theo-transfer"));

    const tx = txBuilder.setTimeout(60).build();
    tx.sign(sourceKp);

    let hash: string;
    try {
      const result = await server.submitTransaction(tx);
      hash = (result as { hash: string }).hash;
    } catch (stellarErr: unknown) {
      const msg = (stellarErr as { response?: { data?: unknown } })?.response?.data
        ? JSON.stringify((stellarErr as { response: { data: unknown } }).response.data)
        : (stellarErr as Error).message;
      await admin.from("payouts").update({
        status: "FAILED",
        failure_reason: String(msg).slice(0, 1000),
      }).eq("id", payout.id);
      return json({ error: String(msg) }, 502);
    }

    await admin.from("payouts").update({
      status: "COMPLETED",
      stellar_tx_hash: hash,
      completed_at: new Date().toISOString(),
    }).eq("id", payout.id);

    return json({ ok: true, payoutId: payout.id, hash });
  } catch (e) {
    console.error("move-funds error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
