/**
 * useCustomer — resolves the effective customer record for the logged-in user.
 *
 * Priority:
 *   1. Own customers row (user is the org owner)
 *   2. org_members row with accepted_at set (user is an invited team member)
 *
 * Returns the full customer object so callers can destructure whatever they need.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export interface CustomerRecord {
  id: string;
  user_id: string | null;
  email: string | null;
  business_name?: string | null;
  kyb_status: string | null;
  stellar_wallet_address: string | null;
  fee_bps: number | null;
  corridor_bps: number | null;
  [key: string]: unknown;
}

export interface UseCustomerResult {
  customer: CustomerRecord | null;
  customerId: string | null;
  isOwner: boolean;
  loading: boolean;
}

export function useCustomer(): UseCustomerResult {
  const { user } = useAuth();
  const [customer, setCustomer] = useState<CustomerRecord | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }

    let cancelled = false;
    (async () => {
      // 1. Check own customer row (org owner)
      const { data: own } = await supabase
        .from("customers")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (cancelled) return;

      if (own) {
        setCustomer(own as CustomerRecord);
        setIsOwner(true);
        setLoading(false);
        return;
      }

      // 2. Check org_members (invited team member)
      const { data: member } = await supabase
        .from("org_members")
        .select("customer_id")
        .eq("user_id", user.id)
        .not("accepted_at", "is", null)
        .maybeSingle();

      if (cancelled) return;

      if (member?.customer_id) {
        const { data: orgCustomer } = await supabase
          .from("customers")
          .select("*")
          .eq("id", member.customer_id)
          .maybeSingle();

        if (!cancelled) {
          setCustomer(orgCustomer as CustomerRecord ?? null);
          setIsOwner(false);
        }
      }

      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [user?.id]);

  return { customer, customerId: customer?.id ?? null, isOwner, loading };
}
