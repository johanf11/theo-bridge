-- 1. Add column-level DEFAULT to share_token.
-- Makes the column optional on INSERT in regenerated Supabase TS types,
-- while keeping the trigger as a defense-in-depth fallback for explicit NULLs.
ALTER TABLE invoices
  ALTER COLUMN share_token SET DEFAULT encode(gen_random_bytes(32), 'hex');

-- 2. Lock down EXECUTE on the trigger function.
-- Only the trigger context (which runs as the table owner) needs to invoke it.
-- No application code calls this function directly.
REVOKE EXECUTE ON FUNCTION public.generate_invoice_share_token() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.generate_invoice_share_token() TO service_role;
