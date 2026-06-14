ALTER TABLE invoices
  ADD COLUMN share_token TEXT UNIQUE,
  ADD COLUMN share_token_expires_at TIMESTAMPTZ;

UPDATE invoices SET share_token = encode(gen_random_bytes(32), 'hex') WHERE share_token IS NULL;

ALTER TABLE invoices ALTER COLUMN share_token SET NOT NULL;

CREATE OR REPLACE FUNCTION generate_invoice_share_token()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.share_token IS NULL THEN
    NEW.share_token := encode(gen_random_bytes(32), 'hex');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_set_share_token ON invoices;
CREATE TRIGGER invoices_set_share_token
  BEFORE INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION generate_invoice_share_token();

CREATE INDEX IF NOT EXISTS invoices_share_token_idx ON invoices(share_token);