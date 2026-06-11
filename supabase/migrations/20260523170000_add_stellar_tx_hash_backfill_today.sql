-- ─────────────────────────────────────────────────────────────────────────────
-- Root cause fix: ledger_transactions was missing the stellar_tx_hash column.
--
-- The 20260518190456 migration replaced post_ledger_entries to INSERT
-- stellar_tx_hash into ledger_transactions, but never added that column via
-- ALTER TABLE.  Every live call to post_ledger_entries since then has failed
-- with "column stellar_tx_hash of relation ledger_transactions does not exist",
-- silently swallowed by safePostLedger → ledger_posting_failures.
--
-- This migration:
--   1. Adds the missing column (idempotent).
--   2. Backfills all four scheduled-tx ledger steps for 2026-05-23 that failed.
--   3. Is idempotent — each step is skipped if the source_key already exists.
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 1: add missing column
ALTER TABLE public.ledger_transactions
  ADD COLUMN IF NOT EXISTS stellar_tx_hash text;

-- Step 2: backfill 2026-05-23 (and any other date whose onramp / swap / payout
--         / usdcmint orders exist but have no ledger_transactions row)
DO $$
DECLARE
  v_date_str  text;
  v_onramp    RECORD;
  v_swap      RECORD;
  v_payout    RECORD;
  v_mint      RECORD;
  v_cig_id    uuid;

  -- ledger account IDs (resolved once)
  v_spih_id   uuid;
  v_htgc_id   uuid;
  v_fx_htg_id uuid;
  v_dist_id   uuid;
  v_cust_id   uuid;
  v_fee_id    uuid;
  v_ext_id    uuid;

  v_tx_id     uuid;
