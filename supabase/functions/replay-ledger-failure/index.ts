// Admin-only: retry a failed ledger posting from the ledger_posting_failures queue.
// Body: { failureId: string }
// On success: marks the failure row resolved and returns the new transaction id.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers });

  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...headers, "Content-Type": "application/json" } });

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
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    if (!roles?.some((r: { role: string }) => r.role === "admin")) {
      return json({ error: "Admin only" }, 403);
    }

    const { failureId } = await req.json().catch(() => ({}));
    if (!failureId) return json({ error: "failureId required" }, 400);

    const { data: failure, error: fetchErr } = await admin
      .from("ledger_posting_failures")
      .select("*")
      .eq("id", failureId)
      .maybeSingle();
    if (fetchErr || !failure) return json({ error: "Failure row not found" }, 404);
    if (failure.resolved_at) return json({ error: "Already resolved" }, 409);

    const payload = { ...(failure.payload as Record<string, unknown>) };
    if (!payload.source_key) payload.source_key = `replay:${failureId}`;

    const { data: txId, error: rpcErr } = await admin.rpc("post_ledger_entries", { payload });
    if (rpcErr) return json({ error: `Retry failed: ${rpcErr.message}` }, 502);

    await admin
      .from("ledger_posting_failures")
      .update({
        resolved_at:      new Date().toISOString(),
        resolved_by:      user.id,
        resolution_tx_id: txId,
      })
      .eq("id", failureId);

    return json({ ok: true, txId });
  } catch (e) {
    console.error("replay-ledger-failure error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
