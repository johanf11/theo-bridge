// Off-ramp HTG-C burn via clawback (issuer-signed).
// Burns htgcAmount from sourceWalletAddress and records a COMPLETED order.
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset, Horizon, Keypair, Memo, Networks, Operation, TransactionBuilder, BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";
import { HTGC_ISSUER } from "../_shared/stellar-assets.ts";
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
    const issuerSecret = Deno.env.get("STELLAR_HTGC_ISSUER_SECRET");
    if (!issuerSecret) return json({ error: "Issuer secret not configured" }, 500);

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: ue } = await userClient.auth.getUser();
    if (ue || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const { customerId, htgcAmount, sourceWalletAddress, destinationBankAccountId } = body as {
      customerId?: string;
      htgcAmount?: number;
      sourceWalletAddress?: string;
      destinationBankAccountId?: string;
    };
    if (!customerId || !sourceWalletAddress || !destinationBankAccountId) {
      return json({ error: "Missing required fields" }, 400);
    }
    const amount = Number(htgcAmount);
    if (!amount || amount <= 0) return json({ error: "Invalid amount" }, 400);

    // Verify customer + KYB through user-context client (RLS scopes to caller)
    const { data: customer, error: ce } = await userClient
      .from("customers")
      .select("id, kyb_status")
      .eq("id", customerId)
      .maybeSingle();
    if (ce || !customer) return json({ error: "Customer not found" }, 404);
    if (customer.kyb_status !== "APPROVED") return json({ error: "KYB not approved" }, 403);

    // Verify bank account belongs to caller
    const { data: bank } = await userClient
      .from("bank_accounts")
      .select("id")
      .eq("id", destinationBankAccountId)
      .eq("customer_id", customerId)
      .maybeSingle();
    if (!bank) return json({ error: "Bank account not found" }, 404);

    // Verify sourceWalletAddress belongs to this customer (prevents clawback on other customers' wallets)
    const admin = createClient(url, service);

    // Enforce org-level permission — redemption moves funds out, same gate as payouts.
    // Without this, a Viewer-role member could redeem/withdraw HTG-C, bypassing the
    // role-based permission system enforced by every other fund-moving function.
    const { checkOrgPermission } = await import("../_shared/resolve-customer.ts");
    const permErr = await checkOrgPermission(admin, user.id, "payout_send");
    if (permErr) return json({ error: permErr }, 403);

    const { data: ownedWallet } = await admin
      .from("wallets")
      .select("id")
      .eq("stellar_address", sourceWalletAddress)
      .eq("customer_id", customerId)
      .maybeSingle();
    if (!ownedWallet) return json({ error: "Source wallet not found or not owned by your account" }, 404);

    // Live Horizon HTG-C balance check
    const server = new Horizon.Server(HORIZON_URL);
    const htgc = new Asset("HTGC", HTGC_ISSUER);
    let account;
    try {
      account = await server.loadAccount(sourceWalletAddress);
    } catch (_e) {
      return json({ error: "Source wallet not found on Stellar" }, 404);
    }
    const htgcBal = (account.balances as Array<{ asset_code?: string; asset_issuer?: string; balance: string }>)
      .find((b) => b.asset_code === "HTGC" && b.asset_issuer === HTGC_ISSUER);
    const available = htgcBal ? Number(htgcBal.balance) : 0;
    if (available < amount) {
      return json({ error: `Insufficient HTG-C balance. Available: ${available.toFixed(2)}` }, 400);
    }

    const reference = `THEO-W-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    // Clawback (issuer-signed)
    let txHash: string;
    try {
      const issuerKp = Keypair.fromSecret(issuerSecret);
      if (issuerKp.publicKey() !== HTGC_ISSUER) {
        return json({ error: "Issuer secret pubkey mismatch" }, 500);
      }
      const issuerAccount = await server.loadAccount(issuerKp.publicKey());
      const tx = new TransactionBuilder(issuerAccount, {
        fee: BASE_FEE, networkPassphrase: Networks.TESTNET,
      })
        .addOperation(Operation.clawback({
          asset: htgc,
          from: sourceWalletAddress,
          amount: amount.toFixed(7),
        }))
        .addMemo(Memo.text(reference.slice(0, 28)))
        .setTimeout(60)
        .build();
      tx.sign(issuerKp);
      const result = await server.submitTransaction(tx);
      txHash = (result as { hash: string }).hash;
    } catch (e: unknown) {
      const data = (e as { response?: { data?: unknown } })?.response?.data;
      const msg = data ? JSON.stringify(data) : (e as Error).message;
      return json({ error: `Clawback failed: ${msg}` }, 502);
    }

    // Record withdrawal order via service client
    // admin client already initialized above
    const now = new Date().toISOString();
    const { data: order, error: orderErr } = await admin
      .from("orders")
      .insert({
        customer_id: customerId,
        order_kind: "htgc_withdrawal",
        status: "COMPLETED",
        htg_amount: amount,
        usdc_amount: 0,
        rate: 1,
        spot_rate: 1,
        reference_number: reference,
        destination_stellar_address: sourceWalletAddress,
        destination_wallet_address: sourceWalletAddress,
        stellar_tx_hash: txHash,
        quote_expires_at: new Date(Date.now() + 60_000).toISOString(),
        funded_at: now,
        released_at: now,
        completed_at: now,
      })
      .select("id, reference_number")
      .single();
    if (orderErr) {
      return json({
        error: `Clawback succeeded but failed to persist order: ${orderErr.message}`,
        txHash,
      }, 500);
    }

    // Ledger: customer redeems HTG-C for physical HTG.
    // HTG-C is burned (outstanding float reduces) and the HTG leaves SPIH custody.
    // Dr HTGC_ISSUED (liability ↓: fewer tokens outstanding)
    // Cr SPIH_BANK_HTG (asset ↓: HTG paid out to customer)
    try {
      await safePostLedger(admin, "withdraw-htgc", {
        orderId: order.id,
        kind: "HTGC_WITHDRAWAL",
        description: `HTG-C redemption ${amount} HTG-C → HTG for ${reference}`,
        sourceKey: `withdraw-htgc:${txHash}`,
        entries: [
          { code: "HTGC_ISSUED",   currency: "HTG", debit:  amount },
          { code: "SPIH_BANK_HTG", currency: "HTG", credit: amount },
        ],
      }, { stellarTxHash: txHash });
    } catch (le) {
      console.error("withdraw-htgc ledger post failed", le);
    }

    return json({
      success: true,
      txHash,
      htgcBurned: amount,
      htgReceivable: amount,
      orderId: order.id,
      reference: order.reference_number,
    });
  } catch (e) {
    console.error("withdraw-htgc error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
