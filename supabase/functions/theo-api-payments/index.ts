// Public Theo API: POST /theo-api-payments
// Step 2 of Odoo bill pay: send USDC to Owlting collecting wallet.
// Body: {
//   quote_id: string,
//   memo_reference: string,
//   usdc_amount: number,
//   payout_fee_usd: number,
//   total_usdc: number,
//   destination: "owlting_collecting_wallet",
//   vendor_bank_details?: { bank_name, account_number, swift, currency },
//   conversion_tx_hash?: string,
// }

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset, Horizon, Memo, Networks,
  Operation, TransactionBuilder, BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";
import { authenticateApiKey } from "../_shared/api-key-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { apiErrorResponse, authErrorCode } from "../_shared/api-errors.ts";
import { resolveOwltingStellarDestination } from "../_shared/odoo-settlement.ts";
import { distributorPublicKey, signWithDistributor } from "../_shared/stellar-signer.ts";

const HORIZON_URL = "https://horizon-testnet.stellar.org";

Deno.serve(async (req) => {
  const headers = corsHeaders(req, { wildcard: true });
  if (req.method === "OPTIONS") return new Response(null, { headers });

  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...headers, "Content-Type": "application/json" } });
  const err = (message: string, code: string, status: number) => apiErrorResponse(req, message, code, status);

  if (req.method !== "POST") return err("Use POST", "invalid_request", 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const auth = await authenticateApiKey(admin, req, "payments:write");
  if ("error" in auth) return err(auth.error, authErrorCode(auth.status, auth.error), auth.status);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const quoteId = String(body.quote_id ?? "");
  const memoReference = String(body.memo_reference ?? "").trim();
  const totalUsdc = Number(body.total_usdc ?? 0);
  const conversionTxHash = body.conversion_tx_hash ? String(body.conversion_tx_hash) : null;

  if (!quoteId) return err("quote_id required", "invalid_request", 400);
  if (!Number.isFinite(totalUsdc) || totalUsdc <= 0) return err("total_usdc must be > 0", "invalid_request", 400);

  const { data: order } = await admin
    .from("orders")
    .select("id, customer_id, status, reference_number, destination_stellar_address, beneficiary_metadata, quote_expires_at, order_kind, stellar_tx_hash")
    .eq("id", quoteId)
    .maybeSingle();
  if (!order) return err("quote not found", "not_found", 404);
  if (order.customer_id !== auth.customer_id) return err("quote does not belong to this customer", "forbidden", 403);

  if (order.stellar_tx_hash && order.status === "COMPLETED") {
    return json({
      ok: true,
      reference_number: order.reference_number,
      stellar_tx_hash: order.stellar_tx_hash,
      settled_at: new Date().toISOString(),
      status: "COMPLETED",
      idempotent_replay: true,
    });
  }

  const isHtgcOrder = order.order_kind === "usdc_conversion";
  if (isHtgcOrder) {
    if (order.status !== "FUNDED") {
      return err(`HTG-C conversion required before payment (status=${order.status})`, "quote_already_used", 409);
    }
    const meta = (order.beneficiary_metadata ?? {}) as Record<string, unknown>;
    const storedConversion = meta.conversion_tx_hash ? String(meta.conversion_tx_hash) : "";
    if (conversionTxHash && storedConversion && conversionTxHash !== storedConversion) {
      return err("conversion_tx_hash mismatch", "invalid_request", 400);
    }
  } else if (order.status !== "QUOTED" && order.status !== "FUNDED") {
    return err(`quote not available for payment (status=${order.status})`, "quote_already_used", 409);
  }

  if (order.quote_expires_at && new Date(order.quote_expires_at).getTime() < Date.now()) {
    return err("quote expired", "quote_expired", 410);
  }

  let dest = order.destination_stellar_address as string | null;
  if (!dest) {
    dest = await resolveOwltingStellarDestination(admin);
    if (!dest) return err("Owlting off-ramp Stellar destination not configured", "destination_not_configured", 503);
  }

  const memoText = (memoReference || order.reference_number || "").slice(0, 28);
  if (!memoText) return err("memo_reference required for Stellar memo", "invalid_request", 400);

  const usdcIssuer = Deno.env.get("STELLAR_USDC_ISSUER");
  if (!usdcIssuer) return err("STELLAR_USDC_ISSUER not configured", "internal_error", 500);

  const server = new Horizon.Server(HORIZON_URL);
  const usdc = new Asset("USDC", usdcIssuer);
  const amount = totalUsdc;

  const vendorBank = body.vendor_bank_details as Record<string, unknown> | undefined;
  const existingMeta = (order.beneficiary_metadata ?? {}) as Record<string, unknown>;
  const mergedMeta = {
    ...existingMeta,
    vendor_bank_details: vendorBank ?? existingMeta.vendor_bank_details ?? null,
    payout_fee_usd: Number(body.payout_fee_usd ?? 0),
    payment_usdc_amount: Number(body.usdc_amount ?? 0),
    total_usdc: totalUsdc,
  };

  await admin.from("orders").update({
    status: "RELEASING",
    usdc_amount: totalUsdc,
    beneficiary_metadata: mergedMeta,
  }).eq("id", order.id);

  let hash: string;
  try {
    const distPub = distributorPublicKey();
    const distAcct = await server.loadAccount(distPub);
    const distBal = (distAcct.balances as Array<{ asset_code?: string; asset_issuer?: string; balance: string }>)
      .find((b) => b.asset_code === "USDC" && b.asset_issuer === usdcIssuer);
    const have = distBal ? Number(distBal.balance) : 0;
    if (have < amount) {
      throw new Error(`Distributor short on USDC (${have}/${amount})`);
    }

    const fresh = await server.loadAccount(distPub);
    const tx = new TransactionBuilder(fresh, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.payment({ destination: dest, asset: usdc, amount: amount.toFixed(7) }))
      .addMemo(Memo.text(memoText))
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

  const settledAt = new Date().toISOString();
  await admin.from("orders").update({
    status: "COMPLETED",
    stellar_tx_hash: hash,
    completed_at: settledAt,
  }).eq("id", order.id);

  return json({
    ok: true,
    reference_number: order.reference_number,
    stellar_tx_hash: hash,
    settled_at: settledAt,
    status: "COMPLETED",
    off_ramp: {
      provider: "owlting",
      stellar_address: dest,
    },
  });
});
