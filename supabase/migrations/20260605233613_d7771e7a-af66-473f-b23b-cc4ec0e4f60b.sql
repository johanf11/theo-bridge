DROP POLICY IF EXISTS "Users read own order channel" ON realtime.messages;

CREATE POLICY "Users read own order channel"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  (realtime.topic() LIKE 'order-%')
  AND EXISTS (
    SELECT 1
    FROM public.orders o
    LEFT JOIN public.customers c ON c.id = o.customer_id
    WHERE o.id::text = substr(realtime.topic(), 7)
      AND (
        c.user_id = (SELECT auth.uid())
        OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
        OR public.is_org_member(o.customer_id)
      )
  )
);