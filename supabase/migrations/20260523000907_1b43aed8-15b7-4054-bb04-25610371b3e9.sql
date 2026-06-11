insert into storage.buckets (id, name, public) values ('assets', 'assets', true) on conflict (id) do update set public = true;

create policy "Public read assets" on storage.objects for select using (bucket_id = 'assets');