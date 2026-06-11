ALTER TABLE public.customers DISABLE TRIGGER USER;

UPDATE public.customers
SET kyb_status = 'APPROVED',
    stellar_wallet_address = 'GCP6VMZS3SJ4CSOT3ZVMMJIOXOHTMJK47YQ4RTUJN7P2KYKDVRCUBS2X',
    updated_at = now()
WHERE id = '1b4247b8-e05a-488d-ba50-8e067ed5c48f';

ALTER TABLE public.customers ENABLE TRIGGER USER;