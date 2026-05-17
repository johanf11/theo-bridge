DO $$
DECLARE
  v_gap          numeric;
  v_fx_usdc_id   uuid;
  v_ob_usdc_id   uuid;
BEGIN
  SELECT SUM(le.debit) - SUM(le.credit) INTO v_gap
  FROM   public.ledger_entries le
  JOIN   public.ledger_accounts la ON la.id = le.account_id
  WHERE  la.code = 'FX_CLEARING_USDC';

  IF v_gap IS NULL OR v_gap <= 0 THEN
    RAISE NOTICE 'FX_CLEARING_USDC gap is % — no correction needed', v_gap;
  ELSE
    SELECT id INTO v_fx_usdc_id FROM public.ledger_accounts WHERE code = 'FX_CLEARING_USDC';
    SELECT id INTO v_ob_usdc_id FROM public.ledger_accounts WHERE code = 'OPENING_BALANCE_USDC';

    PERFORM public.post_ledger_entries(jsonb_build_object(
      'kind', 'opening_balance',
      'description', 'Retire FX_CLEARING_USDC: credit to zero historical debit balance',
      'source_key', 'correction:FX_CLEARING_USDC:retire',
      'entries', jsonb_build_array(
        jsonb_build_object('account_id', v_ob_usdc_id, 'currency', 'USDC', 'debit', v_gap, 'credit', 0),
        jsonb_build_object('account_id', v_fx_usdc_id, 'currency', 'USDC', 'debit', 0, 'credit', v_gap)
      )
    ));
  END IF;
END;
$$;

DO $$
DECLARE
  v_gap        numeric;
  v_settled_id uuid;
  v_ob_htg_id  uuid;
BEGIN
  SELECT SUM(le.debit) - SUM(le.credit) INTO v_gap
  FROM   public.ledger_entries le
  JOIN   public.ledger_accounts la ON la.id = le.account_id
  WHERE  la.code = 'CUSTOMER_HTG_SETTLED';

  IF v_gap IS NULL OR v_gap <= 0 THEN
    RAISE NOTICE 'CUSTOMER_HTG_SETTLED gap is % — no correction needed', v_gap;
  ELSE
    SELECT id INTO v_settled_id FROM public.ledger_accounts WHERE code = 'CUSTOMER_HTG_SETTLED';
    SELECT id INTO v_ob_htg_id  FROM public.ledger_accounts WHERE code = 'OPENING_BALANCE_HTG';

    PERFORM public.post_ledger_entries(jsonb_build_object(
      'kind', 'opening_balance',
      'description', 'Correcting entry: FIAT_SETTLEMENT backfill gap in CUSTOMER_HTG_SETTLED',
      'source_key', 'correction:CUSTOMER_HTG_SETTLED:fiat_settlement_gap',
      'entries', jsonb_build_array(
        jsonb_build_object('account_id', v_ob_htg_id,  'currency', 'HTG', 'debit', v_gap, 'credit', 0),
        jsonb_build_object('account_id', v_settled_id, 'currency', 'HTG', 'debit', 0,     'credit', v_gap)
      )
    ));
  END IF;
END;
$$;

DO $$
DECLARE
  v_gap        numeric;
  v_payable_id uuid;
  v_ob_usdc_id uuid;
BEGIN
  SELECT SUM(le.debit) - SUM(le.credit) INTO v_gap
  FROM   public.ledger_entries le
  JOIN   public.ledger_accounts la ON la.id = le.account_id
  WHERE  la.code = 'CUSTOMER_USDC_PAYABLE'
    AND  la.customer_id IS NULL;

  IF v_gap IS NULL OR v_gap <= 0 THEN
    RAISE NOTICE 'CUSTOMER_USDC_PAYABLE gap is % — no correction needed', v_gap;
  ELSE
    SELECT id INTO v_payable_id FROM public.ledger_accounts
    WHERE code = 'CUSTOMER_USDC_PAYABLE' AND customer_id IS NULL;
    SELECT id INTO v_ob_usdc_id FROM public.ledger_accounts WHERE code = 'OPENING_BALANCE_USDC';

    PERFORM public.post_ledger_entries(jsonb_build_object(
      'kind', 'opening_balance',
      'description', 'Correcting entry: payout backfill gap in CUSTOMER_USDC_PAYABLE',
      'source_key', 'correction:CUSTOMER_USDC_PAYABLE:payout_gap',
      'entries', jsonb_build_array(
        jsonb_build_object('account_id', v_ob_usdc_id, 'currency', 'USDC', 'debit', v_gap, 'credit', 0),
        jsonb_build_object('account_id', v_payable_id, 'currency', 'USDC', 'debit', 0,     'credit', v_gap)
      )
    ));
  END IF;
END;
$$;