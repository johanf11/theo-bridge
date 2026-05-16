REVOKE ALL ON FUNCTION public.ledger_entry_currency_check() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_transaction_balance_check() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_ledger_entries(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_ledger_entries(jsonb) TO service_role;

ALTER FUNCTION public.ledger_entry_currency_check() SECURITY INVOKER;
ALTER FUNCTION public.ledger_transaction_balance_check() SECURITY INVOKER;