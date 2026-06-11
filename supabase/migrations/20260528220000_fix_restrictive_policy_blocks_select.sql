-- Root cause fix: the "Block customer writes" RESTRICTIVE FOR ALL policies
-- also block SELECT for org members (treasury, viewer roles) because
-- RESTRICTIVE policies apply to all operations including SELECT.
--
-- Replace them with write-only RESTRICTIVE policies (INSERT, UPDATE, DELETE)
-- so the USING clause never fires on SELECT operations.

-- ── orders ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Block customer writes on orders" ON public.orders;

CREATE POLICY "Block non-admin inserts on orders"
  ON public.orders AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Block non-admin updates on orders"
  ON public.orders AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Block non-admin deletes on orders"
  ON public.orders AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ── payouts ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Block customer writes on payouts" ON public.payouts;

CREATE POLICY "Block non-admin inserts on payouts"
  ON public.payouts AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Block non-admin updates on payouts"
  ON public.payouts AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Block non-admin deletes on payouts"
  ON public.payouts AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
