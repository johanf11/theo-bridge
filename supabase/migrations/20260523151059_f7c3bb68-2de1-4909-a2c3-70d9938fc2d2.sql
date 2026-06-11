-- Step 1: re-fix _ledger_validate_balance (idempotent)
CREATE OR REPLACE FUNCTION public._ledger_validate_balance(p_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT currency,
           SUM(debit)  AS dr,
           SUM(credit) AS cr
    FROM   public.ledger_entries
    WHERE  transaction_id = p_transaction_id
    GROUP  BY currency
  LOOP
    IF round(r.dr, 7) <> round(r.cr, 7) THEN
      RAISE EXCEPTION
        'Unbalanced posting for transaction %: currency % debits=% credits=%',
        p_transaction_id, r.currency, r.dr, r.cr;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM   public.ledger_entries   le
    JOIN   public.ledger_accounts  la ON la.id = le.account_id
    WHERE  le.transaction_id = p_transaction_id
      AND  le.currency <> la.currency
  ) THEN
    RAISE EXCEPTION
      'Currency mismatch: one or more entries have a currency that does not match their account';
  END IF;
END;
$$;

-- Step 2: insert missing entries for THEO-CNV-MINT-* orders
DO $$
DECLARE
  v_mint          record;
  v_dist_usdc_id  uuid;
  v_cust_usdc_id  uuid;
  v_tx_id         uuid;
  v_entry_count   int;
  v_date_str      text;
BEGIN
  SELECT id INTO v_dist_usdc_id FROM public.ledger_accounts WHERE code = 'DISTRIBUTOR_USDC'      LIMIT 1;
  SELECT id INTO v_cust_usdc_id FROM public.ledger_accounts WHERE code = 'CUSTOMER_USDC_PAYABLE' LIMIT 1;

  IF v_dist_usdc_id IS NULL THEN RAISE EXCEPTION 'DISTRIBUTOR_USDC account not found';      END IF;
  IF v_cust_usdc_id IS NULL THEN RAISE EXCEPTION 'CUSTOMER_USDC_PAYABLE account not found'; END IF;

  FOR v_mint IN
    SELECT o.id, o.usdc_amount, o.completed_at,
           to_char(o.completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date_str
    FROM   public.orders o
    WHERE  o.reference_number LIKE 'THEO-CNV-MINT-%'
    ORDER  BY o.completed_at
  LOOP
    v_date_str := v_mint.date_str;

    SELECT id INTO v_tx_id FROM public.ledger_transactions
    WHERE  source_key = 'sched:usdcmint:' || v_date_str;

    IF v_tx_id IS NULL THEN
      INSERT INTO public.ledger_transactions (source_key, description, posted_by, created_at)
      VALUES (
        'sched:usdcmint:' || v_date_str,
        'Scheduled USDC liquidity provision THEO-CNV-MINT-' || replace(v_date_str, '-', ''),
        NULL,
        v_mint.completed_at
      )
      RETURNING id INTO v_tx_id;
      RAISE NOTICE 'Created tx for %', v_date_str;
    END IF;

    SELECT COUNT(*) INTO v_entry_count
    FROM   public.ledger_entries WHERE transaction_id = v_tx_id;

    IF v_entry_count = 0 THEN
      INSERT INTO public.ledger_entries
        (transaction_id, account_id, currency, debit, credit)
      VALUES
        (v_tx_id, v_cust_usdc_id, 'USDC', v_mint.usdc_amount, 0),
        (v_tx_id, v_dist_usdc_id, 'USDC', 0,                  v_mint.usdc_amount);

      RAISE NOTICE 'Patched entries for %: % USDC', v_date_str, v_mint.usdc_amount;
    ELSE
      RAISE NOTICE 'Skipped % — already has % entries', v_date_str, v_entry_count;
    END IF;
  END LOOP;

  RAISE NOTICE 'Patch complete.';
END $$;

-- Step 3: report orphaned scheduled-tx transactions
DO $$
DECLARE
  v_tx    record;
  v_entry_count int;
BEGIN
  FOR v_tx IN
    SELECT lt.id, lt.source_key, lt.created_at
    FROM   public.ledger_transactions lt
    WHERE  lt.source_key LIKE 'sched:%'
    ORDER  BY lt.created_at
  LOOP
    SELECT COUNT(*) INTO v_entry_count
    FROM   public.ledger_entries WHERE transaction_id = v_tx.id;

    IF v_entry_count = 0 THEN
      RAISE NOTICE 'Orphaned transaction (no entries): % id=%', v_tx.source_key, v_tx.id;
    END IF;
  END LOOP;
END $$;