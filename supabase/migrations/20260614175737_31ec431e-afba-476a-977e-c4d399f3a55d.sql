ALTER TABLE invoices
  ALTER COLUMN share_token SET DEFAULT encode(gen_random_bytes(32), 'hex');

REVOKE EXECUTE ON FUNCTION public.generate_invoice_share_token() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.generate_invoice_share_token() TO service_role;