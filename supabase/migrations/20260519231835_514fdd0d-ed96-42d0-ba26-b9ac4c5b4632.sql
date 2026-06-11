CREATE POLICY "Org members view org customer"
  ON public.customers FOR SELECT TO authenticated
  USING (public.is_org_member(id));

CREATE POLICY "Org members view org orders"
  ON public.orders FOR SELECT TO authenticated
  USING (public.is_org_member(customer_id));

CREATE POLICY "Org members view org payouts"
  ON public.payouts FOR SELECT TO authenticated
  USING (public.is_org_member(customer_id));

CREATE OR REPLACE FUNCTION public.get_effective_customer_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT id FROM public.customers WHERE user_id = auth.uid() LIMIT 1),
    (SELECT om.customer_id
       FROM public.org_members om
      WHERE om.user_id = auth.uid()
        AND om.accepted_at IS NOT NULL
      LIMIT 1)
  );
$$;