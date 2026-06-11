-- Persist HTG-C ↔ USDC swap leg so receipts and reporting can branch correctly.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS swap_direction text;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_swap_direction_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_swap_direction_check
  CHECK (swap_direction IS NULL OR swap_direction IN ('htgc_to_usdc', 'usdc_to_htgc'));

COMMENT ON COLUMN public.orders.swap_direction IS
  'When order_kind = htgc_usdc_swap: htgc_to_usdc (sell HTG-C) or usdc_to_htgc (buy HTG-C).';
