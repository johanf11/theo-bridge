// Public Theo API: POST /theo-api-quote
// Body: {
//   source_wallet_id: string,
//   amount_usd: number,
//   invoice_ref?: string,
//   settlement: {
//     rail: "wire" | "local" | "usdc" | "ach",
//     currency?: string,
//     beneficiary: { name, bank_name?, account_number?, swift?, country?, wallet_address? },
//     external_ref?: string,
//   }
// }
// On-chain settlement always routes to OWLTING_OFFRAMP_STELLAR_ADDRESS; beneficiary
// metadata is stored for Owlting fiat off-ramp (demo: testnet; mainnet: production).

import { createClient } from "jsr:@supabase/supabase-js@2";
import { authenticateApiKey } from "../_shared/api-key-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { owltningOfframpAddress, parseSettlementBody, calcOwltingPlatformFeeUsd } from "../_shared/odoo-settlement.ts";

const QUOTE_TTL_MIN = 15;
const MAX_USDC = 100_000;

function generateReference(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  let s = "";
  for (const b of buf) s += chars[b % chars.length];
  return `THEO-ODO-${s}`;
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req, { wildcard: true });
  if (req.method === "OPTIONS") return new Response(null, { headers });

  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...headers, "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const auth = await authenticateApiKey(admin, req, "quotes:write");
  if ("error" in auth) return json({ error: auth.error }, auth.status);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const sourceWalletId = String(body.source_wallet_id ?? "");
  const amountUsd = Number(body.amount_usd);

  if (!sourceWalletId) return json({ error: "source_wallet_id required" }, 400);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0 || amountUsd > MAX_USDC) {
    return json({ error: `amount_usd must be > 0 and <= ${MAX_USDC}` }, 400);
  }

  const offRamp = owltningOfframpAddress();
  const parsed = parseSettlementBody(body);
  if (parsed.error || !parsed.settlement) return json({ error: parsed.error ?? "invalid settlement" }, 400);
  const settlement = parsed.settlement;
  const isBankWire = settlement.rail === "wire";

  if (!isBankWire && !offRamp) {
    return json({ error: "OWLTING_OFFRAMP_STELLAR_ADDRESS not configured" }, 500);
  }

  const { data: customer } = await admin
    .from("customers")
    .select("id, fee_bps, corridor_bps, kyb_status")
    .eq("id", auth.customer_id)
    .maybeSingle();
  if (!customer) return json({ error: "Customer not found" }, 404);
  if (customer.kyb_status !== "APPROVED") return json({ error: "KYB approval required" }, 403);

  const theoBps = (customer as { fee_bps?: number | null }).fee_bps ?? 130;
  const corrBps = (customer as { corridor_bps?: number | null }).corridor_bps ?? 70;
  const totalBps = theoBps + corrBps;

  const isHtgc = sourceWalletId.startsWith("htgc:");
  let sourceCurrency: "USDC" | "HTGC";
  let sourceWalletDbId: string | null = null;

  if (isHtgc) {
    sourceCurrency = "HTGC";
  } else {
    const { data: w } = await admin
      .from("wallets")
      .select("id")
      .eq("id", sourceWalletId)
      .eq("customer_id", auth.customer_id)
      .maybeSingle();
    if (!w) return json({ error: "source_wallet_id not found for this customer" }, 404);
    sourceCurrency = "USDC";
    sourceWalletDbId = w.id;
  }

  // FX conversion fee applies only when debiting HTG-C (HTG → USDC). Direct USDC has no FX fee.
  const billAmountUsd = amountUsd;
  const fxFeeUsd = sourceCurrency === "HTGC"
    ? Math.round(billAmountUsd * (totalBps / 10_000) * 1e7) / 1e7
    : 0;
  const theoFeeUsdc = sourceCurrency === "HTGC"
    ? Math.round(billAmountUsd * (theoBps / 10_000) * 1e7) / 1e7
    : 0;
  const platformFeeUsd = calcOwltingPlatformFeeUsd(billAmountUsd, settlement.rail);
  const totalFeeUsd = Math.round((fxFeeUsd + platformFeeUsd) * 1e7) / 1e7;
  const totalDebitUsd = Math.round((billAmountUsd + totalFeeUsd) * 1e7) / 1e7;

  let rate = 1;
  let debitHtgc: number | null = null;
  let spotRate: number | null = null;

  if (sourceCurrency === "HTGC") {
    const { data: r } = await admin
      .from("rate_snapshots")
      .select("spot_rate")
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    spotRate = Number(r?.spot_rate ?? 0);
    if (!spotRate || spotRate <= 0) return json({ error: "No spot rate available" }, 500);
    rate = spotRate;
    debitHtgc = Math.round(totalDebitUsd * rate * 100) / 100;
  }

  const reference = generateReference();
  const expiresAt = new Date(Date.now() + QUOTE_TTL_MIN * 60 * 1000).toISOString();

  const { data: order, error: insErr } = await admin
    .from("orders")
    .insert({
      customer_id: auth.customer_id,
      status: "QUOTED",
      htg_amount: debitHtgc ?? 0,
      usdc_amount: totalDebitUsd,
      usdc_gross: totalDebitUsd,
      fee_bps: sourceCurrency === "HTGC" ? totalBps : 0,
      theo_fee_bps: sourceCurrency === "HTGC" ? theoBps : 0,
      corridor_bps: sourceCurrency === "HTGC" ? corrBps : 0,
      fee_usdc: totalFeeUsd,
      theo_fee_usdc: theoFeeUsdc,
      rate,
      spot_rate: spotRate,
      reference_number: reference,
      quote_expires_at: expiresAt,
      destination_wallet_address: offRamp ?? null,
      destination_stellar_address: isBankWire ? null : offRamp,
      order_kind: sourceCurrency === "HTGC" ? "usdc_conversion" : "htgc_usdc_swap",
      beneficiary_metadata: {
        ...settlement,
        settlement_method: isBankWire ? "bank_wire" : settlement.rail,
        off_ramp: isBankWire ? "owlting" : "owlting",
        off_ramp_stellar_address: offRamp,
        platform_fee_usdc: platformFeeUsd,
        bill_amount_usd: billAmountUsd,
        total_debit_usd: totalDebitUsd,
      },
    })
    .select("id")
    .single();
  if (insErr) return json({ error: insErr.message }, 500);

  return json({
    quote_id: order.id,
    reference_number: reference,
    expires_at: expiresAt,
    source_currency: sourceCurrency,
    source_wallet_id: sourceWalletDbId ?? sourceWalletId,
    amount_usd: billAmountUsd,
    fee_usd: fxFeeUsd,
    platform_fee_usd: platformFeeUsd,
    total_debit_usd: totalDebitUsd,
    debit_htgc: debitHtgc,
    rate,
    settlement: {
      rail: settlement.rail,
      currency: settlement.currency ?? settlement.beneficiary.currency,
      beneficiary: settlement.beneficiary,
      external_ref: settlement.external_ref,
    },
    off_ramp: offRamp ? {
      provider: "owlting",
      stellar_address: offRamp,
    } : {
      provider: "owlting",
      settlement_method: "bank_wire",
    },
  });
});
