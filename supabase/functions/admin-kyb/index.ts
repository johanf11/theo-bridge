// Admin KYB workflow: approve, reject (hard), send_back (changes requested),
// edit (white-glove field updates), add_business (admin-created customer + invite).
// All actions require the caller to be an admin (user_roles row).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

type Action = "approve" | "reject" | "send_back" | "edit" | "add_business";

const KYB_FIELDS = [
  "legal_name",
  "registration_number",
  "country",
  "business_type",
  "contact_name",
  "company_name",
  "phone",
] as const;

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
    if (!url || !anon || !service) return json({ error: "Server misconfigured" }, 500);

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, service);

    // Verify admin role
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) return json({ error: "Forbidden: admin only" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body?.action as Action;
    if (!action) return json({ error: "Missing action" }, 400);

    if (action === "approve") {
      const customer_id = String(body.customer_id ?? "");
      if (!customer_id) return json({ error: "customer_id required" }, 400);
      const { error } = await admin
        .from("customers")
        .update({
          kyb_status: "APPROVED",
          kyb_rejection_reason: null,
          kyb_review_notes: null,
          kyb_requested_changes: null,
        })
        .eq("id", customer_id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === "reject") {
      const customer_id = String(body.customer_id ?? "");
      const reason = String(body.reason ?? "").trim();
      if (!customer_id) return json({ error: "customer_id required" }, 400);
      if (reason.length < 5) return json({ error: "Reason must be at least 5 characters" }, 400);
      const { error } = await admin
        .from("customers")
        .update({ kyb_status: "REJECTED", kyb_rejection_reason: reason })
        .eq("id", customer_id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === "send_back") {
      const customer_id = String(body.customer_id ?? "");
      const notes = String(body.notes ?? "").trim();
      const requested_changes = Array.isArray(body.requested_changes)
        ? body.requested_changes
            .map((s: unknown) => String(s ?? "").trim())
            .filter((s: string) => s.length > 0 && s.length <= 200)
            .slice(0, 20)
        : null;
      if (!customer_id) return json({ error: "customer_id required" }, 400);
      if (notes.length < 5) return json({ error: "Notes must be at least 5 characters" }, 400);
      const { error } = await admin
        .from("customers")
        .update({
          kyb_status: "CHANGES_REQUESTED",
          kyb_review_notes: notes,
          kyb_requested_changes: requested_changes,
          kyb_rejection_reason: null,
        })
        .eq("id", customer_id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === "edit") {
      const customer_id = String(body.customer_id ?? "");
      if (!customer_id) return json({ error: "customer_id required" }, 400);
      const fields = (body.fields ?? {}) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const k of KYB_FIELDS) {
        if (k in fields) {
          const v = fields[k];
          if (v === null || v === undefined || v === "") patch[k] = null;
          else patch[k] = String(v).slice(0, 200);
        }
      }
      const setStatus = body.set_status as string | undefined;
      if (setStatus && ["UNDER_REVIEW", "APPROVED", "PENDING", "REJECTED", "CHANGES_REQUESTED"].includes(setStatus)) {
        patch.kyb_status = setStatus;
        if (setStatus === "APPROVED") {
          patch.kyb_rejection_reason = null;
          patch.kyb_review_notes = null;
          patch.kyb_requested_changes = null;
        }
      }
      if (Object.keys(patch).length === 0) return json({ error: "Nothing to update" }, 400);
      const { error } = await admin.from("customers").update(patch).eq("id", customer_id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === "add_business") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const company_name = String(body.company_name ?? "").trim();
      if (!email || !company_name) return json({ error: "email and company_name required" }, 400);

      const siteUrl = Deno.env.get("SITE_URL") ?? "https://app.theokingdom.com";

      // Try to invite the user. If they already exist, fall back to lookup.
      let newUserId: string | null = null;
      const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: siteUrl,
        data: { company_name, phone: body.phone ?? null },
      });
      if (inviteErr) {
        // If user already registered, find their id
        const msg = inviteErr.message?.toLowerCase() ?? "";
        if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
          // Look them up by listing users (paginated) — fallback path
          const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
          const found = list?.users?.find((u) => (u.email ?? "").toLowerCase() === email);
          if (!found) return json({ error: "User exists but could not be resolved" }, 409);
          newUserId = found.id;
        } else {
          return json({ error: inviteErr.message }, 500);
        }
      } else {
        newUserId = invited?.user?.id ?? null;
      }
      if (!newUserId) return json({ error: "Could not create or find user" }, 500);

      // The handle_new_user trigger fires for fresh invites and creates a customers row.
      // For pre-existing users, ensure one exists.
      let customerId: string | null = null;
      const { data: existing } = await admin
        .from("customers")
        .select("id")
        .eq("user_id", newUserId)
        .maybeSingle();
      if (existing?.id) {
        customerId = existing.id;
      } else {
        const { data: created, error: cErr } = await admin
          .from("customers")
          .insert({
            user_id: newUserId,
            company_name,
            email,
            phone: body.phone ?? null,
          })
          .select("id")
          .single();
        if (cErr) return json({ error: cErr.message }, 500);
        customerId = created.id;
        // Ensure customer role exists
        await admin.from("user_roles").insert({ user_id: newUserId, role: "customer" }).select();
      }

      // Patch KYB fields
      const patch: Record<string, unknown> = {};
      for (const k of KYB_FIELDS) {
        if (k in body) {
          const v = body[k];
          if (v === null || v === undefined || v === "") continue;
          patch[k] = String(v).slice(0, 200);
        }
      }
      // Optional fee overrides
      if (typeof body.fee_bps === "number" && body.fee_bps >= 0 && body.fee_bps <= 500) patch.fee_bps = body.fee_bps;
      if (typeof body.corridor_bps === "number" && body.corridor_bps >= 0 && body.corridor_bps <= 500) patch.corridor_bps = body.corridor_bps;

      // Status: default to APPROVED when admin manually adds, unless caller overrides
      const setStatus = (body.set_status as string | undefined) ?? "APPROVED";
      if (["UNDER_REVIEW", "APPROVED", "PENDING", "REJECTED", "CHANGES_REQUESTED"].includes(setStatus)) {
        patch.kyb_status = setStatus;
        if (setStatus === "APPROVED") patch.kyb_submitted_at = new Date().toISOString();
      }

      if (Object.keys(patch).length > 0) {
        const { error: uErr } = await admin.from("customers").update(patch).eq("id", customerId);
        if (uErr) return json({ error: uErr.message }, 500);
      }

      return json({ ok: true, customer_id: customerId, user_id: newUserId });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
