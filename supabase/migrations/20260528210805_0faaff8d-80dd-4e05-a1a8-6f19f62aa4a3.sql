DROP POLICY IF EXISTS "Org members view org orders" ON public.orders;
CREATE POLICY "Org members view org orders"
  ON public.orders FOR SELECT TO authenticated
  USING (public.is_org_member(customer_id));

DROP POLICY IF EXISTS "Org members view org payouts" ON public.payouts;
CREATE POLICY "Org members view org payouts"
  ON public.payouts FOR SELECT TO authenticated
  USING (public.is_org_member(customer_id));

DROP POLICY IF EXISTS "Org members view org wallets" ON public.wallets;
CREATE POLICY "Org members view org wallets"
  ON public.wallets FOR SELECT TO authenticated
  USING (public.is_org_member(customer_id));

DROP POLICY IF EXISTS "Org members view org customer" ON public.customers;
CREATE POLICY "Org members view org customer"
  ON public.customers FOR SELECT TO authenticated
  USING (public.is_org_member(id));