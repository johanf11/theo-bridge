-- Update handle_new_user trigger to auto-accept pending org invites.
--
-- When an invited user signs up (via the magic-link email), their email
-- will already exist in org_members with accepted_at IS NULL. Instead of
-- creating a new blank customers row for them, we link their user_id to
-- the pending invite and set accepted_at = now().
--
-- Normal new customers (no pending invite) flow through unchanged.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Check for a pending org invite for this email
  IF EXISTS (
    SELECT 1 FROM public.org_members
    WHERE email = NEW.email AND accepted_at IS NULL
  ) THEN
    -- Accept all pending invites for this email (handles edge case of multiple orgs)
    UPDATE public.org_members
    SET user_id = NEW.id, accepted_at = now()
    WHERE email = NEW.email AND accepted_at IS NULL;

    -- Still create a user_roles row so auth/RLS works correctly
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'customer');
    RETURN NEW;
  END IF;

  -- Normal new customer signup — create customers + user_roles rows
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
