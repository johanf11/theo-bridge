insert into public.app_settings (key, value)
values (
  'owlting_omnibus_address',
  jsonb_build_object('address', 'GDXYHOGRCS5AU745ZAIWVYI2TZ5TFZPZPGTLKOYRMYI2UHWSGJBTCEAW')
)
on conflict (key) do nothing;