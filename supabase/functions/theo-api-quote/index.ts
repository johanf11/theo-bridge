// Public Theo API: POST /theo-api-quote
// Accepts Odoo settlement object or supplier { bank_wire | stellar_address }.
// Bank-wire quotes route USDC to the Owlting omnibus address; local/USDC quotes
// route to OWLTING_OFFRAMP_STELLAR_ADDRESS.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { authenticateApiKey } from "../_shared/api-key-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  resolveOwltingStellarDestination,
  parseSettlementBody,
  calcOwltingPlatformFeeUsd,
  HTGC_CONVERSION_USDC_MIN,
  odooQuoteMaxUsd,
} from "../_shared/odoo-settlement.ts";
import { apiErrorResponse, authErrorCode } from "../_shared/api-errors.ts";

const QUOTE_TTL_MIN = 15;

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

function parseSupplierMemo(body: Record<string, unknown>): {
  payoutMemo: string | null;
  payoutMemoType: "text" | "id" | null;
  error?: string;
} {
  const supplier = body.supplier as { memo?: string; memo_type?: string } | undefined;
  const rawMemo = (supplier?.memo ?? "").toString().trim();
  const memoType = (supplier?.memo_type ?? "text").toString().toLowerCase();
  if (!rawMemo) return { payoutMemo: null, payoutMemoType: null };
  if (memoType !== "text" && memoType !== "id") {
    return { payoutMemo: null, payoutMemoType: null, error: "supplier.memo_type must be 'text' or 'id'" };
  }
  if (memoType === "text") {
    const bytes = new TextEncoder().encode(rawMemo).length;
    if (bytes > 28) return { payoutMemo: null, payoutMemoType: null, error: "supplier.memo exceeds 28 bytes for MEMO_TEXT" };
  } else if (!/^\d+$/.test(rawMemo)) {
    return { payoutMemo: null, payoutMemoType: null, error: "supplier.memo must be digits only for MEMO_ID" };
  }
  return { payoutMemo: rawMemo, payoutMemoType: memoType };
}

