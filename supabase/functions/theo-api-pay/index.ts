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
import { resolveOwltingStellarDestination } from "../_shared/odoo-settlement.ts";
import { apiErrorResponse, authErrorCode } from "../_shared/api-errors.ts";
import { distributorPublicKey, signWithDistributor } from "../_shared/stellar-signer.ts";
import { InvalidMemoError, resolveStellarMemo } from "../_shared/stellar-memo.ts";

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
  const externalRef = body.external_invoice_ref ? String(body.external_invoice_ref) : null;
  const callerStellarMemo = body.stellar_memo ? String(body.stellar_memo).trim() : "";
  const callerStellarMemoSource = body.stellar_memo_source ? String(body.stellar_memo_source).trim().toLowerCase() : "";
  const callerVendorMemo = body.vendor_memo ? String(body.vendor_memo).trim() : "";
  if (!quoteId) return err("quote_id required", "invalid_request", 400);

  const { data: order } = await admin
    .from("orders")
    .select("id, customer_id, status, usdc_amount, htg_amount, reference_number, destination_stellar_address, order_kind, quote_expires_at, beneficiary_metadata, payout_memo, payout_memo_type, stellar_tx_hash, vendor_memo, stellar_memo, stellar_memo_source, completed_at")
    .eq("id", quoteId)
    .maybeSingle();
  if (!order) return err("quote not found", "not_found", 404);
  if (order.customer_id !== auth.customer_id) return err("quote does not belong to this customer", "forbidden", 403);
  if (order.status === "COMPLETED") {
    return json({
      ok: true,
      reference_number: order.reference_number,
      stellar_tx_hash: order.stellar_tx_hash,
      status: "COMPLETED",
      stellar_memo: order.stellar_memo ?? order.payout_memo ?? order.reference_number,
      stellar_memo_source: order.stellar_memo_source ?? (order.payout_memo ? "vendor" : "theo_ref"),
      settled_at: order.completed_at ?? null,
      idempotent_replay: true,
    });
  }
  if (order.status !== "QUOTED" && order.status !== "FUNDED") {
    return err(`quote already used (status=${order.status})`, "quote_already_used", 409);
  }
  if (order.quote_expires_at && new Date(order.quote_expires_at).getTime() < Date.now()) {
    return err("quote expired", "quote_expired", 410);
  }

  // Trust the destination stored on the quote (already validated at quote time).
  // If somehow missing, resolve via the unified helper.
  let dest = order.destination_stellar_address as string | null;
  if (!dest) {
    dest = await resolveOwltingStellarDestination(admin);
    if (!dest) return err("Owlting off-ramp Stellar destination not configured", "destination_not_configured", 503);
  }

  const { data: claimed, error: claimErr } = await admin
    .from("orders")
    .update({ status: "RELEASING" })
    .eq("id", order.id)
    .eq("status", "QUOTED")
    .select("id")
    .maybeSingle();
  if (claimErr) return err(claimErr.message, "internal_error", 500);
  if (!claimed) {
    const { data: latest } = await admin
      .from("orders")
      .select("status, reference_number, stellar_tx_hash")
      .eq("id", order.id)
      .maybeSingle();
    if (latest?.status === "COMPLETED") {
      return json({
        ok: true,
        reference_number: latest.reference_number,
        stellar_tx_hash: latest.stellar_tx_hash,
        status: "COMPLETED",
        idempotent_replay: true,
      });
    }
    return err(`quote already used (status=${latest?.status ?? "unknown"})`, "quote_already_used", 409);
  }

  const usdcIssuer = Deno.env.get("STELLAR_USDC_ISSUER");
  if (!usdcIssuer) return err("STELLAR_USDC_ISSUER not configured", "internal_error", 500);

  const server = new Horizon.Server(HORIZON_URL);
  const usdc = new Asset("USDC", usdcIssuer);
  const amount = Number(order.usdc_amount);

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
    if (/short on USDC|underfunded|op_underfunded/i.test(String(msg))) {
      return err(`Insufficient USDC liquidity to settle ${amount}`, "insufficient_balance", 402);
    }
    return err(`Payment failed: ${msg}`, "on_chain_failed", 502);
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
