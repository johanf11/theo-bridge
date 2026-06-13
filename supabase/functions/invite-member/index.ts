// Invite a team member to the caller's org.
// 1. Inserts an org_members row (pending, no user_id yet).
// 2. Sends a Supabase magic-link invite email.
// When the invitee clicks the link and signs up, the on_auth_user_created
// trigger picks up the pending row and auto-accepts the invite.
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

    // Caller must be an org owner (has their own customers row)
    const { data: customer } = await admin
      .from("customers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!customer) return json({ error: "Only org owners can invite members" }, 403);

    const body = await req.json().catch(() => ({}));
    const { email, roleId } = body;
    if (!email || !roleId) return json({ error: "email and roleId required" }, 400);

    const normalizedEmail = String(email).trim().toLowerCase();

    // Validate roleId belongs to caller's org (prevent cross-org role assignment)
    const { data: role } = await admin
      .from("org_roles")
      .select("id")
      .eq("id", roleId)
      .eq("customer_id", customer.id)
      .maybeSingle();
    if (!role) return json({ error: "Invalid role for this organization" }, 400);

    // Check if this email is already an accepted member of this org
    const { data: existing } = await admin
      .from("org_members")
      .select("id, accepted_at")
      .eq("customer_id", customer.id)
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (existing?.accepted_at) {
      return json({ error: "This person is already a member of your org" }, 409);
    }

    // Upsert pending org_members row (safe to re-invite)
    const { error: upsertErr } = await admin
      .from("org_members")
      .upsert(
        { customer_id: customer.id, role_id: roleId, email: normalizedEmail },
        { onConflict: "customer_id,email", ignoreDuplicates: false }
      );
    if (upsertErr) return json({ error: upsertErr.message }, 500);

    // Send the magic-link invite email via Supabase Auth admin
    const siteUrl = Deno.env.get("SITE_URL") ?? "https://theo-bridge.lovable.app";
    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(normalizedEmail, {
      redirectTo: siteUrl,
    });

    // "already registered" means the user exists — the org_members row is set,
    // they'll see the org on next login (trigger already ran for them at signup).
    if (inviteErr && !inviteErr.message?.toLowerCase().includes("already been registered")) {
      return json({ error: inviteErr.message }, 500);
    }

    return json({ ok: true, alreadyRegistered: !!inviteErr });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
