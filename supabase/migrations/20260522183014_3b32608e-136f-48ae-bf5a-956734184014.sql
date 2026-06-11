REVOKE EXECUTE ON FUNCTION public.post_ledger_entries(jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.seed_default_roles(uuid, text, uuid) FROM authenticated;