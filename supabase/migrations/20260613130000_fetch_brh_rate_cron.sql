-- Daily BRH rate fetch via pg_cron (weekdays only).
--
-- Schedule: 13:00 UTC Mon–Fri (0 13 * * 1-5). Do NOT use * for day-of-week:
-- BRH does not publish rates on weekends; a Sat/Sun scrape would re-store
-- Friday's rate with a fresh captured_at and mask Monday's real rate when
-- customers open Convert.

CREATE OR REPLACE FUNCTION public.setup_fetch_brh_rate_cron()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault, cron
AS $fn$
DECLARE
  v_secret text;
  v_url    text := 'https://nlbnmsiqfywskuxhqjon.supabase.co/functions/v1/fetch-brh-rate';
  v_sql    text;
  v_job_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1;
  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'CRON_SECRET missing from Vault';
  END IF;

  PERFORM cron.unschedule(jobid) FROM cron.job
    WHERE jobname = 'fetch-brh-rate-daily';

  v_sql := format(
    $cmd$select net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', %L),
      body := %L::jsonb,
      timeout_milliseconds := 120000
    );$cmd$,
    v_url, v_secret,
    '{}'
  );

  v_job_id := cron.schedule('fetch-brh-rate-daily', '0 13 * * 1-5', v_sql);

  RETURN jsonb_build_object('fetch_brh_rate_daily', v_job_id);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.setup_fetch_brh_rate_cron() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.setup_fetch_brh_rate_cron() TO service_role;

DO $do$
BEGIN
  PERFORM public.setup_fetch_brh_rate_cron();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'setup_fetch_brh_rate_cron() not run during migration (run manually): %', SQLERRM;
END
$do$;
