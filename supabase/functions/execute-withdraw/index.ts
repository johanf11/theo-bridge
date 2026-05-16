// Off-ramp: burn HTG-C from user wallet (send to issuer) and record withdrawal order.
// The actual HTG payout via SPIH is handled operationally — this records the on-chain burn.
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset, Horizon, Keypair, Memo, Networks, Operation, TransactionBuilder, BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";
import { HTGC_ISSUER } from "../_shared/stellar-assets.ts";
import { signWithSecret } from "../_shared/stellar-signer.ts";
import { safePostLedger } from "../_shared/ledger.ts";

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

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: ue } = await userClient.auth.getUser();
    if (ue || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, service);

    const { data: customer } = await admin
      .from("customers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!customer) return json({ error: "Customer not found" }, 404);

    const body = await req.json().catch(() => ({}));
    const { wallet_id, amount, bank_account_id } = body as {
      wallet_id?: string; amount?: number; bank_account_id?: string;
    };
    if (!wallet_id) return json({ error: "wallet_id required" }, 400);
    if (!bank_account_id) return json({ error: "bank_account_id required" }, 400);
    const parsedAmount = Number(amount);
    if (!parsedAmount || parsedAmount <= 0) return json({ error: "Valid amount required" }, 400);

    // Wallet must belong to caller and have signing key
    const { data: wallet } = await admin
      .from("wallets")
      .select("id, stellar_address, stellar_secret")
      .eq("id", wallet_id)
      .eq("customer_id", customer.id)
      .maybeSingle();
    if (!wallet) return json({ error: "Wallet not found" }, 404);
    if (!wallet.stellar_secret) return json({ error: "Wallet has no signing key" }, 400);

    // Verify bank account belongs to caller
    const { data: bank } = await admin
      .from("bank_accounts")
      .select("id, bank_name, account_number")
      .eq("id", bank_account_id)
      .eq("customer_id", customer.id)
      .maybeSingle();
    if (!bank) return json({ error: "Bank account not found" }, 404);

    // Check on-chain HTG-C balance
    const server = new Horizon.Server(HORIZON_URL);
    const htgc = new Asset("HTGC", HTGC_ISSUER);
    const userKp = Keypair.fromSecret(wallet.stellar_secret);

    const account = await server.loadAccount(wallet.stellar_address);
    const htgcBal = (account.balances as any[]).find(
      (b) => b.asset_code === "HTGC" && b.asset_issuer === HTGC_ISSUER
    );
    const available = htgcBal ? Number(htgcBal.balance) : 0;
    if (available < parsedAmount) {
      return json({ error: `Insufficient HTG-C balance. Available: ${available.toFixed(2)}` }, 400);
    }

    const reference = `WDR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    // Burn = send HTG-C back to the issuer account
    let burnHash: string;
    try {
      const userAccount = await server.loadAccount(userKp.publicKey());
      const tx = new TransactionBuilder(userAccount, {
        fee: BASE_FEE, networkPassphrase: Networks.TESTNET,
      })
        .addOperation(Operation.payment({
          destination: HTGC_ISSUER,
          asset: htgc,
          amount: parsedAmount.toFixed(7),
        }))
        .addMemo(Memo.text(reference.slice(0, 28)))
        .setTimeout(60)
        .build();
      signWithSecret(tx, wallet.stellar_secret);
      const result = await server.submitTransaction(tx);
      burnHash = (result as { hash: string }).hash;
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: unknown } })?.response?.data
        ? JSON.stringify((e as { response: { data: unknown } }).response.data)
        : (e as Error).message;
      return json({ error: `HTG-C burn failed: ${msg}` }, 502);
    }

    // Record withdrawal order
    const now = new Date().toISOString();
    const { data: order, error: orderErr } = await admin
      .from("orders")
      .insert({
        customer_id: customer.id,
        order_kind: "htgc_withdraw",
        status: "COMPLETED",
        htg_amount: parsedAmount,
        usdc_amount: 0,
        rate: 1,
        spot_rate: 1,
        reference_number: reference,
        destination_stellar_address: wallet.stellar_address,
        destination_wallet_address: wallet.stellar_address,
        stellar_tx_hash: burnHash,
        quote_expires_at: new Date(Date.now() + 60_000).toISOString(),
        funded_at: now,
        released_at: now,
        completed_at: now,
      })
      .select("id")
      .single();
    if (orderErr) {
      return json({ error: `Burn succeeded but failed to persist order: ${orderErr.message}`, burnHash }, 500);
    }

    // Ledger: HTG-C burn closes outstanding float; opens HTG payable to customer pending bank wire.
    await safePostLedger(admin, "execute-withdraw", {
      orderId: order.id,
      kind: "HTGC_BURN_WITHDRAW",
      description: `HTG-C burn for withdrawal ${reference}`,
      sourceKey: `orders:${order.id}:HTGC_BURN_WITHDRAW`,
      entries: [
        { code: "HTGC_ISSUED",           currency: "HTG", debit:  parsedAmount },
        { code: "CUSTOMER_HTG_PENDING",  currency: "HTG", credit: parsedAmount },
      ],
    }, { stellarTxHash: burnHash });

    return json({ ok: true, orderId: order.id, hash: burnHash, reference });
  } catch (e) {
    console.error("execute-withdraw error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
