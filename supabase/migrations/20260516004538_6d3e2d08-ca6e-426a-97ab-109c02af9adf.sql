REVOKE ALL ON FUNCTION public.post_ledger_entries(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_ledger_entries(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.get_or_create_customer_usdc_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_customer_usdc_account(uuid) TO service_role;