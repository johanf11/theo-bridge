create table if not exists public.invoices (
  id                uuid        primary key default gen_random_uuid(),
  customer_id       uuid        not null references public.customers(id) on delete cascade,
  invoice_number    text        not null,
  client_name       text        not null,
  client_email      text,
  currency          text        not null default 'USDC' check (currency in ('USDC', 'HTG-C')),
  line_items        jsonb       not null default '[]',
  discount_type     text        check (discount_type in ('flat', 'percent')),
  discount_value    numeric(18,7) not null default 0,
  subtotal          numeric(18,7) not null default 0,
  total             numeric(18,7) not null default 0,
  payment_wallet_id uuid        references public.wallets(id) on delete set null,
  due_date          date,
  note              text,
  status            text        not null default 'DRAFT' check (status in ('DRAFT', 'SENT', 'PAID', 'OVERDUE')),
  paid_at           timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.invoices enable row level security;

create policy "invoices_owner" on public.invoices
  for all
  using (
    customer_id in (
      select id from public.customers where user_id = auth.uid()
    )
  )
  with check (
    customer_id in (
      select id from public.customers where user_id = auth.uid()
    )
  );

create index if not exists invoices_customer_id_idx on public.invoices(customer_id);
create index if not exists invoices_status_idx on public.invoices(status);