function buildQuoteReplayResponse(
  existing: Record<string, unknown>,
  sourceCurrency: "USDC" | "HTGC",
  sourceWalletDbId: string | null,
  sourceWalletId: string,
  settlement: { rail: string; currency?: string | null; beneficiary: { name: string }; external_ref?: string | null },
  dest: string,
  payoutMemo: string | null,
  payoutMemoType: "text" | "id" | null,
  billAmountUsd: number,
  fxFeeUsd: number,
  platformFeeUsd: number,
) {
  const meta = (existing.beneficiary_metadata ?? {}) as Record<string, unknown>;
  const billUsd = Number(meta.bill_amount_usd ?? billAmountUsd);
  return {
    quote_id: existing.id,
    reference_number: existing.reference_number,
    expires_at: existing.quote_expires_at,
    source_currency: sourceCurrency,
    source_wallet_id: sourceWalletDbId ?? sourceWalletId,
    amount_usd: billUsd,
    fee_usd: fxFeeUsd,
    platform_fee_usd: platformFeeUsd,
    total_debit_usd: Number(existing.usdc_gross ?? existing.usdc_amount),
    debit_htgc: sourceCurrency === "HTGC" ? Number(existing.htg_amount) : null,
    rate: Number(existing.rate),
    status: existing.status,
    idempotent_replay: true,
    settlement: {
      rail: settlement.rail,
      currency: settlement.currency ?? settlement.beneficiary.currency,
      beneficiary: settlement.beneficiary,
      external_ref: settlement.external_ref,
    },
    off_ramp: {
      provider: "owlting",
      stellar_address: dest,
      settlement_method: settlement.rail === "wire" ? "bank_wire" : settlement.rail,
    },
    payout_memo: existing.payout_memo ?? payoutMemo,
    payout_memo_type: existing.payout_memo_type ?? payoutMemoType,
  };
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req, { wildcard: true });
  if (req.method === "OPTIONS") return new Response(null, { headers });

  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...headers, "Content-Type": "application/json" } });
  const err = (message: string, code: string, status: number) => apiErrorResponse(req, message, code, status);

  if (req.method !== "POST") return err("Use POST", "invalid_request", 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const auth = await authenticateApiKey(admin, req, "quotes:write");
  if ("error" in auth) return err(auth.error, authErrorCode(auth.status, auth.error), auth.status);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const sourceWalletId = String(body.source_wallet_id ?? "");
  const amountUsd = Number(body.amount_usd);
  const clientRequestId = clean(body.client_request_id ?? body.idempotency_key);

  if (!sourceWalletId) return err("source_wallet_id required", "invalid_request", 400);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    return err("amount_usd must be a positive number", "invalid_request", 400);
  }
  const opsCap = odooQuoteMaxUsd();
  if (opsCap !== null && amountUsd > opsCap) {
    return err(`amount_usd ${amountUsd} exceeds ops-configured maximum ${opsCap}`, "amount_out_of_range", 400);
  }

  const parsed = parseSettlementBody(body);
  if (parsed.error || !parsed.settlement) return err(parsed.error ?? "invalid settlement", "invalid_settlement", 400);
  const settlement = parsed.settlement;
  const isBankWire = settlement.rail === "wire";
  const externalRef = clean(settlement.external_ref) || clean(body.invoice_ref);

  // Resolve off-ramp destination for ALL rails: prefer omnibus, fallback to env.
  // For rail === "usdc" with explicit beneficiary wallet, route directly to that wallet.
  let dest: string | null = null;
  if (settlement.rail === "usdc" && settlement.beneficiary.wallet_address) {
    dest = settlement.beneficiary.wallet_address;
  } else {
    dest = await resolveOwltingStellarDestination(admin);
    if (!dest) {
      return err("Owlting off-ramp Stellar destination not configured", "destination_not_configured", 503);
    }
  }

  const memoParsed = parseSupplierMemo(body);
  if (memoParsed.error) return err(memoParsed.error, "invalid_request", 400);

  let payoutMemo = memoParsed.payoutMemo;
  let payoutMemoType = memoParsed.payoutMemoType;
  const idempotencyMemo = memoParsed.payoutMemo;
  const idempotencyMemoType = memoParsed.payoutMemoType;

  const userProvidedBusinessRef = externalRef || payoutMemo;
  if (!userProvidedBusinessRef) {
    return err(
      "invoice_ref, settlement.external_ref, or supplier.memo required; health checks must use /theo-api-ping",
      "invalid_request",
      400,
    );
  }

  const { data: customer } = await admin
    .from("customers")
    .select("id, fee_bps, corridor_bps, kyb_status")
    .eq("id", auth.customer_id)
    .maybeSingle();
  if (!customer) return err("Customer not found", "not_found", 404);
  if (customer.kyb_status !== "APPROVED") return err("KYB approval required", "kyb_required", 403);

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
    if (!w) return err("source_wallet_id not found for this customer", "not_found", 404);
    sourceCurrency = "USDC";
    sourceWalletDbId = w.id;
  }

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

  if (sourceCurrency === "HTGC" && totalDebitUsd < HTGC_CONVERSION_USDC_MIN) {
    return err(
      `total_debit_usd ${totalDebitUsd} below HTG-C conversion minimum of ${HTGC_CONVERSION_USDC_MIN}`,
      "amount_out_of_range",
      400,
    );
  }

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
    if (!spotRate || spotRate <= 0) return err("No spot rate available", "rate_unavailable", 500);
    rate = spotRate;
    debitHtgc = Math.round(totalDebitUsd * rate * 100) / 100;
  }

  const reference = generateReference();
  const expiresAt = new Date(Date.now() + QUOTE_TTL_MIN * 60 * 1000).toISOString();

  if (!payoutMemo && isBankWire) {
    payoutMemo = reference;
    payoutMemoType = "text";
  }

  const strongBusinessRef = externalRef || clean(payoutMemo);
  // Idempotency key intentionally omits `destination` — rotating the Owlting
  // omnibus must NOT spawn duplicate quotes for the same bill / wizard ping.
  const idempotencySeed = {
      scope: "business_ref",
      customer_id: auth.customer_id,
      source_wallet_id: sourceWalletId,
      amount_usd: Math.round(amountUsd * 1e7) / 1e7,
      supplier_name: clean(settlement.beneficiary.name).toLowerCase(),
      external_ref: externalRef,
      settlement_method: isBankWire ? "bank_wire" : settlement.rail,
      memo: idempotencyMemo,
      memo_type: idempotencyMemoType,
    };
  const apiIdempotencyKey = `theo-api-quote:${await sha256Hex(JSON.stringify(idempotencySeed))}`;

  const existingQuoteSelect = "id, status, htg_amount, usdc_amount, usdc_gross, fee_usdc, rate, reference_number, quote_expires_at, destination_stellar_address, payout_memo, payout_memo_type, beneficiary_metadata";
  const { data: existing } = await admin
    .from("orders")
    .select(existingQuoteSelect)
    .eq("customer_id", auth.customer_id)
    .eq("api_idempotency_key", apiIdempotencyKey)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const isReplayable = (row: Record<string, unknown> | null | undefined): boolean => {
    if (!row) return false;
    const status = String(row.status ?? "");
    if (status !== "QUOTED" && status !== "FUNDED") return false;
    const exp = row.quote_expires_at ? new Date(String(row.quote_expires_at)).getTime() : 0;
    if (exp && exp < Date.now()) return false;
    return true;
  };

  if (existing && isReplayable(existing as Record<string, unknown>)) {
    return json(buildQuoteReplayResponse(
      existing as Record<string, unknown>,
      sourceCurrency,
      sourceWalletDbId,
      sourceWalletId,
      settlement,
      dest,
      payoutMemo,
      payoutMemoType,
      billAmountUsd,
      fxFeeUsd,
      platformFeeUsd,
    ));
  }

  // Stale row exists for this idempotency key (expired or terminal). Free up the
  // unique slot so we can insert a fresh quote with the same key.
  if (existing && !isReplayable(existing as Record<string, unknown>)) {
    await admin
      .from("orders")
      .update({ api_idempotency_key: null })
      .eq("id", (existing as { id: string }).id);
  }


  // Fallback lookup: same customer + external_ref + supplier + settlement_method,
  // still QUOTED/FUNDED, not expired. Intentionally ignores destination and
  // amount so a rotated omnibus / re-quoted fee doesn't spawn duplicates.
  const { data: existingByBusinessRef } = strongBusinessRef
    ? await admin
        .from("orders")
        .select(existingQuoteSelect)
        .eq("customer_id", auth.customer_id)
        .eq("order_kind", sourceCurrency === "HTGC" ? "usdc_conversion" : "htgc_usdc_swap")
        .in("status", ["QUOTED", "FUNDED"])
        .gt("quote_expires_at", new Date().toISOString())
        .contains("beneficiary_metadata", {
          external_ref: strongBusinessRef,
          settlement_method: isBankWire ? "bank_wire" : settlement.rail,
        })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  if (existingByBusinessRef) {
    await admin
      .from("orders")
      .update({ api_idempotency_key: apiIdempotencyKey })
      .eq("id", existingByBusinessRef.id)
      .is("api_idempotency_key", null);
    return json(buildQuoteReplayResponse(
      existingByBusinessRef as Record<string, unknown>,
      sourceCurrency,
      sourceWalletDbId,
      sourceWalletId,
      settlement,
      dest,
      payoutMemo,
      payoutMemoType,
      billAmountUsd,
      fxFeeUsd,
      platformFeeUsd,
    ));
  }

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
      destination_wallet_address: dest,
      destination_stellar_address: dest,
      order_kind: sourceCurrency === "HTGC" ? "usdc_conversion" : "htgc_usdc_swap",
      payout_memo: payoutMemo,
      payout_memo_type: payoutMemoType,
      api_idempotency_key: apiIdempotencyKey,
      beneficiary_metadata: {
        ...settlement,
        settlement_method: isBankWire ? "bank_wire" : settlement.rail,
        off_ramp: "owlting",
        off_ramp_stellar_address: dest,
        platform_fee_usdc: platformFeeUsd,
        bill_amount_usd: billAmountUsd,
        total_debit_usd: totalDebitUsd,
      },
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
      if (replay && isReplayable(replay as Record<string, unknown>)) {
        return json(buildQuoteReplayResponse(
          replay as Record<string, unknown>,
          sourceCurrency,
          sourceWalletDbId,
          sourceWalletId,
          settlement,
          dest,
          payoutMemo,
          payoutMemoType,
          billAmountUsd,
          fxFeeUsd,
          platformFeeUsd,
        ));
      }
    }
    return err(insErr.message, "internal_error", 500);
  }

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
    off_ramp: {
      provider: "owlting",
      stellar_address: dest,
      settlement_method: isBankWire ? "bank_wire" : settlement.rail,
    },
    payout_memo: payoutMemo,
    payout_memo_type: payoutMemoType,
  });
});
