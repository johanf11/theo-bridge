// replay-ledger-failure — admin-only.
// Retries a single row from ledger_posting_failures.
// Body: { failure_id: string }
// On success: marks the row as resolved (resolved_at, resolution_tx_id) and returns { ok: true, transaction_id }.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { postLedger } from "../_shared/ledger.ts";
import type { LedgerPost } from "../_shared/ledger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

    const url     = Deno.env.get("SUPABASE_URL")!;
    const anon    = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: ue } = await userClient.auth.getUser();
    if (ue || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, service);

    // Admin check
    const { data: roleRow } = await admin
      .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ error: "Forbidden — admin only" }, 403);

    const body = await req.json().catch(() => ({}));
    const { failure_id } = body as { failure_id?: string };
    if (!failure_id) return json({ error: "failure_id required" }, 400);

    // Load the failure row
    const { data: failureRow, error: fetchErr } = await admin
      .from("ledger_posting_failures")
      .select("*")
      .eq("id", failure_id)
      .is("resolved_at", null)
      .maybeSingle();
    if (fetchErr || !failureRow) return json({ error: "Failure row not found or already resolved" }, 404);

    // The payload column contains the original LedgerPost object
    const post = (failureRow as { payload: LedgerPost }).payload;

    // Re-run via postLedger (which calls post_ledger_entries with idempotent source_key)
    const txId = await postLedger(admin, post);

    // Mark resolved
    await admin
      .from("ledger_posting_failures")
      .update({
        resolved_at:       new Date().toISOString(),
        resolved_by:       user.id,
        resolution_tx_id:  txId,
      })
      .eq("id", failure_id);

    return json({ ok: true, transaction_id: txId });

  } catch (e) {
    console.error("replay-ledger-failure error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
