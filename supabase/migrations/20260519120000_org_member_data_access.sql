-- Allow org members to SELECT their parent org's customer row
-- Multiple SELECT policies are ORed together, so this is purely additive.
CREATE POLICY "Org members view org customer"
  ON public.customers FOR SELECT TO authenticated
  USING (public.is_org_member(id));

-- Allow org members to view orders belonging to their org
CREATE POLICY "Org members view org orders"
  ON public.orders FOR SELECT TO authenticated
  USING (public.is_org_member(customer_id));

-- Allow org members to view payouts belonging to their org
CREATE POLICY "Org members view org payouts"
  ON public.payouts FOR SELECT TO authenticated
  USING (public.is_org_member(customer_id));

-- Convenience RPC: returns the effective customer_id for the calling user.
-- Checks own row first (owner), then org_members (invited member).
CREATE OR REPLACE FUNCTION public.get_effective_customer_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT id FROM public.customers WHERE user_id = auth.uid() LIMIT 1),
    (SELECT om.customer_id
       FROM public.org_members om
      WHERE om.user_id = auth.uid()
        AND om.accepted_at IS NOT NULL
      LIMIT 1)
  );
$$;
