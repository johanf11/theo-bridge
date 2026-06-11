-- Reverse the overcorrection posted by 20260523190000.
--
-- The 20260523190000 migration correctly posted the swap and mint ledger entries,
-- which together already closed the -27,716 USDC distributor delta.  But the
-- fallback correcting entry also fired for the full 27,716 (v_delta was not
-- updated in the nested PL/pgSQL scope), doubling the credits and flipping the
-- delta to +27,716.
--
-- This reversal cancels that fallback entry exactly, returning the delta to ~0.
-- Idempotent via source_key.

DO $$
DECLARE
  v_dist_id  uuid;
  v_cust_id  uuid;
  v_cig_id   uuid;
  v_tx_id    uuid;
  v_amount   numeric;
BEGIN
  SELECT id INTO v_dist_id FROM public.ledger_accounts WHERE code = 'DISTRIBUTOR_USDC'      LIMIT 1;
  SELECT id INTO v_cust_id FROM public.ledger_accounts WHERE code = 'CUSTOMER_USDC_PAYABLE' LIMIT 1;
  SELECT id INTO v_cig_id  FROM public.customers       WHERE company_name = 'Caribbean Import Group S.A.' LIMIT 1;

  -- Find the overcorrection entry amount
  SELECT le.credit INTO v_amount
  FROM   public.ledger_transactions lt
  JOIN   public.ledger_entries le ON le.transaction_id = lt.id
  WHERE  lt.source_key = 'correction:distributor:2026-05-23'
    AND  le.account_id = v_dist_id
    AND  le.credit > 0
  LIMIT 1;

  IF v_amount IS NULL THEN
    RAISE NOTICE 'Overcorrection entry not found — nothing to reverse';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ledger_transactions
    WHERE source_key = 'reversal:correction:distributor:2026-05-23'
  ) THEN
    RAISE NOTICE 'Reversal already posted — skipping';
    RETURN;
  END IF;

  INSERT INTO public.ledger_transactions
    (kind, description, source_key, created_at)
  VALUES (
    'USDC_MINT_CORRECTION',
    'Reversal: overcorrection on 2026-05-23 delta correction',
    'reversal:correction:distributor:2026-05-23',
    now()
  )
  RETURNING id INTO v_tx_id;

  -- Debit DISTRIBUTOR_USDC (increases book balance back)
  -- Credit CUSTOMER_USDC_PAYABLE (reverses the phantom payable)
  INSERT INTO public.ledger_entries
    (transaction_id, account_id, currency, debit, credit, customer_id) VALUES
    (v_tx_id, v_dist_id, 'USDC', v_amount, 0,        NULL),
    (v_tx_id, v_cust_id, 'USDC', 0,        v_amount, v_cig_id);

  RAISE NOTICE 'Reversal posted for %', v_amount;
END $$;
