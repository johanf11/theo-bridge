UPDATE public.app_settings SET value = jsonb_set(COALESCE(value,'{}'::jsonb), '{address}', '"GDXYHOGRCS5AU745ZAIWVYI2TZ5TFZPZPGTLKOYRMYI2UHWSGJBTCEAW"'::jsonb) WHERE key = 'owlting_omnibus_address';
INSERT INTO public.app_settings (key, value)
SELECT 'owlting_omnibus_address', jsonb_build_object('address','GDXYHOGRCS5AU745ZAIWVYI2TZ5TFZPZPGTLKOYRMYI2UHWSGJBTCEAW','provisioned_at', now()::text)
WHERE NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key='owlting_omnibus_address');

-- Reconcile failed order so a fresh quote can be issued
UPDATE public.orders
SET failure_reason = 'Owlting omnibus not provisioned on testnet at time of attempt — fixed; please re-issue from Odoo.'
WHERE reference_number = 'THEO-ODO-GPK3W7';