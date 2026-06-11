-- Guarantee org-member data-access policies exist on all four tables.
-- Uses DROP … IF EXISTS + CREATE so this migration is idempotent and safe
-- to apply even if the earlier 20260519 migrations partially succeeded.

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
-- Org members need to read wallets so transaction row labels resolve correctly.
DROP POLICY IF EXISTS "Org members view org wallets" ON public.wallets;
CREATE POLICY "Org members view org wallets"
  ON public.wallets FOR SELECT TO authenticated
  USING (public.is_org_member(customer_id));

-- ── blend_positions ───────────────────────────────────────────────────────────
-- Org members need to read yield positions for the Transactions page.
DROP POLICY IF EXISTS "Org members view org blend positions" ON public.blend_positions;
CREATE POLICY "Org members view org blend positions"
  ON public.blend_positions FOR SELECT TO authenticated
  USING (public.is_org_member(customer_id));

-- ── invoices ─────────────────────────────────────────────────────────────────
-- Org members should also see the org's invoices.
DROP POLICY IF EXISTS "Org members view org invoices" ON public.invoices;
CREATE POLICY "Org members view org invoices"
  ON public.invoices FOR SELECT TO authenticated
  USING (public.is_org_member(customer_id));

-- ── get_effective_customer_id (with search_path hardened) ─────────────────────
CREATE OR REPLACE FUNCTION public.get_effective_customer_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    -- org member takes priority so invited users see the org's data, not their blank row
    (SELECT om.customer_id
       FROM public.org_members om
      WHERE om.user_id = auth.uid()
        AND om.accepted_at IS NOT NULL
      LIMIT 1),
    (SELECT id FROM public.customers WHERE user_id = auth.uid() LIMIT 1)
  );
$$;