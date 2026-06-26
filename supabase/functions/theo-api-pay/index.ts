// Public Theo API: POST /theo-api-pay
// Body: { quote_id: string, external_invoice_ref?: string }
// Sends USDC on-chain to the Owlting off-ramp Stellar address stored on the quote.
// Beneficiary bank/wire details live in beneficiary_metadata for fiat settlement.

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset, Horizon, Keypair, Memo, Networks,
  Operation, TransactionBuilder, BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";
import { authenticateApiKey } from "../_shared/api-key-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { owltningOfframpAddress } from "../_shared/odoo-settlement.ts";
import { distributorPublicKey, signWithDistributor } from "../_shared/stellar-signer.ts";

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
  const externalRef = body.external_invoice_ref ? String(body.external_invoice_ref) : null;
  if (!quoteId) return json({ error: "quote_id required" }, 400);

  const { data: order } = await admin
    .from("orders")
    .select("id, customer_id, status, usdc_amount, htg_amount, reference_number, destination_stellar_address, order_kind, quote_expires_at, beneficiary_metadata, payout_memo, payout_memo_type")
    .eq("id", quoteId)
    .maybeSingle();
  if (!order) return json({ error: "quote not found" }, 404);
  if (order.customer_id !== auth.customer_id) return json({ error: "quote does not belong to this customer" }, 403);
  if (order.status !== "QUOTED" && order.status !== "FUNDED") {
    return json({ error: `quote already used (status=${order.status})` }, 409);
  }
  if (order.quote_expires_at && new Date(order.quote_expires_at).getTime() < Date.now()) {
    return json({ error: "quote expired" }, 410);
  }

  const configuredOffRamp = owltningOfframpAddress();
  if (!configuredOffRamp) return json({ error: "OWLTING_OFFRAMP_STELLAR_ADDRESS not configured" }, 500);

  const dest = order.destination_stellar_address ?? configuredOffRamp;
  if (dest !== configuredOffRamp) {
    return json({ error: "quote destination does not match configured Owlting off-ramp address" }, 400);
  }

  const usdcIssuer = Deno.env.get("STELLAR_USDC_ISSUER");
  if (!usdcIssuer) return json({ error: "STELLAR_USDC_ISSUER not configured" }, 500);

  const server = new Horizon.Server(HORIZON_URL);
  const usdc = new Asset("USDC", usdcIssuer);
  const amount = Number(order.usdc_amount);

  await admin.from("orders").update({ status: "RELEASING" }).eq("id", order.id);

  let hash: string;
  try {
    const distPub = distributorPublicKey();
    const distAcct = await server.loadAccount(distPub);
    const distBal = (distAcct.balances as Array<{ asset_code?: string; asset_issuer?: string; balance: string }>)
      .find((b) => b.asset_code === "USDC" && b.asset_issuer === usdcIssuer);
    const have = distBal ? Number(distBal.balance) : 0;
    if (have < amount) {
      const issuerSecret = Deno.env.get("STELLAR_USDC_ISSUER_SECRET");
      if (!issuerSecret) throw new Error(`Distributor short on USDC (${have}/${amount})`);
      const issuerKp = Keypair.fromSecret(issuerSecret);
      const issuerAcct = await server.loadAccount(issuerKp.publicKey());
      const topup = new TransactionBuilder(issuerAcct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(Operation.payment({ destination: distPub, asset: usdc, amount: (amount - have + 1000).toFixed(7) }))
        .setTimeout(60).build();
      topup.sign(issuerKp);
      await server.submitTransaction(topup);
    }

    const fresh = await server.loadAccount(distPub);
    const storedMemo = order.payout_memo as string | null;
    const storedMemoType = (order.payout_memo_type as "text" | "id" | null) ?? "text";
    let memo;
    if (storedMemo) {
      memo = storedMemoType === "id" ? Memo.id(storedMemo) : Memo.text(storedMemo);
    } else {
      memo = Memo.text((externalRef ?? order.reference_number).slice(0, 28));
    }
    const tx = new TransactionBuilder(fresh, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.payment({ destination: dest, asset: usdc, amount: amount.toFixed(7) }))
      .addMemo(memo)
      .setTimeout(60).build();
    signWithDistributor(tx);
    const r = await server.submitTransaction(tx);
    hash = (r as { hash: string }).hash;
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: unknown } })?.response?.data
      ? JSON.stringify((e as { response: { data: unknown } }).response.data)
      : (e as Error).message;
    await admin.from("orders").update({ status: "FAILED", failure_reason: String(msg).slice(0, 1000) }).eq("id", order.id);
    return json({ error: `Payment failed: ${msg}` }, 502);
  }

  await admin.from("orders").update({
    status: "COMPLETED",
    stellar_tx_hash: hash,
    completed_at: new Date().toISOString(),
  }).eq("id", order.id);

  return json({
    ok: true,
    reference_number: order.reference_number,
    stellar_tx_hash: hash,
    status: "COMPLETED",
    off_ramp: {
      provider: "owlting",
      stellar_address: dest,
    },
    settlement: order.beneficiary_metadata ?? null,
  });
});
