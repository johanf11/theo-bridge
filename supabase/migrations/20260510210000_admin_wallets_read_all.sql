-- Allow admin users to read all wallets across all customers (firm-wide).
-- Used by the HTG-C issuance controls panel in Settings.
create policy "wallets_admin_select_all" on public.wallets
  for select
  using (
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid()
      and role = 'admin'
    )
  );
