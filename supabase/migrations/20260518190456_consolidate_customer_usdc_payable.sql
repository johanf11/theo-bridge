-- Consolidate per-customer CUSTOMER_USDC sub-accounts into a single pooled
-- CUSTOMER_USDC_PAYABLE account while preserving per-customer attribution
-- via a customer_id column on ledger_entries.
--
-- Design: one ledger_accounts row (CUSTOMER_USDC_PAYABLE, no customer_id)
-- for the trial balance. Per-customer balances are derived by filtering
-- ledger_entries.customer_id — no separate account rows needed.
--
-- Note: ledger_accounts has no balance column in this schema; balances
-- are derived by summing ledger_entries.

-- ── 1. Add customer_id to ledger_entries ─────────────────────────────────────
ALTER TABLE public.ledger_entries
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id);

-- ── 2. Migrate per-customer CUSTOMER_USDC entries → CUSTOMER_USDC_PAYABLE ────
DO $$
DECLARE
  payable_id uuid;
  acct       RECORD;
BEGIN
  SELECT id INTO payable_id
  FROM   public.ledger_accounts
  WHERE  code = 'CUSTOMER_USDC_PAYABLE'
    AND  customer_id IS NULL
  LIMIT  1;

  IF payable_id IS NULL THEN
    RAISE EXCEPTION 'CUSTOMER_USDC_PAYABLE system account not found — cannot migrate';
  END IF;

  -- Matches both 'CUSTOMER_USDC' (new schema template rows) and
  -- 'CUSTOMER_USDC_<uuid>' (old schema per-customer rows)
  FOR acct IN
    SELECT la.id, la.customer_id
    FROM   public.ledger_accounts la
    WHERE  la.code = 'CUSTOMER_USDC'
       OR  la.code LIKE 'CUSTOMER_USDC_%'
       AND la.customer_id IS NOT NULL
  LOOP
    -- Re-point entries and stamp customer_id for per-customer attribution
    UPDATE public.ledger_entries
    SET    account_id  = payable_id,
           customer_id = acct.customer_id
    WHERE  account_id = acct.id;

    DELETE FROM public.ledger_accounts WHERE id = acct.id;

    RAISE NOTICE 'Migrated CUSTOMER_USDC account for customer %', acct.customer_id;
  END LOOP;
END;
$$;

-- ── 3. Update post_ledger_entries to store customer_id per entry ─────────────
CREATE OR REPLACE FUNCTION public.post_ledger_entries(payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tx_id   uuid;
  entry   jsonb;
  acct_id uuid;
  src     text;
BEGIN
  src := payload->>'source_key';
  IF src IS NOT NULL THEN
    SELECT id INTO tx_id FROM public.ledger_transactions WHERE source_key = src;
    IF tx_id IS NOT NULL THEN RETURN tx_id; END IF;
  END IF;

  INSERT INTO public.ledger_transactions (order_id, kind, description, posted_by, source_key, stellar_tx_hash)
  VALUES (
    NULLIF(payload->>'order_id',       '')::uuid,
    payload->>'kind',
    payload->>'description',
    NULLIF(payload->>'posted_by',      '')::uuid,
    NULLIF(payload->>'source_key',     '')::text,
    NULLIF(payload->>'stellar_tx_hash','')::text
  )
  RETURNING id INTO tx_id;

  FOR entry IN SELECT * FROM jsonb_array_elements(payload->'entries')
  LOOP
    SELECT id INTO acct_id FROM public.ledger_accounts WHERE code = entry->>'code';
    IF acct_id IS NULL THEN
      RAISE EXCEPTION 'unknown ledger account code: %', entry->>'code';
    END IF;

    INSERT INTO public.ledger_entries
      (transaction_id, account_id, currency, debit, credit, customer_id)
    VALUES (
      tx_id, acct_id,
      entry->>'currency',
      COALESCE((entry->>'debit' )::numeric, 0),
      COALESCE((entry->>'credit')::numeric, 0),
      NULLIF(entry->>'customer_id', '')::uuid
    );
  END LOOP;

  RETURN tx_id;
END
$$;

REVOKE ALL ON FUNCTION public.post_ledger_entries(jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.post_ledger_entries(jsonb) TO service_role;

-- ── 4. Drop the per-customer account helper ───────────────────────────────────
DROP FUNCTION IF EXISTS public.get_or_create_customer_usdc_account(uuid);
