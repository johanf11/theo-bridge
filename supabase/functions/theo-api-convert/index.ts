// Public Theo API: POST /theo-api-convert
// Body: { quote_id: string }
// Compatibility shim for plugins that perform an explicit HTG-C → USDC
// "conversion" step before calling /theo-api-pay. The Theo quote engine
// already prices the HTG-C debit at quote time, so this endpoint validates
// the quote and echoes the conversion details without mutating state.

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
  const auth = await authenticateApiKey(admin, req, "quotes:write");
  if ("error" in auth) return json({ error: auth.error }, auth.status);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const quoteId = String(body.quote_id ?? "");
  if (!quoteId) return json({ error: "quote_id required" }, 400);

  const { data: order } = await admin
    .from("orders")
    .select("id, customer_id, status, usdc_amount, usdc_gross, htg_amount, rate, reference_number, quote_expires_at")
    .eq("id", quoteId)
    .maybeSingle();
  if (!order) return json({ error: "quote not found" }, 404);
  if (order.customer_id !== auth.customer_id) return json({ error: "quote does not belong to this customer" }, 403);
  if (order.status !== "QUOTED") return json({ error: `quote already used (status=${order.status})` }, 409);
  if (order.quote_expires_at && new Date(order.quote_expires_at).getTime() < Date.now()) {
    return json({ error: "quote expired" }, 410);
  }

  return json({
    ok: true,
    quote_id: order.id,
    reference_number: order.reference_number,
    debit_htgc: Number(order.htg_amount),
    amount_usd: Number(order.usdc_amount),
    total_debit_usd: Number(order.usdc_gross),
    rate: Number(order.rate),
    status: "READY_TO_PAY",
  });
});
