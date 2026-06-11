-- Extend kyb_status enum
ALTER TYPE public.kyb_status ADD VALUE IF NOT EXISTS 'UNDER_REVIEW';

-- Add KYB fields to customers
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS registration_number text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS business_type text,
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS kyb_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS kyb_rejection_reason text;

-- Update protect_customer_fields: allow self-transition PENDING -> UNDER_REVIEW only
CREATE OR REPLACE FUNCTION public.protect_customer_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    -- Allow customer to submit (PENDING/REJECTED -> UNDER_REVIEW); otherwise lock status
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
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS protect_customer_fields_trigger ON public.customers;
CREATE TRIGGER protect_customer_fields_trigger
  BEFORE UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_customer_fields();

-- Storage bucket for KYB documents (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('kyb-documents', 'kyb-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: customers manage own folder, admins read all
DROP POLICY IF EXISTS "KYB customers read own docs" ON storage.objects;
CREATE POLICY "KYB customers read own docs"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'kyb-documents'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.has_role(auth.uid(), 'admin'::app_role)
  )
);

DROP POLICY IF EXISTS "KYB customers upload own docs" ON storage.objects;
CREATE POLICY "KYB customers upload own docs"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'kyb-documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "KYB customers update own docs" ON storage.objects;
CREATE POLICY "KYB customers update own docs"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'kyb-documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "KYB admins delete docs" ON storage.objects;
CREATE POLICY "KYB admins delete docs"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'kyb-documents'
  AND public.has_role(auth.uid(), 'admin'::app_role)
);