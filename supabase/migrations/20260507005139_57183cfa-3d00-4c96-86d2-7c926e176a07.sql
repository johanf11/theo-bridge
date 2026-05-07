-- Explicit restrictive policies to guarantee only service_role can write to job_queue.
-- RESTRICTIVE policies are AND-combined with permissive ones, so these act as a hard deny
-- for authenticated/anon regardless of any future permissive policy added by mistake.

CREATE POLICY "Block non-service inserts on job_queue"
  ON public.job_queue
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

CREATE POLICY "Block non-service updates on job_queue"
  ON public.job_queue
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Block non-service deletes on job_queue"
  ON public.job_queue
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated, anon
  USING (false);

-- Ensure service_role retains full access via a permissive policy
CREATE POLICY "Service role full access job_queue"
  ON public.job_queue
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Belt-and-suspenders: revoke table-level write grants from client roles
REVOKE INSERT, UPDATE, DELETE ON public.job_queue FROM authenticated, anon, PUBLIC;