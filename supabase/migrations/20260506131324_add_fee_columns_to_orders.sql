-- Add fee tracking columns to orders for revenue accrual
-- fee_bps / theo_fee_bps / corridor_bps  : basis-point rates at time of quote
-- usdc_gross                              : pre-fee USDC (what the customer sends)
-- fee_usdc                                : total fee in USDC  (usdc_gross * fee_bps / 10000)
-- theo_fee_usdc                           : Theo revenue portion (usdc_gross * theo_fee_bps / 10000)
-- usdc_amount stays as the net amount the customer receives (usdc_gross - fee_usdc)

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS fee_bps       integer,          -- total bps charged (theo + corridor)
  ADD COLUMN IF NOT EXISTS theo_fee_bps  integer,          -- Theo's revenue portion in bps
  ADD COLUMN IF NOT EXISTS corridor_bps  integer,          -- corridor cost in bps
  ADD COLUMN IF NOT EXISTS fee_usdc      numeric(18,7),    -- total fee amount in USDC
  ADD COLUMN IF NOT EXISTS theo_fee_usdc numeric(18,7),    -- Theo revenue in USDC
  ADD COLUMN IF NOT EXISTS usdc_gross    numeric(18,7);    -- pre-fee USDC notional
