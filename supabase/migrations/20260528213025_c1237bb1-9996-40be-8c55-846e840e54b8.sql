-- ── customers ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Org members view org customer" ON public.customers;
CREATE POLICY "Org members view org customer"
  ON public.customers FOR SELECT TO authenticated
  USING (public.is_org_member(id));

-- ── orders ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Org members view org orders" ON public.orders;
CREATE POLICY "Org members view org orders"
  ON public.orders FOR SELECT TO authenticated
  USING (public.is_org_member(customer_id));

-- ── payouts ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Org members view org payouts" ON public.payouts;
CREATE POLICY "Org members view org payouts"
  ON public.payouts FOR SELECT TO authenticated
  USING (public.is_org_member(customer_id));

-- ── wallets ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Org members view org wallets" ON public.wallets;
CREATE POLICY "Org members view org wallets"
  ON public.wallets FOR SELECT TO authenticated
  USING (public.is_org_member(customer_id));

-- ── blend_positions ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Org members view org blend positions" ON public.blend_positions;
CREATE POLICY "Org members view org blend positions"
  ON public.blend_positions FOR SELECT TO authenticated
  USING (public.is_org_member(customer_id));

-- ── invoices ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Org members view org invoices" ON public.invoices;
CREATE POLICY "Org members view org invoices"
  ON public.invoices FOR SELECT TO authenticated
  USING (public.is_org_member(customer_id));

-- ── get_effective_customer_id (with search_path hardened) ─────────────────────
CREATE OR REPLACE FUNCTION public.get_effective_customer_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT om.customer_id
       FROM public.org_members om
      WHERE om.user_id = auth.uid()
        AND om.accepted_at IS NOT NULL
      LIMIT 1),
    (SELECT id FROM public.customers WHERE user_id = auth.uid() LIMIT 1)
  );
$$;