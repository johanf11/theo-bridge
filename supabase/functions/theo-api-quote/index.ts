// Public Theo API: POST /theo-api-quote
// Body: {
//   source_wallet_id: string,      // wallet id from /theo-api-wallets (or "htgc:<customer_id>")
//   amount_usd: number,            // amount the supplier should receive in USD
//   supplier: {
//     name: string,
//     stellar_address?: string,    // currently the only settlement rail supported
//     external_ref?: string,       // Odoo bill number, etc.
//   }
// }
// Returns a 15-min quote stored as a QUOTED order, ready for /theo-api-pay.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { authenticateApiKey } from "../_shared/api-key-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

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

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
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
  const clientRequestId = clean(body.client_request_id ?? body.idempotency_key);
  const supplier = body.supplier as {
    name?: string;
    stellar_address?: string;
    external_ref?: string;
    bank_wire?: Record<string, unknown>;
    settlement_method?: string;
    memo?: string;
    memo_type?: string;
  } | undefined;

  if (!sourceWalletId) return json({ error: "source_wallet_id required" }, 400);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0 || amountUsd > MAX_USDC) {
    return json({ error: `amount_usd must be > 0 and <= ${MAX_USDC}` }, 400);
  }
  if (!supplier?.name) return json({ error: "supplier.name required" }, 400);
  let dest = (supplier.stellar_address ?? "").trim();
  const settlement = String(supplier.settlement_method ?? "").toLowerCase();
  const isBankWire = !dest && (supplier.bank_wire != null || settlement.includes("wire") || settlement.includes("bank"));
  if (isBankWire) {
    const { data: setting } = await admin.from("app_settings")
      .select("value").eq("key", "owlting_omnibus_address").maybeSingle();
    const omnibus = (setting?.value as { address?: string } | null)?.address;
    if (!omnibus) return json({ error: "Owlting omnibus wallet not configured" }, 503);
    dest = omnibus;
  }
  if (!dest || !dest.startsWith("G") || dest.length < 50) {
    return json({ error: "supplier.stellar_address (G…) or supplier.bank_wire required" }, 400);
  }

  // Stellar memo. Owlting (and most exchanges) need a memo on the inbound
  // payment to credit the right off-ramp ticket / customer, so we require one
  // for bank-wire quotes and validate it for all settlement paths.
  const rawMemo = (supplier.memo ?? "").toString().trim();
  const memoType = (supplier.memo_type ?? "text").toString().toLowerCase();
  let payoutMemo: string | null = null;
  let payoutMemoType: "text" | "id" | null = null;
  if (rawMemo.length > 0) {
    if (memoType !== "text" && memoType !== "id") {
      return json({ error: "supplier.memo_type must be 'text' or 'id'" }, 400);
    }
    if (memoType === "text") {
      const bytes = new TextEncoder().encode(rawMemo).length;
      if (bytes > 28) return json({ error: "supplier.memo exceeds 28 bytes for MEMO_TEXT" }, 400);
    } else if (!/^\d+$/.test(rawMemo)) {
      return json({ error: "supplier.memo must be digits only for MEMO_ID" }, 400);
    }
    payoutMemo = rawMemo;
    payoutMemoType = memoType;
  } else if (isBankWire) {
    return json({
      error: "supplier.memo required for bank_wire settlement (Owlting uses it to identify the off-ramp ticket)",
    }, 400);
  }

  // Customer fees
  const { data: customer } = await admin
    .from("customers")
    .select("id, fee_bps, corridor_bps, kyb_status")
    .eq("id", auth.customer_id)
    .maybeSingle();
  if (!customer) return json({ error: "Customer not found" }, 404);
  if (customer.kyb_status !== "APPROVED") return json({ error: "KYB approval required" }, 403);

  // Demo: Theo charges no fee on Odoo-originated payments. Owlting handles its
  // own crypto→fiat fee out-of-band.
  const theoBps = 0;
  const corrBps = 0;
  const totalBps = 0;

  // Determine source currency
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

  // Pricing
  const feeUsd = Math.round(amountUsd * (totalBps / 10_000) * 1e7) / 1e7;
  const theoFeeUsdc = Math.round(amountUsd * (theoBps / 10_000) * 1e7) / 1e7;
  const totalDebitUsd = Math.round((amountUsd + feeUsd) * 1e7) / 1e7;

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

  const strongBusinessRef = clean(supplier.external_ref) || clean(payoutMemo);
  const idempotencySeed = clientRequestId
    ? { scope: "client", client_request_id: clientRequestId }
    : {
      scope: strongBusinessRef ? "business_ref" : "quote_window",
      quote_window: strongBusinessRef ? null : Math.floor(Date.now() / (QUOTE_TTL_MIN * 60 * 1000)),
      source_wallet_id: sourceWalletId,
      amount_usd: Math.round(amountUsd * 1e7) / 1e7,
      supplier_name: clean(supplier.name).toLowerCase(),
      external_ref: clean(supplier.external_ref),
      settlement_method: isBankWire ? "bank_wire" : "stellar",
      destination: dest,
      memo: payoutMemo,
      memo_type: payoutMemoType,
    };
  const apiIdempotencyKey = `theo-api-quote:${await sha256Hex(JSON.stringify(idempotencySeed))}`;

  const existingQuoteSelect = "id, status, htg_amount, usdc_amount, usdc_gross, fee_usdc, rate, reference_number, quote_expires_at, destination_stellar_address, payout_memo, payout_memo_type";
  const { data: existing } = await admin
    .from("orders")
    .select(existingQuoteSelect)
    .eq("customer_id", auth.customer_id)
    .eq("api_idempotency_key", apiIdempotencyKey)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    return json({
      quote_id: existing.id,
      reference_number: existing.reference_number,
      expires_at: existing.quote_expires_at,
      source_currency: sourceCurrency,
      source_wallet_id: sourceWalletDbId ?? sourceWalletId,
      amount_usd: Number(existing.usdc_amount),
      fee_usd: Number(existing.fee_usdc ?? 0),
      total_debit_usd: Number(existing.usdc_gross ?? existing.usdc_amount),
      debit_htgc: sourceCurrency === "HTGC" ? Number(existing.htg_amount) : null,
      rate: Number(existing.rate),
      status: existing.status,
      idempotent_replay: true,
      supplier: {
        name: supplier.name,
        stellar_address: existing.destination_stellar_address,
        external_ref: supplier.external_ref ?? null,
        memo: existing.payout_memo,
        memo_type: existing.payout_memo_type,
      },
    });
  }

  const { data: order, error: insErr } = await admin
    .from("orders")
    .insert({
      customer_id: auth.customer_id,
      status: "QUOTED",
      htg_amount: debitHtgc ?? 0,
      usdc_amount: amountUsd,
      usdc_gross: totalDebitUsd,
      fee_bps: totalBps,
      theo_fee_bps: theoBps,
      corridor_bps: corrBps,
      fee_usdc: feeUsd,
      theo_fee_usdc: theoFeeUsdc,
      rate,
      spot_rate: spotRate,
      reference_number: reference,
      quote_expires_at: expiresAt,
      destination_wallet_address: dest,
      destination_stellar_address: dest,
      order_kind: sourceCurrency === "HTGC" ? "usdc_conversion" : "htgc_usdc_swap",
      payout_memo: payoutMemo,
      payout_memo_type: payoutMemoType,
      api_idempotency_key: apiIdempotencyKey,
    })
    .select("id")
    .single();
  if (insErr) {
    if ((insErr as { code?: string }).code === "23505") {
      const { data: replay } = await admin
        .from("orders")
        .select(existingQuoteSelect)
        .eq("customer_id", auth.customer_id)
        .eq("api_idempotency_key", apiIdempotencyKey)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (replay) {
        return json({
          quote_id: replay.id,
          reference_number: replay.reference_number,
          expires_at: replay.quote_expires_at,
          source_currency: sourceCurrency,
          source_wallet_id: sourceWalletDbId ?? sourceWalletId,
          amount_usd: Number(replay.usdc_amount),
          fee_usd: Number(replay.fee_usdc ?? 0),
          total_debit_usd: Number(replay.usdc_gross ?? replay.usdc_amount),
          debit_htgc: sourceCurrency === "HTGC" ? Number(replay.htg_amount) : null,
          rate: Number(replay.rate),
          status: replay.status,
          idempotent_replay: true,
          supplier: {
            name: supplier.name,
            stellar_address: replay.destination_stellar_address,
            external_ref: supplier.external_ref ?? null,
            memo: replay.payout_memo,
            memo_type: replay.payout_memo_type,
          },
        });
      }
    }
    return json({ error: insErr.message }, 500);
  }

  return json({
    quote_id: order.id,
    reference_number: reference,
    expires_at: expiresAt,
    source_currency: sourceCurrency,
    source_wallet_id: sourceWalletDbId ?? sourceWalletId,
    amount_usd: amountUsd,
    fee_usd: feeUsd,
    total_debit_usd: totalDebitUsd,
    debit_htgc: debitHtgc,
    rate,
    supplier: {
      name: supplier.name,
      stellar_address: dest,
      external_ref: supplier.external_ref ?? null,
      memo: payoutMemo,
      memo_type: payoutMemoType,
    },
  });
});
