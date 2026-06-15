-- Enum value must be added in its own transaction before use
ALTER TYPE public.kyb_status ADD VALUE IF NOT EXISTS 'CHANGES_REQUESTED';

COMMIT;

-- Columns to carry reviewer feedback back to the customer
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS kyb_review_notes text,
  ADD COLUMN IF NOT EXISTS kyb_requested_changes text[];

-- Update protect_customer_fields trigger to also allow CHANGES_REQUESTED -> UNDER_REVIEW
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

  -- Row owner: lock fee/corridor/kyb_rejection_reason/review_notes; allow other self-updates
  IF NEW.user_id = auth.uid() THEN
    NEW.fee_bps := OLD.fee_bps;
    NEW.corridor_bps := OLD.corridor_bps;
    NEW.kyb_rejection_reason := OLD.kyb_rejection_reason;
    NEW.kyb_review_notes := OLD.kyb_review_notes;
    NEW.kyb_requested_changes := OLD.kyb_requested_changes;
    -- Allow kyb_status only for the PENDING/REJECTED/CHANGES_REQUESTED -> UNDER_REVIEW transition
    IF NEW.kyb_status IS DISTINCT FROM OLD.kyb_status THEN
      IF NOT (
        OLD.kyb_status IN ('PENDING'::kyb_status, 'REJECTED'::kyb_status, 'CHANGES_REQUESTED'::kyb_status)
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
      OLD.kyb_status IN ('PENDING'::kyb_status, 'REJECTED'::kyb_status, 'CHANGES_REQUESTED'::kyb_status)
      AND NEW.kyb_status = 'UNDER_REVIEW'::kyb_status
    ) THEN
      NEW.kyb_status := OLD.kyb_status;
    END IF;
  END IF;
  NEW.stellar_wallet_address := OLD.stellar_wallet_address;
  NEW.kyb_rejection_reason := OLD.kyb_rejection_reason;
  NEW.kyb_review_notes := OLD.kyb_review_notes;
  NEW.kyb_requested_changes := OLD.kyb_requested_changes;
  NEW.fee_bps := OLD.fee_bps;
  NEW.corridor_bps := OLD.corridor_bps;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;