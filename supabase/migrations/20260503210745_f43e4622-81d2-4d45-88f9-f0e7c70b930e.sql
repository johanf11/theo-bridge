ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS destination_stellar_address text;

UPDATE public.orders SET destination_stellar_address = destination_wallet_address WHERE destination_stellar_address IS NULL AND destination_wallet_address IS NOT NULL;

UPDATE public.customers SET stellar_wallet_address = 'GBGNNLK7H2UAN2MWG6VHJGWQA2H4VIIS4EL2VW6C4A3MRAYBUWNF2NEY' WHERE id = '1b4247b8-e05a-488d-ba50-8e067ed5c48f';