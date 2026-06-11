ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS display_order integer;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY created_at) AS rn
  FROM public.wallets
  WHERE display_order IS NULL
)
UPDATE public.wallets w
SET display_order = ranked.rn
FROM ranked
WHERE w.id = ranked.id;

CREATE INDEX IF NOT EXISTS idx_wallets_customer_display_order
  ON public.wallets (customer_id, display_order);