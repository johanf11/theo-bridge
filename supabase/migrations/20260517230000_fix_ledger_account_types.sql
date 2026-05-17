-- ─────────────────────────────────────────────────────────────────────────────
-- Fix ledger account types and post correcting entries for backfill gaps.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. FX_CLEARING_USDC: retire by zeroing existing balance with an equity entry.
--    The account was seeded as LIABILITY but was only ever debited (no credits),
--    giving it a permanently negative balance. The underlying flows in
--    execute-swap and release-usdc have been fixed to use DISTRIBUTOR_USDC +
--    per-customer USDC account directly. This correcting entry zeros out the
--    historical debit balance so the account can be ignored going forward.
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

    IF v_fx_usdc_id IS NULL OR v_ob_usdc_id IS NULL THEN
      RAISE EXCEPTION 'Required ledger accounts not found';
    END IF;

    PERFORM public.post_ledger_entries(jsonb_build_object(
      'kind',        'opening_balance',
      'description', 'Retire FX_CLEARING_USDC: credit to zero historical debit balance',
      'source_key',  'correction:FX_CLEARING_USDC:retire',
      'entries', jsonb_build_array(
        jsonb_build_object('account_id', v_ob_usdc_id,  'currency', 'USDC', 'debit', v_gap, 'credit', 0),
        jsonb_build_object('account_id', v_fx_usdc_id,  'currency', 'USDC', 'debit', 0,     'credit', v_gap)
      )
    ));
    RAISE NOTICE 'Zeroed FX_CLEARING_USDC with correction of %', v_gap;
  END IF;
END;
$$;

-- 2. Correcting entry for CUSTOMER_HTG_SETTLED:
--    The backfill posted USDC_PAYOUT (Dr CUSTOMER_HTG_SETTLED) for all
--    historical orders but never posted the paired FIAT_SETTLEMENT
--    (Cr CUSTOMER_HTG_SETTLED). Post an opening-balance credit to zero it out.
DO $$
DECLARE
  v_gap          numeric;
  v_settled_id   uuid;
  v_ob_htg_id    uuid;
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

    IF v_settled_id IS NULL OR v_ob_htg_id IS NULL THEN
      RAISE EXCEPTION 'Required ledger accounts not found';
    END IF;

    PERFORM public.post_ledger_entries(jsonb_build_object(
      'kind',        'opening_balance',
      'description', 'Correcting entry: FIAT_SETTLEMENT backfill gap in CUSTOMER_HTG_SETTLED',
      'source_key',  'correction:CUSTOMER_HTG_SETTLED:fiat_settlement_gap',
      'entries', jsonb_build_array(
        jsonb_build_object('account_id', v_ob_htg_id,  'currency', 'HTG', 'debit', v_gap, 'credit', 0),
        jsonb_build_object('account_id', v_settled_id, 'currency', 'HTG', 'debit', 0,     'credit', v_gap)
      )
    ));
    RAISE NOTICE 'Posted HTG correction of % for CUSTOMER_HTG_SETTLED', v_gap;
  END IF;
END;
$$;

-- 3. Correcting entry for CUSTOMER_USDC_PAYABLE (system account, no customer_id):
--    Payout backfill debited this account for historical payouts where no
--    per-customer account existed, but the original USDC credits went to
--    per-customer accounts. Post an opening-balance credit to zero it out.
DO $$
DECLARE
  v_gap         numeric;
  v_payable_id  uuid;
  v_ob_usdc_id  uuid;
BEGIN
  SELECT SUM(le.debit) - SUM(le.credit) INTO v_gap
  FROM   public.ledger_entries le
  JOIN   public.ledger_accounts la ON la.id = le.account_id
  WHERE  la.code = 'CUSTOMER_USDC_PAYABLE'
    AND  la.customer_id IS NULL;

  IF v_gap IS NULL OR v_gap <= 0 THEN
    RAISE NOTICE 'CUSTOMER_USDC_PAYABLE gap is % — no correction needed', v_gap;
  ELSE
    SELECT id INTO v_payable_id
    FROM   public.ledger_accounts
    WHERE  code = 'CUSTOMER_USDC_PAYABLE' AND customer_id IS NULL;

    SELECT id INTO v_ob_usdc_id FROM public.ledger_accounts WHERE code = 'OPENING_BALANCE_USDC';

    IF v_payable_id IS NULL OR v_ob_usdc_id IS NULL THEN
      RAISE EXCEPTION 'Required ledger accounts not found';
    END IF;

    PERFORM public.post_ledger_entries(jsonb_build_object(
      'kind',        'opening_balance',
      'description', 'Correcting entry: payout backfill gap in CUSTOMER_USDC_PAYABLE',
      'source_key',  'correction:CUSTOMER_USDC_PAYABLE:payout_gap',
      'entries', jsonb_build_array(
        jsonb_build_object('account_id', v_ob_usdc_id,  'currency', 'USDC', 'debit', v_gap, 'credit', 0),
        jsonb_build_object('account_id', v_payable_id,  'currency', 'USDC', 'debit', 0,     'credit', v_gap)
      )
    ));
    RAISE NOTICE 'Posted USDC correction of % for CUSTOMER_USDC_PAYABLE', v_gap;
  END IF;
END;
$$;
