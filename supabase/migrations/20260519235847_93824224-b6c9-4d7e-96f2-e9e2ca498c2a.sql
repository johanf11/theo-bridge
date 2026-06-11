CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.org_members
    WHERE email = NEW.email AND accepted_at IS NULL
  ) THEN
    UPDATE public.org_members
    SET user_id = NEW.id, accepted_at = now()
    WHERE email = NEW.email AND accepted_at IS NULL;

    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'customer');
    RETURN NEW;
  END IF;

  INSERT INTO public.customers (user_id, company_name, email, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'company_name', 'Unnamed Company'),
    NEW.email,
    NEW.raw_user_meta_data->>'phone'
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'customer');
  RETURN NEW;
END;
$$;