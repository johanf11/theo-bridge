
-- 1. Defense-in-depth: explicitly revoke SELECT on wallets.stellar_secret from
--    anon/authenticated/public roles. Service role retains access.
REVOKE SELECT (stellar_secret), INSERT (stellar_secret), UPDATE (stellar_secret)
  ON public.wallets FROM anon, authenticated, PUBLIC;

-- 2. Remove anon EXECUTE on SECURITY DEFINER functions in public schema.
--    These functions all rely on auth.uid(); anon has no business invoking them.
REVOKE EXECUTE ON FUNCTION public.get_invoice_share_token(uuid) FROM anon, PUBLIC;

-- 3. Realtime: restrict client-side INSERT on order-* topics so authenticated
--    users cannot publish forged messages to order channels. Server-side
--    broadcasts via service role bypass RLS and continue to work.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'realtime' AND tablename = 'messages'
      AND policyname = 'Block client inserts to order topics'
  ) THEN
    DROP POLICY "Block client inserts to order topics" ON realtime.messages;
  END IF;
END $$;

CREATE POLICY "Block client inserts to order topics"
  ON realtime.messages
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (
    NOT (realtime.topic() LIKE 'order-%')
  );
