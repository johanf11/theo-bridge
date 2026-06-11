update public.federation_addresses set memo_type = null where memo_type = 'hash';

alter table public.federation_addresses
  drop constraint if exists federation_addresses_memo_type_check;

alter table public.federation_addresses
  add constraint federation_addresses_memo_type_check
  check (memo_type in ('text', 'id'));