ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS usdc_conversion_limits;
ALTER TABLE public.orders ADD CONSTRAINT usdc_conversion_limits CHECK (
  order_kind <> 'usdc_conversion'::order_kind
  OR usdc_amount IS NULL
  OR usdc_amount >= 1000
);