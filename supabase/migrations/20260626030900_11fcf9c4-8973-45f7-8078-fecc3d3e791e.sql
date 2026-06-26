ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS api_idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS orders_customer_api_idempotency_key_unique
  ON public.orders (customer_id, api_idempotency_key)
  WHERE api_idempotency_key IS NOT NULL;

DO $$
DECLARE
  v_ids uuid[];
BEGIN
  SELECT array_agg(id) INTO v_ids
  FROM public.orders
  WHERE reference_number LIKE 'THEO-ODO-%'
    AND status = 'QUOTED';

  IF v_ids IS NULL OR array_length(v_ids, 1) = 0 THEN
    RETURN;
  END IF;

  DELETE FROM public.ledger_entries
  WHERE transaction_id IN (
    SELECT id FROM public.ledger_transactions WHERE order_id = ANY(v_ids)
  );

  DELETE FROM public.ledger_transactions
  WHERE order_id = ANY(v_ids);

  DELETE FROM public.orders
  WHERE id = ANY(v_ids);
END $$;