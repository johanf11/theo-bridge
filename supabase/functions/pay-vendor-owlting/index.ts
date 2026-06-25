// Customer-facing: pay a vendor via the Owlting omnibus off-ramp (DEMO).
// Sends USDC from the caller's wallet to the omnibus collector and records
// the vendor wire details in `vendor_wire_instructions`. In mainnet, Owlting
// would convert the USDC to fiat and wire the vendor; here it stops on-chain.

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset, BASE_FEE, Horizon, Memo, Networks, Operation, TransactionBuilder,
} from "npm:@stellar/stellar-sdk@12.3.0";
import { signWithSecret } from "../_shared/stellar-signer.ts";
import { resolveCustomerId, checkOrgPermission } from "../_shared/resolve-customer.ts";
import { assertWithinLimits } from "../_shared/tx-limits.ts";
import { corsHeaders } from "../_shared/cors.ts";

const HORIZON_URL = "https://horizon-testnet.stellar.org";

Deno.serve(async (req) => {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...headers, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const usdcIssuer = Deno.env.get("STELLAR_USDC_ISSUER");
    if (!usdcIssuer) return json({ error: "STELLAR_USDC_ISSUER not configured" }, 500);

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: ue } = await userClient.auth.getUser();
    if (ue || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, service);

    const customerId = await resolveCustomerId(admin, user.id);
    if (!customerId) return json({ error: "Customer not found" }, 404);

    const permErr = await checkOrgPermission(admin, user.id, "payout_send");
    if (permErr) return json({ error: permErr }, 403);

    const body = await req.json().catch(() => ({}));
    const {
      sourceWalletId, amount,
      vendorName, vendorCountry, bankName, accountNumber, swiftBic, reference, note,
    } = body ?? {};

    if (!sourceWalletId) return json({ error: "sourceWalletId required" }, 400);
    if (!vendorName?.toString().trim()) return json({ error: "vendorName required" }, 400);
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) return json({ error: "Valid amount required" }, 400);
    try { assertWithinLimits(parsedAmount, "Payout amount"); }
    catch (e) { return json({ error: (e as Error).message }, 400); }

    // Resolve omnibus address.
    const { data: setting } = await admin.from("app_settings")
      .select("value").eq("key", "owlting_omnibus_address").maybeSingle();
    const omnibusAddress: string | undefined = setting?.value?.address;
    if (!omnibusAddress) return json({ error: "Owlting omnibus wallet not set up. Ask an admin to run Setup in Admin → Owlting." }, 503);

    // Load source wallet.
    const { data: wallet } = await admin.from("wallets")
      .select("id, stellar_address, stellar_secret, label")
      .eq("id", sourceWalletId).eq("customer_id", customerId).maybeSingle();
    if (!wallet) return json({ error: "Source wallet not found" }, 404);
    if (!wallet.stellar_secret) return json({ error: "Source wallet has no signing key" }, 400);

    // Short memo token (≤ 28 bytes) tying the on-chain tx to the wire row.
    const shortId = crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
    const memoVal = `OWL-${shortId}`;

    // Create payouts row (PENDING).
    const recipientName = `Owlting → ${vendorName.toString().trim()}`.slice(0, 200);
    const { data: payout, error: payErr } = await admin.from("payouts").insert({
      customer_id: customerId,
      source_wallet_id: wallet.id,
      recipient_name: recipientName,
      recipient_address: omnibusAddress,
      amount_usdc: parsedAmount,
      memo: memoVal,
      memo_type: "text",
      status: "PENDING",
    }).select("id").single();
    if (payErr) throw payErr;

    // Submit Stellar payment.
    const server = new Horizon.Server(HORIZON_URL);
    const sourceAccount = await server.loadAccount(wallet.stellar_address);
    const usdc = new Asset("USDC", usdcIssuer);

    const tx = new TransactionBuilder(sourceAccount, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.payment({ destination: omnibusAddress, asset: usdc, amount: parsedAmount.toFixed(7) }))
      .addMemo(Memo.text(memoVal))
      .setTimeout(60).build();
    signWithSecret(tx, wallet.stellar_secret);

    let hash: string;
    try {
      const result = await server.submitTransaction(tx);
      hash = (result as { hash: string }).hash;
    } catch (e: unknown) {
      const data = (e as { response?: { data?: unknown } })?.response?.data;
      const msg = data ? JSON.stringify(data) : (e as Error).message;
      await admin.from("payouts").update({ status: "FAILED", failure_reason: String(msg).slice(0, 1000) }).eq("id", payout.id);
      return json({ error: String(msg) }, 502);
    }

    await admin.from("payouts").update({
      status: "COMPLETED",
      stellar_tx_hash: hash,
      completed_at: new Date().toISOString(),
    }).eq("id", payout.id);

    // Persist wire details.
    const { data: wire, error: wireErr } = await admin.from("vendor_wire_instructions").insert({
      payout_id: payout.id,
      customer_id: customerId,
      vendor_name: vendorName.toString().trim(),
      vendor_country: vendorCountry?.toString().trim() || null,
      bank_name: bankName?.toString().trim() || null,
      account_number: accountNumber?.toString().trim() || null,
      swift_bic: swiftBic?.toString().trim() || null,
      reference: reference?.toString().trim() || null,
      note: note?.toString().trim() || null,
      amount_usdc: parsedAmount,
      owlting_status: "RECEIVED",
    }).select("id").single();
    if (wireErr) console.error("vendor wire insert failed:", wireErr.message);

    return json({ ok: true, payoutId: payout.id, wireId: wire?.id, hash, memo: memoVal, omnibusAddress });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
