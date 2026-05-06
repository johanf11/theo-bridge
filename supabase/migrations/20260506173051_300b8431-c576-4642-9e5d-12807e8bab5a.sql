ALTER TABLE public.customers ALTER COLUMN fee_bps SET DEFAULT 130;
UPDATE public.customers SET fee_bps = 130 WHERE fee_bps = 150;