
-- 1. Harden has_role: remove session-variable bypass branch
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
      AND (
        _user_id = auth.uid()
        OR auth.role() = 'service_role'
      )
  );
$function$;

-- 2. Remove customer INSERT policy on wallets (creation must go through edge function)
DROP POLICY IF EXISTS "Customers insert own wallets" ON public.wallets;

-- 3. Lock sensitive fields on customer UPDATE via trigger
CREATE OR REPLACE FUNCTION public.protect_wallet_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Service role and admins bypass all protections
  IF current_setting('role', true) = 'service_role'
     OR auth.role() = 'service_role'
     OR public.has_role(auth.uid(), 'admin') THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- Customers may only change safe presentation fields (label, display_order).
  -- Force all other fields back to their previous values.
  NEW.stellar_address  := OLD.stellar_address;
  NEW.stellar_secret   := OLD.stellar_secret;
  NEW.has_signing_key  := OLD.has_signing_key;
  NEW.usdc_balance     := OLD.usdc_balance;
  NEW.customer_id      := OLD.customer_id;
  NEW.wallet_type      := OLD.wallet_type;
  NEW.network          := OLD.network;
  NEW.currency         := OLD.currency;
  NEW.updated_at       := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_wallet_fields ON public.wallets;
CREATE TRIGGER trg_protect_wallet_fields
BEFORE UPDATE ON public.wallets
FOR EACH ROW
EXECUTE FUNCTION public.protect_wallet_fields();
