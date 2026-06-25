// Public Theo API: GET /theo-api-ping
// Test connection endpoint for the Odoo plugin.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authenticateApiKey } from "../_shared/api-key-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const headers = corsHeaders(req, { wildcard: true });
  if (req.method === "OPTIONS") return new Response(null, { headers });

  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...headers, "Content-Type": "application/json" } });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const auth = await authenticateApiKey(admin, req);
  if ("error" in auth) return json({ error: auth.error }, auth.status);

  const { data: customer } = await admin
    .from("customers")
    .select("id, company_name")
    .eq("id", auth.customer_id)
    .maybeSingle();

  return json({
    ok: true,
    customer: { id: customer?.id ?? auth.customer_id, company_name: customer?.company_name ?? null },
    scopes: auth.scopes,
  });
});
