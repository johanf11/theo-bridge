// Admin-only: record a SPIH bank settlement that discharges the FX_CLEARING_HTG obligation.
// Body: { amount: number, reference: string, orderId?: string }
// Posts: Dr FX_CLEARING_HTG / Cr SPIH_BANK_HTG
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const url     = Deno.env.get("SUPABASE_URL")!;
    const anon    = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, service);
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
    if (!roles?.some((r: { role: string }) => r.role === "admin")) {
      return json({ error: "Admin only" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const { amount, reference, orderId } = body as { amount?: number; reference?: string; orderId?: string };

    if (!amount || amount <= 0) return json({ error: "Valid amount required (positive HTG integer)" }, 400);
    if (!reference?.trim()) return json({ error: "Reference required (e.g. SPIH batch date or ID)" }, 400);

    const htgAmount = Math.round(amount); // HTG has no cents
    const now = new Date().toISOString();
    const sourceKey = `spih-settlement:${reference.trim().replace(/\s+/g, "-")}:${htgAmount}`;

    const { data: txId, error: rpcErr } = await admin.rpc("post_ledger_entries", {
      payload: {
        order_id:    orderId ?? null,
        kind:        "SPIH_SETTLEMENT",
        description: `SPIH bank settlement — ${reference.trim()} — ${htgAmount.toLocaleString()} HTG`,
        posted_by:   user.id,
        source_key:  sourceKey,
        entries: [
          { code: "FX_CLEARING_HTG", currency: "HTG", debit:  htgAmount, credit: 0 },
          { code: "SPIH_BANK_HTG",   currency: "HTG", debit:  0,         credit: htgAmount },
        ],
      },
    });

    if (rpcErr) return json({ error: rpcErr.message }, 502);

    return json({ ok: true, txId, amount: htgAmount, reference: reference.trim() });
  } catch (e) {
    console.error("admin-spih-settlement error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
