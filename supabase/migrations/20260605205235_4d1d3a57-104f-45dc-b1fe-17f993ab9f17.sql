CREATE OR REPLACE FUNCTION public.is_org_member(p_customer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select exists (
    select 1 from customers  where id = p_customer_id and user_id = auth.uid()
    union all
    select 1 from org_members where customer_id = p_customer_id and user_id = auth.uid() and accepted_at is not null
  );
$$;