-- Fix org-member recent transaction visibility.
-- The previous restrictive "Block customer writes" policies used FOR ALL,
-- which also restricted SELECT and prevented org members from reading orders/payouts.
-- Recreate them as write-only restrictive policies.

DROP POLICY IF EXISTS "Block customer writes on orders" ON public.orders;
DROP POLICY IF EXISTS "Block customer writes on payouts" ON public.payouts;

CREATE POLICY "Block non-admin inserts on orders"
ON public.orders
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Block non-admin updates on orders"
ON public.orders
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Block non-admin deletes on orders"
ON public.orders
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Block non-admin inserts on payouts"
ON public.payouts
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Block non-admin updates on payouts"
ON public.payouts
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Block non-admin deletes on payouts"
ON public.payouts
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));
