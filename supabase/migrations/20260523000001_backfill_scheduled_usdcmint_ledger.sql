-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill ledger entries for USDC auto-mint step that was missing from the
-- first backfill migration (20260523000000).
--
-- Each scheduled-tx run sends ~20K USDC from the distributor to the customer
-- wallet (THEO-CNV-MINT-* orders). These were not covered in the first pass.
--
--   sched:usdcmint:{date}
--     Dr CUSTOMER_USDC_PAYABLE  mintAmount  USDC
--     Cr DISTRIBUTOR_USDC       mintAmount  USDC
--
-- Idempotent via source_key — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_mint          record;
  v_dist_usdc_id  uuid;
  v_cust_usdc_id  uuid;
  v_tx_id         uuid;
  v_date_str      text;
BEGIN

  SELECT id INTO v_dist_usdc_id FROM ledger_accounts WHERE code = 'DISTRIBUTOR_USDC'      LIMIT 1;
  SELECT id INTO v_cust_usdc_id FROM ledger_accounts WHERE code = 'CUSTOMER_USDC_PAYABLE' LIMIT 1;

  IF v_dist_usdc_id IS NULL THEN RAISE EXCEPTION 'DISTRIBUTOR_USDC account not found';      END IF;
  IF v_cust_usdc_id IS NULL THEN RAISE EXCEPTION 'CUSTOMER_USDC_PAYABLE account not found'; END IF;

  FOR v_mint IN
    SELECT o.id, o.usdc_amount, o.stellar_tx_hash, o.completed_at,
           to_char(o.completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date_str
    FROM   orders o
    WHERE  o.reference_number LIKE 'THEO-CNV-MINT-%'
    ORDER  BY o.completed_at
  LOOP
    v_date_str := v_mint.date_str;

    CONTINUE WHEN EXISTS (
      SELECT 1 FROM ledger_transactions
      WHERE source_key = 'sched:usdcmint:' || v_date_str
    );

    INSERT INTO ledger_transactions (source_key, description, posted_by, created_at)
    VALUES (
      'sched:usdcmint:' || v_date_str,
      'Scheduled USDC liquidity provision THEO-CNV-MINT-' || replace(v_date_str, '-', ''),
      NULL,
      v_mint.completed_at
    )
    RETURNING id INTO v_tx_id;

    INSERT INTO ledger_entries (transaction_id, account_id, amount, side, currency)
    VALUES
      (v_tx_id, v_cust_usdc_id, v_mint.usdc_amount, 'DEBIT',  'USDC'),
      (v_tx_id, v_dist_usdc_id, v_mint.usdc_amount, 'CREDIT', 'USDC');

    RAISE NOTICE 'usdcmint posted for %: % USDC', v_date_str, v_mint.usdc_amount;
  END LOOP;

  RAISE NOTICE 'USDC mint backfill complete.';
END $$;
