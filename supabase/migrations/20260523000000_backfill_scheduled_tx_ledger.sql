-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill ledger entries for all existing scheduled-tx runs
-- (those whose ledger was missing because scheduled-tx had no postLedger calls).
--
-- Covers 4 event kinds per day:
--   sched:onramp:{date}   — SPIH_BANK_HTG Dr / HTGC_ISSUED Cr        (HTG)
--   sched:swap:{date}     — htgc_to_usdc swap journal                  (HTG+USDC)
--   sched:burn:{date}     — HTGC_ISSUED Dr / SPIH_BANK_HTG Cr         (HTG)
--   sched:payout:{date}   — CUSTOMER_USDC_PAYABLE Dr / EXTERNAL Cr    (USDC)
--
-- All posts are idempotent via source_key — safe to re-run.
-- Burn entries use the same HTG amount as the swap (swapHtgAmount).
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_onramp        record;
  v_swap          record;
  v_payout        record;

  -- ledger account ids (resolved once)
  v_spih_id       uuid;
  v_htgc_id       uuid;
  v_fx_htg_id     uuid;
  v_dist_usdc_id  uuid;
  v_cust_usdc_id  uuid;
  v_fee_rev_id    uuid;
  v_ext_flow_id   uuid;

  v_tx_id         uuid;
  v_date_str      text;
