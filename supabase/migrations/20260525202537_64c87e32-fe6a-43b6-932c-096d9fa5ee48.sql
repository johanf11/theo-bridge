CREATE OR REPLACE FUNCTION public.notify_admin_on_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'net', 'extensions'
AS $$
BEGIN
  IF NEW.status = 'QUOTED' THEN
    PERFORM net.http_post(
      url := 'https://nlbnmsiqfywskuxhqjon.supabase.co/functions/v1/notify-admin',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := jsonb_build_object('record', row_to_json(NEW))
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_admin_on_order() FROM PUBLIC, anon, authenticated;