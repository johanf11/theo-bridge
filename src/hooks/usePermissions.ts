import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export type Permission =
  | "convert"
  | "payout_send"
  | "balance_view_keys"
  | "accounts_manage"
  | "view_balances";

const ALL_PERMISSIONS: Permission[] = [
  "convert",
  "payout_send",
  "balance_view_keys",
  "accounts_manage",
  "view_balances",
];

export interface PermissionsState {
  can: (p: Permission) => boolean;
  isOwner: boolean;
  loading: boolean;
}

export function usePermissions(): PermissionsState {
  const { user } = useAuth();
  const [perms, setPerms] = useState<Set<Permission>>(new Set());
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }

    (async () => {
      // 1. Check if the user is an org owner (has their own customers row)
      const { data: ownCustomer } = await supabase
        .from("customers")
        .select("id, user_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (ownCustomer) {
        // Org owner — all permissions granted unconditionally
        setIsOwner(true);
        setPerms(new Set(ALL_PERMISSIONS));
        setLoading(false);
        return;
      }

      // 2. Check if the user is an invited org member
      const { data: member } = await supabase
        .from("org_members")
        .select("customer_id, role_id")
        .eq("user_id", user.id)
        .not("accepted_at", "is", null)
        .maybeSingle();

      if (!member) { setLoading(false); return; }

      const { data: rolePerms } = await supabase
        .from("role_permissions")
        .select("permission, enabled")
        .eq("role_id", member.role_id)
        .eq("enabled", true);

      setPerms(new Set((rolePerms ?? []).map((p) => p.permission as Permission)));
      setLoading(false);
    })();
  }, [user?.id]);

  return {
    can: (p: Permission) => perms.has(p),
    isOwner,
    loading,
  };
}
