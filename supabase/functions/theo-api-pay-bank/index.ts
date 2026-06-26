// Public Theo API: POST /theo-api-pay-bank
// Bank-wire settlement via Owlting: sends USDC to the Owlting omnibus Stellar
// address stored on the quote (with payout memo for ticket matching).
// Body: { quote_id: string, external_invoice_ref?: string }

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset, Horizon, Keypair, Memo, Networks,
  Operation, TransactionBuilder, BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";
import { authenticateApiKey } from "../_shared/api-key-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
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
    .select("id, customer_id, status, usdc_amount, reference_number, destination_stellar_address, quote_expires_at, payout_memo, payout_memo_type, beneficiary_metadata, stellar_tx_hash")
    .eq("id", quoteId)
    .maybeSingle();
  if (!order) return json({ error: "quote not found" }, 404);
  if (order.customer_id !== auth.customer_id) return json({ error: "quote does not belong to this customer" }, 403);
  if (order.quote_expires_at && new Date(order.quote_expires_at).getTime() < Date.now()) {
    return json({ error: "quote expired" }, 410);
  }

  const meta = (order.beneficiary_metadata ?? {}) as Record<string, unknown>;
  const settlementMethod = String(meta.settlement_method ?? meta.rail ?? "");
  if (settlementMethod !== "bank_wire" && meta.rail !== "wire") {
    return json({ error: "quote is not a bank wire settlement" }, 400);
  }

  if (order.status === "COMPLETED") {
    return json({
      ok: true,
      reference_number: order.reference_number,
      stellar_tx_hash: order.stellar_tx_hash,
      settlement_method: "bank_wire",
      status: "COMPLETED",
      settled_at: meta.completed_at ?? new Date().toISOString(),
      idempotent_replay: true,
    });
  }

  if (order.status !== "QUOTED" && order.status !== "FUNDED") {
    return json({ error: `quote not available for payment (status=${order.status})` }, 409);
  }

  const dest = order.destination_stellar_address;
  if (!dest) return json({ error: "quote has no destination address" }, 400);

  // Pre-flight destination: must exist on Horizon AND trust USDC.
  // If not, fail fast WITHOUT claiming the quote so the caller can retry once
  // the omnibus account is provisioned.
  const usdcIssuerCheck = Deno.env.get("STELLAR_USDC_ISSUER");
  try {
    const preServer = new Horizon.Server(HORIZON_URL);
    const destAcct = await preServer.loadAccount(dest);
    const destBals = (destAcct.balances as Array<{ asset_code?: string; asset_issuer?: string }>);
    const hasUsdc = destBals.some((b) => b.asset_code === "USDC" && b.asset_issuer === usdcIssuerCheck);
    if (!hasUsdc) {
      return json({
        error: "destination_not_provisioned: Owlting omnibus is missing a USDC trustline. Contact Theo support.",
      }, 503);
    }
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (status === 404) {
      return json({
        error: "destination_not_provisioned: Owlting omnibus account does not exist on Stellar. Contact Theo support.",
      }, 503);
    }
    return json({ error: `destination preflight failed: ${(e as Error).message}` }, 502);
  }

  const { data: claimed, error: claimErr } = await admin
    .from("orders")
    .update({ status: "RELEASING" })
    .eq("id", order.id)
    .eq("status", "QUOTED")
    .select("id")
    .maybeSingle();
  if (claimErr) return json({ error: claimErr.message }, 500);
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
        settlement_method: "bank_wire",
        idempotent_replay: true,
      });
    }
    return json({ error: `quote already used (status=${latest?.status ?? "unknown"})` }, 409);
  }

  const usdcIssuer = Deno.env.get("STELLAR_USDC_ISSUER");
  if (!usdcIssuer) return json({ error: "STELLAR_USDC_ISSUER not configured" }, 500);

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
    return json({ error: `Payment failed: ${msg}` }, 502);
  }

  const settledAt = new Date().toISOString();
  await admin.from("orders").update({
    status: "COMPLETED",
    stellar_tx_hash: hash,
    completed_at: settledAt,
    beneficiary_metadata: {
      ...meta,
      external_invoice_ref: externalRef ?? meta.external_ref ?? null,
      owlting_bank_wire_submitted_at: settledAt,
      completed_at: settledAt,
    },
  }).eq("id", order.id);

  return json({
    ok: true,
    reference_number: order.reference_number,
    stellar_tx_hash: hash,
    settlement_method: "bank_wire",
    status: "COMPLETED",
    settled_at: settledAt,
  });
});
