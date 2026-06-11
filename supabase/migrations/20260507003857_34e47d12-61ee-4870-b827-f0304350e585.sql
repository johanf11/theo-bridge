
-- 1. Explicit deny: only service_role can write to user_roles
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM authenticated, anon;

-- 2. Explicit deny: only service_role can write to job_queue
REVOKE INSERT, UPDATE, DELETE ON public.job_queue FROM authenticated, anon;

-- 3. Lock down SECURITY DEFINER functions: revoke EXECUTE from public/anon/authenticated
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_customer_created() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_customer_fields() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.seed_default_roles(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- is_org_member / is_org_owner are used inside RLS policies — they MUST be callable by authenticated
-- (RLS evaluates as the calling role). Keep EXECUTE for authenticated, revoke from anon.
REVOKE EXECUTE ON FUNCTION public.is_org_member(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_org_owner(uuid) FROM PUBLIC, anon;

-- has_role is used in many RLS policies — keep authenticated EXECUTE, revoke anon
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
