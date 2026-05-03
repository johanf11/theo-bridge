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

  -- Row owner: allow updating their own kyb_status and stellar wallet address
  IF NEW.user_id = auth.uid() THEN
    -- Lock rejection reason for non-admins
    NEW.kyb_rejection_reason := OLD.kyb_rejection_reason;
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
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

-- Ensure service role can update any customer record
DROP POLICY IF EXISTS "Service role updates customers" ON public.customers;
CREATE POLICY "Service role updates customers"
ON public.customers
FOR UPDATE
TO service_role
USING (true)
WITH CHECK (true);
