-- 1. Revoke SELECT on wallets.stellar_secret from all client roles.
-- Secret retrieval must go through the reveal-wallet-secret edge function.
REVOKE SELECT (stellar_secret) ON public.wallets FROM anon, authenticated, PUBLIC;

-- 2. Lock down client INSERT/UPDATE/DELETE on orders.
-- All order mutations happen via edge functions running as service_role.
-- The existing "Admins manage orders" policy still allows admin writes.
DROP POLICY IF EXISTS "Block customer writes on orders" ON public.orders;
CREATE POLICY "Block customer writes on orders"
ON public.orders
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 3. Lock down client INSERT/UPDATE/DELETE on payouts.
-- All payout mutations happen via edge functions running as service_role.
DROP POLICY IF EXISTS "Block customer writes on payouts" ON public.payouts;
CREATE POLICY "Block customer writes on payouts"
ON public.payouts
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));