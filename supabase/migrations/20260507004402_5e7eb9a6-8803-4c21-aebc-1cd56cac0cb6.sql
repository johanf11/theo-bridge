
-- Realtime authorization for order-* channels.
-- Channel naming convention: "order-{order_uuid}".
-- Only allow a user to read messages on that topic if they own the order
-- (or are an admin). Service role bypasses RLS.

-- SELECT (the relevant op for receiving broadcast/postgres_changes on private channels)
CREATE POLICY "Users read own order channel"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  (realtime.topic() LIKE 'order-%')
  AND EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    WHERE o.id::text = substr(realtime.topic(), 7)
      AND (c.user_id = (SELECT auth.uid()) OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  )
);
