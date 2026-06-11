DO $$
DECLARE
  v_dist_id  uuid;
  v_cust_id  uuid;
  v_fee_id   uuid;
  v_ext_id   uuid;
  v_cig_id   uuid;
  v_swap     RECORD;
  v_mint     RECORD;
  v_payout   RECORD;
  v_tx_id    uuid;
  v_date_str text := '2026-05-24';
BEGIN
  SELECT id INTO v_dist_id FROM public.ledger_accounts WHERE code = 'DISTRIBUTOR_USDC'                LIMIT 1;
  SELECT id INTO v_cust_id FROM public.ledger_accounts WHERE code = 'CUSTOMER_USDC_PAYABLE'           LIMIT 1;
  SELECT id INTO v_fee_id  FROM public.ledger_accounts WHERE code = 'FEE_REVENUE_USDC'                LIMIT 1;
  SELECT id INTO v_ext_id  FROM public.ledger_accounts WHERE code = 'EXTERNAL_COUNTERPARTY_FLOW_USDC' LIMIT 1;
  SELECT id INTO v_cig_id  FROM public.customers WHERE company_name = 'Caribbean Import Group S.A.'   LIMIT 1;

  SELECT * INTO v_swap FROM public.orders WHERE reference_number = 'SWP-SCHED-20260524' LIMIT 1;
  IF v_swap IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.ledger_transactions WHERE source_key = 'sched:swap:' || v_date_str
  ) THEN
    INSERT INTO public.ledger_transactions (kind, description, source_key, stellar_tx_hash, created_at)
    VALUES ('htgc_to_usdc_swap', 'Scheduled swap HTG-C → USDC SWP-SCHED-20260524',
            'sched:swap:' || v_date_str, v_swap.stellar_tx_hash, v_swap.completed_at)
    RETURNING id INTO v_tx_id;
    INSERT INTO public.ledger_entries (transaction_id, account_id, currency, debit, credit, customer_id) VALUES
      (v_tx_id, v_cust_id, 'USDC', COALESCE(v_swap.usdc_gross, v_swap.usdc_amount), 0,                          v_cig_id),
      (v_tx_id, v_dist_id, 'USDC', 0,                                               v_swap.usdc_amount,          NULL),
      (v_tx_id, v_fee_id,  'USDC', 0,                                               COALESCE(v_swap.fee_usdc, 0), NULL);
    RAISE NOTICE 'Swap posted: % USDC net', v_swap.usdc_amount;
  ELSE
    RAISE NOTICE 'Swap: already exists or order not found';
  END IF;

  SELECT p.* INTO v_payout FROM public.payouts p
  WHERE  to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') = v_date_str
    AND  p.memo NOT IN ('internal-transfer', 'blend-withdraw')
  ORDER  BY p.created_at DESC LIMIT 1;
  IF v_payout IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.ledger_transactions WHERE source_key = 'sched:payout:' || v_date_str
  ) THEN
    INSERT INTO public.ledger_transactions (kind, description, source_key, stellar_tx_hash, created_at)
    VALUES ('PAYOUT_USDC', 'Scheduled payout', 'sched:payout:' || v_date_str, v_payout.stellar_tx_hash, v_payout.created_at)
    RETURNING id INTO v_tx_id;
    INSERT INTO public.ledger_entries (transaction_id, account_id, currency, debit, credit, customer_id) VALUES
      (v_tx_id, v_cust_id, 'USDC', v_payout.amount_usdc, 0,                    v_cig_id),
      (v_tx_id, v_ext_id,  'USDC', 0,                    v_payout.amount_usdc, NULL);
    RAISE NOTICE 'Payout posted: % USDC', v_payout.amount_usdc;
  ELSE
    RAISE NOTICE 'Payout: already exists or not found';
  END IF;

  SELECT * INTO v_mint FROM public.orders WHERE reference_number = 'THEO-CNV-MINT-20260524' LIMIT 1;
  IF v_mint IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.ledger_transactions WHERE source_key = 'sched:usdcmint:' || v_date_str
  ) THEN
    INSERT INTO public.ledger_transactions (kind, description, source_key, stellar_tx_hash, created_at)
    VALUES ('DISTRIBUTOR_AUTO_MINT', 'Scheduled USDC liquidity provision THEO-CNV-MINT-20260524',
            'sched:usdcmint:' || v_date_str, v_mint.stellar_tx_hash, v_mint.completed_at)
    RETURNING id INTO v_tx_id;
    INSERT INTO public.ledger_entries (transaction_id, account_id, currency, debit, credit, customer_id) VALUES
      (v_tx_id, v_cust_id, 'USDC', v_mint.usdc_amount, 0,                  v_cig_id),
      (v_tx_id, v_dist_id, 'USDC', 0,                  v_mint.usdc_amount, NULL);
    RAISE NOTICE 'USDC mint posted: % USDC', v_mint.usdc_amount;
  ELSE
    RAISE NOTICE 'USDC mint: already exists or order not found';
  END IF;

  RAISE NOTICE 'May 24 backfill complete.';
END $$;