DO $$
DECLARE
  v_secret text;
  v_req_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1;
  IF v_secret IS NULL THEN RAISE EXCEPTION 'CRON_SECRET missing'; END IF;
  SELECT net.http_post(
    url := 'https://nlbnmsiqfywskuxhqjon.supabase.co/functions/v1/admin-authorize-trustline',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', v_secret),
    body := jsonb_build_object('trustor','GDXYHOGRCS5AU745ZAIWVYI2TZ5TFZPZPGTLKOYRMYI2UHWSGJBTCEAW','asset_code','USDC'),
    timeout_milliseconds := 60000
  ) INTO v_req_id;
  RAISE NOTICE 'http request id: %', v_req_id;
END $$;