import { supabase } from "@/integrations/supabase/client";

/**
 * Resolve the customer_id whose data the current user may access.
 * Org membership takes priority over the auto-created personal row
 * (every auth user gets a blank customers row from the signup trigger).
 */
export async function resolveEffectiveCustomerId(): Promise<string | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data: mem } = await supabase
    .from("org_members")
    .select("customer_id")
    .eq("user_id", auth.user.id)
    .not("accepted_at", "is", null)
    .maybeSingle();

  if (mem?.customer_id) return mem.customer_id;

  const { data: own } = await supabase
    .from("customers")
    .select("id")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  return own?.id ?? null;
}
