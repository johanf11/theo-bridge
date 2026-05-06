ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS fee_bps       integer,
  ADD COLUMN IF NOT EXISTS theo_fee_bps  integer,
  ADD COLUMN IF NOT EXISTS corridor_bps  integer,
  ADD COLUMN IF NOT EXISTS fee_usdc      numeric(18,7),
  ADD COLUMN IF NOT EXISTS theo_fee_usdc numeric(18,7),
  ADD COLUMN IF NOT EXISTS usdc_gross    numeric(18,7);