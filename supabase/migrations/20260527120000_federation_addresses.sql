-- Federation addresses (SEP-0002)
-- Maps alias*theokingdom.com → a customer's Stellar address

create table public.federation_addresses (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid not null references public.customers(id) on delete cascade,
  alias          text not null,          -- e.g. "acra"  →  acra*theokingdom.com
  stellar_address text not null,         -- the G... address this resolves to
  memo_type      text check (memo_type in ('text', 'id', 'hash')),
  memo           text,
  created_at     timestamptz default now(),
  constraint federation_addresses_alias_unique unique (alias),
  constraint federation_addresses_alias_format check (alias ~ '^[a-z0-9][a-z0-9._-]*$')
);

alter table public.federation_addresses enable row level security;

-- Owners and org members can read their own entries
create policy "fed_select" on public.federation_addresses
  for select using (
    customer_id in (
      select id   from public.customers   where user_id = auth.uid()
      union
      select customer_id from public.org_members where user_id = auth.uid() and accepted_at is not null
    )
  );

-- Only the account owner can create
create policy "fed_insert" on public.federation_addresses
  for insert with check (
    customer_id in (
      select id from public.customers where user_id = auth.uid()
    )
  );

-- Only the account owner can delete
create policy "fed_delete" on public.federation_addresses
  for delete using (
    customer_id in (
      select id from public.customers where user_id = auth.uid()
    )
  );

-- Service role full access (needed by the public federation edge function)
create policy "fed_service_role" on public.federation_addresses
  for all using (auth.role() = 'service_role');
