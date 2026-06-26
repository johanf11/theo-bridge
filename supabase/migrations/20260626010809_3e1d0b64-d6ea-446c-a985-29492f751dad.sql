
WITH stuck AS (
  SELECT id FROM public.orders
   WHERE reference_number LIKE 'THEO-ODO-%'
     AND status = 'QUOTED'
), tx AS (
  SELECT id FROM public.ledger_transactions WHERE order_id IN (SELECT id FROM stuck)
)
DELETE FROM public.ledger_entries WHERE transaction_id IN (SELECT id FROM tx);

DELETE FROM public.ledger_transactions
 WHERE order_id IN (SELECT id FROM public.orders WHERE reference_number LIKE 'THEO-ODO-%' AND status = 'QUOTED');

DELETE FROM public.orders
 WHERE reference_number LIKE 'THEO-ODO-%' AND status = 'QUOTED';
