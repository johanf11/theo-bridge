
-- 1. Revoke direct SELECT on wallets.stellar_secret from client roles.
--    The reveal-wallet-secret edge function is the only path to retrieve a secret.
REVOKE SELECT (stellar_secret) ON public.wallets FROM anon, authenticated, PUBLIC;

-- Also revoke UPDATE/INSERT/DELETE on wallets from anon entirely
-- (anon should never write to wallets; RLS denies but defense-in-depth).
REVOKE INSERT, UPDATE, DELETE ON public.wallets FROM anon;

-- 2. Tighten saved_recipients INSERT: only org owners, or org members whose
--    role has the payout_send permission enabled, may add recipients.
DROP POLICY IF EXISTS "Org members insert org saved_recipients" ON public.saved_recipients;

CREATE POLICY "Owners or payout-permitted members insert saved_recipients"
ON public.saved_recipients
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_org_owner(customer_id)
  OR EXISTS (
    SELECT 1
    FROM public.org_members om
    JOIN public.role_permissions rp ON rp.role_id = om.role_id
    WHERE om.customer_id = saved_recipients.customer_id
      AND om.user_id = auth.uid()
      AND om.accepted_at IS NOT NULL
      AND rp.permission = 'payout_send'
      AND rp.enabled = true
  )
);
