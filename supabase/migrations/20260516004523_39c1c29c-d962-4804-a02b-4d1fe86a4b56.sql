
-- Phase 2: ledger expansion

-- 1. Add customer_id to ledger_accounts for per-customer subaccounts
ALTER TABLE public.ledger_accounts
  ADD COLUMN IF NOT EXISTS customer_id uuid;

CREATE INDEX IF NOT EXISTS idx_ledger_accounts_customer ON public.ledger_accounts(customer_id);

-- 2. Idempotency key on ledger_transactions for backfill + replays
ALTER TABLE public.ledger_transactions
  ADD COLUMN IF NOT EXISTS source_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_tx_source_key
  ON public.ledger_transactions(source_key)
  WHERE source_key IS NOT NULL;

-- 3. Performance index on entries
CREATE INDEX IF NOT EXISTS idx_ledger_entries_acct_currency
  ON public.ledger_entries(account_id, currency);

-- 4. Posting failures table — ops queue when chain succeeded but ledger post failed
CREATE TABLE IF NOT EXISTS public.ledger_posting_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,           -- e.g. 'release-usdc', 'blend-sweep'
  reason text NOT NULL,
  payload jsonb NOT NULL,
  stellar_tx_hash text,
  order_id uuid,
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_tx_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ledger_posting_failures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read posting failures"
  ON public.ledger_posting_failures FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins update posting failures"
  ON public.ledger_posting_failures FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service full posting failures"
  ON public.ledger_posting_failures FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- 5. New seed accounts (idempotent via ON CONFLICT)
INSERT INTO public.ledger_accounts (code, name, type, currency) VALUES
  ('TREASURY_USDC',          'Treasury USDC (cold)',      'ASSET',     'USDC'),
  ('BLEND_DEPOSITS_USDC',    'Blend principal (USDC)',    'ASSET',     'USDC'),
  ('BLEND_YIELD_USDC',       'Blend yield income',        'REVENUE',   'USDC'),
  ('HTGC_ISSUED',            'HTG-C outstanding float',   'LIABILITY', 'HTG'),
  ('FEE_REVENUE_HTG',        'Fee revenue (HTG)',         'REVENUE',   'HTG'),
  ('OPENING_BALANCE_USDC',   'Opening balance equity USDC','EQUITY',   'USDC'),
  ('OPENING_BALANCE_HTG',    'Opening balance equity HTG','EQUITY',    'HTG')
ON CONFLICT (code) DO NOTHING;

-- 6. RPC: get or create per-customer USDC subaccount (service role only)
CREATE OR REPLACE FUNCTION public.get_or_create_customer_usdc_account(p_customer_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  acct_id uuid;
  acct_code text;
BEGIN
  acct_code := 'CUSTOMER_USDC_' || replace(p_customer_id::text, '-', '');
  SELECT id INTO acct_id FROM public.ledger_accounts WHERE code = acct_code;
  IF acct_id IS NULL THEN
    INSERT INTO public.ledger_accounts (code, name, type, currency, customer_id)
    VALUES (acct_code, 'Customer USDC payable ' || left(p_customer_id::text, 8), 'LIABILITY', 'USDC', p_customer_id)
    ON CONFLICT (code) DO NOTHING
    RETURNING id INTO acct_id;
    IF acct_id IS NULL THEN
      SELECT id INTO acct_id FROM public.ledger_accounts WHERE code = acct_code;
    END IF;
  END IF;
  RETURN acct_id;
END
$$;

REVOKE ALL ON FUNCTION public.get_or_create_customer_usdc_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_customer_usdc_account(uuid) TO service_role;

-- 7. Enhance post_ledger_entries to accept source_key
CREATE OR REPLACE FUNCTION public.post_ledger_entries(payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tx_id uuid;
  entry jsonb;
  acct_id uuid;
  src_key text;
BEGIN
  src_key := NULLIF(payload->>'source_key','');

  -- Idempotency: if source_key already posted, return existing tx id
  IF src_key IS NOT NULL THEN
    SELECT id INTO tx_id FROM public.ledger_transactions WHERE source_key = src_key;
    IF tx_id IS NOT NULL THEN
      RETURN tx_id;
    END IF;
  END IF;

  INSERT INTO public.ledger_transactions (order_id, kind, description, posted_by, source_key)
  VALUES (
    NULLIF(payload->>'order_id','')::uuid,
    payload->>'kind',
    payload->>'description',
    NULLIF(payload->>'posted_by','')::uuid,
    src_key
  )
  RETURNING id INTO tx_id;

  FOR entry IN SELECT * FROM jsonb_array_elements(payload->'entries')
  LOOP
    IF entry ? 'account_id' THEN
      acct_id := (entry->>'account_id')::uuid;
    ELSE
      SELECT id INTO acct_id FROM public.ledger_accounts WHERE code = entry->>'code';
      IF acct_id IS NULL THEN
        RAISE EXCEPTION 'unknown ledger account code: %', entry->>'code';
      END IF;
    END IF;
    INSERT INTO public.ledger_entries (transaction_id, account_id, currency, debit, credit)
    VALUES (
      tx_id,
      acct_id,
      entry->>'currency',
      COALESCE((entry->>'debit')::numeric, 0),
      COALESCE((entry->>'credit')::numeric, 0)
    );
  END LOOP;

  RETURN tx_id;
END
$$;