BEGIN

  -- ── Resolve ledger account IDs ──────────────────────────────────────────────
  SELECT id INTO v_spih_id      FROM ledger_accounts WHERE code = 'SPIH_BANK_HTG'                  LIMIT 1;
  SELECT id INTO v_htgc_id      FROM ledger_accounts WHERE code = 'HTGC_ISSUED'                    LIMIT 1;
  SELECT id INTO v_fx_htg_id    FROM ledger_accounts WHERE code = 'FX_CLEARING_HTG'               LIMIT 1;
  SELECT id INTO v_dist_usdc_id FROM ledger_accounts WHERE code = 'DISTRIBUTOR_USDC'              LIMIT 1;
  SELECT id INTO v_cust_usdc_id FROM ledger_accounts WHERE code = 'CUSTOMER_USDC_PAYABLE'         LIMIT 1;
  SELECT id INTO v_fee_rev_id   FROM ledger_accounts WHERE code = 'FEE_REVENUE_USDC'              LIMIT 1;
  SELECT id INTO v_ext_flow_id  FROM ledger_accounts WHERE code = 'EXTERNAL_COUNTERPARTY_FLOW_USDC' LIMIT 1;

  IF v_spih_id IS NULL      THEN RAISE EXCEPTION 'ledger account SPIH_BANK_HTG not found';      END IF;
  IF v_htgc_id IS NULL      THEN RAISE EXCEPTION 'ledger account HTGC_ISSUED not found';        END IF;
  IF v_fx_htg_id IS NULL    THEN RAISE EXCEPTION 'ledger account FX_CLEARING_HTG not found';    END IF;
  IF v_dist_usdc_id IS NULL THEN RAISE EXCEPTION 'ledger account DISTRIBUTOR_USDC not found';   END IF;
  IF v_cust_usdc_id IS NULL THEN RAISE EXCEPTION 'ledger account CUSTOMER_USDC_PAYABLE not found'; END IF;
  IF v_fee_rev_id IS NULL   THEN RAISE EXCEPTION 'ledger account FEE_REVENUE_USDC not found';   END IF;
  IF v_ext_flow_id IS NULL  THEN RAISE EXCEPTION 'ledger account EXTERNAL_COUNTERPARTY_FLOW_USDC not found'; END IF;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- 1. ONRAMP  (THEO-CNV-SCHED-*)
  --    Dr SPIH_BANK_HTG  htg_amount  HTG
  --    Cr HTGC_ISSUED    htg_amount  HTG
  -- ═══════════════════════════════════════════════════════════════════════════
  FOR v_onramp IN
    SELECT o.id, o.htg_amount, o.stellar_tx_hash, o.completed_at,
           to_char(o.completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date_str
    FROM   orders o
    WHERE  o.reference_number LIKE 'THEO-CNV-SCHED-%'
    ORDER  BY o.completed_at
  LOOP
    v_date_str := v_onramp.date_str;

    -- Skip if already posted
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM ledger_transactions WHERE source_key = 'sched:onramp:' || v_date_str
    );

    INSERT INTO ledger_transactions (source_key, description, posted_by, created_at)
    VALUES (
      'sched:onramp:' || v_date_str,
      'Scheduled onramp — SPIH cash-in THEO-CNV-SCHED-' || replace(v_date_str, '-', ''),
      NULL,
      v_onramp.completed_at
    )
    RETURNING id INTO v_tx_id;

    INSERT INTO ledger_entries (transaction_id, account_id, amount, side, currency)
    VALUES
      (v_tx_id, v_spih_id, v_onramp.htg_amount, 'DEBIT',  'HTG'),
      (v_tx_id, v_htgc_id, v_onramp.htg_amount, 'CREDIT', 'HTG');

    RAISE NOTICE 'onramp posted for %: % HTG', v_date_str, v_onramp.htg_amount;
  END LOOP;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- 2. SWAP  (SWP-SCHED-*)
  --    HTG side:  Dr SPIH_BANK_HTG / Cr FX_CLEARING_HTG
  --    USDC side: Dr CUSTOMER_USDC_PAYABLE / Cr DISTRIBUTOR_USDC + FEE_REVENUE_USDC
  -- ═══════════════════════════════════════════════════════════════════════════
  FOR v_swap IN
    SELECT o.id, o.htg_amount, o.usdc_amount, o.usdc_gross, o.fee_usdc,
           o.stellar_tx_hash, o.completed_at,
           to_char(o.completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date_str
    FROM   orders o
    WHERE  o.reference_number LIKE 'SWP-SCHED-%'
    ORDER  BY o.completed_at
  LOOP
    v_date_str := v_swap.date_str;

    -- ── Swap journal ──
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM ledger_transactions WHERE source_key = 'sched:swap:' || v_date_str
    );

    INSERT INTO ledger_transactions (source_key, description, posted_by, created_at)
    VALUES (
      'sched:swap:' || v_date_str,
      'Scheduled swap HTG-C → USDC SWP-SCHED-' || replace(v_date_str, '-', ''),
      NULL,
      v_swap.completed_at
    )
    RETURNING id INTO v_tx_id;

    INSERT INTO ledger_entries (transaction_id, account_id, amount, side, currency)
    VALUES
      -- HTG leg
      (v_tx_id, v_spih_id,      v_swap.htg_amount,  'DEBIT',  'HTG'),
      (v_tx_id, v_fx_htg_id,    v_swap.htg_amount,  'CREDIT', 'HTG'),
      -- USDC leg (gross = net + fee)
      (v_tx_id, v_cust_usdc_id, COALESCE(v_swap.usdc_gross, v_swap.usdc_amount), 'DEBIT',  'USDC'),
      (v_tx_id, v_dist_usdc_id, v_swap.usdc_amount, 'CREDIT', 'USDC'),
      (v_tx_id, v_fee_rev_id,   GREATEST(COALESCE(v_swap.fee_usdc, 0), 0.0000001), 'CREDIT', 'USDC');

    RAISE NOTICE 'swap posted for %: % HTG / % USDC net', v_date_str, v_swap.htg_amount, v_swap.usdc_amount;

    -- ── Burn journal (same date, same HTG amount) ──
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM ledger_transactions WHERE source_key = 'sched:burn:' || v_date_str
    );

    INSERT INTO ledger_transactions (source_key, description, posted_by, created_at)
    VALUES (
      'sched:burn:' || v_date_str,
      'Scheduled HTGC burn — supply contraction SWP-SCHED-' || replace(v_date_str, '-', ''),
      NULL,
      v_swap.completed_at + interval '1 second'
    )
    RETURNING id INTO v_tx_id;

    INSERT INTO ledger_entries (transaction_id, account_id, amount, side, currency)
    VALUES
      (v_tx_id, v_htgc_id, v_swap.htg_amount, 'DEBIT',  'HTG'),
      (v_tx_id, v_spih_id, v_swap.htg_amount, 'CREDIT', 'HTG');

    RAISE NOTICE 'burn posted for %: % HTG burned', v_date_str, v_swap.htg_amount;
  END LOOP;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- 3. PAYOUT  (payouts table, excluding internal-transfer / blend-withdraw)
  --    Dr CUSTOMER_USDC_PAYABLE  / Cr EXTERNAL_COUNTERPARTY_FLOW_USDC
  --    Match by date to the scheduled-tx run
  -- ═══════════════════════════════════════════════════════════════════════════
  FOR v_payout IN
    SELECT p.id, p.amount_usdc, p.stellar_tx_hash, p.created_at,
           to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date_str
    FROM   payouts p
    WHERE  p.memo NOT IN ('internal-transfer', 'blend-withdraw')
      AND  to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') IN (
             -- only backfill dates that have a scheduled swap (i.e. were scheduled-tx runs)
             SELECT DISTINCT to_char(completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
             FROM   orders
             WHERE  reference_number LIKE 'SWP-SCHED-%'
           )
    ORDER  BY p.created_at
  LOOP
    v_date_str := v_payout.date_str;

    CONTINUE WHEN EXISTS (
      SELECT 1 FROM ledger_transactions WHERE source_key = 'sched:payout:' || v_date_str
    );

    INSERT INTO ledger_transactions (source_key, description, posted_by, created_at)
    VALUES (
      'sched:payout:' || v_date_str,
      'Scheduled payout',
      NULL,
      v_payout.created_at
    )
    RETURNING id INTO v_tx_id;

    INSERT INTO ledger_entries (transaction_id, account_id, amount, side, currency)
    VALUES
      (v_tx_id, v_cust_usdc_id, v_payout.amount_usdc, 'DEBIT',  'USDC'),
      (v_tx_id, v_ext_flow_id,  v_payout.amount_usdc, 'CREDIT', 'USDC');

    RAISE NOTICE 'payout posted for %: % USDC', v_date_str, v_payout.amount_usdc;
  END LOOP;

  RAISE NOTICE 'Backfill complete.';
END $$;
