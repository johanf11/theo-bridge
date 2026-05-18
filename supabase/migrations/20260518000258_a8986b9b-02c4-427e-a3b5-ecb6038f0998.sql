DO $$
DECLARE
  v_order_id    uuid;
  v_htg_amount  numeric;
  v_source_key  text;
  v_fx_htg_id   uuid;
  v_spih_id     uuid;
  v_exists      boolean;
BEGIN
  SELECT id, htg_amount INTO v_order_id, v_htg_amount
  FROM public.orders
  WHERE reference_number = 'THEO-W-E34165B5';

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order THEO-W-E34165B5 not found';
  END IF;

  v_source_key := 'orders:' || v_order_id::text || ':htgc_burn_withdraw';

  SELECT EXISTS(
    SELECT 1 FROM public.ledger_transactions WHERE source_key = v_source_key
  ) INTO v_exists;

  IF v_exists THEN
    RAISE NOTICE 'Already posted — nothing to do';
    RETURN;
  END IF;

  SELECT id INTO v_fx_htg_id FROM public.ledger_accounts WHERE code = 'FX_CLEARING_HTG';
  SELECT id INTO v_spih_id   FROM public.ledger_accounts WHERE code = 'SPIH_BANK_HTG';

  PERFORM public.post_ledger_entries(jsonb_build_object(
    'kind',             'htgc_burn_withdraw',
    'description',      'HTG-C burn for withdrawal THEO-W-E34165B5',
    'source_key',       v_source_key,
    'stellar_tx_hash',  'f46fccbb47999b0539d9a5d2b4b590949f37db2bfae74d51f1d4470408f2d8ad',
    'order_id',         v_order_id,
    'entries', jsonb_build_array(
      jsonb_build_object('account_id', v_fx_htg_id, 'currency', 'HTG', 'debit', v_htg_amount, 'credit', 0),
      jsonb_build_object('account_id', v_spih_id,   'currency', 'HTG', 'debit', 0, 'credit', v_htg_amount)
    )
  ));

  RAISE NOTICE 'Posted missing htgc_burn_withdraw for THEO-W-E34165B5: % HTG', v_htg_amount;
END;
$$;