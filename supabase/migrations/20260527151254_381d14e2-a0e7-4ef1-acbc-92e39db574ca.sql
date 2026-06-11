CREATE POLICY "Anon read rates" ON public.rate_snapshots FOR SELECT TO anon USING (true);
GRANT SELECT ON public.rate_snapshots TO anon;