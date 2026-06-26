// Public Theo API: POST /theo-api-convert
// Step 1 of Odoo HTG-C bill pay: burn HTG-C from importer wallet, prepare USDC for payout.
// Body: {
//   quote_id: string,
//   memo_reference: string,
//   payment_token: "htgc",
//   htgc_amount: number,
//   usdc_amount: number,
//   fx_rate: number,
//   theo_fee_htgc?: number,
//   payout_fee_usd?: number,
//   total_usdc?: number,
//   wallet_id: string,
// }

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset, Horizon, Keypair, Memo, Networks,
  Operation, TransactionBuilder, BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";
import { authenticateApiKey } from "../_shared/api-key-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { HTGC_ISSUER } from "../_shared/stellar-assets.ts";
import { ensureWalletReady } from "../_shared/ensure-wallet-ready.ts";
import { distributorPublicKey, signWithDistributor, signWithSecret } from "../_shared/stellar-signer.ts";

const HORIZON_URL = "https://horizon-testnet.stellar.org";

Deno.serve(async (req) => {
  const headers = corsHeaders(req, { wildcard: true });
  if (req.method === "OPTIONS") return new Response(null, { headers });

  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...headers, "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const auth = await authenticateApiKey(admin, req, "payments:write");
  if ("error" in auth) return json({ error: auth.error }, auth.status);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const quoteId = String(body.quote_id ?? "");
  const memoReference = String(body.memo_reference ?? "").trim();
  const walletId = String(body.wallet_id ?? "");
  const htgcAmount = Number(body.htgc_amount);
  const totalUsdc = Number(body.total_usdc ?? body.usdc_amount ?? 0);

  if (!quoteId) return json({ error: "quote_id required" }, 400);
  if (!walletId) return json({ error: "wallet_id required" }, 400);
  if (!Number.isFinite(htgcAmount) || htgcAmount <= 0) return json({ error: "htgc_amount must be > 0" }, 400);
  if (!Number.isFinite(totalUsdc) || totalUsdc <= 0) return json({ error: "total_usdc must be > 0" }, 400);

  const { data: order } = await admin
    .from("orders")
    .select("id, customer_id, status, reference_number, beneficiary_metadata, quote_expires_at, order_kind")
    .eq("id", quoteId)
    .maybeSingle();
  if (!order) return json({ error: "quote not found" }, 404);
  if (order.customer_id !== auth.customer_id) return json({ error: "quote does not belong to this customer" }, 403);
  if (order.quote_expires_at && new Date(order.quote_expires_at).getTime() < Date.now()) {
    return json({ error: "quote expired" }, 410);
  }

  const meta = (order.beneficiary_metadata ?? {}) as Record<string, unknown>;
  const existingConversion = meta.conversion_tx_hash ? String(meta.conversion_tx_hash) : "";
  if (order.status === "FUNDED" && existingConversion) {
    return json({
      ok: true,
      usdc_released: totalUsdc,
      conversion_tx_hash: existingConversion,
      status: "FUNDED",
    });
  }
  if (order.status !== "QUOTED") {
    return json({ error: `quote not available for conversion (status=${order.status})` }, 409);
  }

  const { data: wallet } = await admin
    .from("wallets")
    .select("id, stellar_address, stellar_secret")
    .eq("id", walletId)
    .eq("customer_id", auth.customer_id)
    .maybeSingle();
  if (!wallet) return json({ error: "wallet_id not found for this customer" }, 404);
  if (!wallet.stellar_secret) return json({ error: "wallet has no signing key" }, 400);

  const usdcIssuer = Deno.env.get("STELLAR_USDC_ISSUER");
  if (!usdcIssuer) return json({ error: "STELLAR_USDC_ISSUER not configured" }, 500);

  const server = new Horizon.Server(HORIZON_URL);
  const htgc = new Asset("HTGC", HTGC_ISSUER);
  const usdc = new Asset("USDC", usdcIssuer);
  const distPub = distributorPublicKey();
  const memoText = (memoReference || order.reference_number || "").slice(0, 28);

  let conversionHash: string;
  try {
    const htgcIssuerSecret = Deno.env.get("STELLAR_HTGC_ISSUER_SECRET") ?? undefined;
    const ready = await ensureWalletReady({
      server,
      address: wallet.stellar_address,
      secret: wallet.stellar_secret,
      usdcIssuer,
      htgcIssuerSecret,
      usdcIssuerSecret: Deno.env.get("STELLAR_USDC_ISSUER_SECRET") ?? undefined,
    });
    if (!ready.ok) throw new Error(`Wallet not ready: ${ready.error}`);

    // Top up HTG-C on wallet if short (testnet demo).
    const userAcct = await server.loadAccount(wallet.stellar_address);
    const htgcBal = (userAcct.balances as Array<{ asset_code?: string; asset_issuer?: string; balance: string }>)
      .find((b) => b.asset_code === "HTGC" && b.asset_issuer === HTGC_ISSUER);
    const haveHtgc = htgcBal ? Number(htgcBal.balance) : 0;
    if (haveHtgc < htgcAmount) {
      if (!htgcIssuerSecret) throw new Error(`Wallet short HTG-C (${haveHtgc}/${htgcAmount})`);
      const issuerKp = Keypair.fromSecret(htgcIssuerSecret);
      const issuerAcct = await server.loadAccount(issuerKp.publicKey());
      const topup = new TransactionBuilder(issuerAcct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(Operation.payment({
          destination: wallet.stellar_address,
          asset: htgc,
          amount: (htgcAmount - haveHtgc + 1).toFixed(7),
        }))
        .setTimeout(60).build();
      topup.sign(issuerKp);
      await server.submitTransaction(topup);
    }

    // Leg 1: burn HTG-C from importer wallet → distributor.
    const freshUser = await server.loadAccount(wallet.stellar_address);
    const burnTx = new TransactionBuilder(freshUser, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.payment({
        destination: distPub,
        asset: htgc,
        amount: htgcAmount.toFixed(7),
      }))
      .addMemo(Memo.text(memoText))
      .setTimeout(60).build();
    signWithSecret(burnTx, wallet.stellar_secret);
    const burnResult = await server.submitTransaction(burnTx);
    conversionHash = (burnResult as { hash: string }).hash;

    // Ensure distributor holds enough USDC for the subsequent Owlting payout.
    const distAcct = await server.loadAccount(distPub);
    const distUsdc = (distAcct.balances as Array<{ asset_code?: string; asset_issuer?: string; balance: string }>)
      .find((b) => b.asset_code === "USDC" && b.asset_issuer === usdcIssuer);
    const haveUsdc = distUsdc ? Number(distUsdc.balance) : 0;
    if (haveUsdc < totalUsdc) {
      const issuerSecret = Deno.env.get("STELLAR_USDC_ISSUER_SECRET");
      if (!issuerSecret) throw new Error(`Distributor short USDC (${haveUsdc}/${totalUsdc})`);
      const issuerKp = Keypair.fromSecret(issuerSecret);
      const issuerAcct = await server.loadAccount(issuerKp.publicKey());
      const topup = new TransactionBuilder(issuerAcct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(Operation.payment({
          destination: distPub,
          asset: usdc,
          amount: (totalUsdc - haveUsdc + 1000).toFixed(7),
        }))
        .setTimeout(60).build();
      topup.sign(issuerKp);
      await server.submitTransaction(topup);
    }
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: unknown } })?.response?.data
      ? JSON.stringify((e as { response: { data: unknown } }).response.data)
      : (e as Error).message;
    await admin.from("orders").update({
      status: "FAILED",
      failure_reason: String(msg).slice(0, 1000),
    }).eq("id", order.id);
    return json({ error: `HTG-C conversion failed: ${msg}` }, 502);
  }

  const updatedMeta = {
    ...meta,
    conversion_tx_hash: conversionHash,
    odoo_convert: {
      htgc_amount: htgcAmount,
      usdc_amount: Number(body.usdc_amount ?? 0),
      fx_rate: Number(body.fx_rate ?? 0),
      theo_fee_htgc: Number(body.theo_fee_htgc ?? 0),
      payout_fee_usd: Number(body.payout_fee_usd ?? 0),
      total_usdc: totalUsdc,
      wallet_id: walletId,
    },
  };

  await admin.from("orders").update({
    status: "FUNDED",
    htg_amount: htgcAmount,
    usdc_amount: totalUsdc,
    beneficiary_metadata: updatedMeta,
  }).eq("id", order.id);

  return json({
    ok: true,
    usdc_released: totalUsdc,
    conversion_tx_hash: conversionHash,
    status: "FUNDED",
    memo_reference: memoReference || order.reference_number,
  });
});
