CREATE OR REPLACE FUNCTION public.notify_admin_on_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net', 'extensions'
AS $function$
DECLARE
  webhook_secret text;
BEGIN
  IF NEW.status = 'QUOTED' THEN
    -- Read the shared secret from Vault so the edge function can authenticate
    -- this database webhook the same way it authenticates Telegram callbacks.
    SELECT decrypted_secret INTO webhook_secret
      FROM vault.decrypted_secrets
     WHERE name = 'TELEGRAM_WEBHOOK_SECRET'
     LIMIT 1;

    PERFORM net.http_post(
      url := 'https://nlbnmsiqfywskuxhqjon.supabase.co/functions/v1/notify-admin',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Telegram-Bot-Api-Secret-Token', COALESCE(webhook_secret, '')
      ),
      body := jsonb_build_object('record', row_to_json(NEW))
    );
  END IF;
  RETURN NEW;
END;
$function$;