// Public Theo API: POST /theo-api-convert
// Body: { quote_id: string }
// Call after /theo-api-quote. Validates the quote and returns HTG-C conversion
// pricing for the Odoo wizard (status: "READY_TO_PAY"). Pricing is fixed at
// quote time; this endpoint does not mutate order state.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { authenticateApiKey } from "../_shared/api-key-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

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
  if (!quoteId) return json({ error: "quote_id required" }, 400);

  const { data: order } = await admin
    .from("orders")
    .select("id, customer_id, status, usdc_amount, usdc_gross, htg_amount, rate, fee_usdc, reference_number, quote_expires_at, order_kind, beneficiary_metadata")
    .eq("id", quoteId)
    .maybeSingle();
  if (!order) return json({ error: "quote not found" }, 404);
  if (order.customer_id !== auth.customer_id) return json({ error: "quote does not belong to this customer" }, 403);
  if (order.status !== "QUOTED" && order.status !== "FUNDED") {
    return json({ error: `quote not available for conversion (status=${order.status})` }, 409);
  }
  if (order.quote_expires_at && new Date(order.quote_expires_at).getTime() < Date.now()) {
    return json({ error: "quote expired" }, 410);
  }
  if (order.order_kind !== "usdc_conversion") {
    return json({ error: "convert is only required for HTG-C sourced quotes" }, 400);
  }

  const meta = (order.beneficiary_metadata ?? {}) as Record<string, unknown>;
  const billUsd = Number(meta.bill_amount_usd ?? 0) || roundBillFromOrder(order);

  return json({
    ok: true,
    quote_id: order.id,
    reference_number: order.reference_number,
    debit_htgc: Number(order.htg_amount ?? 0),
    amount_usd: billUsd,
    total_debit_usd: Number(order.usdc_gross ?? order.usdc_amount ?? 0),
    rate: Number(order.rate ?? 0),
    status: "READY_TO_PAY",
  });
});

function roundBillFromOrder(order: {
  usdc_amount?: number | null;
  fee_usdc?: number | null;
}): number {
  const total = Number(order.usdc_amount ?? 0);
  const fees = Number(order.fee_usdc ?? 0);
  return Math.round(Math.max(total - fees, 0) * 100) / 100;
}
