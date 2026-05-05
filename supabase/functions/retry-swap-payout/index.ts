// Retry leg 2 (distributor → user) for a FAILED htgc_usdc_swap order.
// Verifies leg 1 settled on-chain, authorizes the destination trustline if needed
// (HTGC payouts), then submits leg 2 from the distributor.
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset, Horizon, Keypair, Memo, Networks, Operation, TransactionBuilder, BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";
import { HTGC_ISSUER } from "../_shared/stellar-assets.ts";

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
    const htgcIssuerSecret = Deno.env.get("STELLAR_HTGC_ISSUER_SECRET");
    if (!distributorSecret) return json({ error: "STELLAR_DISTRIBUTOR_SECRET not configured" }, 500);
    if (!usdcIssuer) return json({ error: "STELLAR_USDC_ISSUER not configured" }, 500);

    // Auth: caller must be admin OR the order owner
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: ue } = await userClient.auth.getUser();
    if (ue || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, service);

    const body = await req.json().catch(() => ({}));
    const { orderId } = body as { orderId?: string };
    if (!orderId) return json({ error: "orderId required" }, 400);

    // Load the order
    const { data: order } = await admin
      .from("orders")
      .select("id, customer_id, order_kind, status, htg_amount, usdc_amount, reference_number, stellar_tx_hash, failure_reason, destination_stellar_address")
      .eq("id", orderId)
      .maybeSingle();
    if (!order) return json({ error: "Order not found" }, 404);
    if (order.order_kind !== "htgc_usdc_swap") {
      return json({ error: `Only htgc_usdc_swap orders can be retried (got ${order.order_kind})` }, 400);
    }
    if (order.status !== "FAILED") {
      return json({ error: `Order status must be FAILED to retry (got ${order.status})` }, 400);
    }

    // Authorization: admin OR owner
    const { data: roleRow } = await admin
      .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    const isAdmin = !!roleRow;
    if (!isAdmin) {
      const { data: customer } = await admin
        .from("customers").select("id").eq("user_id", user.id).maybeSingle();
      if (!customer || customer.id !== order.customer_id) {
        return json({ error: "Forbidden" }, 403);
      }
    }

    // Direction inferred from failure_reason xdr or simply from amounts.
    // Actually we stored htg_amount and usdc_amount. The original direction determines
    // who sent what in leg 1. failure_reason holds the leg-1 hash. We reconstruct from
    // the on-chain leg-1 tx by looking up its operations.
    const leg1Hash = order.stellar_tx_hash;
    if (!leg1Hash) return json({ error: "Order has no leg 1 tx hash to verify" }, 400);

    const server = new Horizon.Server(HORIZON_URL);
    const distributor = Keypair.fromSecret(distributorSecret);
    const usdc = new Asset("USDC", usdcIssuer);
    const htgc = new Asset("HTGC", HTGC_ISSUER);

    // Verify leg 1 succeeded on-chain and learn direction + recipient wallet
    let leg1Ops: { from: string; to: string; asset_code?: string; asset_issuer?: string; amount: string }[];
    try {
      const opsRes = await server.operations().forTransaction(leg1Hash).call();
      leg1Ops = (opsRes.records as unknown as Array<{ type: string; from: string; to: string; asset_code?: string; asset_issuer?: string; amount: string }>)
        .filter((o) => o.type === "payment");
    } catch (e) {
      return json({ error: `Failed to verify leg 1 on-chain: ${(e as Error).message}` }, 502);
    }
    if (leg1Ops.length === 0) {
      return json({ error: "Leg 1 transaction has no payment operation — cannot verify" }, 502);
    }
    const leg1 = leg1Ops[0];
    if (leg1.to !== distributor.publicKey()) {
      return json({ error: `Leg 1 destination ${leg1.to} is not the distributor — refusing to retry` }, 400);
    }
    const userAddress = leg1.from;

    // Determine destination asset & amount based on what leg 1 sent
    const sentHtgc = leg1.asset_code === "HTGC" && leg1.asset_issuer === HTGC_ISSUER;
    const sentUsdc = leg1.asset_code === "USDC" && leg1.asset_issuer === usdcIssuer;
    if (!sentHtgc && !sentUsdc) {
      return json({ error: `Leg 1 asset ${leg1.asset_code}/${leg1.asset_issuer} not recognized` }, 400);
    }
    const destAsset = sentHtgc ? usdc : htgc;
    const destAmount = sentHtgc ? Number(order.usdc_amount) : Number(order.htg_amount);
    if (!destAmount || destAmount <= 0) {
      return json({ error: "Order has no destination amount" }, 400);
    }

    // If destination is HTGC, ensure issuer-side authorization on the user's trustline
    if (destAsset === htgc) {
      if (!htgcIssuerSecret) {
        return json({ error: "STELLAR_HTGC_ISSUER_SECRET not configured — required to authorize HTGC trustline" }, 500);
      }
      try {
        const issuerKp = Keypair.fromSecret(htgcIssuerSecret);
        if (issuerKp.publicKey() !== HTGC_ISSUER) {
          return json({ error: `STELLAR_HTGC_ISSUER_SECRET pubkey ${issuerKp.publicKey()} != HTGC_ISSUER ${HTGC_ISSUER}` }, 500);
        }
        const issuerAcct = await server.loadAccount(issuerKp.publicKey());
        const authTx = new TransactionBuilder(issuerAcct, {
          fee: BASE_FEE, networkPassphrase: Networks.TESTNET,
        })
          .addOperation(Operation.setTrustLineFlags({
            trustor: userAddress,
            asset: htgc,
            flags: { authorized: true },
          }))
          .setTimeout(60)
          .build();
        authTx.sign(issuerKp);
        await server.submitTransaction(authTx);
      } catch (e: unknown) {
        const msg = (e as { response?: { data?: unknown } })?.response?.data
          ? JSON.stringify((e as { response: { data: unknown } }).response.data)
          : (e as Error).message;
        // op_already_authorized is fine — keep going
        if (!String(msg).includes("op_already") && !String(msg).includes("already_authorized")) {
          console.error("Trustline auth failed (continuing)", msg);
        }
      }
    }

    // Submit leg 2: distributor → user
    const memo = (order.reference_number ?? "RETRY").slice(0, 28);
    let leg2Hash: string;
    try {
      const distAccount = await server.loadAccount(distributor.publicKey());
      const tx2 = new TransactionBuilder(distAccount, {
        fee: BASE_FEE, networkPassphrase: Networks.TESTNET,
      })
        .addOperation(Operation.payment({
          destination: userAddress,
          asset: destAsset,
          amount: destAmount.toFixed(7),
        }))
        .addMemo(Memo.text(memo))
        .setTimeout(60)
        .build();
      tx2.sign(distributor);
      const r2 = await server.submitTransaction(tx2);
      leg2Hash = (r2 as { hash: string }).hash;
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: unknown } })?.response?.data
        ? JSON.stringify((e as { response: { data: unknown } }).response.data)
        : (e as Error).message;
      return json({ error: `Leg 2 retry failed: ${msg}`, leg1Hash }, 502);
    }

    // Mark order completed
    const now = new Date().toISOString();
    const newReason = `${order.failure_reason ?? ""}\n[retry ${now}] leg 2 settled: ${leg2Hash}`.slice(0, 1500);
    const { error: updErr } = await admin
      .from("orders")
      .update({
        status: "COMPLETED",
        stellar_tx_hash: leg2Hash,
        completed_at: now,
        released_at: now,
        failure_reason: newReason,
        destination_stellar_address: userAddress,
      })
      .eq("id", order.id);
    if (updErr) {
      return json({ error: `Leg 2 settled (${leg2Hash}) but failed to update order: ${updErr.message}`, leg2Hash }, 500);
    }

    return json({ ok: true, orderId: order.id, leg1Hash, leg2Hash });
  } catch (e) {
    console.error("retry-swap-payout error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