BEGIN
  -- Resolve account IDs
  SELECT id INTO v_spih_id   FROM public.ledger_accounts WHERE code = 'SPIH_BANK_HTG'                    LIMIT 1;
  SELECT id INTO v_htgc_id   FROM public.ledger_accounts WHERE code = 'HTGC_ISSUED'                      LIMIT 1;
  SELECT id INTO v_fx_htg_id FROM public.ledger_accounts WHERE code = 'FX_CLEARING_HTG'                  LIMIT 1;
  SELECT id INTO v_dist_id   FROM public.ledger_accounts WHERE code = 'DISTRIBUTOR_USDC'                 LIMIT 1;
  SELECT id INTO v_cust_id   FROM public.ledger_accounts WHERE code = 'CUSTOMER_USDC_PAYABLE'            LIMIT 1;
  SELECT id INTO v_fee_id    FROM public.ledger_accounts WHERE code = 'FEE_REVENUE_USDC'                 LIMIT 1;
  SELECT id INTO v_ext_id    FROM public.ledger_accounts WHERE code = 'EXTERNAL_COUNTERPARTY_FLOW_USDC'  LIMIT 1;

  IF v_spih_id   IS NULL THEN RAISE EXCEPTION 'SPIH_BANK_HTG account not found';                    END IF;
  IF v_htgc_id   IS NULL THEN RAISE EXCEPTION 'HTGC_ISSUED account not found';                      END IF;
  IF v_fx_htg_id IS NULL THEN RAISE EXCEPTION 'FX_CLEARING_HTG account not found';                  END IF;
  IF v_dist_id   IS NULL THEN RAISE EXCEPTION 'DISTRIBUTOR_USDC account not found';                 END IF;
  IF v_cust_id   IS NULL THEN RAISE EXCEPTION 'CUSTOMER_USDC_PAYABLE account not found';            END IF;
  IF v_fee_id    IS NULL THEN RAISE EXCEPTION 'FEE_REVENUE_USDC account not found';                 END IF;
  IF v_ext_id    IS NULL THEN RAISE EXCEPTION 'EXTERNAL_COUNTERPARTY_FLOW_USDC account not found';  END IF;

  -- CIG customer id (for customer_id attribution on CUSTOMER_USDC_PAYABLE entries)
  SELECT id INTO v_cig_id FROM public.customers WHERE company_name = 'Caribbean Import Group S.A.' LIMIT 1;

  -- ── Loop over every date that has an onramp order (THEO-CNV-SCHED-*)
  --    but is missing the sched:onramp ledger transaction. This catches
  --    2026-05-23 and any future dates that fall through the same bug.
  FOR v_onramp IN
    SELECT o.id, o.htg_amount, o.stellar_tx_hash, o.completed_at,
           to_char(o.completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date_str
    FROM   public.orders o
    WHERE  o.reference_number LIKE 'THEO-CNV-SCHED-%'
      AND  NOT EXISTS (
             SELECT 1 FROM public.ledger_transactions lt
             WHERE  lt.source_key = 'sched:onramp:' ||
                    to_char(o.completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
           )
    ORDER  BY o.completed_at
  LOOP
    v_date_str := v_onramp.date_str;
    RAISE NOTICE 'Backfilling sched steps for %', v_date_str;

    -- ── 1. ONRAMP ───────────────────────────────────────────────────────────
    INSERT INTO public.ledger_transactions
      (kind, description, source_key, stellar_tx_hash, created_at)
    VALUES (
      'SPIH_CASH_IN',
      'Scheduled onramp — SPIH cash-in THEO-CNV-SCHED-' || replace(v_date_str, '-', ''),
      'sched:onramp:' || v_date_str,
      v_onramp.stellar_tx_hash,
      v_onramp.completed_at
    )
    RETURNING id INTO v_tx_id;

    INSERT INTO public.ledger_entries
      (transaction_id, account_id, currency, debit, credit) VALUES
      (v_tx_id, v_spih_id, 'HTG', v_onramp.htg_amount, 0),
      (v_tx_id, v_htgc_id, 'HTG', 0, v_onramp.htg_amount);

    RAISE NOTICE '  onramp: % HTG', v_onramp.htg_amount;

    -- ── 2. SWAP ─────────────────────────────────────────────────────────────
    SELECT * INTO v_swap FROM public.orders
    WHERE  reference_number = 'SWP-SCHED-' || replace(v_date_str, '-', '')
    LIMIT  1;

    IF v_swap IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.ledger_transactions WHERE source_key = 'sched:swap:' || v_date_str
    ) THEN
      INSERT INTO public.ledger_transactions
        (kind, description, source_key, stellar_tx_hash, created_at)
      VALUES (
        'htgc_to_usdc_swap',
        'Scheduled swap HTG-C → USDC SWP-SCHED-' || replace(v_date_str, '-', ''),
        'sched:swap:' || v_date_str,
        v_swap.stellar_tx_hash,
        v_swap.completed_at
      )
      RETURNING id INTO v_tx_id;

      INSERT INTO public.ledger_entries
        (transaction_id, account_id, currency, debit, credit, customer_id) VALUES
        (v_tx_id, v_spih_id,   'HTG',  v_swap.htg_amount,                             0,                   NULL),
        (v_tx_id, v_fx_htg_id, 'HTG',  0,                                             v_swap.htg_amount,   NULL),
        (v_tx_id, v_cust_id,   'USDC', COALESCE(v_swap.usdc_gross, v_swap.usdc_amount), 0,                 v_cig_id),
        (v_tx_id, v_dist_id,   'USDC', 0,                                             v_swap.usdc_amount,  NULL),
        (v_tx_id, v_fee_id,    'USDC', 0,                                             COALESCE(v_swap.fee_usdc, 0), NULL);

      RAISE NOTICE '  swap: % HTG / % USDC net', v_swap.htg_amount, v_swap.usdc_amount;
    END IF;

    -- ── 3. PAYOUT ───────────────────────────────────────────────────────────
    SELECT p.* INTO v_payout FROM public.payouts p
    WHERE  to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') = v_date_str
      AND  p.memo NOT IN ('internal-transfer', 'blend-withdraw')
    ORDER  BY p.created_at DESC
    LIMIT  1;

    IF v_payout IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.ledger_transactions WHERE source_key = 'sched:payout:' || v_date_str
    ) THEN
      INSERT INTO public.ledger_transactions
        (kind, description, source_key, stellar_tx_hash, created_at)
      VALUES (
        'PAYOUT_USDC',
        'Scheduled payout',
        'sched:payout:' || v_date_str,
        v_payout.stellar_tx_hash,
        v_payout.created_at
      )
      RETURNING id INTO v_tx_id;

      INSERT INTO public.ledger_entries
        (transaction_id, account_id, currency, debit, credit, customer_id) VALUES
        (v_tx_id, v_cust_id, 'USDC', v_payout.amount_usdc, 0,                   v_cig_id),
        (v_tx_id, v_ext_id,  'USDC', 0,                   v_payout.amount_usdc, NULL);

      RAISE NOTICE '  payout: % USDC', v_payout.amount_usdc;
    END IF;

    -- ── 4. USDC MINT ────────────────────────────────────────────────────────
    SELECT * INTO v_mint FROM public.orders
    WHERE  reference_number = 'THEO-CNV-MINT-' || replace(v_date_str, '-', '')
    LIMIT  1;

    IF v_mint IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.ledger_transactions WHERE source_key = 'sched:usdcmint:' || v_date_str
    ) THEN
      INSERT INTO public.ledger_transactions
        (kind, description, source_key, stellar_tx_hash, created_at)
      VALUES (
        'DISTRIBUTOR_AUTO_MINT',
        'Scheduled USDC liquidity provision THEO-CNV-MINT-' || replace(v_date_str, '-', ''),
        'sched:usdcmint:' || v_date_str,
        v_mint.stellar_tx_hash,
        v_mint.completed_at
      )
      RETURNING id INTO v_tx_id;

      INSERT INTO public.ledger_entries
        (transaction_id, account_id, currency, debit, credit, customer_id) VALUES
        (v_tx_id, v_cust_id, 'USDC', v_mint.usdc_amount, 0,                  v_cig_id),
        (v_tx_id, v_dist_id, 'USDC', 0,                  v_mint.usdc_amount, NULL);

      RAISE NOTICE '  usdcmint: % USDC', v_mint.usdc_amount;
    ELSE
      RAISE NOTICE '  usdcmint: already exists or no order found for %', v_date_str;
    END IF;
  END LOOP;

  RAISE NOTICE 'Done.';
END $$;
