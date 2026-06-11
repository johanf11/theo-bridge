create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

CREATE OR REPLACE FUNCTION public.setup_daily_tx_cron()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault, cron
AS $fn$
DECLARE
  v_secret text;
  v_url    text := 'https://nlbnmsiqfywskuxhqjon.supabase.co/functions/v1/scheduled-tx';
  v_sql    text;
  v_id_cig bigint;
  v_id_md  bigint;
BEGIN
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1;
  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'CRON_SECRET missing from Vault';
  END IF;

  -- Unschedule existing copies (idempotent)
  PERFORM cron.unschedule(jobid) FROM cron.job
    WHERE jobname IN ('daily-tx-cig','daily-tx-mache-delma');

  v_sql := format(
    $cmd$select net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', %L),
      body := %L::jsonb,
      timeout_milliseconds := 120000
    );$cmd$,
    v_url, v_secret,
    '{"customer":"Caribbean Import Group S.A.","slug":"cig"}'
  );
  v_id_cig := cron.schedule('daily-tx-cig', '15 14 * * 1-5', v_sql);

  v_sql := format(
    $cmd$select net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', %L),
      body := %L::jsonb,
      timeout_milliseconds := 120000
    );$cmd$,
    v_url, v_secret,
    '{"customer":"Mache Delma","slug":"md"}'
  );
  v_id_md := cron.schedule('daily-tx-mache-delma', '15 14 * * 1-5', v_sql);

  RETURN jsonb_build_object('cig', v_id_cig, 'md', v_id_md);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.setup_daily_tx_cron() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.setup_daily_tx_cron() TO service_role;