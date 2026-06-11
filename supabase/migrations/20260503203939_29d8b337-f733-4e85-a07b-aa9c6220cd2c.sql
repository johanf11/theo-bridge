ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS stellar_secret text;