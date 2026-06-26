ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS vendor_memo TEXT,
  ADD COLUMN IF NOT EXISTS stellar_memo TEXT,
  ADD COLUMN IF NOT EXISTS stellar_memo_source TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_stellar_memo_source_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_stellar_memo_source_check
      CHECK (stellar_memo_source IS NULL OR stellar_memo_source IN ('vendor','theo_ref'));
  END IF;
END $$;