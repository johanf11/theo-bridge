-- Tighten federation_addresses.memo_type to only ('text', 'id').
-- 'hash' was allowed by the original constraint but send-payment returns 400
-- for it, so it was never usable in practice. Nullify any existing 'hash'
-- rows before dropping and recreating the constraint.
update public.federation_addresses set memo_type = null where memo_type = 'hash';

alter table public.federation_addresses
  drop constraint if exists federation_addresses_memo_type_check;

alter table public.federation_addresses
  add constraint federation_addresses_memo_type_check
  check (memo_type in ('text', 'id'));
