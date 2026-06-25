// Mint and revoke API keys for the Odoo plugin and other integrations.
// Owner-only. Returns the raw key exactly once on creation.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { resolveCustomerId } from "../_shared/resolve-customer.ts";
import { generateApiKey, hashApiKey } from "../_shared/api-key-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers });

  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...headers, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: ue } = await userClient.auth.getUser();
    if (ue || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, service);
    const customerId = await resolveCustomerId(admin, user.id);
    if (!customerId) return json({ error: "Customer not found" }, 404);

    // Owner-only: caller must own (not just be a member of) the customer row.
    const { data: ownCheck } = await admin
      .from("customers")
      .select("id")
      .eq("id", customerId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!ownCheck) return json({ error: "Only org owners can manage API keys" }, 403);

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = String(body.action ?? "").toLowerCase();

    if (action === "create") {
      const name = String(body.name ?? "").trim();
      if (!name || name.length > 80) return json({ error: "name is required (1-80 chars)" }, 400);
      const scopes = Array.isArray(body.scopes) && body.scopes.length > 0
        ? (body.scopes as string[])
        : ["payments:write", "wallets:read", "balance:read", "quotes:write"];

      const { raw, prefix, last_four } = generateApiKey();
      const hashed = await hashApiKey(raw);

      const { data: inserted, error } = await admin
        .from("api_keys")
        .insert({
          customer_id: customerId,
          name,
          prefix,
          last_four,
          hashed_key: hashed,
          scopes,
          created_by: user.id,
        })
        .select("id, prefix, last_four, scopes, created_at")
        .single();
      if (error) return json({ error: error.message }, 500);

      return json({
        ok: true,
        api_key: raw, // shown once
        id: inserted.id,
        prefix: inserted.prefix,
        last_four: inserted.last_four,
        scopes: inserted.scopes,
        created_at: inserted.created_at,
      });
    }

    if (action === "revoke") {
      const id = String(body.id ?? "");
      if (!id) return json({ error: "id required" }, 400);
      const { error } = await admin
        .from("api_keys")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id)
        .eq("customer_id", customerId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: "Unknown action. Use 'create' or 'revoke'." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
