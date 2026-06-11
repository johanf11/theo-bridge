
-- 1) Lock stellar_secret column from client roles. RLS row policies remain;
--    column-level privileges block SELECT of this single column for non-service roles.
REVOKE SELECT (stellar_secret) ON public.wallets FROM anon, authenticated;

-- 2) Extend protect_customer_fields() to also lock fee_bps and corridor_bps for the row owner.
CREATE OR REPLACE FUNCTION public.protect_customer_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Allow service_role and admins to bypass all protections
  IF current_setting('role', true) = 'service_role'
     OR auth.role() = 'service_role'
     OR public.has_role(auth.uid(), 'admin') THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- Row owner: lock fee/corridor/kyb_rejection_reason; allow other self-updates
  IF NEW.user_id = auth.uid() THEN
    NEW.fee_bps := OLD.fee_bps;
    NEW.corridor_bps := OLD.corridor_bps;
    NEW.kyb_rejection_reason := OLD.kyb_rejection_reason;
    -- Allow kyb_status only for the PENDING/REJECTED -> UNDER_REVIEW transition
    IF NEW.kyb_status IS DISTINCT FROM OLD.kyb_status THEN
      IF NOT (
        OLD.kyb_status IN ('PENDING'::kyb_status, 'REJECTED'::kyb_status)
        AND NEW.kyb_status = 'UNDER_REVIEW'::kyb_status
      ) THEN
        NEW.kyb_status := OLD.kyb_status;
      END IF;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- Other authenticated users: lock sensitive fields
  IF NEW.kyb_status IS DISTINCT FROM OLD.kyb_status THEN
    IF NOT (
      OLD.kyb_status IN ('PENDING'::kyb_status, 'REJECTED'::kyb_status)
      AND NEW.kyb_status = 'UNDER_REVIEW'::kyb_status
    ) THEN
      NEW.kyb_status := OLD.kyb_status;
    END IF;
  END IF;
  NEW.stellar_wallet_address := OLD.stellar_wallet_address;
  NEW.kyb_rejection_reason := OLD.kyb_rejection_reason;
  NEW.fee_bps := OLD.fee_bps;
  NEW.corridor_bps := OLD.corridor_bps;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

-- Ensure the trigger is attached (it should already be; create only if missing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'protect_customer_fields_trg'
      AND tgrelid = 'public.customers'::regclass
  ) THEN
    CREATE TRIGGER protect_customer_fields_trg
    BEFORE UPDATE ON public.customers
    FOR EACH ROW EXECUTE FUNCTION public.protect_customer_fields();
  END IF;
END$$;
