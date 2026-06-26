// Public Theo API: POST /theo-api-pay-bank
// Bank-wire settlement via Owlting (no Stellar off-ramp payment).
// Body: { quote_id: string, external_invoice_ref?: string }

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
  const externalRef = body.external_invoice_ref ? String(body.external_invoice_ref) : null;
  if (!quoteId) return json({ error: "quote_id required" }, 400);

  const { data: order } = await admin
    .from("orders")
    .select("id, customer_id, status, reference_number, beneficiary_metadata, quote_expires_at, order_kind, usdc_amount, htg_amount")
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
      settlement_method: "bank_wire",
      status: "COMPLETED",
      settled_at: meta.completed_at ?? new Date().toISOString(),
    });
  }

  const isHtgc = order.order_kind === "usdc_conversion";
  if (isHtgc && meta.odoo_status !== "READY_TO_PAY" && order.status !== "FUNDED") {
    return json({ error: "HTG-C conversion required before bank wire payout" }, 409);
  }
  if (!isHtgc && order.status !== "QUOTED" && order.status !== "FUNDED") {
    return json({ error: `quote not available for payment (status=${order.status})` }, 409);
  }

  const settledAt = new Date().toISOString();
  const updatedMeta = {
    ...meta,
    external_invoice_ref: externalRef ?? meta.external_ref ?? null,
    owlting_bank_wire_submitted_at: settledAt,
    completed_at: settledAt,
  };

  await admin.from("orders").update({
    status: "COMPLETED",
    completed_at: settledAt,
    beneficiary_metadata: updatedMeta,
  }).eq("id", order.id);

  return json({
    ok: true,
    reference_number: order.reference_number,
    settlement_method: "bank_wire",
    status: "COMPLETED",
    settled_at: settledAt,
    amount_usd: Number(meta.bill_amount_usd ?? order.usdc_amount ?? 0),
    debit_htgc: Number(order.htg_amount ?? 0) || null,
    settlement: order.beneficiary_metadata ?? null,
  });
});
