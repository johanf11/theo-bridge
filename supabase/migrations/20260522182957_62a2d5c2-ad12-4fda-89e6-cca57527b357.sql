-- Revoke public/anon execute on SECURITY DEFINER helpers; grant only to authenticated + service_role.
DO $$
DECLARE
  fn text;
  sig text;
BEGIN
  FOR fn, sig IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'has_role',
        'is_org_owner',
        'is_org_member',
        'get_effective_customer_id',
        'post_ledger_entries',
        'seed_default_roles'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon;', fn, sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role;', fn, sig);
  END LOOP;
END $$;