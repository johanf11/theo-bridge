alter table public.orders
  add column if not exists payout_memo text,
  add column if not exists payout_memo_type text check (payout_memo_type in ('text','id'));