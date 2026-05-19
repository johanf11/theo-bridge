import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

/**
 * Resolves the effective customer_id for a user.
 *
 * Org members (invited team accounts) take priority over the user's own
 * auto-created customers row — because every new signup gets a blank
 * customers row from the DB trigger, checking own row first would
 * always shadow the org membership.
 *
 * Resolution order:
 *   1. org_members WHERE user_id = uid AND accepted_at IS NOT NULL → org customer
 *   2. customers WHERE user_id = uid → own customer (org owner)
 *
 * @param admin  Service-role Supabase client
 * @param userId auth.users.id of the caller
 * @returns customer id string, or null if neither record exists
 */
export async function resolveCustomerId(
  admin: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data: mem } = await admin
    .from("org_members")
    .select("customer_id")
    .eq("user_id", userId)
    .not("accepted_at", "is", null)
    .maybeSingle();

  if (mem?.customer_id) return mem.customer_id;

  const { data: own } = await admin
    .from("customers")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  return own?.id ?? null;
}
