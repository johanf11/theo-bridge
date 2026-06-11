-- Backfill fee columns on historical COMPLETED usdc_conversion orders
-- that were created before fee persistence was added to create-quote.
--
-- Logic:
--   Old orders stored the gross USDC in usdc_amount (no fee was deducted).
--   We apply the standard 2.00% all-in fee retroactively:
--     fee_bps       = 200  (2.00% total)
--     theo_fee_bps  = 130  (1.30% Theo net margin)
--     corridor_bps  =  70  (0.70% MoneyGram corridor)
--     usdc_gross    = usdc_amount            (original stored value was gross)
--     fee_usdc      = usdc_gross * 0.0200
--     theo_fee_usdc = usdc_gross * 0.0130
--
-- Only rows where fee_usdc IS NULL are touched (idempotent).

UPDATE orders
SET
  usdc_gross     = usdc_amount,
  fee_bps        = 200,
  theo_fee_bps   = 130,
  corridor_bps   = 70,
  fee_usdc       = ROUND((usdc_amount * 0.0200)::numeric, 7),
  theo_fee_usdc  = ROUND((usdc_amount * 0.0130)::numeric, 7)
WHERE
  status        = 'COMPLETED'
  AND order_kind = 'usdc_conversion'
  AND fee_usdc   IS NULL
  AND usdc_amount IS NOT NULL;
