-- Payouts table for single and bulk USDC payments sent by customers
create type payout_status as enum ('PENDING', 'COMPLETED', 'FAILED');

create table if not exists payouts (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid not null references customers(id) on delete cascade,
  source_wallet_id  uuid references wallets(id) on delete set null,
  recipient_name    text not null,
  recipient_address text not null,
  amount_usdc       numeric(18, 7) not null check (amount_usdc > 0),
  memo              text,
  status            payout_status not null default 'PENDING',
  stellar_tx_hash   text,
  failure_reason    text,
  created_at        timestamptz not null default now(),
  completed_at      timestamptz
);

-- RLS
alter table payouts enable row level security;

create policy "customers can view own payouts"
  on payouts for select
  using (customer_id in (
    select id from customers where user_id = auth.uid()
  ));

create policy "service role full access on payouts"
  on payouts for all
  to service_role
  using (true)
  with check (true);

-- Index for listing by customer
create index payouts_customer_id_idx on payouts(customer_id, created_at desc);
