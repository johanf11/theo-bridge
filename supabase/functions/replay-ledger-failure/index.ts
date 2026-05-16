// replay-ledger-failure — admin-only.
// Retries a single row from ledger_posting_failures.
// Body: { failure_id: string }
// On success, deletes the failure row and returns { ok: true, transaction_id }.

import { createClient } from "jsr:@supabase/supabase-js@2";

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
      .maybeSingle();
    if (fetchErr || !failureRow) return json({ error: "Failure row not found" }, 404);

    const payload = (failureRow as { payload: Record<string, unknown> }).payload;

    // Re-resolve entries from the stored payload
    // The payload was stored as a PostLedgerParams object (account_code + optional customer_id)
    const entries = (payload.entries as Array<{
      account_code: string;
      customer_id?: string;
      amount: number;
      side: string;
      currency: string;
    }>);

    const resolvedEntries = await Promise.all(
      entries.map(async (e) => {
        let accountId: string;
        if (e.account_code === "CUSTOMER_USDC" && e.customer_id) {
          const { data, error } = await admin.rpc("get_or_create_customer_usdc_account", {
            p_customer_id: e.customer_id,
          });
          if (error) throw new Error(`get_or_create failed: ${error.message}`);
          accountId = data as string;
        } else {
          const { data, error } = await admin
            .from("ledger_accounts")
            .select("id")
            .eq("code", e.account_code)
            .is("customer_id", null)
            .single();
          if (error || !data) throw new Error(`Account not found: ${e.account_code}`);
          accountId = (data as { id: string }).id;
        }
        return { account_id: accountId, amount: e.amount, side: e.side, currency: e.currency };
      }),
    );

    const { data: txId, error: postErr } = await admin.rpc("post_ledger_entries", {
      p_source_key:  payload.source_key,
      p_description: payload.description,
      p_posted_by:   payload.posted_by ?? null,
      p_entries:     JSON.stringify(resolvedEntries),
    });

    if (postErr) return json({ error: `Retry failed: ${postErr.message}` }, 502);

    // Success — delete the failure row
    await admin.from("ledger_posting_failures").delete().eq("id", failure_id);

    return json({ ok: true, transaction_id: txId });

  } catch (e) {
    console.error("replay-ledger-failure error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
