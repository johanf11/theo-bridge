-- Bank accounts for off-ramp withdrawals
CREATE TABLE bank_accounts (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id   uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  bank_name     text NOT NULL,
  account_name  text NOT NULL,
  account_number text NOT NULL,          -- stored as entered (masked in UI)
  routing_code  text,                    -- BIC / SWIFT / local routing
  currency      text NOT NULL DEFAULT 'HTG',
  is_default    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customers manage own bank accounts"
  ON bank_accounts FOR ALL
  USING (
    customer_id IN (
      SELECT id FROM customers WHERE user_id = auth.uid()
    )
  );

-- Only one default per customer
CREATE UNIQUE INDEX bank_accounts_one_default
  ON bank_accounts (customer_id)
  WHERE is_default = true;
