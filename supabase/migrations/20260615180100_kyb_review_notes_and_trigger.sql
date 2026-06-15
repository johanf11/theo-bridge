-- White-glove KYB review support:
--   * kyb_review_notes: reviewer's suggested edits / comments when sending an
--     application back to the customer. Kept separate from kyb_rejection_reason
--     (hard decline) so the two are not conflated.
--   * protect_customer_fields(): allow customers to resubmit from the new
--     CHANGES_REQUESTED state, and lock kyb_review_notes from non-admin writers.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS kyb_review_notes text;

-- kyb_review_notes is admin/service-role-only for writes. Column-level UPDATE is
-- not granted to authenticated (new columns are not auto-granted after the
-- earlier REVOKE UPDATE ON customers FROM authenticated); service_role retains
-- full UPDATE via GRANT UPDATE ON public.customers TO service_role.

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

  -- Row owner: lock fee/corridor/review fields; allow other self-updates
  IF NEW.user_id = auth.uid() THEN
    NEW.fee_bps := OLD.fee_bps;
    NEW.corridor_bps := OLD.corridor_bps;
    NEW.kyb_rejection_reason := OLD.kyb_rejection_reason;
    NEW.kyb_review_notes := OLD.kyb_review_notes;
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
  NEW.fee_bps := OLD.fee_bps;
  NEW.corridor_bps := OLD.corridor_bps;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

-- White-glove onboarding: allow admins to upload/replace KYB documents into any
-- customer's folder (e.g. paperwork a customer emailed in). Mirrors the existing
-- "admins read all" and "admins delete" storage policies; non-admin customers
-- remain restricted to their own folder by the existing upload policy.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'KYB admins upload docs'
  ) THEN
    CREATE POLICY "KYB admins upload docs"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'kyb-documents'
      AND public.has_role(auth.uid(), 'admin'::app_role)
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'KYB admins update docs'
  ) THEN
    CREATE POLICY "KYB admins update docs"
    ON storage.objects FOR UPDATE TO authenticated
    USING (
      bucket_id = 'kyb-documents'
      AND public.has_role(auth.uid(), 'admin'::app_role)
    );
  END IF;
END$$;
