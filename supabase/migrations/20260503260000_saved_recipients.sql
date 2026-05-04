create table if not exists saved_recipients (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references customers(id) on delete cascade,
  name            text not null,
  stellar_address text not null,
  label           text,
  created_at      timestamptz not null default now(),
  unique(customer_id, stellar_address)
);

alter table saved_recipients enable row level security;

create policy "customers can manage own saved recipients"
  on saved_recipients for all
  using (customer_id in (select id from customers where user_id = auth.uid()))
  with check (customer_id in (select id from customers where user_id = auth.uid()));

create policy "service role full access on saved_recipients"
  on saved_recipients for all
  to service_role
  using (true)
  with check (true);

create index saved_recipients_customer_id_idx on saved_recipients(customer_id, created_at desc);
