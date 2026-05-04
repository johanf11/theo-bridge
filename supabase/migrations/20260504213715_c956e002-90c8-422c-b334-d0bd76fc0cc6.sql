-- Add order kind to distinguish USDC conversions from HTG-C mints
DO $$ BEGIN
  CREATE TYPE public.order_kind AS ENUM ('usdc_conversion', 'htgc_mint');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_kind public.order_kind NOT NULL DEFAULT 'usdc_conversion';

-- Allow nulls for HTG-C mint deposits (no USDC, no rate)
ALTER TABLE public.orders ALTER COLUMN usdc_amount DROP NOT NULL;
ALTER TABLE public.orders ALTER COLUMN rate DROP NOT NULL;
ALTER TABLE public.orders ALTER COLUMN spot_rate DROP NOT NULL;