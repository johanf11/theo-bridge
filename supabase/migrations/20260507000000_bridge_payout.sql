-- Cross-chain bridge support for payouts (Stellar → Solana / Base via Allbridge Core)
--
-- BRIDGING: Stellar leg submitted; awaiting delivery on destination chain.
-- destination_chain: null = native Stellar payout (default), 'solana' | 'base' = cross-chain.
-- platform_fee_usdc: Theo's 25 bps surcharge, deducted before sending to Allbridge.
-- bridge_fee_usdc:   Allbridge network fee estimate at quote time; deducted on destination side.

ALTER TYPE payout_status ADD VALUE IF NOT EXISTS 'BRIDGING';

ALTER TABLE payouts
  ADD COLUMN IF NOT EXISTS destination_chain  text
    CHECK (destination_chain IN ('solana', 'base')),
  ADD COLUMN IF NOT EXISTS platform_fee_usdc  numeric(18, 7),
  ADD COLUMN IF NOT EXISTS bridge_fee_usdc    numeric(18, 7);

COMMENT ON COLUMN payouts.destination_chain  IS 'null = Stellar; ''solana'' | ''base'' = Allbridge cross-chain';
COMMENT ON COLUMN payouts.platform_fee_usdc  IS 'Theo bridge surcharge (25 bps of gross send amount)';
COMMENT ON COLUMN payouts.bridge_fee_usdc    IS 'Allbridge network fee estimate shown at quote time';
