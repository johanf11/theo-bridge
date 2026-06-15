// Admin KYB review actions. All KYB mutations go through this function with the
// service-role client because several customer columns (kyb_status,
// kyb_rejection_reason, kyb_review_notes, fee_bps, …) are revoked from the
// `authenticated` role at the column-privilege level, so the admin browser
// session cannot write them directly.
//
// Actions:
//   approve         { customerId }                  -> APPROVED, clears reason/notes
//   reject          { customerId, reason }          -> REJECTED, stores reason
//   send_back       { customerId, notes }           -> CHANGES_REQUESTED, stores notes
//   edit            { customerId, fields }          -> white-glove field edits
//   create_business { email, companyName, fields, submit } -> invite user + fill KYB
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

type Fields = {
  companyName?: string;
  legalName?: string;
  registrationNumber?: string;
  country?: string;
  businessType?: string;
  contactName?: string;
  phone?: string;
};

const LIMITS: Record<keyof Fields, number> = {
  companyName: 160,
  legalName: 160,
  registrationNumber: 80,
  country: 80,
  businessType: 80,
  contactName: 120,
  phone: 40,
};

// Map incoming camelCase fields to DB columns, trimming + length-capping.
function buildFieldUpdate(fields: Fields | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fields) return out;
  const col: Record<keyof Fields, string> = {
    companyName: "company_name",
    legalName: "legal_name",
    registrationNumber: "registration_number",
    country: "country",
    businessType: "business_type",
    contactName: "contact_name",
    phone: "phone",
  };
  (Object.keys(col) as (keyof Fields)[]).forEach((k) => {
    const v = fields[k];
    if (typeof v === "string") {
      const trimmed = v.trim().slice(0, LIMITS[k]);
      if (trimmed) out[col[k]] = trimmed;
    }
  });
  return out;
}

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
    const { data: role } = await admin
      .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!role) return json({ error: "Admin only" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    switch (action) {
      case "approve": {
        if (!body.customerId) return json({ error: "customerId required" }, 400);
        const { error } = await admin
          .from("customers")
          .update({ kyb_status: "APPROVED", kyb_rejection_reason: null, kyb_review_notes: null })
          .eq("id", body.customerId);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      case "reject": {
        const reason = String(body.reason ?? "").trim();
        if (!body.customerId) return json({ error: "customerId required" }, 400);
        if (reason.length < 5) return json({ error: "A rejection reason (5+ chars) is required" }, 400);
        const { error } = await admin
          .from("customers")
          .update({ kyb_status: "REJECTED", kyb_rejection_reason: reason.slice(0, 1000) })
          .eq("id", body.customerId);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      case "send_back": {
        const notes = String(body.notes ?? "").trim();
        if (!body.customerId) return json({ error: "customerId required" }, 400);
        if (notes.length < 5) return json({ error: "Please describe the changes needed (5+ chars)" }, 400);
        const { error } = await admin
          .from("customers")
          .update({ kyb_status: "CHANGES_REQUESTED", kyb_review_notes: notes.slice(0, 1000) })
          .eq("id", body.customerId);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      case "edit": {
        if (!body.customerId) return json({ error: "customerId required" }, 400);
        const update = buildFieldUpdate(body.fields);
        if (Object.keys(update).length === 0) return json({ error: "No fields to update" }, 400);
        const { error } = await admin.from("customers").update(update).eq("id", body.customerId);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      case "create_business": {
        const email = String(body.email ?? "").trim().toLowerCase();
        const companyName = String(body.companyName ?? "").trim();
        if (!email || !email.includes("@")) return json({ error: "A valid email is required" }, 400);
        if (companyName.length < 2) return json({ error: "Company name is required" }, 400);

        // Reuse an existing customer if this email already has an account.
        const { data: existingUsers } = await admin.auth.admin.listUsers();
        const existing = existingUsers?.users?.find(
          (u) => u.email?.toLowerCase() === email,
        );

        let userId: string;
        if (existing) {
          userId = existing.id;
        } else {
          const siteUrl = Deno.env.get("SITE_URL") ?? "https://app.theokingdom.com";
          const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
            data: { company_name: companyName },
            redirectTo: siteUrl,
          });
          if (inviteErr || !invited?.user) {
            return json({ error: inviteErr?.message ?? "Could not create user" }, 500);
          }
          userId = invited.user.id;
        }

        // Wait for the handle_new_user trigger to create the customers row.
        let customerId: string | null = null;
        for (let i = 0; i < 8 && !customerId; i++) {
          const { data: cust } = await admin
            .from("customers").select("id").eq("user_id", userId).maybeSingle();
          if (cust) { customerId = cust.id; break; }
          await new Promise((r) => setTimeout(r, 250));
        }
        if (!customerId) return json({ error: "Customer profile not provisioned; try again" }, 504);

        const update: Record<string, unknown> = {
          ...buildFieldUpdate({ ...body.fields, companyName }),
        };
        // Paperwork in hand -> queue for review unless caller opts out.
        if (body.submit !== false) {
          update.kyb_status = "UNDER_REVIEW";
          update.kyb_submitted_at = new Date().toISOString();
        }
        const { error: updErr } = await admin.from("customers").update(update).eq("id", customerId);
        if (updErr) return json({ error: updErr.message }, 500);

        return json({ ok: true, customerId, userId });
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
