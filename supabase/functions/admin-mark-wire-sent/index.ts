// Admin-only: mark a vendor wire as WIRED (demo simulation of Owlting
// completing the fiat leg).

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

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, service);
    const { data: role } = await admin.from("user_roles")
      .select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!role) return json({ error: "Admin only" }, 403);

    const { wireId, status } = await req.json().catch(() => ({}));
    if (!wireId) return json({ error: "wireId required" }, 400);

    const newStatus = (status === "FAILED" ? "FAILED" : "WIRED") as "WIRED" | "FAILED";
    const ref = newStatus === "WIRED"
      ? `WIRE-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
      : null;

    const { error } = await admin.from("vendor_wire_instructions").update({
      owlting_status: newStatus,
      wired_at: newStatus === "WIRED" ? new Date().toISOString() : null,
      simulated_wire_ref: ref,
    }).eq("id", wireId);
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true, status: newStatus, simulated_wire_ref: ref });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
