ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS usdc_min;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS usdc_max;
ALTER TABLE public.orders ADD CONSTRAINT usdc_min CHECK (usdc_amount IS NULL OR usdc_amount >= 0);
ALTER TABLE public.orders ADD CONSTRAINT usdc_conversion_limits CHECK (
  order_kind <> 'usdc_conversion'
  OR usdc_amount IS NULL
  OR (usdc_amount >= 1000 AND usdc_amount <= 50000)
);